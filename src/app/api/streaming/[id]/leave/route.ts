import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api-utils";

type RouteContext = { params: Promise<{ id: string }> };

/** POST — register a viewer leaving a stream. */
export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json();
  const { viewerId } = body;

  if (!viewerId) return jsonError("viewerId is required");

  const viewer = await prisma.streamViewer.findFirst({
    where: { id: viewerId, streamSessionId: id, leftAt: null },
  });

  if (!viewer) return jsonError("Active viewer session not found", 404);

  const now = new Date();
  const durationSeconds = Math.round((now.getTime() - viewer.joinedAt.getTime()) / 1000);

  await prisma.streamViewer.update({
    where: { id: viewerId },
    data: { leftAt: now, durationSeconds },
  });

  return NextResponse.json({ success: true, durationSeconds });
}
