jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, routeParams } from "@/test-utils/http";
import { PATCH } from "@/app/api/bookings/[id]/route";

const TENANT = "tenant-1";
const ADMIN = { id: "admin-1", role: "TENANT_ADMIN" as const, tenantId: TENANT };
const USER = { id: "user-1", role: "USER" as const, tenantId: TENANT };
const OTHER = "user-2";
const BOOKING = "booking-1";

// Winter date: Europe/London = UTC, so a 10:00 slot starts at 10:00Z.
const WINTER_DATE = "2026-12-15";
// Summer date: Europe/London = BST (UTC+1), so an 18:00 slot starts at 17:00Z.
const SUMMER_DATE = "2027-07-15";

const patch = (status: string) =>
  PATCH(jsonRequest("PATCH", `/api/bookings/${BOOKING}`, { status }), routeParams({ id: BOOKING }));

/** Fix "now" (Date only; real timers otherwise so promises/IO behave). */
function nowIs(iso: string) {
  jest.useFakeTimers({
    doNotFake: [
      "nextTick", "setImmediate", "clearImmediate", "setTimeout", "clearTimeout",
      "setInterval", "clearInterval", "queueMicrotask", "hrtime", "performance",
    ],
  });
  jest.setSystemTime(new Date(iso));
}

/** Hours before `slotStartUtc` as an ISO string. */
const hoursBefore = (slotStartUtc: string, hours: number) =>
  new Date(new Date(slotStartUtc).getTime() - hours * 3_600_000).toISOString();

function givenBooking(over: Record<string, unknown> = {}) {
  const date = (over.date as string) ?? WINTER_DATE;
  const timeSlot = (over.timeSlot as string) ?? "10:00";
  prismaMock.booking.findUnique.mockResolvedValue({
    id: BOOKING,
    tenantId: TENANT,
    userId: USER.id,
    bookedByUserId: USER.id,
    bookedByTenantId: null,
    federationId: null,
    date,
    status: "CONFIRMED",
    adminOverride: false,
    overrideReason: null,
    payment: null,
    slots: [{ id: "slot-1", bookingId: BOOKING, rinkId: "rink-a", timeSlot, playerName: null }],
    tenant: { id: TENANT, timezone: "Europe/London" },
    ...over,
  } as never);
}

beforeEach(() => {
  const tenant = { id: TENANT, name: "Club", slug: "club", status: "ACTIVE", active: true, openingTime: "08:00", closingTime: "20:00", timezone: "Europe/London" };
  prismaMock.tenant.findUnique.mockResolvedValue(tenant as never);
  prismaMock.tenant.findFirst.mockResolvedValue(tenant as never);
  prismaMock.booking.update.mockImplementation((async ({ where, data }: any) => ({ id: where.id, ...data })) as never);
  prismaMock.waitlistEntry.findMany.mockResolvedValue([] as never);
  prismaMock.waitlistEntry.findFirst.mockResolvedValue(null);
  prismaMock.groupMember.findFirst.mockResolvedValue(null); // plain member: no extra grants
});

afterEach(() => {
  jest.useRealTimers();
});

