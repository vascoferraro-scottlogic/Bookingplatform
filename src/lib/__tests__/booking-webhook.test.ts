// Booking payment webhook: signature verification, replay protection and
// idempotent, state-guarded processing (FR-PAY-003/004, FR-BOOK-003).
//
// The route may read PAYMENT_WEBHOOK_SECRET at import time, so each test
// loads a fresh copy of it after setting the environment (loadRoute).
//
// Prisma is replaced by a small stateful fake: one booking and its payment
// (update / updateMany honour simple `where` filters, so state-guarded writes
// behave as they would in the database), plus an in-memory store for any
// webhook-event model a fix adds for dedupe (unique on every string field, so
// a second create of the same event id fails with P2002 like a unique index).
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prismaMock } from "@/test-utils/prisma-mock";
import { request, readJson } from "@/test-utils/http";

jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);

const SECRET = "whsec_unit_test_configured_secret";
const DEFAULT_SECRET = "whsec_test_default_secret";
const BOOKING = "booking-1";
const PAYMENT = "bpay-1";
const TENANT = "tenant-1";

// ── Stateful fake Prisma ────────────────────────────────────────

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    if (k === "AND") return (cond as Row[]).every((w) => matches(row, w));
    if (k === "OR") return (cond as Row[]).some((w) => matches(row, w));
    if (k === "NOT") return ![].concat(cond).some((w) => matches(row, w));
    const v = row[k];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond) return (cond.in as unknown[]).includes(v);
      if ("notIn" in cond) return !(cond.notIn as unknown[]).includes(v);
      if ("not" in cond) return v !== cond.not;
      if ("equals" in cond) return v === cond.equals;
      if ("is" in cond) return v != null && matches(v, cond.is);
      // Relation filter on an included row (payment.booking / booking.payment).
      return v != null && typeof v === "object" && matches(v, cond);
    }
    return v === cond;
  });
}

let state: { booking: Row; payment: Row };
let paymentWrites: Row[];
let bookingWrites: Row[];
let eventStores: Record<string, Row[]>;

function eventStore(name: string) {
  const rows = (eventStores[name] ??= []);
  const find = (where: Row | undefined) => rows.find((r) => matches(r, flattenUnique(where)));
  const insert = (data: Row) => {
    const dup = rows.find((r) =>
      Object.entries(data).some(([k, v]) => typeof v === "string" && r[k] === v && /id$/i.test(k) && !/^(booking|payment|bookingPayment|tenant|user)Id$/i.test(k)),
    );
    if (dup) {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "7.0.0" });
    }
    const row = { id: `evt-row-${rows.length + 1}`, createdAt: new Date(), ...data };
    rows.push(row);
    return row;
  };
  return {
    create: async ({ data }: Row) => insert(data),
    createMany: async ({ data, skipDuplicates }: Row) => {
      let count = 0;
      for (const d of [].concat(data)) {
        try {
          insert(d);
          count++;
        } catch (e) {
          if (!skipDuplicates) throw e;
        }
      }
      return { count };
    },
    upsert: async ({ where, create }: Row) => find(where) ?? insert(create),
    findUnique: async ({ where }: Row) => find(where) ?? null,
    findFirst: async (args: Row = {}) => find(args.where) ?? null,
    count: async (args: Row = {}) => rows.filter((r) => matches(r, flattenUnique(args.where))).length,
    findMany: async (args: Row = {}) => rows.filter((r) => matches(r, flattenUnique(args.where))),
    update: async ({ where, data }: Row) => Object.assign(find(where) ?? {}, data),
    delete: async ({ where }: Row) => find(where),
  };
}

/** { a_b: { a: 1, b: 2 } } → { a: 1, b: 2 } */
function flattenUnique(where: Row | undefined): Row | undefined {
  if (!where) return where;
  const out: Row = {};
  for (const [k, v] of Object.entries(where)) {
    if (k.includes("_") && v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, v);
    else out[k] = v;
  }
  return out;
}

const paymentView = () => ({ ...state.payment, booking: { ...state.booking } });
const bookingView = () => ({ ...state.booking, payment: { ...state.payment } });

