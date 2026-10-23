// Booking payments: checkout on confirmation, per-tenant fee, owner-paid guard
// and refunds on cancellation (FR-PAY-001/002/005, D-01, D-04, D-06).
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, request, readJson, routeParams } from "@/test-utils/http";
import { isoDateFromToday } from "@/test-utils/dates";
import { PATCH } from "@/app/api/bookings/[id]/route";
import { POST as CHECKOUT } from "@/app/api/bookings/[id]/checkout/route";
import { paymentProvider } from "@/lib/payments";
import { getPaymentEngine, setPaymentEngine, type PaymentEngine } from "@/lib/payment";

const TENANT = "tenant-1";
const BOOKING = "booking-1";
const PAYMENT = "bpay-1";
const ADMIN = { id: "admin-1", role: "TENANT_ADMIN" as const, tenantId: TENANT };
const MEMBER = { id: "member-1", role: "USER" as const, tenantId: TENANT };

// Tenant.bookingFeePence and Tenant.timezone are required by FR-PAY-005 / D-05.
const TENANT_ROW = {
  id: TENANT,
  name: "Lakeview BC",
  slug: "lakeview",
  active: true,
  status: "ACTIVE",
  openingTime: "08:00",
  closingTime: "20:00",
  bookingFeePence: 600,
  timezone: "Europe/London",
};

type Slot = { id: string; bookingId: string; rinkId: string; timeSlot: string; playerName: null; greenName: string };
const slot = (n: number, timeSlot = "10:00"): Slot => ({
  id: `slot-${n}`,
  bookingId: BOOKING,
  rinkId: `rink-${n}`,
  timeSlot,
  playerName: null,
  greenName: "Main Green",
});

function makeBooking(over: Record<string, unknown> = {}) {
  return {
    id: BOOKING,
    tenantId: TENANT,
    userId: MEMBER.id,
    bookedByUserId: MEMBER.id,
    bookedByTenantId: null,
    federationId: null,
    adminOverride: false,
    overrideReason: null,
    date: isoDateFromToday(10),
    status: "RESERVED",
    createdAt: new Date(),
    updatedAt: new Date(),
    payment: null as Record<string, unknown> | null,
    slots: [slot(1)],
    tenant: TENANT_ROW,
    ...over,
  };
}

