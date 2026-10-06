/**
 * Committer for proposal kind `FUNDING_APPLICATION_DRAFT`.
 *
 * When a FUNDING_APPLICATION_DRAFT proposal is approved, this committer
 * creates (or updates) a FundingResponse row on the target application
 * with source=AI_APPROVED and links the agentProposalId for audit.
 *
 * If a FundingResponse for the same question already exists on the
 * application, the response content is updated (not duplicated).
 */

import { prisma } from "@/lib/prisma";
import { registerCommitter, type CommitResult } from "./index";

export const FUNDING_APPLICATION_DRAFT_KIND = "FUNDING_APPLICATION_DRAFT";

export interface FundingApplicationDraftPayload {
  applicationId: string;
  /** FK to FundingQuestion if the question came from the opportunity. */
  questionId?: string;
  /** Denormalised label for display + freeform question support. */
  questionLabel: string;
  /** The AI-drafted answer text. */
  draftText: string;
  /** 0-1 confidence the draft is usable without heavy editing. */
  confidence: number;
  /** Short explanation of how the draft was derived. */
  reasoning: string;
}

registerCommitter<FundingApplicationDraftPayload>(
  FUNDING_APPLICATION_DRAFT_KIND,
  async ({ proposal, payload, edits, approverId }): Promise<CommitResult> => {
    const merged: FundingApplicationDraftPayload = {
      ...payload,
      ...(edits ?? {}),
    };

    // Verify the application still exists and belongs to the right tenant.
    const tenantId = proposal.targetTenantId ?? proposal.tenantId;
    const application = await prisma.fundingApplication.findFirst({
      where: {
        id: merged.applicationId,
        ...(tenantId ? { tenantId } : {}),
      },
      select: { id: true },
    });
    if (!application) {
      throw new Error(
        `FundingApplication ${merged.applicationId} not found or tenant mismatch`,
      );
    }

    // Upsert: if a response for the same question already exists, update it.
    const existingResponse = merged.questionId
      ? await prisma.fundingResponse.findFirst({
          where: {
            applicationId: merged.applicationId,
            questionId: merged.questionId,
          },
        })
      : await prisma.fundingResponse.findFirst({
          where: {
            applicationId: merged.applicationId,
            questionLabel: merged.questionLabel,
            questionId: null,
          },
        });

    if (existingResponse) {
      const updated = await prisma.fundingResponse.update({
        where: { id: existingResponse.id },
        data: {
          content: merged.draftText,
          source: "AI_APPROVED",
          agentProposalId: proposal.id,
        },
      });
      return { entityType: "FundingResponse", entityId: updated.id };
    }

    const created = await prisma.fundingResponse.create({
      data: {
        applicationId: merged.applicationId,
        questionId: merged.questionId ?? null,
        questionLabel: merged.questionLabel,
        content: merged.draftText,
        source: "AI_APPROVED",
        agentProposalId: proposal.id,
      },
    });
    return { entityType: "FundingResponse", entityId: created.id };
  },
);