const bookingPayment = {
  findFirst: async (args: Row = {}) => (matches(paymentView(), args.where) ? paymentView() : null),
  findUnique: async (args: Row = {}) => (matches(paymentView(), args.where) ? paymentView() : null),
  update: async ({ where, data }: Row) => {
    if (!matches(paymentView(), where)) throw new Error("Record to update not found.");
    paymentWrites.push(data);
    Object.assign(state.payment, data);
    return paymentView();
  },
  updateMany: async ({ where, data }: Row) => {
    if (!matches(paymentView(), where)) return { count: 0 };
    paymentWrites.push(data);
    Object.assign(state.payment, data);
    return { count: 1 };
  },
};

const booking = {
  findFirst: async (args: Row = {}) => (matches(bookingView(), args.where) ? bookingView() : null),
  findUnique: async (args: Row = {}) => (matches(bookingView(), args.where) ? bookingView() : null),
  update: async ({ where, data }: Row) => {
    if (!matches(bookingView(), where)) throw new Error("Record to update not found.");
    bookingWrites.push(data);
    Object.assign(state.booking, data);
    return bookingView();
  },
  updateMany: async ({ where, data }: Row) => {
    if (!matches(bookingView(), where)) return { count: 0 };
    bookingWrites.push(data);
    Object.assign(state.booking, data);
    return { count: 1 };
  },
};

const fakePrisma: any = new Proxy(
  {},
  {
    get(_t, prop: string) {
      if (prop === "then") return undefined;
      if (prop === "$transaction") {
        return async (arg: unknown) =>
          typeof arg === "function" ? (arg as (tx: unknown) => unknown)(fakePrisma) : Promise.all(arg as Promise<unknown>[]);
      }
      if (prop === "bookingPayment") return bookingPayment;
      if (prop === "booking") return booking;
      if (/webhook|processedEvent|paymentEvent/i.test(prop)) return eventStore(prop);
      return (prismaMock as any)[prop];
    },
  },
);

function arrange(bookingStatus: string, paymentStatus: string) {
  state = {
    booking: { id: BOOKING, tenantId: TENANT, userId: "member-1", date: "2026-11-20", status: bookingStatus },
    payment: { id: PAYMENT, bookingId: BOOKING, amount: 600, currency: "GBP", status: paymentStatus, checkoutUrl: null },
  };
}

beforeEach(() => {
  paymentWrites = [];
  bookingWrites = [];
  eventStores = {};
  arrange("CONFIRMED", "PENDING");
});

// ── Route loading and signed requests ───────────────────────────

const savedSecret = process.env.PAYMENT_WEBHOOK_SECRET;
afterEach(() => {
  if (savedSecret === undefined) delete process.env.PAYMENT_WEBHOOK_SECRET;
  else process.env.PAYMENT_WEBHOOK_SECRET = savedSecret;
});

type Handler = (req: any) => Promise<Response>;

function loadRoute(secret: string | undefined): Handler {
  if (secret === undefined) delete process.env.PAYMENT_WEBHOOK_SECRET;
  else process.env.PAYMENT_WEBHOOK_SECRET = secret;
  let POST!: Handler;
  jest.isolateModules(() => {
    jest.doMock("@/lib/prisma", () => ({ prisma: fakePrisma }));
    POST = require("@/app/api/bookings/webhook/route").POST;
  });
  return POST;
}

const nowSeconds = () => String(Math.floor(Date.now() / 1000));

/** Signs exactly as the route verifies: HMAC-SHA256(secret, `${timestamp}.${rawBody}`) as hex. */
function sign(secret: string, timestamp: string, rawBody: string) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function webhookRequest(
  payload: Record<string, unknown>,
  opts: { secret?: string; timestamp?: string; signature?: string } = {},
) {
  const rawBody = JSON.stringify(payload);
  const timestamp = opts.timestamp ?? nowSeconds();
  const signature = opts.signature ?? sign(opts.secret ?? SECRET, timestamp, rawBody);
  return request("/api/bookings/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-payment-signature": signature, "x-payment-timestamp": timestamp },
    body: rawBody,
  });
}

/** A provider event; the event id is sent both as `id` and `eventId`. */
function event(eventType: string, eventId: string, extra: Record<string, unknown> = {}) {
  return { id: eventId, eventId, eventType, paymentId: PAYMENT, bookingId: BOOKING, status: "ok", amount: 600, ...extra };
}

const paymentStatuses = () => paymentWrites.map((d) => d.status).filter(Boolean);
const bookingStatuses = () => bookingWrites.map((d) => d.status).filter(Boolean);

// ── Signature verification ──────────────────────────────────────

