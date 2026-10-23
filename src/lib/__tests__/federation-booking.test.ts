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
const HOME_USER = { id: "home-user", role: "USER" as const, tenantId: HOME };
const HOME_ADMIN = { id: "home-admin", role: "TENANT_ADMIN" as const, tenantId: HOME };

const book = (body: Record<string, unknown>) => POST(jsonRequest("POST", "/api/bookings", body));

const rinkRow = (id: string, greenName: string) => ({
  id,
  greenId: `green-of-${id}`,
  name: id,
  green: { name: greenName, allWeather: false, seasonStartMMDD: null, seasonEndMMDD: null, seasons: [] },
});

/** Grants the signed-in USER these permissions (TENANT_ADMIN bypasses this lookup). */
function grantPermissions(...permissions: string[]) {
  prismaMock.groupMember.findFirst.mockImplementation((async (args: any) =>
    permissions.includes(args.where.group.grants.some.permission) ? { id: "gm-1" } : null) as never);
}

const tenantRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id === HOME ? "Home Club" : "Away Club",
  slug: id,
  active: true,
  status: "ACTIVE",
  openingTime: "08:00",
  closingTime: "20:00",
  timezone: "Europe/London",
  ...over,
});

/** The user's existing bookings on the day. Honours a tenantId filter (equals / not / notIn) if the route sends one. */
function givenUserBookings(bookings: { id: string; tenantId: string; tenantName: string; timeSlot: string }[]) {
  prismaMock.booking.findMany.mockImplementation((async (args: any) => {
    const t = args?.where?.tenantId ?? args?.where?.NOT?.tenantId;
    const negate = args?.where?.tenantId === undefined && args?.where?.NOT?.tenantId !== undefined;
    const keep = (tenantId: string) => {
      if (t === undefined) return true;
      let match: boolean;
      if (typeof t === "string") match = tenantId === t;
      else if (t.not !== undefined) match = tenantId !== t.not;
      else if (t.notIn !== undefined) match = !t.notIn.includes(tenantId);
      else if (t.in !== undefined) match = t.in.includes(tenantId);
      else match = true;
      return negate ? !match : match;
    };
    return bookings
      .filter((b) => keep(b.tenantId))
      .map((b) => ({ id: b.id, tenantId: b.tenantId, status: "CONFIRMED", slots: [{ timeSlot: b.timeSlot }], tenant: { name: b.tenantName } }));
  }) as never);
}

beforeEach(() => {
  // Federation flag is on for both clubs.
  prismaMock.featureFlag.findUnique.mockImplementation((async (args: any) => {
    const { tenantId, key } = args.where.tenantId_key;
    return [HOME, AWAY].includes(tenantId) && (key === "federation" || key === "bookings") ? { tenantId, key, enabled: true } : null;
  }) as never);
  // Both clubs exist and are ACTIVE.
  prismaMock.tenant.findUnique.mockImplementation((async (args: any) =>
    [HOME, AWAY].includes(args.where.id) ? tenantRow(args.where.id) : null) as never);
  // Home user is in a group granting federation_book_at_partners.
  grantPermissions("federation_book_at_partners");
  // Both clubs are active members of FED.
  prismaMock.federationMembership.findMany.mockResolvedValue([{ federationId: FED }] as never);
  prismaMock.federationMembership.findFirst.mockResolvedValue({ federationId: FED } as never);
  // Rinks resolve within whichever tenant the route asks for.
  prismaMock.rink.findMany.mockImplementation((async (args: any) =>
    args.where.green.tenantId === AWAY ? [rinkRow(AWAY_RINK, "Away Green")] : [rinkRow(HOME_RINK, "Home Green")]) as never);
  prismaMock.bookingSlot.findFirst.mockResolvedValue(null);
  // No existing bookings for the user on the day unless a test says otherwise.
  prismaMock.booking.findMany.mockResolvedValue([] as never);
  prismaMock.booking.create.mockImplementation((async ({ data }: any) => ({
    id: "new-booking",
    ...data,
    slots: data.slots.create,
  })) as never);
});

