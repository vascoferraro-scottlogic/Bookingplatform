import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api-utils";
import { pushSignal, getSignals } from "@/lib/streaming";

type RouteContext = { params: Promise<{ id: string }> };

/** GET — poll for signaling messages (offer/answer/ICE candidates). */
export async function GET(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const { searchParams } = new URL(req.url);
  const since = parseInt(searchParams.get("since") ?? "0", 10);

  const stream = await prisma.streamSession.findUnique({ where: { id } });
  if (!stream) return jsonError("Stream not found", 404);

  const signals = getSignals(id, since);

  return NextResponse.json({ signals, nextSince: since + signals.length });
}

/** POST — push a signaling message (offer/answer/ICE candidate). */
export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const stream = await prisma.streamSession.findUnique({ where: { id } });
  if (!stream) return jsonError("Stream not found", 404);
  if (stream.status !== "LIVE" && stream.status !== "IDLE") {
    return jsonError("Stream is not accepting connections", 400);
  }

  const body = await req.json();
  const { type, from, payload } = body;

  if (!type || !from || !payload) {
    return jsonError("type, from, and payload are required");
  }

  if (!["offer", "answer", "ice-candidate"].includes(type)) {
    return jsonError("type must be offer, answer, or ice-candidate");
  }

  pushSignal(id, { type, from, payload });

  return NextResponse.json({ success: true }, { status: 201 });
}