function paidPayment(over: Record<string, unknown> = {}) {
  return {
    id: PAYMENT,
    bookingId: BOOKING,
    amount: 600,
    currency: "GBP",
    status: "PAID",
    checkoutUrl: "https://stub.payments.local/checkout/bpay-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

/** Wire the Prisma mock around one booking. */
function arrange(booking: ReturnType<typeof makeBooking>) {
  const withRelations = () => ({ ...booking, slots: [...booking.slots], tenant: TENANT_ROW });
  prismaMock.booking.findUnique.mockImplementation((async () => withRelations()) as never);
  // Only a lookup of this booking by id finds it; clash checks find nothing.
  prismaMock.booking.findFirst.mockImplementation((async (args: any) =>
    args?.where?.id === BOOKING ? withRelations() : null) as never);
  prismaMock.booking.findMany.mockResolvedValue([] as never);
  prismaMock.booking.count.mockResolvedValue(0 as never);
  prismaMock.booking.update.mockImplementation((async ({ data }: any) => ({ ...booking, ...data })) as never);

  prismaMock.tenant.findUnique.mockResolvedValue(TENANT_ROW as never);
  prismaMock.tenant.findFirst.mockResolvedValue(TENANT_ROW as never);

  prismaMock.bookingSlot.findMany.mockImplementation((async (args: any) =>
    args?.where?.bookingId === BOOKING ? booking.slots : []) as never);
  prismaMock.bookingSlot.count.mockImplementation((async (args: any) =>
    args?.where?.bookingId === BOOKING ? booking.slots.length : 0) as never);
  prismaMock.bookingSlot.findFirst.mockResolvedValue(null as never);

  prismaMock.bookingPayment.findUnique.mockResolvedValue((booking.payment ?? null) as never);
  prismaMock.bookingPayment.findFirst.mockResolvedValue((booking.payment ?? null) as never);
  prismaMock.bookingPayment.create.mockImplementation((async ({ data }: any) => ({
    id: PAYMENT, currency: "GBP", status: "PENDING", checkoutUrl: null, ...data,
  })) as never);
  prismaMock.bookingPayment.upsert.mockImplementation((async ({ create }: any) => ({
    id: PAYMENT, currency: "GBP", status: "PENDING", checkoutUrl: null, ...create,
  })) as never);
  prismaMock.bookingPayment.update.mockImplementation((async ({ where, data }: any) => ({
    ...(booking.payment ?? {}), id: where.id, ...data,
  })) as never);
  prismaMock.bookingPayment.updateMany.mockResolvedValue({ count: 1 } as never);

  prismaMock.waitlistEntry.findMany.mockResolvedValue([] as never);
  // A booking payment id is not a TenantPayment id: as in the real database,
  // updating a TenantPayment with it fails.
  prismaMock.tenantPayment.update.mockRejectedValue(new Error("Record to update not found."));
}

const patch = (status: string) =>
  PATCH(jsonRequest("PATCH", `/api/bookings/${BOOKING}`, { status }), routeParams({ id: BOOKING }));
const checkout = () =>
  CHECKOUT(request(`/api/bookings/${BOOKING}/checkout`, { method: "POST" }), routeParams({ id: BOOKING }));

/** Every BookingPayment the route created (create or upsert). */
function createdPayments(): Array<Record<string, any>> {
  return [
    ...prismaMock.bookingPayment.create.mock.calls.map((c: any[]) => c[0].data),
    ...prismaMock.bookingPayment.upsert.mock.calls.map((c: any[]) => c[0].create),
  ];
}

/** Every status written to a BookingPayment (update or updateMany). */
function paymentStatusWrites(): string[] {
  return [
    ...prismaMock.bookingPayment.update.mock.calls,
    ...prismaMock.bookingPayment.updateMany.mock.calls,
  ]
    .map((c: any[]) => c[0]?.data?.status)
    .filter(Boolean);
}

function bookingStatusWrites(): string[] {
  return [...prismaMock.booking.update.mock.calls, ...prismaMock.booking.updateMany.mock.calls]
    .map((c: any[]) => c[0]?.data?.status)
    .filter(Boolean);
}

let originalEngine: PaymentEngine;
let providerCheckout: jest.SpyInstance;

beforeEach(() => {
  originalEngine = getPaymentEngine();
  providerCheckout = jest.spyOn(paymentProvider, "createBookingCheckout");
});

afterEach(() => {
  setPaymentEngine(originalEngine);
  jest.restoreAllMocks();
});

// ── Checkout route ──────────────────────────────────────────────

describe("POST /api/bookings/[id]/checkout", () => {
  // The owner may START a provider checkout (D-01) but never set PAID themselves.
  test("[B-32] FR-PAY-001 – the booking owner cannot mark their own payment PAID directly (body status ignored, no PAID write)", async () => {
    arrange(makeBooking({ status: "CONFIRMED", payment: paidPayment({ status: "PENDING" }) }));
    providerCheckout.mockResolvedValue({ checkoutUrl: "https://stub.payments.local/checkout/bpay-1" });
    signInAs(MEMBER);

    await CHECKOUT(
      jsonRequest("POST", `/api/bookings/${BOOKING}/checkout`, { status: "PAID" }),
      routeParams({ id: BOOKING }),
    );

    expect(paymentStatusWrites()).not.toContain("PAID");
  });

  test("[B-32] FR-PAY-001 – a member who is not the owner (and not a manager) gets 403 from checkout", async () => {
    arrange(makeBooking({ status: "CONFIRMED", payment: paidPayment({ status: "PENDING" }) }));
    signInAs({ id: "member-2", role: "USER" as const, tenantId: TENANT });

    const { status } = await readJson(await checkout());

    expect(status).toBe(403);
    expect(providerCheckout).not.toHaveBeenCalled();
    expect(paymentStatusWrites()).not.toContain("PAID");
  });

  test("[B-32] D-01 – the owner can start a provider checkout for their CONFIRMED unpaid booking", async () => {
    arrange(makeBooking({ status: "CONFIRMED", payment: paidPayment({ status: "PENDING" }) }));
    providerCheckout.mockResolvedValue({ checkoutUrl: "https://stub.payments.local/checkout/bpay-1" });
    signInAs(MEMBER);

    const { status, body } = await readJson(await checkout());

    expect(status).toBe(200);
    expect(providerCheckout).toHaveBeenCalledWith(PAYMENT, 600, "GBP");
    expect(body.checkoutUrl).toBe("https://stub.payments.local/checkout/bpay-1");
    expect(paymentStatusWrites()).not.toContain("PAID");
  });

  test("[B-33] D-01 – checkout is still allowed for a CONFIRMED booking that is unpaid", async () => {
    arrange(makeBooking({ status: "CONFIRMED", payment: paidPayment({ status: "PENDING" }) }));
    signInAs(ADMIN);

    const { status } = await readJson(await checkout());

    expect(status).toBe(200);
    expect(paymentStatusWrites()).toContain("PAID");
  });
});

// ── Status change: checkout on confirmation ─────────────────────

describe("PATCH /api/bookings/[id] – checkout on confirmation", () => {
  test("[B-33] D-01 – moving a booking to RESERVED creates no checkout and no BookingPayment", async () => {
    arrange(makeBooking({ status: "APPROVED" }));
    signInAs(ADMIN);

    const { status } = await readJson(await patch("RESERVED"));

    expect(status).toBe(200);
    expect(createdPayments()).toEqual([]);
    expect(providerCheckout).not.toHaveBeenCalled();
  });

  test("[B-33] D-01 – moving a booking to CONFIRMED creates a BookingPayment for bookingFeePence × slots", async () => {
    arrange(makeBooking({ status: "RESERVED", slots: [slot(1, "10:00"), slot(2, "12:00")] }));
    signInAs(ADMIN);

    const { status } = await readJson(await patch("CONFIRMED"));

    expect(status).toBe(200);
    expect(createdPayments()).toEqual([expect.objectContaining({ bookingId: BOOKING, amount: 1200 })]);
  });

  test("[B-33] FR-PAY-005 – a club with a £6 fee charges 600, not 1000, across the booking lifecycle", async () => {
    signInAs(ADMIN);

    arrange(makeBooking({ status: "APPROVED" }));
    await patch("RESERVED");
    const reservedPayments = createdPayments();
    const reservedProviderAmounts = providerCheckout.mock.calls.map((c) => c[1]);
    prismaMock.bookingPayment.create.mockClear();
    prismaMock.bookingPayment.upsert.mockClear();
    providerCheckout.mockClear();

    arrange(makeBooking({ status: "RESERVED", payment: null }));
    await patch("CONFIRMED");

    const amounts = [...reservedPayments, ...createdPayments()].map((p) => p.amount);
    expect(amounts).toEqual([600]);
    expect([...reservedProviderAmounts, ...providerCheckout.mock.calls.map((c) => c[1])]).not.toContain(1000);
  });

  test("[B-34] FR-PAY-001 – the provider checkout receives the BookingPayment id, and stub immediate mode ends PAID", async () => {
    arrange(makeBooking({ status: "RESERVED" }));
    signInAs(ADMIN);

    const { status } = await readJson(await patch("CONFIRMED"));

    expect(status).toBe(200);
    expect(providerCheckout).toHaveBeenCalledTimes(1);
    expect(providerCheckout.mock.calls[0][0]).toBe(PAYMENT);
    expect(providerCheckout.mock.calls[0][0]).not.toBe(BOOKING);
    expect(prismaMock.bookingPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PAYMENT }, data: expect.objectContaining({ status: "PAID" }) }),
    );
  });
});

