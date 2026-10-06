import { prisma } from "@/lib/prisma";
import type { MlModelVersion, MlModelStatus } from "@prisma/client";

export type { MlModelVersion };

/**
 * Returns the currently ACTIVE model version, or null if none exists.
 */
export async function getActiveVersion(): Promise<MlModelVersion | null> {
  return prisma.mlModelVersion.findFirst({ where: { status: "ACTIVE" } });
}

/**
 * Lists all model versions ordered by creation date (newest first).
 */
export async function listVersions(limit = 20): Promise<MlModelVersion[]> {
  return prisma.mlModelVersion.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Promotes a candidate version to ACTIVE and archives the current champion.
 * Does NOT call the sidecar /reload — callers must do that after.
 */
export async function promoteVersion(candidateVersion: string): Promise<MlModelVersion> {
  return prisma.$transaction(async (tx) => {
    // Archive the current champion (if any)
    await tx.mlModelVersion.updateMany({
      where: { status: "ACTIVE" },
      data: { status: "ARCHIVED", updatedAt: new Date() },
    });
    // Promote the candidate
    return tx.mlModelVersion.update({
      where: { version: candidateVersion },
      data: { status: "ACTIVE", promotedAt: new Date(), updatedAt: new Date() },
    });
  });
}

/**
 * Marks a candidate as REJECTED (failed the promotion gate).
 */
export async function rejectVersion(candidateVersion: string, notes?: string): Promise<void> {
  await prisma.mlModelVersion.update({
    where: { version: candidateVersion },
    data: { status: "REJECTED", notes, updatedAt: new Date() },
  });
}

/**
 * Returns the latest drift check for a given model version.
 */
export async function getLatestDriftCheck(modelVersion: string) {
  return prisma.mlDriftCheck.findFirst({
    where: { modelVersion },
    orderBy: { checkedAt: "desc" },
  });
}

/**
 * Returns the last N drift checks for the active version (for trend display).
 */
export async function getDriftHistory(modelVersion: string, limit = 10) {
  return prisma.mlDriftCheck.findMany({
    where: { modelVersion },
    orderBy: { checkedAt: "desc" },
    take: limit,
  });
}
