import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";

/** Join waitlist for a booking's date/slots. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) return jsonError("Booking not found", 404);
  if (booking.tenantId !== session.user.tenantId) return jsonError("Forbidden", 403);

  const entry = await prisma.waitlistEntry.create({
    data: { bookingId: id, userId: session.user.id },
  });

  logAudit({ session, action: "waitlist.joined", entity: "WaitlistEntry", entityId: entry.id, tenantId: booking.tenantId, meta: { bookingId: id } });

  return NextResponse.json(entry, { status: 201 });
}
