import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { checkCharityGate } from "@/lib/charity/feature-gate";
import { charityGateError } from "@/lib/charity/api-helpers";
import { getTARSections } from "@/lib/charity/tar-sections";

/**
 * GET /api/charity/tar/export?yearId=...
 *
 * Exports the TAR as structured JSON keyed by regulator section, suitable
 * for pasting into the regulator's template. Only available once finalised.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  const permErr = await assertPermissionOrFail(session, tenantId, Permission.charity_view);
  if (permErr) return permErr;
  const gate = await checkCharityGate(tenantId);
  const gateErr = charityGateError(gate);
  if (gateErr) return gateErr;

  const url = new URL(req.url);
  const yearId = url.searchParams.get("yearId");
  if (!yearId) return jsonError("yearId required");

  const tar = await prisma.charityTAR.findUnique({
    where: { tenantId_financialYearId: { tenantId, financialYearId: yearId } },
    include: { financialYear: true },
  });
  if (!tar) return jsonError("TAR not found", 404);
  if (tar.status !== "FINALISED")
    return jsonError("TAR must be finalised before export", 409);

  const settings = await prisma.charitySettings.findUnique({
    where: { tenantId },
    select: { charityNumber: true, regulator: true },
  });
  if (!settings) return jsonError("Charity settings not configured", 400);

  const sectionDefs = getTARSections(settings.regulator);
  const sections = JSON.parse(tar.sections) as Record<
    string,
    { content?: string; source?: string }
  >;

  // Build export keyed by section slug with title for readability
  const exportSections = sectionDefs.map((def) => ({
    slug: def.slug,
    title: def.title,
    content: sections[def.slug]?.content ?? "",
    required: def.required,
  }));

  return NextResponse.json({
    regulator: settings.regulator,
    charityNumber: settings.charityNumber,
    period: {
      startDate: tar.financialYear.startDate,
      endDate: tar.financialYear.endDate,
    },
    finalisedAt: tar.finalisedAt,
    sections: exportSections,
  });
}
