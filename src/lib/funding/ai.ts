/**
 * Funding AI helpers — shared between the batch agent (`FundingApplicationAgent`)
 * and the per-question refine endpoint.
 *
 * Two entry points:
 *  - `aggregateTenantContext(tenantId)` — collects club facts (profile, members,
 *    events, finances, maintenance, other applications) used as LLM context.
 *  - `refineAnswer({...})` — refines a single response in-place: takes the
 *    current text and an optional user instruction (e.g. "make it more formal"),
 *    returns the new draft text. Used by the inline "Improve with AI" button.
 *
 * The batch agent still owns multi-question whole-application drafting via the
 * proposal-inbox flow.
 */

import { prisma } from "@/lib/prisma";
import { getProvider } from "@/lib/agent/providers";

export interface TenantContext {
  tenantName: string;
  orgType: string | null;
  country: string | null;
  locality: string | null;
  charityNumber: string | null;
  totalMembers: number;
  newMembersThisYear: number | null;
  recentEvents: Array<{ title: string; date: string }>;
  financialSummary: string | null;
  recentMaintenance: Array<{ description: string; date: string }>;
  otherApplications: Array<{ opportunity: string; status: string }>;
}

export async function aggregateTenantContext(tenantId: string): Promise<TenantContext> {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const [tenant, charitySettings, totalMembers, newMembers, events, maintenance, otherApps] =
    await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          name: true,
          organisationType: true,
          country: true,
          locality: true,
        },
      }),
      prisma.charitySettings
        .findUnique({
          where: { tenantId },
          select: { charityNumber: true, reservesPolicy: true },
        })
        .catch(() => null),
      prisma.membership.count({ where: { tenantId, status: "ACTIVE" } }),
      prisma.membership.count({
        where: {
          tenantId,
          status: "ACTIVE",
          startedAt: { gte: oneYearAgo },
        },
      }),
      prisma.event.findMany({
        where: {
          tenantId,
          status: "PUBLISHED",
          // `Event.date` is stored as a string (YYYY-MM-DD).
          date: { gte: oneYearAgo.toISOString().slice(0, 10) },
        },
        select: { title: true, date: true },
        orderBy: { date: "desc" },
        take: 20,
      }),
      prisma.maintenanceHistory.findMany({
        where: { tenantId, performedAt: { gte: oneYearAgo } },
        select: { description: true, performedAt: true },
        orderBy: { performedAt: "desc" },
        take: 10,
      }),
      prisma.fundingApplication.findMany({
        where: { tenantId, status: { not: "DRAFT" } },
        include: { opportunity: { select: { name: true } } },
        take: 10,
      }),
    ]);

  return {
    tenantName: tenant?.name ?? "Unknown Club",
    orgType: tenant?.organisationType ?? null,
    country: tenant?.country ?? null,
    locality: tenant?.locality ?? null,
    charityNumber: charitySettings?.charityNumber ?? null,
    totalMembers,
    newMembersThisYear: newMembers,
    recentEvents: events.map((e) => ({ title: e.title, date: e.date })),
    financialSummary: charitySettings?.reservesPolicy ?? null,
    recentMaintenance: maintenance.map((m) => ({
      description: m.description ?? "Maintenance activity",
      date: m.performedAt.toISOString().slice(0, 10),
    })),
    otherApplications: otherApps.map((a) => ({
      opportunity: a.opportunity.name,
      status: a.status,
    })),
  };
}

