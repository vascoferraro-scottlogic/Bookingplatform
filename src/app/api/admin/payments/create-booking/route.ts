import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const body = await req.json().catch(() => null);
  if (!body || !body.bookingId || !body.amount) return jsonError("bookingId and amount required");

  const { bookingId, amount, processNow } = body as { bookingId: string; amount: number; processNow?: boolean };

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return jsonError("Booking not found", 404);

  const payment = await prisma.bookingPayment.create({ data: { bookingId, amount, status: "PENDING" } });

  logAudit({ session, action: "billing.admin.manual_booking_payment_created", entity: "BookingPayment", entityId: payment.id, tenantId: booking.tenantId, meta: { amount } });

  if (processNow) {
    // Mark paid and confirm booking immediately (stub behaviour)
    await prisma.bookingPayment.update({ where: { id: payment.id }, data: { status: "PAID" } });
    await prisma.booking.update({ where: { id: bookingId }, data: { status: "CONFIRMED" } });
  }

  return NextResponse.json({ ok: true, paymentId: payment.id });
}
