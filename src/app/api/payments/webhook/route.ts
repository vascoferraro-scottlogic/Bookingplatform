import { NextRequest, NextResponse } from "next/server";
import { paymentProvider } from "@/lib/payments";

/**
 * POST /api/payments/webhook
 *
 * Accepts provider-like events for development/testing and forwards
 * them into the payment provider reconciliation logic.
 */
export async function POST(req: NextRequest) {
  // Basic safety: only allow in non-production unless explicitly allowed
  const auth = req.headers.get("authorization") ?? "";
  if (process.env.NODE_ENV === "production" && process.env.PAYMENT_STUB_SECRET && auth !== `Bearer ${process.env.PAYMENT_STUB_SECRET}` && process.env.ALLOW_STUB_IN_PROD !== "true") {
    return new NextResponse(JSON.stringify({ error: "forbidden" }), { status: 403 });
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