describe("PATCH /api/bookings/[id] - member cancellation window", () => {
  const SLOT_START = `${WINTER_DATE}T10:00:00.000Z`;

  test("[B-30] D-04 – member cancels own CONFIRMED booking 49h before slot start → 200 and CANCELLED", async () => {
    signInAs(USER);
    givenBooking({ status: "CONFIRMED" });
    nowIs(hoursBefore(SLOT_START, 49));

    const { status } = await readJson(await patch("CANCELLED"));

    expect(status).toBe(200);
    expect(prismaMock.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BOOKING }, data: expect.objectContaining({ status: "CANCELLED" }) }),
    );
  });

  test("[B-30] D-04 – member cancels own RESERVED booking 49h before slot start → 200", async () => {
    signInAs(USER);
    givenBooking({ status: "RESERVED" });
    nowIs(hoursBefore(SLOT_START, 49));

    const { status } = await readJson(await patch("CANCELLED"));

    expect(status).toBe(200);
    expect(prismaMock.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }),
    );
  });

  test("[B-30] D-04 – member cancelling exactly 48h before slot start is refused (403)", async () => {
    signInAs(USER);
    givenBooking({ status: "CONFIRMED" });
    nowIs(hoursBefore(SLOT_START, 48));

    const { status } = await readJson(await patch("CANCELLED"));

    expect(status).toBe(403);
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
  });

  test("[B-30] D-04 – member cancelling 47h before slot start is refused (403)", async () => {
    signInAs(USER);
    givenBooking({ status: "CONFIRMED" });
    nowIs(hoursBefore(SLOT_START, 47));

    const { status } = await readJson(await patch("CANCELLED"));

    expect(status).toBe(403);
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
  });

  test("[B-30] D-04 – tenant admin can cancel 47h before slot start → 200", async () => {
    signInAs(ADMIN);
    givenBooking({ status: "CONFIRMED" });
    nowIs(hoursBefore(SLOT_START, 47));

    const { status } = await readJson(await patch("CANCELLED"));

    expect(status).toBe(200);
    expect(prismaMock.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }),
    );
  });

  test("[B-30] FR-BOOK-012 – member cannot cancel someone else's booking (403)", async () => {
    signInAs(USER);
    givenBooking({ status: "CONFIRMED", userId: OTHER, bookedByUserId: OTHER });
    nowIs(hoursBefore(SLOT_START, 72));

    const { status } = await readJson(await patch("CANCELLED"));

    expect(status).toBe(403);
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/bookings/[id] - window measured from slot start in club timezone", () => {
  // 18:00 Europe/London on a BST date = 17:00Z.
  const SLOT_START = `${SUMMER_DATE}T17:00:00.000Z`;

  test("[B-30] D-05 – 18:00 slot, member cancels 49h before slot start → allowed (not measured from midnight UTC)", async () => {
    signInAs(USER);
    givenBooking({ status: "CONFIRMED", date: SUMMER_DATE, timeSlot: "18:00" });
    nowIs(hoursBefore(SLOT_START, 49));

    const { status } = await readJson(await patch("CANCELLED"));

    expect(status).toBe(200);
    expect(prismaMock.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }),
    );
  });

  test("[B-30] D-05 – 18:00 BST slot, 47.5h before (49.5h if misread as UTC) → member refused (403)", async () => {
    signInAs(USER);
    givenBooking({ status: "CONFIRMED", date: SUMMER_DATE, timeSlot: "18:00" });
    nowIs(hoursBefore(SLOT_START, 47.5));

    const { status } = await readJson(await patch("CANCELLED"));

    expect(status).toBe(403);
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/bookings/[id] - refund status", () => {
  test("[B-38] FR-BOOK-003 – member cannot move CANCELLED → REFUNDED (403)", async () => {
    signInAs(USER);
    givenBooking({ status: "CANCELLED" });
    nowIs(`2026-12-01T10:00:00.000Z`);

    const { status } = await readJson(await patch("REFUNDED"));

    expect(status).toBe(403);
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/bookings/[id] - no-show marking", () => {
  test("[B-48] D-13 – admin marking NO_SHOW on the play day but before slot start → 400", async () => {
    signInAs(ADMIN);
    givenBooking({ status: "CONFIRMED", timeSlot: "18:00" });
    nowIs(`${WINTER_DATE}T12:00:00.000Z`); // slot starts 18:00Z

    const { status } = await readJson(await patch("NO_SHOW"));

    expect(status).toBe(400);
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
  });

  test("[B-48] D-13 – admin marking NO_SHOW after slot start → 200", async () => {
    signInAs(ADMIN);
    givenBooking({ status: "CONFIRMED", timeSlot: "18:00" });
    nowIs(`${WINTER_DATE}T18:30:00.000Z`);

    const { status } = await readJson(await patch("NO_SHOW"));

    expect(status).toBe(200);
    expect(prismaMock.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "NO_SHOW" }) }),
    );
  });
});
