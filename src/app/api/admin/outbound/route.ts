import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  assertRoleOrFail,
  rejectIfImpersonating,
  jsonError,
} from "@/lib/api-utils";

/** GET /api/admin/outbound — list captured outbound messages. */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const sp = req.nextUrl.searchParams;
  const channel = sp.get("channel");
  const tenantId = sp.get("tenantId");
  const limit = Math.min(200, Math.max(1, parseInt(sp.get("limit") ?? "100", 10)));

  const messages = await prisma.outboundMessage.findMany({
    where: {
      ...(channel ? { channel: channel as never } : {}),
      ...(tenantId ? { tenantId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { tenant: { select: { id: true, name: true, slug: true } } },
  });

  return NextResponse.json(messages);
}
