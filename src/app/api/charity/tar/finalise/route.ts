import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { checkCharityGate } from "@/lib/charity/feature-gate";
import { charityGateError } from "@/lib/charity/api-helpers";
import { getTARSections } from "@/lib/charity/tar-sections";

/**
 * POST /api/charity/tar/finalise
 * Body: { yearId }
 *
 * Validates all required sections are filled, then locks the TAR and
 * the parent financial year.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  const permErr = await assertPermissionOrFail(session, tenantId, Permission.charity_finalise_tar);
  if (permErr) return permErr;
  const gate = await checkCharityGate(tenantId);
  const gateErr = charityGateError(gate);
  if (gateErr) return gateErr;

  const body = await req.json();
  const { yearId } = body as { yearId?: string };
  if (!yearId) return jsonError("yearId required");

  const tar = await prisma.charityTAR.findUnique({
    where: { tenantId_financialYearId: { tenantId, financialYearId: yearId } },
  });
  if (!tar) return jsonError("TAR not found", 404);
  if (tar.status === "FINALISED")
    return jsonError("TAR is already finalised", 409);

  // Validate required sections
  const settings = await prisma.charitySettings.findUnique({
    where: { tenantId },
    select: { regulator: true },
  });
  if (!settings) return jsonError("Charity settings not configured", 400);

  const sectionDefs = getTARSections(settings.regulator);
  const sections = JSON.parse(tar.sections) as Record<
    string,
    { content?: string }
  >;

  const missing = sectionDefs
    .filter((s) => s.required)
    .filter((s) => !sections[s.slug]?.content?.trim())
    .map((s) => s.title);

  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "INCOMPLETE_SECTIONS",
        message: `Required sections are incomplete: ${missing.join(", ")}`,
        missingSections: missing,
      },
      { status: 422 },
    );
  }

  const now = new Date();
  const userId = session.user.id;

  // Lock TAR and year in a transaction
  const [updated] = await prisma.$transaction([
    prisma.charityTAR.update({
      where: { id: tar.id },
      data: {
        status: "FINALISED",
        finalisedAt: now,
        finalisedById: userId,
      },
    }),
    prisma.charityFinancialYear.update({
      where: { id: yearId },
      data: { status: "LOCKED", lockedAt: now, lockedById: userId },
    }),
  ]);

  await logAudit({
    session,
    tenantId,
    action: "CHARITY_TAR_FINALISED",
    entity: "CharityTAR",
    entityId: tar.id,
    meta: { yearId },
  });

  return NextResponse.json({
    status: updated.status,
    finalisedAt: updated.finalisedAt,
  });
}
