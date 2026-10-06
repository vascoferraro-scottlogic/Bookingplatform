import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

/** List season overrides for a green. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id: greenId } = await ctx.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const green = await prisma.green.findUnique({ where: { id: greenId } });
  if (!green || green.tenantId !== tenantId) return jsonError("Green not found", 404);

  const seasons = await prisma.greenSeason.findMany({
    where: { greenId },
    orderBy: { year: "asc" },
  });

  return NextResponse.json(seasons);
}

/** Create or update a season override for a green+year. */
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

  const { year, startDate, endDate, note } = body as {
    year?: number;
    startDate?: string;
    endDate?: string;
    note?: string;
  };

  if (!year || !startDate || !endDate) {
    return jsonError("year, startDate, and endDate are required", 400);
  }
  if (typeof year !== "number" || year < 2000 || year > 2100) {
    return jsonError("year must be a number between 2000 and 2100", 400);
  }
  if (new Date(endDate) <= new Date(startDate)) {
    return jsonError("endDate must be after startDate", 400);
  }

  const season = await prisma.greenSeason.upsert({
    where: { greenId_year: { greenId, year } },
    update: {
      startDate,
      endDate,
      note: note?.trim() || null,
    },
    create: {
      greenId,
      year,
      startDate,
      endDate,
      note: note?.trim() || null,
    },
  });

  logAudit({
    session,
    action: "greenSeason.upserted",
    entity: "GreenSeason",
    entityId: season.id,
    tenantId,
    meta: { greenId, greenName: green.name, year, startDate, endDate },
  });

  return NextResponse.json(season, { status: 201 });
}

/** Delete a season override. */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id: greenId } = await ctx.params;
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  const green = await prisma.green.findUnique({ where: { id: greenId } });
  if (!green || green.tenantId !== tenantId) return jsonError("Green not found", 404);

  const url = new URL(req.url);
  const yearParam = url.searchParams.get("year");
  if (!yearParam) return jsonError("year query param required", 400);
  const year = parseInt(yearParam, 10);
  if (isNaN(year)) return jsonError("year must be a number", 400);

  const existing = await prisma.greenSeason.findUnique({
    where: { greenId_year: { greenId, year } },
  });
  if (!existing) return jsonError("Season override not found", 404);

  await prisma.greenSeason.delete({ where: { id: existing.id } });

  logAudit({
    session,
    action: "greenSeason.deleted",
    entity: "GreenSeason",
    entityId: existing.id,
    tenantId,
    meta: { greenId, greenName: green.name, year },
  });

  return NextResponse.json({ deleted: true });
}
