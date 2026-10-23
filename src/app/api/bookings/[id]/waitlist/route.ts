import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, getEffective, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";

/** Join waitlist for a booking's date/slots. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { id } = await params;
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) return jsonError("Booking not found", 404);
  // Effective (impersonation-aware) tenant, not the user's own tenantId.
  if (booking.tenantId !== getEffective(session).tenantId) return jsonError("Forbidden", 403);

  const existing = await prisma.waitlistEntry.findFirst({ where: { bookingId: id, userId: session.user.id } });
  if (existing) return jsonError("You are already on the waiting list for this booking", 409);

  let entry;
  try {
    entry = await prisma.waitlistEntry.create({
      data: { bookingId: id, userId: session.user.id },
    });
  } catch (err) {
    // Lost a race with a concurrent join: the (bookingId, userId) unique index caught it.
    if ((err as { code?: string })?.code === "P2002") {
      return jsonError("You are already on the waiting list for this booking", 409);
    }
    throw err;
  }

  logAudit({ session, action: "waitlist.joined", entity: "WaitlistEntry", entityId: entry.id, tenantId: booking.tenantId, meta: { bookingId: id } });

  return NextResponse.json(entry, { status: 201 });
}
