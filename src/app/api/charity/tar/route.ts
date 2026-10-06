import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  jsonError,
} from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { checkCharityGate } from "@/lib/charity/feature-gate";
import { charityGateError } from "@/lib/charity/api-helpers";
import { getTARSections } from "@/lib/charity/tar-sections";
import type { CharityRegulator } from "@prisma/client";

/**
 * GET /api/charity/tar?yearId=...
 *
 * Returns the TAR for the given year (creates a DRAFT if none exists).
 * Also returns the regulator section definitions so the UI knows what
 * sections to render.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  const permErr = await assertPermissionOrFail(session, tenantId, Permission.charity_edit);
  if (permErr) return permErr;
  const gate = await checkCharityGate(tenantId);
  const gateErr = charityGateError(gate);
  if (gateErr) return gateErr;

  const url = new URL(req.url);
  const yearId = url.searchParams.get("yearId");
  if (!yearId) return jsonError("yearId required");

  const year = await prisma.charityFinancialYear.findFirst({
    where: { id: yearId, tenantId },
  });
  if (!year) return jsonError("yearId not found", 404);

  const settings = await prisma.charitySettings.findUnique({
    where: { tenantId },
    select: { regulator: true },
  });
  if (!settings) return jsonError("Charity settings not configured", 400);

  // Upsert: create DRAFT if not exists
  const tar = await prisma.charityTAR.upsert({
    where: { tenantId_financialYearId: { tenantId, financialYearId: yearId } },
    create: {
      tenantId,
      financialYearId: yearId,
      status: "DRAFT",
      sections: "{}",
    },
    update: {},
  });

  const sections = getTARSections(settings.regulator);

  return NextResponse.json({
    tar: {
      id: tar.id,
      status: tar.status,
      sections: JSON.parse(tar.sections),
      generatedAt: tar.generatedAt,
      finalisedAt: tar.finalisedAt,
    },
    sectionDefinitions: sections,
    regulator: settings.regulator,
    year: { id: year.id, startDate: year.startDate, endDate: year.endDate },
  });
}

/**
 * PATCH /api/charity/tar
 * Body: { yearId, slug, content, source? }
 *
 * Saves a single section's content. Only works while status=DRAFT.
 */
export async function PATCH(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  const permErr = await assertPermissionOrFail(session, tenantId, Permission.charity_edit);
  if (permErr) return permErr;
  const gate = await checkCharityGate(tenantId);
  const gateErr = charityGateError(gate);
  if (gateErr) return gateErr;

  const body = await req.json();
  const { yearId, slug, content, source } = body as {
    yearId?: string;
    slug?: string;
    content?: string;
    source?: string;
  };
  if (!yearId || !slug || content === undefined)
    return jsonError("yearId, slug, and content are required");

  const validSources = ["manual", "suggested", "carried_forward"];
  const sectionSource = validSources.includes(source ?? "") ? source : "manual";

  const tar = await prisma.charityTAR.findUnique({
    where: { tenantId_financialYearId: { tenantId, financialYearId: yearId } },
  });
  if (!tar) return jsonError("TAR not found — GET first to create it", 404);
  if (tar.status === "FINALISED")
    return jsonError("Cannot edit a finalised TAR", 409);

  // Validate slug against regulator sections
  const settings = await prisma.charitySettings.findUnique({
    where: { tenantId },
    select: { regulator: true },
  });
  if (!settings) return jsonError("Charity settings not configured", 400);

  const validSlugs = getTARSections(settings.regulator).map((s) => s.slug);
  if (!validSlugs.includes(slug))
    return jsonError(`Invalid section slug '${slug}'`, 400);

  const existing = JSON.parse(tar.sections) as Record<string, unknown>;
  existing[slug] = {
    content,
    suggestedContent: (existing[slug] as Record<string, unknown> | undefined)
      ?.suggestedContent ?? null,
    lastEditedAt: new Date().toISOString(),
    source: sectionSource,
  };

  const updated = await prisma.charityTAR.update({
    where: { id: tar.id },
    data: { sections: JSON.stringify(existing) },
  });

  return NextResponse.json({
    sections: JSON.parse(updated.sections),
    updatedAt: updated.updatedAt,
  });
}
