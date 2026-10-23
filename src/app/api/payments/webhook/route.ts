import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { paymentProvider } from "@/lib/payments";

/** Timing-safe string compare (unequal lengths are simply different). */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * POST /api/payments/webhook
 *
 * Accepts provider-like events and forwards them into the payment provider
 * reconciliation logic. Always authenticated with `Authorization: Bearer
 * PAYMENT_STUB_SECRET`; the only way to accept unsigned events is the explicit
 * development flag PAYMENT_WEBHOOK_ALLOW_UNSIGNED=true.
 */
export async function POST(req: NextRequest) {
  if (process.env.PAYMENT_WEBHOOK_ALLOW_UNSIGNED !== "true") {
    const secret = process.env.PAYMENT_STUB_SECRET;
    const auth = req.headers.get("authorization") ?? "";
    if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
      return new NextResponse(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }
  }

  const body = await req.json().catch(() => null);
  if (!body) return new NextResponse(JSON.stringify({ error: "invalid body" }), { status: 400 });

  try {
    await paymentProvider.handleWebhookEvent(body, Object.fromEntries(req.headers.entries()));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return new NextResponse(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
