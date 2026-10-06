import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { checkCharityGate } from "@/lib/charity/feature-gate";
import { charityGateError } from "@/lib/charity/api-helpers";
import { getTARSections } from "@/lib/charity/tar-sections";
import { getProvider } from "@/lib/agent/providers";
import { LLMRateLimitError } from "@/lib/agent/llm-provider";

/**
 * POST /api/charity/tar/suggest
 * Body: { yearId, slug, context }
 *
 * Uses the LLM to draft narrative text for a single TAR section based
 * on the aggregated platform data (`context` from /tar/context).
 *
 * The `context` object should contain the relevant data buckets for this
 * section (see the section's `dataKeys`). The caller (wizard UI) passes
 * this in so we avoid a redundant second aggregation call.
 *
 * Returns: { suggestedContent, model }
 */
export async function POST(req: NextRequest) {
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
  const { yearId, slug, context } = body as {
    yearId?: string;
    slug?: string;
    context?: Record<string, unknown>;
  };
  if (!yearId || !slug || !context)
    return jsonError("yearId, slug, and context are required");

  // Validate slug
  const settings = await prisma.charitySettings.findUnique({
    where: { tenantId },
    select: { regulator: true },
  });
  if (!settings) return jsonError("Charity settings not configured", 400);

  const sectionDefs = getTARSections(settings.regulator);
  const sectionDef = sectionDefs.find((s) => s.slug === slug);
  if (!sectionDef)
    return jsonError(`Invalid section slug '${slug}'`, 400);

  // Only allow if TAR is still DRAFT
  const tar = await prisma.charityTAR.findUnique({
    where: { tenantId_financialYearId: { tenantId, financialYearId: yearId } },
    select: { id: true, status: true },
  });
  if (!tar) return jsonError("TAR not found — GET /api/charity/tar first", 404);
  if (tar.status === "FINALISED")
    return jsonError("Cannot generate suggestions for a finalised TAR", 409);

  const provider = getProvider();

  const systemPrompt = `You are a professional charity report writer assisting with the Trustees' Annual Report (TAR) for a UK/NI charitable bowling club.

Write factual, clear, concise prose suitable for the "${sectionDef.title}" section.
Use information provided in the data context — do NOT invent facts.
If insufficient data is available for a point, note "[data not available]" rather than fabricating.
Write in the third person ("The charity...") in a formal but accessible tone.
Keep to 2–4 paragraphs unless the data warrants more.
Amounts are in pence — convert to pounds (e.g. 150000 → £1,500.00).
Dates are ISO format — present them naturally (e.g. "2026-04-01" → "1 April 2026").`;

  const userPrompt = `Section: ${sectionDef.title}
Guidance: ${sectionDef.guidance}

Data context:
${JSON.stringify(context, null, 2)}

Write the narrative for this section.`;

  try {
    const result = await provider.call({
      systemPrompt,
      userPrompt,
      temperature: 0.3,
      maxTokens: 1500,
    });

    // Persist suggestedContent in the TAR sections blob
    const tarFull = await prisma.charityTAR.findUniqueOrThrow({
      where: { id: tar.id },
    });
    const sections = JSON.parse(tarFull.sections) as Record<
      string,
      Record<string, unknown>
    >;
    const existing = sections[slug] ?? {};
    sections[slug] = {
      ...existing,
      suggestedContent: result.content as string,
    };

    await prisma.charityTAR.update({
      where: { id: tar.id },
      data: {
        sections: JSON.stringify(sections),
        generatedAt: new Date(),
      },
    });

    return NextResponse.json({
      suggestedContent: result.content,
      model: result.model,
    });
  } catch (e) {
    if (e instanceof LLMRateLimitError) {
      return NextResponse.json(
        { error: "RATE_LIMITED", message: "LLM rate limit reached. Try again shortly." },
        { status: 429 },
      );
    }
    // eslint-disable-next-line no-console
    console.error("[tar/suggest] LLM error:", e);
    return NextResponse.json(
      { error: "LLM_ERROR", message: "Failed to generate suggestion." },
      { status: 502 },
    );
  }
}