/** Format the club context into a prompt block. Shared by batch + refine. */
export function formatContextBlock(ctx: TenantContext): string {
  return [
    `--- Club profile ---`,
    `Name: ${ctx.tenantName}`,
    `Org type: ${ctx.orgType ?? "Not specified"}`,
    `Country: ${ctx.country ?? "Not specified"}`,
    `Locality: ${ctx.locality ?? "Not specified"}`,
    ctx.charityNumber ? `Charity number: ${ctx.charityNumber}` : null,
    `Active members: ${ctx.totalMembers}`,
    ctx.newMembersThisYear != null
      ? `New members this year: ${ctx.newMembersThisYear}`
      : null,
    ``,
    `--- Events & activities ---`,
    ctx.recentEvents.length > 0
      ? ctx.recentEvents.map((e) => `• ${e.title} (${e.date})`).join("\n")
      : "No recent events recorded.",
    ``,
    `--- Financial overview ---`,
    ctx.financialSummary ?? "No financial data available.",
    ``,
    `--- Maintenance & facilities ---`,
    ctx.recentMaintenance.length > 0
      ? ctx.recentMaintenance.map((m) => `• ${m.description} (${m.date})`).join("\n")
      : "No recent maintenance records.",
    ``,
    `--- Existing funding applications ---`,
    ctx.otherApplications.length > 0
      ? ctx.otherApplications
          .map((a) => `• ${a.opportunity} — ${a.status}`)
          .join("\n")
      : "No other applications.",
  ]
    .filter(Boolean)
    .join("\n");
}

const REFINE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    draftText: { type: "string" },
    confidence: { type: "number" },
    notes: { type: "string" },
  },
  required: ["draftText", "confidence"],
};

interface RefineLLMResult {
  draftText: string;
  confidence: number;
  notes?: string;
}

export interface RefineAnswerInput {
  opportunityName: string;
  funder: string;
  opportunityDescription: string;
  questionLabel: string;
  questionHelpText?: string | null;
  /** Existing answer text (may be empty for first-draft). */
  currentText: string;
  /** Optional user instruction, e.g. "more formal", "shorter, emphasise youth". */
  instruction?: string;
  context: TenantContext;
}

export interface RefineAnswerResult {
  draftText: string;
  confidence: number;
  notes: string | null;
  model: string;
}

/**
 * Refine a single answer. Returns the new draft text; caller decides what to
 * persist (typically writes back to FundingResponse with source=AI_DRAFT).
 */
export async function refineAnswer(
  input: RefineAnswerInput,
): Promise<RefineAnswerResult> {
  const provider = getProvider();
  const isFirstDraft = input.currentText.trim().length === 0;

  const systemPrompt = [
    `You are a grant application writing assistant for community bowling clubs.`,
    `You ${isFirstDraft ? "draft" : "refine"} answers to grant application questions`,
    `using the club's data and the user's instruction. Write in the third person`,
    `(the club is the applicant). Be factual — use specific numbers and dates`,
    `from the data provided. Where data is genuinely missing, write a placeholder`,
    `[NEEDS INPUT: describe what's needed].`,
    ``,
    `Length: 100–300 words unless the question only needs a short answer.`,
    `Set confidence 0.9+ when data fully supports the answer, 0.5–0.8 when partial,`,
    `below 0.5 when mostly placeholder.`,
  ].join("\n");

  const instructionBlock = input.instruction?.trim()
    ? `--- User instruction ---\n${input.instruction.trim()}\n\n`
    : "";

  const currentBlock = isFirstDraft
    ? ""
    : `--- Current answer ---\n${input.currentText}\n\n`;

  const userPrompt = [
    `Grant: ${input.opportunityName} (${input.funder})`,
    `Description: ${input.opportunityDescription}`,
    ``,
    formatContextBlock(input.context),
    ``,
    `--- Question ---`,
    input.questionLabel,
    input.questionHelpText ? `Guidance: ${input.questionHelpText}` : null,
    ``,
    currentBlock + instructionBlock,
    `Return JSON: { draftText, confidence (0-1), notes (optional, one sentence on what changed or how data supports it) }.`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await provider.call({
    systemPrompt,
    userPrompt,
    responseSchema: REFINE_RESPONSE_SCHEMA,
    temperature: 0.3,
    maxTokens: 1500,
  });

  const parsed = result.content as RefineLLMResult;
  if (!parsed?.draftText) {
    throw new Error("LLM returned no draft text");
  }

  return {
    draftText: parsed.draftText,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    notes: parsed.notes ?? null,
    model: result.model,
  };
}
