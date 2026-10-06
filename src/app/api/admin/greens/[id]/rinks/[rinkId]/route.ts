import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string; rinkId: string }> };

/** Rename a rink. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id: greenId, rinkId } = await ctx.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const rink = await prisma.rink.findUnique({ where: { id: rinkId }, include: { green: true } });
  if (!rink || rink.greenId !== greenId || rink.green.tenantId !== tenantId) {
    return jsonError("Rink not found", 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const { name } = body as { name?: string };
  if (!name || !name.trim()) return jsonError("name is required");

  try {
    const updated = await prisma.rink.update({
      where: { id: rinkId },
      data: { name: name.trim() },
    });

    logAudit({ session, action: "rink.updated", entity: "Rink", entityId: rinkId, tenantId, meta: { name: updated.name, greenId } });

    return NextResponse.json(updated);
  } catch {
    return jsonError("Failed to update rink", 500);
  }
}

/** Delete a rink. Blocked if it has future booking slots. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id: greenId, rinkId } = await ctx.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const rink = await prisma.rink.findUnique({ where: { id: rinkId }, include: { green: true } });
  if (!rink || rink.greenId !== greenId || rink.green.tenantId !== tenantId) {
    return jsonError("Rink not found", 404);
  }

  const futureSlots = await prisma.bookingSlot.count({
    where: { rinkId, date: { gte: new Date() } },
  });
  if (futureSlots > 0) {
    return jsonError("Cannot delete rink with future bookings. Cancel or reassign them first.", 409);
  }

  try {
    await prisma.bookingSlot.deleteMany({ where: { rinkId } });
    await prisma.rink.delete({ where: { id: rinkId } });

    logAudit({ session, action: "rink.deleted", entity: "Rink", entityId: rinkId, tenantId, meta: { name: rink.name, greenId } });

    return NextResponse.json({ success: true });
  } catch {
    return jsonError("Failed to delete rink", 500);
  }
}
