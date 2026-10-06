import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, rejectIfImpersonating, jsonError, getEffective } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";

// Tenant-plane fields. Editing these is a tenant-side action, so it requires
// the **effective** TENANT_ADMIN of the tenant — i.e. either a real
// TENANT_ADMIN, or a PLATFORM_ADMIN who is currently impersonating. A
// non-impersonating PLATFORM_ADMIN cannot reach in to edit these directly:
// they must start an impersonation first. This preserves the orthogonal
// role model (PLATFORM_ADMIN has no implicit tenant powers).
//
// `country`, `organisationType`, `financialYearEnd*` are KYC fields: set in
// onboarding chapter 2 (Your organisation) and editable thereafter from the
// tenant settings page. See decisions log 2026-05-04 (country self-declared).
const TENANT_PLANE_FIELDS = new Set([
  "name",
  "brandColor",
  "logoUrl",
  "locale",
  "seasonStart",
  "seasonEnd",
  "openingTime",
  "closingTime",
  "latitude",
  "longitude",
  "locality",
  "country",
  "organisationType",
  "financialYearEndMonth",
  "financialYearEndDay",
]);

const ALLOWED_COUNTRIES = new Set(["GB", "NI", "OTHER"]);
const ALLOWED_ORG_TYPES = new Set([
  "REGISTERED_CHARITY",
  "CIO",
  "SCIO",
  "CASC",
  "COMMUNITY_INTEREST_COMPANY",
  "LIMITED_COMPANY",
  "UNINCORPORATED_ASSOCIATION",
  "PRIVATE_MEMBERS_CLUB",
  "OTHER",
  "NOT_CONSTITUTED",
]);

// Platform-plane fields. Only a real, non-impersonating PLATFORM_ADMIN may
// flip these — they're how the platform manages a tenant's lifecycle.
const PLATFORM_PLANE_FIELDS = new Set(["status", "active"]);

