import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";

// Slugs the public router or onboarding flow already owns. The admin can't
// claim any of these as their public URL.
const RESERVED_SLUGS = new Set([
  "api",
  "auth",
  "dashboard",
  "onboarding",
  "events",
  "register-club",
  "invite",
  "join",
  "admin",
  "platform",
  "_next",
  "static",
  "public",
  "assets",
  "favicon",
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

function validateSlug(input: unknown): { ok: true; slug: string } | { ok: false; reason: string } {
  if (typeof input !== "string") return { ok: false, reason: "Slug is required" };
  const slug = input.trim().toLowerCase();
  if (slug.length < 3) return { ok: false, reason: "Slug must be at least 3 characters" };
  if (slug.length > 40) return { ok: false, reason: "Slug must be at most 40 characters" };
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      reason: "Slug may only contain lowercase letters, digits and hyphens, and must start and end with a letter or digit",
    };
  }
  if (slug.includes("--")) return { ok: false, reason: "Slug may not contain consecutive hyphens" };
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: "That slug is reserved" };
  return { ok: true, slug };
}

/**
 * GET /api/onboarding/slug?candidate=foo
 *
 * Convenience endpoint for the wizard's live availability check. Returns
 * `{ available: boolean, reason?: string }`. Effective TENANT_ADMIN gate
 * applies (we don't want to expose this to anonymous users).
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const eff = getEffective(session);
  const tenantId = eff.tenantId;
  if (!tenantId) return jsonError("No tenant context", 400);

  const candidate = req.nextUrl.searchParams.get("candidate");
  const v = validateSlug(candidate);
  if (!v.ok) return NextResponse.json({ available: false, reason: v.reason });

  // Slug is "available" if no other tenant uses it. The caller's own current
  // slug is fine (lets the form re-submit unchanged).
  const existing = await prisma.tenant.findUnique({ where: { slug: v.slug }, select: { id: true } });
  if (existing && existing.id !== tenantId) {
    return NextResponse.json({ available: false, reason: "Already taken" });
  }
  return NextResponse.json({ available: true, slug: v.slug });
}

/**
 * PATCH /api/onboarding/slug
 *
 * Body: `{ slug: string }`
 *
 * Sets the tenant's public URL slug during onboarding. Refuses to change
 * once the tenant has gone live (slug is locked at go-live to keep URLs
 * stable). Only the effective TENANT_ADMIN of THIS tenant can change it.
 */
export async function PATCH(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const eff = getEffective(session);
  const tenantId = eff.tenantId;
  if (!tenantId) return jsonError("No tenant context", 400);

  let body: { slug?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  const v = validateSlug(body.slug);
  if (!v.ok) return jsonError(v.reason, 400);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, slug: true, status: true, goLiveAt: true },
  });
  if (!tenant) return jsonError("Tenant not found", 404);
  if (tenant.status === "ACTIVE" || tenant.goLiveAt) {
    return jsonError("Slug is locked once the club has gone live", 409);
  }

  // No-op if unchanged.
  if (tenant.slug === v.slug) {
    return NextResponse.json({ slug: tenant.slug, unchanged: true });
  }

  // Uniqueness check (race-condition-safe via the unique constraint, but
  // friendlier error if we check first).
  const taken = await prisma.tenant.findUnique({ where: { slug: v.slug }, select: { id: true } });
  if (taken && taken.id !== tenantId) return jsonError("Slug already taken", 409);

  const previousSlug = tenant.slug;
  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: { slug: v.slug },
    select: { slug: true },
  });

  logAudit({
    session,
    action: "onboarding.slug.updated",
    entity: "Tenant",
    entityId: tenantId,
    tenantId,
    meta: { previousSlug, newSlug: updated.slug },
  });

  return NextResponse.json({ slug: updated.slug });
}