// ── Status change: refund on cancellation ───────────────────────

describe("PATCH /api/bookings/[id] – refund on cancellation", () => {
  test("[B-31] D-06 – a member cancelling a PAID booking more than 48h before the slot gets it REFUNDED", async () => {
    arrange(makeBooking({ status: "CONFIRMED", date: isoDateFromToday(10), payment: paidPayment() }));
    signInAs(MEMBER);

    const { status } = await readJson(await patch("CANCELLED"));

    expect(status).toBe(200);
    expect(bookingStatusWrites()).toContain("CANCELLED");
    expect(paymentStatusWrites()).toContain("REFUNDED");
  });

  test("[B-31] D-06 – a tenant admin cancelling a PAID booking inside 48h gets it refunded", async () => {
    arrange(makeBooking({ status: "CONFIRMED", date: isoDateFromToday(1), payment: paidPayment() }));
    signInAs(ADMIN);

    const { status } = await readJson(await patch("CANCELLED"));

    expect(status).toBe(200);
    expect(bookingStatusWrites()).toContain("CANCELLED");
    expect(paymentStatusWrites()).toContain("REFUNDED");
  });

  test("[B-31] D-06 – a failed refund still cancels, marks the payment REFUND_FAILED and returns a warning", async () => {
    arrange(makeBooking({ status: "CONFIRMED", date: isoDateFromToday(10), payment: paidPayment() }));
    signInAs(ADMIN);
    // The provider refuses the refund, whichever layer the route goes through.
    jest.spyOn(paymentProvider, "refundPayment").mockResolvedValue({ success: false });
    setPaymentEngine({ ...originalEngine, refund: async () => ({ success: false, error: "Refund declined" }) });

    const { status, body } = await readJson(await patch("CANCELLED"));

    expect(status).toBe(200);
    expect(bookingStatusWrites()).toContain("CANCELLED");
    expect(paymentStatusWrites()).toContain("REFUND_FAILED");
    expect(paymentStatusWrites()).not.toContain("REFUNDED");
    expect(body.warning ?? body.warnings).toBeTruthy();
  });
});
