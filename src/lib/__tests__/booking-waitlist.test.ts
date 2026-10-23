jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, request, routeParams } from "@/test-utils/http";
import { isoDateFromToday } from "@/test-utils/dates";
import { PATCH } from "@/app/api/bookings/[id]/route";
import { POST as JOIN } from "@/app/api/bookings/[id]/waitlist/route";

const TENANT = "tenant-1";
const ADMIN = { id: "admin-1", role: "TENANT_ADMIN" as const, tenantId: TENANT };
const USER = { id: "user-1", role: "USER" as const, tenantId: TENANT };
const BOOKING = "booking-1";
const RINK = "rink-a";
const SLOT = "14:00";
const DATE = isoDateFromToday(30);

const WAITERS = [
  { id: "wl-1", bookingId: BOOKING, userId: "waiter-1", createdAt: new Date("2026-10-01T09:00:00Z") },
  { id: "wl-2", bookingId: BOOKING, userId: "waiter-2", createdAt: new Date("2026-10-02T09:00:00Z") },
  { id: "wl-3", bookingId: BOOKING, userId: "waiter-3", createdAt: new Date("2026-10-03T09:00:00Z") },
];

const cancel = () =>
  PATCH(jsonRequest("PATCH", `/api/bookings/${BOOKING}`, { status: "CANCELLED" }), routeParams({ id: BOOKING }));
const join = () => JOIN(request(`/api/bookings/${BOOKING}/waitlist`, { method: "POST" }), routeParams({ id: BOOKING }));

function givenBooking(status: string) {
  prismaMock.booking.findUnique.mockResolvedValue({
    id: BOOKING,
    tenantId: TENANT,
    userId: "owner-1",
    bookedByUserId: "owner-1",
    date: DATE,
    status,
    adminOverride: false,
    overrideReason: null,
    payment: null,
    slots: [{ id: "slot-1", bookingId: BOOKING, rinkId: RINK, timeSlot: SLOT, playerName: null }],
    waitlistEntries: WAITERS,
    tenant: { id: TENANT, timezone: "Europe/London" },
  } as never);
}

/** userIds that received a waitlist notification. */
function waitlistNotifiedUsers(): string[] {
  return prismaMock.notification.create.mock.calls
    .map((c: any[]) => c[0]?.data)
    .filter((d: any) => d && d.userId !== "owner-1")
    .map((d: any) => d.userId);
}

beforeEach(() => {
  prismaMock.tenant.findUnique.mockResolvedValue({ id: TENANT, status: "ACTIVE", active: true, timezone: "Europe/London" } as never);
  prismaMock.booking.update.mockImplementation((async ({ where, data }: any) => ({ id: where.id, ...data })) as never);
  prismaMock.booking.create.mockImplementation((async ({ data }: any) => ({ id: "assigned-booking", ...data })) as never);
  // Waiters in join order (route asks for createdAt asc).
  prismaMock.waitlistEntry.findMany.mockResolvedValue(WAITERS as never);
  prismaMock.waitlistEntry.findFirst.mockResolvedValue(WAITERS[0] as never);
  prismaMock.notification.create.mockImplementation((async ({ data }: any) => ({ id: `n-${data.userId}`, ...data })) as never);
});

describe("PATCH /api/bookings/[id] - waiting list on cancel", () => {
  test("[B-47] D-03 – cancelling a CONFIRMED booking creates a REQUESTED booking for the first waiter only", async () => {
    signInAs(ADMIN);
    givenBooking("CONFIRMED");

    const { status } = await readJson(await cancel());

    expect(status).toBe(200);
    expect(prismaMock.booking.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: TENANT, userId: "waiter-1", date: DATE, status: "REQUESTED" }),
      }),
    );
  });

  test("[B-47] D-03 – only the first waiter is notified", async () => {
    signInAs(ADMIN);
    givenBooking("CONFIRMED");

    await cancel();

    expect(waitlistNotifiedUsers()).toEqual(["waiter-1"]);
  });

  test("[B-47] D-03 – the other waiters stay queued", async () => {
    signInAs(ADMIN);
    givenBooking("CONFIRMED");

    await cancel();

    // Assignment happened (otherwise this test is vacuous)...
    expect(prismaMock.booking.create).toHaveBeenCalled();
    // ...and any removal from the queue targets only the first waiter's entry.
    const removals = [
      ...prismaMock.waitlistEntry.delete.mock.calls,
      ...prismaMock.waitlistEntry.deleteMany.mock.calls,
    ].map((c) => JSON.stringify(c[0]));
    for (const r of removals) {
      expect(r).toContain("wl-1");
      expect(r).not.toMatch(/wl-2|wl-3/);
    }
  });

  test("[B-47] D-03 – cancelling a REQUESTED booking doesn't trigger the waiting list", async () => {
    signInAs(ADMIN);
    givenBooking("REQUESTED");

    const { status } = await readJson(await cancel());

    expect(status).toBe(200);
    expect(prismaMock.booking.create).not.toHaveBeenCalled();
    expect(waitlistNotifiedUsers()).toEqual([]);
  });
});

describe("POST /api/bookings/[id]/waitlist", () => {
  beforeEach(() => {
    givenBooking("CONFIRMED");
    prismaMock.waitlistEntry.create.mockImplementation((async ({ data }: any) => ({ id: "wl-new", ...data })) as never);
  });

  test("[B-47] FR-BOOK-011 – joining the same waiting list twice → 409", async () => {
    signInAs(USER);
    const existing = { id: "wl-existing", bookingId: BOOKING, userId: USER.id, createdAt: new Date() };
    prismaMock.waitlistEntry.findFirst.mockResolvedValue(existing as never);
    prismaMock.waitlistEntry.findUnique.mockResolvedValue(existing as never);
    prismaMock.waitlistEntry.findMany.mockResolvedValue([existing] as never);
    prismaMock.waitlistEntry.count.mockResolvedValue(1 as never);

    const { status } = await readJson(await join());

    expect(status).toBe(409);
    expect(prismaMock.waitlistEntry.create).not.toHaveBeenCalled();
  });

  test("[B-47] FR-SEC-005 – an impersonating platform admin joins using the effective (impersonated) tenant", async () => {
    signInAs({
      id: "platform-1",
      role: "PLATFORM_ADMIN",
      tenantId: null,
      actingAs: { tenantId: TENANT, role: "TENANT_ADMIN", impersonationId: "imp-1", startedAt: new Date().toISOString() },
    });
    prismaMock.waitlistEntry.findFirst.mockResolvedValue(null);
    prismaMock.waitlistEntry.findUnique.mockResolvedValue(null);
    prismaMock.waitlistEntry.findMany.mockResolvedValue([] as never);
    prismaMock.waitlistEntry.count.mockResolvedValue(0 as never);

    const { status } = await readJson(await join());

    expect(status).toBe(201);
    expect(prismaMock.waitlistEntry.create).toHaveBeenCalled();
  });
});
