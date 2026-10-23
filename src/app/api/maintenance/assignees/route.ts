import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { Permission } from "@prisma/client";
import { resolveTenantId } from "@/lib/tenant";
import { maintenanceGateOrFail } from "../gate";

/** Users who can be assigned a task: active members of the tenant holding the MAINTENANCE role (D-11). */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const permErr = await maintenanceGateOrFail(session, Permission.maintenance_assign);
  if (permErr) return permErr;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  try {
    const memberships = await prisma.membership.findMany({
      where: { tenantId, role: "MAINTENANCE", status: "ACTIVE" },
      select: { user: { select: { id: true, name: true } } },
    });
    return NextResponse.json(memberships.map((m) => m.user));
  } catch {
    return jsonError("Failed to fetch assignees", 500);
  }
}
