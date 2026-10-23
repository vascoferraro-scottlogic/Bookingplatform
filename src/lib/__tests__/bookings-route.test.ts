jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, request } from "@/test-utils/http";
import { isoDateFromToday } from "@/test-utils/dates";
import { GET, POST } from "@/app/api/bookings/route";

const TENANT = "tenant-1";
const ADMIN = { id: "admin-1", role: "TENANT_ADMIN" as const, tenantId: TENANT };
const USER = { id: "user-1", role: "USER" as const, tenantId: TENANT };
const RINK = "rink-a";

const book = (body: Record<string, unknown>) => POST(jsonRequest("POST", "/api/bookings", body));

beforeEach(() => {
  // The rink belongs to an open green (no season configured) in the caller's tenant.
  prismaMock.rink.findMany.mockResolvedValue([
    {
      id: RINK,
      greenId: "green-1",
      name: "Rink A",
      green: { name: "Test Green", allWeather: false, seasonStartMMDD: null, seasonEndMMDD: null, seasons: [] },
    },
  ] as never);
  // No conflicting slot unless a test says otherwise.
  prismaMock.bookingSlot.findFirst.mockResolvedValue(null);
  // booking.create echoes what it was given.
  prismaMock.booking.create.mockImplementation((async ({ data }: any) => ({
    id: "new-booking",
    ...data,
    slots: data.slots.create,
  })) as never);
});

// ── Self-booking ───────────────────────────────────────────────

describe("POST /api/bookings - self booking", () => {
  test("creates booking with userId = bookedByUserId = actor", async () => {
    signInAs(USER);

    const { status, body } = await readJson(await book({ date: isoDateFromToday(30), slots: [{ rinkId: RINK, timeSlot: "09:00" }] }));

    expect(status).toBe(201);
    expect(body.userId).toBe(USER.id);
    expect(body.bookedByUserId).toBe(USER.id);
    expect(body.adminOverride).toBe(false);
    expect(prismaMock.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: TENANT, userId: USER.id, bookedByUserId: USER.id, status: "REQUESTED" }),
      }),
    );
  });

  test("only accepts rinks on the caller's club's greens", async () => {
    signInAs(USER);

    await book({ date: isoDateFromToday(30), slots: [{ rinkId: RINK, timeSlot: "09:00" }] });

    expect(prismaMock.rink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [RINK] }, green: { tenantId: TENANT } } }),
    );
  });
});

// ── Book-on-behalf ─────────────────────────────────────────────

describe("POST /api/bookings - book on behalf", () => {
  test("admin can book for another member in same tenant", async () => {
    signInAs(ADMIN);
    prismaMock.user.findFirst.mockResolvedValue({ id: "user-2" } as never);

    const { status, body } = await readJson(
      await book({ date: isoDateFromToday(31), slots: [{ rinkId: RINK, timeSlot: "10:00" }], bookForUserId: "user-2" }),
    );

    expect(status).toBe(201);
    expect(body.userId).toBe("user-2");
    expect(body.bookedByUserId).toBe(ADMIN.id);
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-2", tenantId: TENANT } }),
    );
  });

  test("non-admin cannot book for someone else (403)", async () => {
    signInAs(USER);
    prismaMock.groupMember.findFirst.mockResolvedValue(null); // no bookings_manage grant

    const { status } = await readJson(
      await book({ date: isoDateFromToday(31), slots: [{ rinkId: RINK, timeSlot: "11:00" }], bookForUserId: "user-2" }),
    );

    expect(status).toBe(403);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("admin cannot book for user in different tenant (404)", async () => {
    signInAs(ADMIN);
    prismaMock.user.findFirst.mockResolvedValue(null); // not found within TENANT

    const { status } = await readJson(
      await book({ date: isoDateFromToday(31), slots: [{ rinkId: RINK, timeSlot: "12:00" }], bookForUserId: "cross-user" }),
    );

    expect(status).toBe(404);
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cross-user", tenantId: TENANT } }),
    );
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });
});

// ── Admin override ─────────────────────────────────────────────

describe("POST /api/bookings - admin override", () => {
  test("non-admin cannot use adminOverride (403)", async () => {
    signInAs(USER);
    prismaMock.groupMember.findFirst.mockResolvedValue(null);

    const { status } = await readJson(
      await book({
        date: isoDateFromToday(32),
        slots: [{ rinkId: RINK, timeSlot: "09:00" }],
        adminOverride: true,
        overrideReason: "Testing",
      }),
    );

    expect(status).toBe(403);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("admin override without reason is rejected (400)", async () => {
    signInAs(ADMIN);

    const { status } = await readJson(
      await book({
        date: isoDateFromToday(32),
        slots: [{ rinkId: RINK, timeSlot: "09:00" }],
        adminOverride: true,
        overrideReason: "",
      }),
    );

    expect(status).toBe(400);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("an APPROVED booking in the slot blocks a normal booking (409)", async () => {
    signInAs(ADMIN);
    const date = isoDateFromToday(33);
    prismaMock.bookingSlot.findFirst.mockResolvedValue({ id: "existing-slot" } as never);

    const { status } = await readJson(await book({ date, slots: [{ rinkId: RINK, timeSlot: "14:00" }] }));

    expect(status).toBe(409);
    expect(prismaMock.bookingSlot.findFirst).toHaveBeenCalledWith({
      where: {
        rinkId: RINK,
        timeSlot: "14:00",
        booking: { date, status: { in: ["APPROVED", "RESERVED", "CONFIRMED"] }, tenantId: TENANT },
      },
    });
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
  });

  test("admin override bypasses conflict check", async () => {
    signInAs(ADMIN);
    prismaMock.bookingSlot.findFirst.mockResolvedValue({ id: "existing-slot" } as never);

    const { status, body } = await readJson(
      await book({
        date: isoDateFromToday(33),
        slots: [{ rinkId: RINK, timeSlot: "14:00" }],
        adminOverride: true,
        overrideReason: "Emergency coaching session",
      }),
    );

    expect(status).toBe(201);
    expect(body.adminOverride).toBe(true);
    expect(body.overrideReason).toBe("Emergency coaching session");
    expect(prismaMock.bookingSlot.findFirst).not.toHaveBeenCalled();
  });
});

// ── GET ────────────────────────────────────────────────────────

describe("GET /api/bookings", () => {
  test("includes bookedByUser in response", async () => {
    signInAs(ADMIN);
    prismaMock.booking.findMany.mockResolvedValue([
      { id: "b1", userId: "user-2", bookedByUserId: ADMIN.id, bookedByUser: { id: ADMIN.id, name: "Admin", email: "a@x" } },
    ] as never);

    const { status, body } = await readJson(await GET(request("/api/bookings")));

    expect(status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].bookedByUser.id).toBe(ADMIN.id);
    expect(prismaMock.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT },
        include: expect.objectContaining({ bookedByUser: { select: { id: true, name: true, email: true } } }),
      }),
    );
  });

  test("a plain member only sees their own bookings in their own club", async () => {
    signInAs(USER);
    prismaMock.groupMember.findFirst.mockResolvedValue(null);
    prismaMock.booking.findMany.mockResolvedValue([] as never);

    const { status } = await readJson(await GET(request("/api/bookings")));

    expect(status).toBe(200);
    expect(prismaMock.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, userId: USER.id } }),
    );
  });

  test("returns 401 when signed out", async () => {
    const { status } = await readJson(await GET(request("/api/bookings")));

    expect(status).toBe(401);
    expect(prismaMock.booking.findMany).not.toHaveBeenCalled();
  });
});
