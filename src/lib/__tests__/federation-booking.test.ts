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

beforeEach(() => {
  // Federation flag is on for the home club.
  prismaMock.featureFlag.findUnique.mockImplementation((async (args: any) => {
    const { tenantId, key } = args.where.tenantId_key;
    return tenantId === HOME && key === "federation" ? { tenantId, key, enabled: true } : null;
  }) as never);
  // Away club exists.
  prismaMock.tenant.findUnique.mockImplementation((async (args: any) =>
    args.where.id === AWAY ? { id: AWAY } : null) as never);
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
    expect(prismaMock.featureFlag.findUnique).not.toHaveBeenCalled();
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
      expect.objectContaining({ where: { id: { in: [AWAY_RINK] }, green: { tenantId: AWAY } } }),
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
    prismaMock.featureFlag.findUnique.mockResolvedValue({ enabled: false } as never);

    const { status } = await readJson(
      await book({ date: isoDateFromToday(34), targetTenantId: AWAY, slots: [{ rinkId: AWAY_RINK, timeSlot: "10:00" }] }),
    );

    expect(status).toBe(403);
    expect(prismaMock.featureFlag.findUnique).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: HOME, key: "federation" } },
    });
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });
});

// ── Cross-club clash detection ────────────────────────────────

describe("Cross-club clash detection", () => {
  /** The user already holds a 14:00-16:00 booking at the home club on `date`. */
  function existingHomeBooking() {
    prismaMock.booking.findMany.mockResolvedValue([
      { id: "home-booking", slots: [{ timeSlot: "14:00-16:00" }], tenant: { name: "Home Club" } },
    ] as never);
  }

  test("same slot at different clubs returns CROSS_CLUB_CLASH", async () => {
    signInAs(HOME_USER);
    existingHomeBooking();
    const date = isoDateFromToday(40);

    const { status, body } = await readJson(
      await book({ date, targetTenantId: AWAY, slots: [{ rinkId: AWAY_RINK, timeSlot: "14:00-16:00" }] }),
    );

    expect(status).toBe(409);
    expect(body.error).toBe("CROSS_CLUB_CLASH");
    expect(body.confirm).toBe(true);
    expect(body.existingBooking).toEqual({ id: "home-booking", tenantName: "Home Club", timeSlot: "14:00-16:00" });
    expect(prismaMock.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: HOME_USER.id, date, status: { in: ["APPROVED", "RESERVED", "CONFIRMED", "REQUESTED"] } },
      }),
    );
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("adjacent slot returns CROSS_CLUB_CONSECUTIVE", async () => {
    signInAs(HOME_USER);
    existingHomeBooking();

    const { status, body } = await readJson(
      await book({ date: isoDateFromToday(40), targetTenantId: AWAY, slots: [{ rinkId: AWAY_RINK, timeSlot: "16:00-18:00" }] }),
    );

    expect(status).toBe(409);
    expect(body.error).toBe("CROSS_CLUB_CONSECUTIVE");
    expect(body.confirm).toBe(true);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("confirmClash bypasses clash warning", async () => {
    signInAs(HOME_USER);
    existingHomeBooking();

    const { status } = await readJson(
      await book({
        date: isoDateFromToday(40),
        targetTenantId: AWAY,
        confirmClash: true,
        slots: [{ rinkId: AWAY_RINK, timeSlot: "14:00-16:00" }],
      }),
    );

    expect(status).toBe(201);
    expect(prismaMock.booking.findMany).not.toHaveBeenCalled();
  });
});
