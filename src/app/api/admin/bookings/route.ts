import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating, jsonError } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId");
  if (!tenantId) return jsonError("tenantId query param required", 400);

  try {
    const bookings = await prisma.booking.findMany({
      where: { tenantId },
      orderBy: { date: "desc" },
      take: 200,
      select: {
        id: true,
        date: true,
        status: true,
        user: { select: { id: true, name: true, email: true } },
        payment: { select: { id: true, status: true, amount: true } },
      },
    });
    return NextResponse.json(bookings);
  } catch (e) {
    return jsonError("Failed to fetch bookings", 500);
  }
}
