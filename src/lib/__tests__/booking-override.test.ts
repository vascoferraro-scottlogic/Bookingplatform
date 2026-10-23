jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson } from "@/test-utils/http";
import { isoDateFromToday } from "@/test-utils/dates";
import { POST } from "@/app/api/bookings/route";

const HOME = "home-club";
const AWAY = "away-club";
const FED = "fed-1";
const HOME_RINK = "home-rink";
const AWAY_RINK = "away-rink";
const HOME_ADMIN = { id: "home-admin", role: "TENANT_ADMIN" as const, tenantId: HOME };
// A home-club member whose home groups grant override + partner booking.
const HOME_OVERRIDER = { id: "home-overrider", role: "USER" as const, tenantId: HOME };

const book = (body: Record<string, unknown>) => POST(jsonRequest("POST", "/api/bookings", body));

const tenantRow = (id: string) => ({
  id,
  name: id === HOME ? "Home Club" : "Away Club",
  slug: id,
  active: true,
  status: "ACTIVE",
  openingTime: "08:00",
  closingTime: "20:00",
  timezone: "Europe/London",
});

const rinkRow = (id: string, tenantId: string, season: Record<string, unknown> = {}) => ({
  id,
  greenId: `green-of-${id}`,
  name: id,
  green: {
    name: `${tenantId} Green`,
    tenantId,
    allWeather: false,
    seasonStartMMDD: null,
    seasonEndMMDD: null,
    seasons: [],
    tenant: tenantRow(tenantId),
    ...season,
  },
});

/** Group grants: permission is held only at the listed tenant. */
function grantAt(tenantId: string, ...permissions: string[]) {
  prismaMock.groupMember.findFirst.mockImplementation((async (args: any) => {
    const where = args?.where ?? {};
    const t = where.group?.tenantId ?? where.membership?.tenantId;
    const p = where.group?.grants?.some?.permission;
    return t === tenantId && permissions.includes(p) ? { id: "gm-1" } : null;
  }) as never);
}

let rinksFor: (tenantId: string) => unknown[];

beforeEach(() => {
  rinksFor = (tenantId) => [tenantId === AWAY ? rinkRow(AWAY_RINK, AWAY) : rinkRow(HOME_RINK, HOME)];
  prismaMock.featureFlag.findUnique.mockImplementation((async (args: any) => {
    const { tenantId, key } = args.where.tenantId_key;
    return key === "federation" ? { tenantId, key, enabled: true } : null;
  }) as never);
  prismaMock.tenant.findUnique.mockImplementation((async (args: any) =>
    [HOME, AWAY].includes(args.where.id) ? tenantRow(args.where.id) : null) as never);
  prismaMock.federationMembership.findMany.mockResolvedValue([{ federationId: FED }] as never);
  prismaMock.federationMembership.findFirst.mockResolvedValue({ federationId: FED } as never);
  prismaMock.rink.findMany.mockImplementation((async (args: any) => rinksFor(args.where.green.tenantId)) as never);
  prismaMock.bookingSlot.findFirst.mockResolvedValue(null);
  prismaMock.bookingSlot.findMany.mockResolvedValue([] as never);
  prismaMock.booking.findMany.mockResolvedValue([] as never);
  prismaMock.booking.findFirst.mockResolvedValue(null);
  prismaMock.booking.create.mockImplementation((async ({ data }: any) => ({
    id: "new-booking",
    ...data,
    slots: data.slots?.create ?? [],
  })) as never);
  prismaMock.notification.create.mockImplementation((async ({ data }: any) => ({ id: "n-1", ...data })) as never);
});

describe("POST /api/bookings - admin override", () => {
  test("[B-46] FR-BOOK-010 – override permission is checked on the booking (target) tenant, not the home tenant → 403", async () => {
    // Holds bookings_admin_override at HOME only; not at the partner club.
    signInAs(HOME_OVERRIDER);
    grantAt(HOME, "bookings_admin_override", "federation_book_at_partners");

    const { status } = await readJson(
      await book({
        date: isoDateFromToday(30),
        targetTenantId: AWAY,
        slots: [{ rinkId: AWAY_RINK, timeSlot: "10:00" }],
        adminOverride: true,
        overrideReason: "Coaching session",
      }),
    );

    expect(status).toBe(403);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("[B-46] FR-BOOK-010 – override doesn't bypass a closed season → 400", async () => {
    signInAs(HOME_ADMIN);
    const date = isoDateFromToday(30);
    const year = Number(date.slice(0, 4));
    // A per-year season override that ends long before `date` (and its previous-year counterpart).
    const closed = {
      seasons: [
        { year, startDate: `${year}-01-01`, endDate: `${year}-01-01` },
        { year: year - 1, startDate: `${year - 1}-01-01`, endDate: `${year - 1}-01-01` },
      ],
    };
    // Guard: a date 30 days ahead can't be 1 January.
    expect(date.slice(5)).not.toBe("01-01");
    rinksFor = () => [rinkRow(HOME_RINK, HOME, closed)];

    const { status } = await readJson(
      await book({
        date,
        slots: [{ rinkId: HOME_RINK, timeSlot: "10:00" }],
        adminOverride: true,
        overrideReason: "Emergency coaching session",
      }),
    );

    expect(status).toBe(400);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("[B-46] FR-BOOK-010 – the displaced booking's owner is notified", async () => {
    signInAs(HOME_ADMIN);
    const date = isoDateFromToday(30);
    const displaced = { id: "displaced-booking", tenantId: HOME, userId: "victim-1", date, status: "CONFIRMED" };
    const slot = { id: "displaced-slot", bookingId: displaced.id, rinkId: HOME_RINK, timeSlot: "14:00", playerName: null, booking: displaced };
    prismaMock.bookingSlot.findFirst.mockResolvedValue(slot as never);
    prismaMock.bookingSlot.findMany.mockResolvedValue([slot] as never);
    prismaMock.booking.findFirst.mockResolvedValue({ ...displaced, slots: [slot] } as never);
    prismaMock.booking.findMany.mockResolvedValue([{ ...displaced, slots: [slot] }] as never);

    const { status } = await readJson(
      await book({
        date,
        slots: [{ rinkId: HOME_RINK, timeSlot: "14:00" }],
        adminOverride: true,
        overrideReason: "County match",
      }),
    );

    expect(status).toBe(201);
    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "victim-1", tenantId: HOME }) }),
    );
  });
});
