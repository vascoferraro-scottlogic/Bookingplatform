import { prisma } from "@/lib/prisma";
import type { CharityRegulator } from "@prisma/client";
import { getCategorySeed } from "@/lib/charity/categories";

/**
 * Idempotently seed a tenant's chart of accounts and ensure a default
 * "General" UNRESTRICTED fund exists. Called when CharitySettings is
 * first created (or when a settings POST forces a re-seed for a
 * regulator change). Existing categories with the same code are left
 * untouched so admin-edits to labels survive.
 */
export async function seedCharityDefaults(
  tenantId: string,
  regulator: CharityRegulator,
): Promise<void> {
  const seeds = getCategorySeed(regulator);
  const existing = await prisma.charityCategory.findMany({
    where: { tenantId },
    select: { code: true },
  });
  const existingCodes = new Set(existing.map((c) => c.code));

  const toCreate = seeds.filter((s) => !existingCodes.has(s.code));
  if (toCreate.length > 0) {
    await prisma.charityCategory.createMany({
      data: toCreate.map((s) => ({
        tenantId,
        code: s.code,
        kind: s.kind,
        label: s.label,
        sortOrder: s.sortOrder,
      })),
    });
  }

  // Ensure a default fund exists. Name "General" by convention.
  const generalFund = await prisma.charityFund.findUnique({
    where: { tenantId_name: { tenantId, name: "General" } },
  });
  if (!generalFund) {
    await prisma.charityFund.create({
      data: { tenantId, name: "General", kind: "UNRESTRICTED" },
    });
  }
}