describe("POST /api/bookings/webhook – signature verification", () => {
  test("[B-35] FR-PAY-003 – control: a fresh, validly signed event is accepted (200)", async () => {
    const POST = loadRoute(SECRET);

    const res = await POST(webhookRequest(event("payment.completed", "evt_ok")));

    expect(res.status).toBe(200);
    expect(state.payment.status).toBe("PAID");
  });

  test("[B-35] FR-PAY-003 – with no webhook secret configured, an event signed with the hard-coded default secret is rejected (401)", async () => {
    const POST = loadRoute(undefined);

    const res = await POST(webhookRequest(event("payment.completed", "evt_default"), { secret: DEFAULT_SECRET }));

    expect(res.status).toBe(401);
    expect(paymentWrites).toEqual([]);
    expect(bookingWrites).toEqual([]);
  });

  test("[B-35] FR-PAY-003 – a bad signature is rejected (401)", async () => {
    const POST = loadRoute(SECRET);

    const wrongSecret = await POST(webhookRequest(event("payment.completed", "evt_bad1"), { secret: "whsec_someone_else" }));
    const shortSig = await POST(webhookRequest(event("payment.completed", "evt_bad2"), { signature: "abc123" }));

    expect(wrongSecret.status).toBe(401);
    expect(shortSig.status).toBe(401);
    expect(paymentWrites).toEqual([]);
  });

  test("[B-35] FR-PAY-003 – a non-numeric (NaN) timestamp is rejected (401)", async () => {
    const POST = loadRoute(SECRET);

    // Correctly signed over the bogus timestamp, so only the timestamp is wrong.
    const res = await POST(webhookRequest(event("payment.completed", "evt_nan"), { timestamp: "not-a-number" }));

    expect(res.status).toBe(401);
    expect(paymentWrites).toEqual([]);
  });

  test("[B-35] FR-PAY-003 – a timestamp older than 5 minutes is rejected (401)", async () => {
    const POST = loadRoute(SECRET);
    const sixMinutesAgo = String(Math.floor(Date.now() / 1000) - 6 * 60);

    const res = await POST(webhookRequest(event("payment.completed", "evt_old"), { timestamp: sixMinutesAgo }));

    expect(res.status).toBe(401);
    expect(paymentWrites).toEqual([]);
  });
});

// ── Idempotency and state guards ────────────────────────────────

describe("POST /api/bookings/webhook – idempotent processing", () => {
  test("[B-37] FR-PAY-004 – the same event id delivered twice is applied once; the second delivery is a no-op", async () => {
    arrange("CANCELLED", "PAID");
    const POST = loadRoute(SECRET);

    const first = await POST(webhookRequest(event("payment.refunded", "evt_dup")));
    const second = await POST(webhookRequest(event("payment.refunded", "evt_dup")));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(paymentWrites).toHaveLength(1);
    expect(bookingWrites.length).toBeLessThanOrEqual(1);
  });

  test("[B-37] FR-PAY-004 – payment.failed after the payment is PAID is ignored (payment stays PAID)", async () => {
    arrange("CONFIRMED", "PAID");
    const POST = loadRoute(SECRET);

    const res = await POST(webhookRequest(event("payment.failed", "evt_late_fail", { status: "card_declined" })));

    expect(res.status).toBe(200);
    expect(state.payment.status).toBe("PAID");
    expect(paymentStatuses()).not.toContain("FAILED");
  });

  test("[B-37] FR-PAY-004 – payment.refunded sets the booking status to REFUNDED", async () => {
    arrange("CANCELLED", "PAID");
    const POST = loadRoute(SECRET);

    const res = await POST(webhookRequest(event("payment.refunded", "evt_refund")));

    expect(res.status).toBe(200);
    expect(state.payment.status).toBe("REFUNDED");
    expect(state.booking.status).toBe("REFUNDED");
  });

  test.each([
    ["CANCELLED", "PENDING"],
    ["REFUNDED", "REFUNDED"],
  ])(
    "[B-39] FR-BOOK-003 – payment.completed on a %s booking does not set it CONFIRMED",
    async (bookingStatus, paymentStatus) => {
      arrange(bookingStatus, paymentStatus);
      const POST = loadRoute(SECRET);

      const res = await POST(webhookRequest(event("payment.completed", `evt_late_${bookingStatus}`)));

      expect(res.status).toBeLessThan(500);
      expect(state.booking.status).toBe(bookingStatus);
      expect(bookingStatuses()).not.toContain("CONFIRMED");
    },
  );
});
