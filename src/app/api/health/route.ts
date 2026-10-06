import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Public liveness probe — no auth, no DB call (stays "live" even while a
 * scale-to-zero database wakes). Used by the Caddy router, container
 * healthchecks, and per-colour uptime monitors. Reports which blue/green
 * colour and release answered so a monitor can confirm a swap took effect.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      color: process.env.APP_COLOR ?? "unknown",
      release: process.env.APP_VERSION ?? "unknown",
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
