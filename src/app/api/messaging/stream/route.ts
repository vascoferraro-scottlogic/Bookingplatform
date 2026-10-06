import { NextResponse } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { isFeatureEnabled } from "@/lib/features";
import { addConnection, removeConnection } from "@/lib/sse-connections";

export const dynamic = "force-dynamic";

/** SSE stream for real-time messaging events. */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const tenantId = session.user.tenantId;
  if (!tenantId) {
    // Platform admins without tenant context get an empty stream
    return new NextResponse("event: connected\ndata: {}\n\n", {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" },
    });
  }

  if (!(await isFeatureEnabled(tenantId, "messaging"))) {
    return jsonError("Messaging is not enabled for this club", 403);
  }

  const userId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  addConnection(userId, writer);

  // Send initial connection event
  writer.write(encoder.encode(`event: connected\ndata: ${JSON.stringify({ userId })}\n\n`)).catch(() => {});

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    writer.write(encoder.encode(": heartbeat\n\n")).catch(() => {
      clearInterval(heartbeat);
      removeConnection(userId, writer);
    });
  }, 30_000);

  // Clean up on client disconnect
  const response = new NextResponse(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });

  // When the readable side is cancelled (client disconnects), clean up
  stream.readable.pipeTo(new WritableStream()).catch(() => {}).finally(() => {
    clearInterval(heartbeat);
    removeConnection(userId, writer);
  });

  return response;
}
