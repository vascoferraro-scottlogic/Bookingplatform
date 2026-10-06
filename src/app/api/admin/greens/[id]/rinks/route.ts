import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

/** Add a rink to a green. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { id: greenId } = await ctx.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const green = await prisma.green.findUnique({ where: { id: greenId } });
  if (!green || green.tenantId !== tenantId) return jsonError("Green not found", 404);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const { name } = body as { name?: string };
  if (!name || !name.trim()) return jsonError("name is required");

  try {
    const rink = await prisma.rink.create({
      data: { greenId, name: name.trim() },
    });

    logAudit({ session, action: "rink.created", entity: "Rink", entityId: rink.id, tenantId, meta: { name: rink.name, greenId } });

    return NextResponse.json(rink, { status: 201 });
  } catch {
    return jsonError("Failed to create rink", 500);
  }
}
