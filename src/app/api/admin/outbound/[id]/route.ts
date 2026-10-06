import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  assertRoleOrFail,
  rejectIfImpersonating,
  jsonError,
} from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

/** GET — single outbound message detail. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const { id } = await params;
  const msg = await prisma.outboundMessage.findUnique({
    where: { id },
    include: { tenant: { select: { id: true, name: true, slug: true } } },
  });
  if (!msg) return jsonError("Message not found", 404);
  return NextResponse.json(msg);
}

/** PATCH — mark as sent manually (training/demo flow). */
export async function PATCH(_req: NextRequest, { params }: Params) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const { id } = await params;
  const updated = await prisma.outboundMessage.update({
    where: { id },
    data: { status: "SENT_MANUAL", sentAt: new Date() },
  });

  logAudit({
    session,
    action: "outbound.marked_sent",
    entity: "OutboundMessage",
    entityId: id,
  });

  return NextResponse.json(updated);
}
