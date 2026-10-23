// Platform payment webhook and admin payment routes (FR-PAY-003, FR-BOOK-003).
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock, prismaModule } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson } from "@/test-utils/http";
import { POST as SIMULATE } from "@/app/api/payments/simulate/route";
import { POST as CREATE_BOOKING_PAYMENT } from "@/app/api/admin/payments/create-booking/route";

const TENANT = "tenant-1";
const BOOKING = "booking-1";
const PLATFORM_ADMIN = { id: "padmin-1", role: "PLATFORM_ADMIN" as const, tenantId: null };

function bookingStatusWrites(): string[] {
  return [...prismaMock.booking.update.mock.calls, ...prismaMock.booking.updateMany.mock.calls]
    .map((c: any[]) => c[0]?.data?.status)
    .filter(Boolean);
}

// ── /api/payments/webhook ───────────────────────────────────────

const WEBHOOK_ENV = ["PAYMENT_WEBHOOK_ALLOW_UNSIGNED", "PAYMENT_STUB_SECRET", "ALLOW_STUB_IN_PROD"] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => WEBHOOK_ENV.forEach((k) => (savedEnv[k] = process.env[k])));
afterEach(() =>
  WEBHOOK_ENV.forEach((k) => (savedEnv[k] === undefined ? delete process.env[k] : (process.env[k] = savedEnv[k]))),
);

type Handler = (req: any) => Promise<Response>;

/** Loads a fresh copy of the route so env read at import time is honoured. */
function loadPlatformWebhook(env: Partial<Record<(typeof WEBHOOK_ENV)[number], string>>): Handler {
  WEBHOOK_ENV.forEach((k) => delete process.env[k]);
  Object.assign(process.env, env);
  let POST!: Handler;
  jest.isolateModules(() => {
    jest.doMock("@/lib/prisma", () => prismaModule);
    POST = require("@/app/api/payments/webhook/route").POST;
  });
  return POST;
}

const unsignedEvent = () =>
  jsonRequest("POST", "/api/payments/webhook", { type: "payment_succeeded", paymentId: "tpay-1", providerId: "stub_tpay-1" });

describe("POST /api/payments/webhook", () => {
  beforeEach(() => {
    prismaMock.tenantPayment.update.mockResolvedValue({ id: "tpay-1", status: "PAID" } as never);
  });

  test("[B-36] FR-PAY-003 – an unsigned event outside production is rejected (401) without PAYMENT_WEBHOOK_ALLOW_UNSIGNED", async () => {
    expect(process.env.NODE_ENV).not.toBe("production");
    const POST = loadPlatformWebhook({});

    const res = await POST(unsignedEvent());

    expect(res.status).toBe(401);
    expect(prismaMock.tenantPayment.update).not.toHaveBeenCalled();
  });

  test("[B-36] FR-PAY-003 – control: with PAYMENT_WEBHOOK_ALLOW_UNSIGNED=true an unsigned dev event is accepted", async () => {
    const POST = loadPlatformWebhook({ PAYMENT_WEBHOOK_ALLOW_UNSIGNED: "true" });

    const res = await POST(unsignedEvent());

    expect(res.status).toBe(200);
    expect(prismaMock.tenantPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tpay-1" }, data: expect.objectContaining({ status: "PAID" }) }),
    );
  });
});

// ── /api/payments/simulate ──────────────────────────────────────

describe("POST /api/payments/simulate", () => {
  test("[B-39] FR-BOOK-003 – simulating a completed payment on a CANCELLED booking is refused (409)", async () => {
    const booking = { id: BOOKING, tenantId: TENANT, userId: "member-1", date: "2026-11-20", status: "CANCELLED" };
    const payment = { id: "bpay-1", bookingId: BOOKING, amount: 600, currency: "GBP", status: "PENDING", checkoutUrl: null, booking };
    prismaMock.bookingPayment.findFirst.mockResolvedValue(payment as never);
    prismaMock.bookingPayment.findUnique.mockResolvedValue(payment as never);
    prismaMock.booking.findUnique.mockResolvedValue({ ...booking, payment } as never);
    signInAs(PLATFORM_ADMIN);

    const { status } = await readJson(
      await SIMULATE(jsonRequest("POST", "/api/payments/simulate", { type: "payment.completed", bookingId: BOOKING })),
    );

    expect(status).toBe(409);
    expect(bookingStatusWrites()).not.toContain("CONFIRMED");
  });
});

// ── /api/admin/payments/create-booking ──────────────────────────

describe("POST /api/admin/payments/create-booking", () => {
  test("[B-39] FR-BOOK-003 – a platform admin who is not impersonating (no tenant context) is refused (403)", async () => {
    prismaMock.booking.findUnique.mockResolvedValue({
      id: BOOKING, tenantId: TENANT, userId: "member-1", date: "2026-11-20", status: "REQUESTED", payment: null,
    } as never);
    prismaMock.bookingPayment.create.mockResolvedValue({ id: "bpay-1", bookingId: BOOKING, amount: 600, status: "PENDING" } as never);
    signInAs(PLATFORM_ADMIN);

    const { status } = await readJson(
      await CREATE_BOOKING_PAYMENT(
        jsonRequest("POST", "/api/admin/payments/create-booking", { bookingId: BOOKING, amount: 600, processNow: true }),
      ),
    );

    expect(status).toBe(403);
    expect(prismaMock.bookingPayment.create).not.toHaveBeenCalled();
    expect(bookingStatusWrites()).not.toContain("CONFIRMED");
  });
});
