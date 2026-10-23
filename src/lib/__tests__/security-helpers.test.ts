/**
 * Small security properties (B-19 timing-safe secret comparison, B-20
 * rate-limit key spoofing). Routes are required lazily inside each test, after
 * the environment below is set, because some read secrets at import time.
 */
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);
jest.mock("@/lib/outbound", () => ({
  sendOutbound: jest.fn(async () => ({ id: "out-1", status: "QUEUED" })),
  sendEmail: jest.fn(async () => ({ id: "out-1", status: "QUEUED" })),
  sendSms: jest.fn(),
  sendSocial: jest.fn(),
}));

import crypto from "crypto";
import { prismaMock } from "@/test-utils/prisma-mock";
import { request } from "@/test-utils/http";
import "@/test-utils/session"; // load the next-auth mock (and its hooks) at file level
import { POST as agentRunPOST } from "@/app/api/agent/run/route";
import { POST as leadsPOST } from "@/app/api/leads/route";

const AGENT_SECRET = "agent-secret-for-tests-0123456789";
const WEBHOOK_SECRET = "whsec_unit_test_secret_0123456789";
process.env.AGENT_SECRET = AGENT_SECRET;
process.env.PAYMENT_WEBHOOK_SECRET = WEBHOOK_SECRET;

let timingSafeEqual: jest.SpyInstance;

beforeEach(() => {
  timingSafeEqual = jest.spyOn(crypto, "timingSafeEqual");
  // Flags off so the agent route stops right after authorising.
  prismaMock.featureFlag.findUnique.mockResolvedValue({ enabled: false } as never);
});

afterEach(() => {
  timingSafeEqual.mockRestore();
});

afterAll(() => {
  delete process.env.AGENT_SECRET;
  delete process.env.PAYMENT_WEBHOOK_SECRET;
});

describe("[B-19] secret comparisons are timing-safe", () => {
  test("[B-19] NFR-02 – POST /api/agent/run compares the bearer secret with crypto.timingSafeEqual", async () => {
    const POST = agentRunPOST;

    await POST(
      request("/api/agent/run?tenantId=tenant-1", {
        method: "POST",
        headers: { authorization: `Bearer ${AGENT_SECRET}`, "content-type": "application/json" },
        body: "{}",
      }),
    );

    expect(timingSafeEqual).toHaveBeenCalled();
  });

  test("[B-19] NFR-02 – POST /api/bookings/webhook compares the signature with crypto.timingSafeEqual", async () => {
    const { POST } = require("@/app/api/bookings/webhook/route") as typeof import("@/app/api/bookings/webhook/route");
    prismaMock.bookingPayment.findFirst.mockResolvedValue(null);

    const body = JSON.stringify({ eventType: "payment.completed", bookingId: "b1", status: "PAID" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex");

    await POST(
      request("/api/bookings/webhook", {
        method: "POST",
        headers: { "x-payment-signature": signature, "x-payment-timestamp": timestamp, "content-type": "application/json" },
        body,
      }),
    );

    expect(timingSafeEqual).toHaveBeenCalled();
  });
});

describe("[B-20] rate-limit key", () => {
  test("[B-20] NFR-02 – POST /api/leads ignores x-forwarded-for when no trusted proxy is configured", async () => {
    // No trusted-proxy configuration in the test environment.
    const POST = leadsPOST;

    // One client rotating a spoofed x-forwarded-for on every request. The limit
    // is 5 per window; the bodies are invalid, so nothing is ever written.
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await POST(
        request("/api/leads", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${i + 1}` },
          body: "{}",
        }),
      );
      statuses.push(res.status);
    }

    expect(statuses[5]).toBe(429);
    expect(prismaMock.tenantApplication.create).not.toHaveBeenCalled();
  });
});
