import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSessionOrFail,
  assertRoleOrFail,
  rejectIfImpersonating,
  jsonError,
} from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/outbound";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const { id } = await params;
  let body: { decisionNotes?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const decisionNotes = (body.decisionNotes ?? "").trim();
  if (!decisionNotes) return jsonError("decisionNotes is required for rejection");

  const app = await prisma.tenantApplication.findUnique({ where: { id } });
  if (!app) return jsonError("Application not found", 404);
  if (app.status === "APPROVED") return jsonError("Already approved", 409);

  await prisma.tenantApplication.update({
    where: { id: app.id },
    data: {
      status: "REJECTED",
      decisionNotes,
      reviewedAt: new Date(),
      reviewedById: session.user.id,
    },
  });

  await sendEmail({
    to: app.contactEmail,
    subject: `Update on your application for ${app.clubName}`,
    template: "rejection",
    data: {
      contactName: app.contactName,
      clubName: app.clubName,
      decisionNotes,
    },
    relatedEntity: "TenantApplication",
    relatedEntityId: app.id,
  });

  logAudit({
    session,
    action: "application.rejected",
    entity: "TenantApplication",
    entityId: app.id,
    meta: { clubName: app.clubName },
  });

  return NextResponse.json({ ok: true });
}
