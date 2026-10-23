import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { isValidMMDD } from "@/lib/season";

/** List greens (with rinks) for the current tenant. */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  try {
    const greens = await prisma.green.findMany({
      where: { tenantId, archivedAt: null },
      include: {
        rinks: { where: { archivedAt: null }, orderBy: { name: "asc" } },
        seasons: { orderBy: { year: "asc" } },
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(greens);
  } catch {
    return jsonError("Failed to fetch greens", 500);
  }
}

/** Create a new green (with optional rinks). */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const { name, rinks, allWeather, seasonStartMMDD, seasonEndMMDD } = body as {
    name?: string;
    rinks?: { name: string }[];
    allWeather?: boolean;
    seasonStartMMDD?: string;
    seasonEndMMDD?: string;
  };
  if (!name || !name.trim()) return jsonError("name is required");
  for (const v of [seasonStartMMDD, seasonEndMMDD]) {
    if (v?.trim() && !isValidMMDD(v.trim())) return jsonError("Season dates must be valid MM-DD values", 400);
  }

  try {
    const green = await prisma.green.create({
      data: {
        tenantId,
        name: name.trim(),
        allWeather: allWeather === true,
        seasonStartMMDD: seasonStartMMDD?.trim() || null,
        seasonEndMMDD: seasonEndMMDD?.trim() || null,
        rinks: Array.isArray(rinks) && rinks.length
          ? { create: rinks.map((r) => ({ name: r.name?.trim() || "Unnamed" })) }
          : undefined,
      },
      include: { rinks: true, seasons: true },
    });

    logAudit({ session, action: "green.created", entity: "Green", entityId: green.id, tenantId, meta: { name: green.name, rinkCount: green.rinks.length } });

    return NextResponse.json(green, { status: 201 });
  } catch {
    return jsonError("Failed to create green", 500);
  }
}
