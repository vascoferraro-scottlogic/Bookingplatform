import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import crypto from "crypto";

type RouteContext = { params: Promise<{ id: string }> };

/** GET — list tokens for a stream. TENANT_ADMIN+ only. */
export async function GET(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const stream = await prisma.streamSession.findFirst({ where: { id, tenantId } });
  if (!stream) return jsonError("Stream not found", 404);

  const tokens = await prisma.streamToken.findMany({
    where: { streamSessionId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(tokens);
}

/** POST — generate a new shareable token for a stream. TENANT_ADMIN+ only. */
export async function POST(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const stream = await prisma.streamSession.findFirst({ where: { id, tenantId } });
  if (!stream) return jsonError("Stream not found", 404);

  const body = await req.json();
  const { expiresInHours = 24, maxUses } = body;

  if (typeof expiresInHours !== "number" || !Number.isFinite(expiresInHours) || expiresInHours <= 0) {
    return jsonError("expiresInHours must be a positive number");
  }
  if (maxUses != null && (typeof maxUses !== "number" || !Number.isInteger(maxUses) || maxUses < 1)) {
    return jsonError("maxUses must be a whole number of at least 1");
  }

  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
  const token = crypto.randomBytes(32).toString("hex");

  const streamToken = await prisma.streamToken.create({
    data: {
      streamSessionId: id,
      tenantId,
      token,
      expiresAt,
      maxUses: maxUses ?? null,
      createdById: session.user.id,
    },
  });

  logAudit({
    session,
    action: "streaming.token_created",
    entity: "StreamToken",
    entityId: streamToken.id,
    meta: { streamSessionId: id, expiresInHours, maxUses },
  });

  return NextResponse.json(streamToken, { status: 201 });
}