// ── Same-club booking still works ─────────────────────────────

describe("Same-club booking (no regression)", () => {
  test("booking at own club works without targetTenantId", async () => {
    signInAs(HOME_USER);

    const { status, body } = await readJson(await book({ date: isoDateFromToday(30), slots: [{ rinkId: HOME_RINK, timeSlot: "09:00" }] }));

    expect(status).toBe(201);
    expect(body.tenantId).toBe(HOME);
    expect(body.bookedByTenantId).toBeNull();
    expect(body.federationId).toBeNull();
    expect(prismaMock.featureFlag.findUnique).not.toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: HOME, key: "federation" } },
    });
  });
});

// ── Cross-club booking ────────────────────────────────────────

describe("Cross-club booking via federation", () => {
  test("user with federation permission can book at partner club", async () => {
    signInAs(HOME_USER);

    const { status, body } = await readJson(
      await book({ date: isoDateFromToday(31), targetTenantId: AWAY, slots: [{ rinkId: AWAY_RINK, timeSlot: "10:00" }] }),
    );

    expect(status).toBe(201);
    expect(body.tenantId).toBe(AWAY);
    expect(body.bookedByTenantId).toBe(HOME);
    expect(body.federationId).toBe(FED);
    expect(prismaMock.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: AWAY, bookedByTenantId: HOME, federationId: FED, userId: HOME_USER.id }),
      }),
    );
  });

  test("looks up the common federation and validates rinks against the target club", async () => {
    signInAs(HOME_USER);

    await book({ date: isoDateFromToday(31), targetTenantId: AWAY, slots: [{ rinkId: AWAY_RINK, timeSlot: "10:00" }] });

    expect(prismaMock.federationMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: HOME, leftAt: null, federation: { status: "ACTIVE" } } }),
    );
    expect(prismaMock.federationMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: AWAY, leftAt: null, federationId: { in: [FED] }, federation: { status: "ACTIVE" } },
      }),
    );
    expect(prismaMock.rink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: [AWAY_RINK] }, green: { tenantId: AWAY, archivedAt: null } }) }),
    );
  });

  test("user without federation permission gets 403", async () => {
    signInAs(HOME_USER);
    grantPermissions();

    const { status, body } = await readJson(
      await book({ date: isoDateFromToday(32), targetTenantId: AWAY, slots: [{ rinkId: AWAY_RINK, timeSlot: "10:00" }] }),
    );

    expect(status).toBe(403);
    expect(body.error).toContain("permission");
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("TENANT_ADMIN can cross-club book (implicit all-permissions)", async () => {
    signInAs(HOME_ADMIN);
    grantPermissions();

    const { status } = await readJson(
      await book({ date: isoDateFromToday(32), targetTenantId: AWAY, slots: [{ rinkId: AWAY_RINK, timeSlot: "11:00" }] }),
    );

    expect(status).toBe(201);
    expect(prismaMock.groupMember.findFirst).not.toHaveBeenCalled();
  });

  test("club not in federation gets 403", async () => {
    signInAs(HOME_USER);
    prismaMock.federationMembership.findFirst.mockResolvedValue(null); // away club has left

    const { status } = await readJson(
      await book({ date: isoDateFromToday(33), targetTenantId: AWAY, slots: [{ rinkId: AWAY_RINK, timeSlot: "10:00" }] }),
    );

    expect(status).toBe(403);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("federation feature disabled gets 403", async () => {
    signInAs(HOME_USER);
    prismaMock.featureFlag.findUnique.mockImplementation((async (args: any) => {
      const { tenantId, key } = args.where.tenantId_key;
      return { tenantId, key, enabled: key !== "federation" };
    }) as never);

    const { status } = await readJson(
      await book({ date: isoDateFromToday(34), targetTenantId: AWAY, slots: [{ rinkId: AWAY_RINK, timeSlot: "10:00" }] }),
    );

    expect(status).toBe(403);
    expect(prismaMock.featureFlag.findUnique).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: HOME, key: "federation" } },
    });
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("[B-55] FR-BOOK-017 – booking at a partner club that is SUSPENDED → 403", async () => {
    signInAs(HOME_USER);
    prismaMock.tenant.findUnique.mockImplementation((async (args: any) =>
      args.where.id === AWAY ? tenantRow(AWAY, { status: "SUSPENDED" }) : args.where.id === HOME ? tenantRow(HOME) : null) as never);

    const { status } = await readJson(
      await book({ date: isoDateFromToday(34), targetTenantId: AWAY, slots: [{ rinkId: AWAY_RINK, timeSlot: "10:00" }] }),
    );

    expect(status).toBe(403);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("[B-55] FR-BOOK-017 – booking at a partner club with its federation flag off → 403", async () => {
    signInAs(HOME_USER);
    prismaMock.featureFlag.findUnique.mockImplementation((async (args: any) => {
      const { tenantId, key } = args.where.tenantId_key;
      return tenantId === HOME || key === "bookings" ? { tenantId, key, enabled: true } : { tenantId, key, enabled: false };
    }) as never);

    const { status } = await readJson(
      await book({ date: isoDateFromToday(34), targetTenantId: AWAY, slots: [{ rinkId: AWAY_RINK, timeSlot: "10:00" }] }),
    );

    expect(status).toBe(403);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });
});

// ── Cross-club clash detection ────────────────────────────────

describe("Cross-club clash detection", () => {
  /** The user already holds a booking at the home club on the day. */
  function existingHomeBooking(timeSlot = "14:00") {
    givenUserBookings([{ id: "home-booking", tenantId: HOME, tenantName: "Home Club", timeSlot }]);
  }

  test("same slot at different clubs returns CROSS_CLUB_CLASH", async () => {
    signInAs(HOME_USER);
    existingHomeBooking("14:00");
    const date = isoDateFromToday(40);

    const { status, body } = await readJson(
      await book({ date, targetTenantId: AWAY, slots: [{ rinkId: AWAY_RINK, timeSlot: "14:00" }] }),
    );

    expect(status).toBe(409);
    expect(body.error).toBe("CROSS_CLUB_CLASH");
    expect(body.confirm).toBe(true);
    expect(body.existingBooking).toEqual({ id: "home-booking", tenantName: "Home Club", timeSlot: "14:00" });
    expect(prismaMock.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: HOME_USER.id, date }) }),
    );
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("[B-54] FR-FED-003 – 09:00 at one club then 10:00 at another returns CROSS_CLUB_CONSECUTIVE", async () => {
    signInAs(HOME_USER);
    existingHomeBooking("09:00");

    const { status, body } = await readJson(
      await book({ date: isoDateFromToday(40), targetTenantId: AWAY, slots: [{ rinkId: AWAY_RINK, timeSlot: "10:00" }] }),
    );

    expect(status).toBe(409);
    expect(body.error).toBe("CROSS_CLUB_CONSECUTIVE");
    expect(body.confirm).toBe(true);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("[B-54] FR-FED-003 – a booking at the same club as the user's other booking gives no cross-club warning (201)", async () => {
    signInAs(HOME_USER);
    // The user's other booking that day is at the AWAY club too (another rink, same time).
    givenUserBookings([{ id: "away-booking", tenantId: AWAY, tenantName: "Away Club", timeSlot: "14:00" }]);

    const { status } = await readJson(
      await book({ date: isoDateFromToday(40), targetTenantId: AWAY, slots: [{ rinkId: AWAY_RINK, timeSlot: "14:00" }] }),
    );

    expect(status).toBe(201);
    expect(prismaMock.booking.create).toHaveBeenCalled();
  });

  test("confirmClash bypasses clash warning", async () => {
    signInAs(HOME_USER);
    existingHomeBooking("14:00");

    const { status } = await readJson(
      await book({
        date: isoDateFromToday(40),
        targetTenantId: AWAY,
        confirmClash: true,
        slots: [{ rinkId: AWAY_RINK, timeSlot: "14:00" }],
      }),
    );

    expect(status).toBe(201);
    expect(prismaMock.booking.findMany).not.toHaveBeenCalled();
  });
});
