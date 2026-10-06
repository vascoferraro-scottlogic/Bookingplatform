import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";

/** Update a plan — PLATFORM_ADMIN only. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const { id } = await params;
  const plan = await prisma.platformPlan.findUnique({ where: { id } });
  if (!plan) return jsonError("Plan not found", 404);

  const body = await req.json().catch(() => null);
  if (!body) return jsonError("Invalid JSON");

  const allowedFields = ["name", "description", "priceMonthlyPence", "trialDays", "maxMembers", "maxGreens", "includedStreamingTier", "featureFlags", "sortOrder", "active"];
  const data: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (body[key] !== undefined) data[key] = body[key];
  }

  if (Object.keys(data).length === 0) return jsonError("No valid fields to update");

  const updated = await prisma.platformPlan.update({ where: { id }, data });

  logAudit({ session, action: "billing.plan.updated", entity: "PlatformPlan", entityId: id, meta: { fields: Object.keys(data) } });

  return NextResponse.json(updated);
}
