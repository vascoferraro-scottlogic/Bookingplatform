import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/features";

/** Wizard chapters 1–10 (FR-ONB-005). Chapter 10 is Review & Go live. */
export const TOTAL_CHAPTERS = 10;
export const ALL_CHAPTERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** Chapter 5 (greens) is only required when the bookings capability is on. */
export const GREENS_CHAPTER = 5;

export function requiredChapters(bookingsOn: boolean): number[] {
  return bookingsOn ? ALL_CHAPTERS : ALL_CHAPTERS.filter((n) => n !== GREENS_CHAPTER);
}

export function parseCompleted(json: string): number[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed.filter((n): n is number => typeof n === "number");
    return [];
  } catch {
    return [];
  }
}

/**
 * Can this chapter be recorded as complete? Completion is derived from what
 * the server holds (FR-ONB-005), never from the client's say-so. Chapters
 * whose answers aren't stored in a checkable place (hours, people, knowledge,
 * features) are accepted as the admin's confirmation.
 */
export async function chapterDataComplete(
  tenantId: string,
  chapter: number,
  ctx: { completed: Set<number>; subscriptionAttestedAt?: Date | null },
): Promise<boolean> {
  const bookingsOn = await isFeatureEnabled(tenantId, "bookings");
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      name: true,
      slug: true,
      country: true,
      organisationType: true,
      financialYearEndMonth: true,
      financialYearEndDay: true,
      latitude: true,
      longitude: true,
      locality: true,
    },
  });
  if (!tenant) return false;

  switch (chapter) {
    case 1: // About: a name and a real public URL (not the t-xxxx placeholder)
      return !!tenant.name?.trim() && !!tenant.slug && !tenant.slug.startsWith("t-");
    case 2: // Organisation (KYC)
      return (
        !!tenant.country &&
        !!tenant.organisationType &&
        !!tenant.financialYearEndMonth &&
        !!tenant.financialYearEndDay
      );
    case 3: // Where you are
      return !!tenant.locality || (tenant.latitude != null && tenant.longitude != null);
    case GREENS_CHAPTER: {
      if (!bookingsOn) return true;
      const greens = await prisma.green.count({ where: { tenantId, archivedAt: null } });
      return (greens ?? 0) > 0;
    }
    case 9: // Subscription attested
      return !!ctx.subscriptionAttestedAt;
    case 10: // Review: everything else must already be complete
      return requiredChapters(bookingsOn)
        .filter((n) => n !== 10)
        .every((n) => ctx.completed.has(n));
    default:
      return true;
  }
}
