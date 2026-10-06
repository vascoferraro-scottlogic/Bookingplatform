import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";

/**
 * PATCH /api/admin/federations/[id] — suspend or dissolve a federation.
 * Body: { status: "SUSPENDED" | "DISSOLVED" }
 *
 * PLATFORM_ADMIN only.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const federation = await prisma.federation.findUnique({ where: { id } });
  if (!federation) return jsonError("Federation not found", 404);

  const body = await req.json();
  const status = body.status;
  if (!status || !["SUSPENDED", "DISSOLVED"].includes(status)) {
    return jsonError("status must be SUSPENDED or DISSOLVED", 400);
  }

  const updated = await prisma.federation.update({
    where: { id },
    data: { status },
  });

  logAudit({
    session,
    action: `federation.${status.toLowerCase()}`,
    entity: "Federation",
    entityId: id,
    meta: { federationName: federation.name },
  });

  return NextResponse.json(updated);
}
