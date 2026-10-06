import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

/** Update a green (rename). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const green = await prisma.green.findUnique({ where: { id } });
  if (!green || green.tenantId !== tenantId) return jsonError("Green not found", 404);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const { name, allWeather, seasonStartMMDD, seasonEndMMDD } = body as {
    name?: string;
    allWeather?: boolean;
    seasonStartMMDD?: string | null;
    seasonEndMMDD?: string | null;
  };
  if (name !== undefined && (!name || !name.trim())) return jsonError("name must not be empty");

  try {
    const updated = await prisma.green.update({
      where: { id },
      data: {
        ...(name ? { name: name.trim() } : {}),
        ...(allWeather !== undefined ? { allWeather } : {}),
        ...(seasonStartMMDD !== undefined ? { seasonStartMMDD: seasonStartMMDD?.trim() || null } : {}),
        ...(seasonEndMMDD !== undefined ? { seasonEndMMDD: seasonEndMMDD?.trim() || null } : {}),
      },
      include: { rinks: true, seasons: true },
    });

    logAudit({ session, action: "green.updated", entity: "Green", entityId: id, tenantId, meta: { name: updated.name, allWeather: updated.allWeather } });

    return NextResponse.json(updated);
  } catch {
    return jsonError("Failed to update green", 500);
  }
}

/** Delete a green. Blocked if any rink has future booking slots. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const green = await prisma.green.findUnique({ where: { id }, include: { rinks: true } });
  if (!green || green.tenantId !== tenantId) return jsonError("Green not found", 404);

  // Check for future bookings on any rink in this green
  const rinkIds = green.rinks.map((r) => r.id);
  if (rinkIds.length > 0) {
    const futureSlots = await prisma.bookingSlot.count({
      where: { rinkId: { in: rinkIds }, date: { gte: new Date() } },
    });
    if (futureSlots > 0) {
      return jsonError("Cannot delete green with future bookings. Cancel or reassign them first.", 409);
    }
  }

  try {
    // Delete rinks first (cascade), then the green
    if (rinkIds.length > 0) {
      await prisma.bookingSlot.deleteMany({ where: { rinkId: { in: rinkIds } } });
      await prisma.rink.deleteMany({ where: { greenId: id } });
    }
    await prisma.green.delete({ where: { id } });

    logAudit({ session, action: "green.deleted", entity: "Green", entityId: id, tenantId, meta: { name: green.name } });

    return NextResponse.json({ success: true });
  } catch {
    return jsonError("Failed to delete green", 500);
  }
}
