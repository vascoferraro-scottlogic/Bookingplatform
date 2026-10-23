jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, routeParams } from "@/test-utils/http";
import { isoDateFromToday } from "@/test-utils/dates";
import { PATCH } from "@/app/api/bookings/[id]/route";

const TENANT = "tenant-1";
const ADMIN = { id: "admin-1", role: "TENANT_ADMIN" as const, tenantId: TENANT };
const BOOKING = "booking-1";
const OTHER_BOOKING = "other-booking";
const RINK = "rink-a";
const SLOT = "14:00";
const DATE = isoDateFromToday(30);

const patch = (status: string) =>
  PATCH(jsonRequest("PATCH", `/api/bookings/${BOOKING}`, { status }), routeParams({ id: BOOKING }));

function givenBooking(status: string, payment: Record<string, unknown> | null = null) {
  prismaMock.booking.findUnique.mockResolvedValue({
    id: BOOKING,
    tenantId: TENANT,
    userId: "user-1",
    bookedByUserId: "user-1",
    date: DATE,
    status,
    adminOverride: false,
    overrideReason: null,
    payment,
    slots: [{ id: "slot-1", bookingId: BOOKING, rinkId: RINK, timeSlot: SLOT, playerName: null }],
    tenant: { id: TENANT, timezone: "Europe/London" },
  } as never);
}

/** Another booking already holds the same rink/date/slot with `status`. */
function givenHeldBy(status: "RESERVED" | "CONFIRMED") {
  const other = { id: OTHER_BOOKING, tenantId: TENANT, userId: "user-2", date: DATE, status };
  const slot = { id: "other-slot", bookingId: OTHER_BOOKING, rinkId: RINK, timeSlot: SLOT, playerName: null, booking: other };
  prismaMock.bookingSlot.findFirst.mockResolvedValue(slot as never);
  prismaMock.bookingSlot.findMany.mockResolvedValue([slot] as never);
  prismaMock.bookingSlot.count.mockResolvedValue(1 as never);
  prismaMock.booking.findFirst.mockResolvedValue({ ...other, slots: [slot] } as never);
  prismaMock.booking.findMany.mockResolvedValue([{ ...other, slots: [slot] }] as never);
  prismaMock.booking.count.mockResolvedValue(1 as never);
}

beforeEach(() => {
  prismaMock.tenant.findUnique.mockResolvedValue({ id: TENANT, status: "ACTIVE", active: true, timezone: "Europe/London" } as never);
  // No clash unless a test says otherwise.
  prismaMock.bookingSlot.findFirst.mockResolvedValue(null);
  prismaMock.bookingSlot.findMany.mockResolvedValue([] as never);
  prismaMock.bookingSlot.count.mockResolvedValue(0 as never);
  prismaMock.booking.findFirst.mockResolvedValue(null);
  prismaMock.booking.findMany.mockResolvedValue([] as never);
  prismaMock.booking.count.mockResolvedValue(0 as never);
  prismaMock.booking.update.mockImplementation((async ({ where, data }: any) => ({ id: where.id, ...data })) as never);
  prismaMock.waitlistEntry.findMany.mockResolvedValue([] as never);
});

describe("PATCH /api/bookings/[id] - clash re-check on approve/reserve/confirm", () => {
  test.each(["RESERVED", "CONFIRMED"] as const)(
    "[B-40] FR-BOOK-009 – approving (REQUESTED → APPROVED) while a %s booking holds the slot → 409",
    async (held) => {
      signInAs(ADMIN);
      givenBooking("REQUESTED");
      givenHeldBy(held);

      const { status } = await readJson(await patch("APPROVED"));

      expect(status).toBe(409);
      expect(prismaMock.booking.update).not.toHaveBeenCalled();
    },
  );

  test("[B-40] FR-BOOK-009 – reserving (APPROVED → RESERVED) while another booking is CONFIRMED on the slot → 409", async () => {
    signInAs(ADMIN);
    givenBooking("APPROVED", { id: "pay-1", bookingId: BOOKING, amount: 1000, status: "PENDING" });
    givenHeldBy("CONFIRMED");

    const { status } = await readJson(await patch("RESERVED"));

    expect(status).toBe(409);
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
  });

  test("[B-40] FR-BOOK-009 – confirming (RESERVED → CONFIRMED) while another booking is CONFIRMED on the slot → 409", async () => {
    signInAs(ADMIN);
    givenBooking("RESERVED", { id: "pay-1", bookingId: BOOKING, amount: 1000, status: "PAID" });
    givenHeldBy("CONFIRMED");

    const { status } = await readJson(await patch("CONFIRMED"));

    expect(status).toBe(409);
    expect(prismaMock.booking.update).not.toHaveBeenCalled();
  });

  test("[B-40] NFR-08 – the clash re-check and the status change run inside prisma.$transaction", async () => {
    signInAs(ADMIN);
    givenBooking("REQUESTED");

    const { status } = await readJson(await patch("APPROVED"));

    expect(status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalled();
    expect(prismaMock.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED" }) }),
    );
  });
});
