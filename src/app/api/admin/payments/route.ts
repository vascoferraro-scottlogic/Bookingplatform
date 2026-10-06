import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating } from "@/lib/api-utils";

/**
 * GET /api/admin/payments
 *
 * Returns pending tenant payments (invoices) and booking payments for admin review.
 */
export async function GET(_req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const tenantPayments = await prisma.tenantPayment.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { tenant: { select: { name: true } } },
  });

  const bookingPayments = await prisma.bookingPayment.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { booking: { select: { id: true, date: true, tenantId: true, userId: true } } },
  });

  return NextResponse.json({ tenantPayments, bookingPayments });
}

