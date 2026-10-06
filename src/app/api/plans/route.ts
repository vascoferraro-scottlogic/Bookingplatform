import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** Public: list active platform plans for onboarding / plan comparison. */
export async function GET() {
  const plans = await prisma.platformPlan.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      priceMonthlyPence: true,
      trialDays: true,
      maxMembers: true,
      maxGreens: true,
      includedStreamingTier: true,
      featureFlags: true,
    },
  });

  return NextResponse.json(plans);
}