/** Get a single tenant. PLATFORM_ADMIN any tenant; TENANT_ADMIN own tenant only. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const eff = getEffective(session);
  const isPlatformAdmin = session.user.role === "PLATFORM_ADMIN" && !eff.isImpersonating;

  const { id } = await params;

  if (!isPlatformAdmin) {
    if (eff.role !== "TENANT_ADMIN" && eff.role !== "PLATFORM_ADMIN") {
      return jsonError("Forbidden", 403);
    }
    if (eff.tenantId !== id) return jsonError("Forbidden", 403);
  } else {
    const impErr = rejectIfImpersonating(session);
    if (impErr) return impErr;
  }

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: { greens: { include: { rinks: true } }, featureFlags: true },
    });
    if (!tenant) return jsonError("Not found", 404);
    return NextResponse.json(tenant);
  } catch {
    return jsonError("Failed to fetch tenant", 500);
  }
}

/**
 * Update tenant. Field gating is split by plane:
 *  - Tenant-plane fields (branding, hours, location, name, locale) require
 *    the effective TENANT_ADMIN of the tenant. A non-impersonating
 *    PLATFORM_ADMIN must start an impersonation first.
 *  - Platform-plane fields (status, active) require a real, non-impersonating
 *    PLATFORM_ADMIN.
 *
 * Mixing fields from both planes in one PATCH is rejected to keep audit
 * trails clean and prevent privilege confusion.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;

  let data: Record<string, unknown>;
  try {
    data = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  // Partition the requested keys by plane.
  const platformPlaneRequested: Record<string, unknown> = {};
  const tenantPlaneRequested: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (PLATFORM_PLANE_FIELDS.has(key)) platformPlaneRequested[key] = value;
    else if (TENANT_PLANE_FIELDS.has(key)) tenantPlaneRequested[key] = value;
    // Unknown keys are silently dropped.
  }

  const wantsPlatform = Object.keys(platformPlaneRequested).length > 0;
  const wantsTenant = Object.keys(tenantPlaneRequested).length > 0;

  if (wantsPlatform && wantsTenant) {
    return jsonError("Cannot mix tenant-plane and platform-plane fields in one update.", 400);
  }
  if (!wantsPlatform && !wantsTenant) {
    return jsonError("No editable fields provided.", 400);
  }

  const eff = getEffective(session);
  const isRealPlatformAdmin = session.user.role === "PLATFORM_ADMIN" && !eff.isImpersonating;

  let allowed: Record<string, unknown>;
  let action: string;

  if (wantsPlatform) {
    // Platform-plane gate: real PLATFORM_ADMIN, not impersonating.
    if (!isRealPlatformAdmin) {
      return jsonError("Forbidden: platform-plane fields require a non-impersonating platform admin.", 403);
    }
    allowed = { ...platformPlaneRequested };

    // The admin "Activate" toggle is for ACTIVE ↔ SUSPENDED only. It must
    // NOT be used to bypass go-live: an ONBOARDING tenant has no
    // `goLiveAt`, no flushed invitations, and no `tenant.went_live` audit
    // — flipping `active=true` here would publish a half-built public
    // site at /[slug]. Force admins through the proper go-live flow
    // (impersonate → onboarding wizard → Go Live).
    if ("active" in allowed && !("status" in allowed)) {
      const current = await prisma.tenant.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!current) return jsonError("Tenant not found", 404);
      if (current.status === "ONBOARDING") {
        return jsonError(
          "Use the go-live flow to activate an onboarding tenant. Impersonate the tenant admin and complete the onboarding wizard.",
          409,
        );
      }
      // Keep status coherent with the active flip. (`active` is a
      // DEPRECATED mirror of status === ACTIVE per schema comment.)
      if (allowed.active === true) allowed.status = "ACTIVE";
      else if (allowed.active === false) allowed.status = "SUSPENDED";
    } else if (typeof allowed.status === "string") {
      // Keep `active` boolean mirror in sync.
      allowed.active = allowed.status === "ACTIVE";
    }
    action = allowed.active === true ? "admin.tenant.activated" : allowed.active === false ? "admin.tenant.deactivated" : "admin.tenant.status_changed";
  } else {
    // Tenant-plane gate: effective TENANT_ADMIN of THIS tenant.
    const isEffectiveTenantAdminHere =
      (eff.role === "TENANT_ADMIN" || eff.role === "PLATFORM_ADMIN") && eff.tenantId === id;
    if (!isEffectiveTenantAdminHere) {
      if (isRealPlatformAdmin) {
        return NextResponse.json(
          { error: "PLATFORM_ADMIN_NO_CONTEXT", message: "Start an impersonation to edit tenant content." },
          { status: 403 },
        );
      }
      return jsonError("Forbidden", 403);
    }
    allowed = { ...tenantPlaneRequested };

    // Validate the KYC enum + numeric fields. Other tenant-plane fields are
    // free-text or coords with no further constraints worth enforcing here.
    if ("country" in allowed) {
      if (typeof allowed.country !== "string" || !ALLOWED_COUNTRIES.has(allowed.country)) {
        return jsonError(`country must be one of ${[...ALLOWED_COUNTRIES].join(", ")}`);
      }
    }
    if ("organisationType" in allowed) {
      if (allowed.organisationType !== null) {
        if (typeof allowed.organisationType !== "string" || !ALLOWED_ORG_TYPES.has(allowed.organisationType)) {
          return jsonError(`organisationType must be one of ${[...ALLOWED_ORG_TYPES].join(", ")} or null`);
        }
      }
    }
    if ("financialYearEndMonth" in allowed && allowed.financialYearEndMonth !== null) {
      const m = allowed.financialYearEndMonth;
      if (typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 12) {
        return jsonError("financialYearEndMonth must be 1..12 or null");
      }
    }
    if ("financialYearEndDay" in allowed && allowed.financialYearEndDay !== null) {
      const d = allowed.financialYearEndDay;
      if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > 31) {
        return jsonError("financialYearEndDay must be 1..31 or null");
      }
    }

    action = "admin.tenant.updated";
  }

  try {
    const tenant = await prisma.tenant.update({ where: { id }, data: allowed });
    logAudit({ session, action, entity: "Tenant", entityId: id, tenantId: id, meta: allowed });
    return NextResponse.json(tenant);
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err) {
      const prismaErr = err as { code: string };
      if (prismaErr.code === "P2025") return jsonError("Tenant not found", 404);
      if (prismaErr.code === "P2002") return jsonError("A unique constraint was violated", 409);
    }
    return jsonError("Failed to update tenant", 500);
  }
}
