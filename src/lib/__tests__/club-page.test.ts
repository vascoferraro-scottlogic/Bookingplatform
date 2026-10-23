/**
 * Public club page (src/app/[slug]/page.tsx) — event visibility (FR-EVT-003).
 *
 * The page is an async server component. It is called directly and the
 * returned element tree is searched for the EventCard elements it would
 * render, so the test checks what the visitor is actually shown rather than
 * the shape of the query.
 */
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);
jest.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
jest.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
// Child components are stubbed: only the props the page passes them matter.
jest.mock("@/components/events/EventCard", () => ({ __esModule: true, default: function EventCard() { return null; } }));
jest.mock("@/components/ClubNavBar", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/home/UpcomingBookings", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/home/NotificationPreview", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/home/QuickBookButton", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/content/HeroSection", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/content/AboutSection", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/content/PhotoSection", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/content/MapSection", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/content/ContactSection", () => ({ __esModule: true, default: () => null }));

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { isoDateFromToday } from "@/test-utils/dates";
import EventCard from "@/components/events/EventCard";
import PublicClubPage from "@/app/[slug]/page";

const CLUB = { id: "club-1", slug: "lakeview", name: "Lakeview BC" };
const OTHER_CLUB_ID = "club-2";

// ── In-memory data ────────────────────────────────────────

/** Evaluates the subset of Prisma `where` syntax used here against an in-memory row. */
function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "AND") return ([] as any[]).concat(cond).every((c) => matchesWhere(row, c));
    if (key === "OR") return (cond as any[]).some((c) => matchesWhere(row, c));
    if (key === "NOT") return !([] as any[]).concat(cond).some((c) => matchesWhere(row, c));
    if (row?.[key] === undefined && key.includes("_") && cond && typeof cond === "object") return matchesWhere(row, cond);
    return matchesValue(row?.[key], cond);
  });
}
const OPS = new Set(["equals", "in", "notIn", "not", "lt", "lte", "gt", "gte", "contains", "startsWith", "mode", "is", "isNot", "has"]);
function matchesValue(v: any, cond: any): boolean {
  if (cond === null) return v === null || v === undefined;
  if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
  if (typeof cond !== "object") return v === cond;
  if (Array.isArray(v)) {
    if ("some" in cond) return v.some((x) => matchesWhere(x, cond.some));
    if ("every" in cond) return v.every((x) => matchesWhere(x, cond.every));
    if ("none" in cond) return !v.some((x) => matchesWhere(x, cond.none));
  }
  const keys = Object.keys(cond);
  if (keys.length > 0 && keys.every((k) => OPS.has(k))) {
    return keys.every((op) => {
      const x = cond[op];
      switch (op) {
        case "equals": return matchesValue(v, x);
        case "in": return (x as any[]).includes(v);
        case "notIn": return !(x as any[]).includes(v);
        case "not": return !matchesValue(v, x);
        case "lt": return v != null && v < x;
        case "lte": return v != null && v <= x;
        case "gt": return v != null && v > x;
        case "gte": return v != null && v >= x;
        case "contains": return typeof v === "string" && v.includes(x);
        case "startsWith": return typeof v === "string" && v.startsWith(x);
        case "has": return Array.isArray(v) && v.includes(x);
        case "is": return x === null ? v == null : v != null && matchesWhere(v, x);
        case "isNot": return x === null ? v != null : v == null || !matchesWhere(v, x);
        default: return true;
      }
    });
  }
  if (v === null || v === undefined) return false;
  return matchesWhere(v, cond);
}

const event = (id: string, visibility: "PUBLIC" | "MEMBERS_ONLY") => ({
  id, tenantId: CLUB.id, title: id, description: id, category: "SOCIAL", format: null, playerCount: null,
  date: isoDateFromToday(10), startTime: "10:00", endTime: null, location: null, capacity: null,
  entryFee: null, currency: "GBP", imageUrl: null, visibility, status: "PUBLISHED",
});
const EVENTS = [event("public-event", "PUBLIC"), event("members-event", "MEMBERS_ONLY")];

const MEMBERSHIPS = [
  { id: "m-1", userId: "club-member", tenantId: CLUB.id, role: "USER", status: "ACTIVE", kind: "MEMBER" },
  { id: "m-2", userId: "other-member", tenantId: OTHER_CLUB_ID, role: "USER", status: "ACTIVE", kind: "MEMBER" },
];

beforeEach(() => {
  prismaMock.tenant.findUnique.mockResolvedValue({
    ...CLUB, active: true, status: "ACTIVE", brandColor: "#000", logoUrl: null, locale: "en",
    locality: null, openingTime: "08:00", closingTime: "20:00",
  } as never);
  // Every flag a club page can read is on, so nothing but membership decides.
  prismaMock.featureFlag.findUnique.mockResolvedValue({ enabled: true } as never);
  prismaMock.featureFlag.findFirst.mockResolvedValue({ enabled: true } as never);
  prismaMock.contentSection.findMany.mockResolvedValue([] as never);
  prismaMock.event.findMany.mockImplementation((async (a: any = {}) => EVENTS.filter((e) => matchesWhere(e, a.where))) as never);
  const findMembership = (async (a: any = {}) => MEMBERSHIPS.find((m) => matchesWhere(m, a.where)) ?? null) as never;
  prismaMock.membership.findFirst.mockImplementation(findMembership);
  prismaMock.membership.findUnique.mockImplementation(findMembership);
  prismaMock.membership.findMany.mockImplementation((async (a: any = {}) => MEMBERSHIPS.filter((m) => matchesWhere(m, a.where))) as never);
});

/** Ids of the events the rendered page passes to EventCard. */
async function shownEventIds(): Promise<string[]> {
  const tree = await PublicClubPage({ params: Promise.resolve({ slug: CLUB.slug }) });
  const ids: string[] = [];
  const walk = (node: any) => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === EventCard) ids.push(node.props.event.id);
    walk(node.props?.children);
  };
  walk(tree);
  return ids;
}

describe("Public club page — event visibility", () => {
  test("[B-12] FR-EVT-003 – an anonymous visitor sees PUBLIC events only", async () => {
    const ids = await shownEventIds();

    expect(ids).toContain("public-event");
    expect(ids).not.toContain("members-event");
  });

  test("[B-12] FR-EVT-003 – a signed-in member of another club does not see MEMBERS_ONLY events", async () => {
    signInAs({ id: "other-member", role: "USER", tenantId: OTHER_CLUB_ID });

    const ids = await shownEventIds();

    expect(ids).not.toContain("members-event");
  });

  test("[B-12] FR-EVT-003 – a signed-in user with no club does not see MEMBERS_ONLY events", async () => {
    signInAs({ id: "no-club-user", role: "USER", tenantId: null });

    const ids = await shownEventIds();

    expect(ids).not.toContain("members-event");
  });

  test("[B-12] FR-EVT-003 – a member of the club sees its MEMBERS_ONLY and PUBLIC events", async () => {
    signInAs({ id: "club-member", role: "USER", tenantId: CLUB.id });

    const ids = await shownEventIds();

    expect(ids).toEqual(expect.arrayContaining(["public-event", "members-event"]));
  });
});
