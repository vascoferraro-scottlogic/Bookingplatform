import { prisma } from "@/lib/prisma";
import type { MlFeatureDefinition } from "@prisma/client";

export type { MlFeatureDefinition };

/** Lists all feature definitions ordered by creation date. */
export async function listFeatures(): Promise<MlFeatureDefinition[]> {
  return prisma.mlFeatureDefinition.findMany({ orderBy: { createdAt: "asc" } });
}

/** Lists only ENROLLED features — used by train.py equivalents in TS context. */
export async function getEnrolledFeatures(): Promise<MlFeatureDefinition[]> {
  return prisma.mlFeatureDefinition.findMany({
    where: { status: "ENROLLED" },
    orderBy: { createdAt: "asc" },
  });
}

/** Returns counts by status for the dashboard summary card. */
export async function getFeatureSummary(): Promise<{
  enrolled: number;
  available: number;
  retired: number;
}> {
  const rows = await prisma.mlFeatureDefinition.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const map: Record<string, number> = {};
  for (const r of rows) map[r.status] = r._count._all;
  return {
    enrolled: map["ENROLLED"] ?? 0,
    available: map["AVAILABLE"] ?? 0,
    retired: map["RETIRED"] ?? 0,
  };
}
