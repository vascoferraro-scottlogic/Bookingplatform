import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { currentClubYear } from "@/lib/season";

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

  const { year: yearInput, startDate, endDate, note, overwrite } = body as {
    year?: number;
    overwrite?: boolean;
    startDate?: string;
    endDate?: string;
    note?: string;
  };

  if (!startDate || !endDate) {
    return jsonError("startDate and endDate are required", 400);
  }

  // Year defaults to the current year in the club's timezone
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
  const year = yearInput ?? currentClubYear(tenant?.timezone);
  if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 2100) {
    return jsonError("year must be a number between 2000 and 2100", 400);
  }
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!isoDate.test(startDate) || !isoDate.test(endDate) || isNaN(new Date(startDate).getTime()) || isNaN(new Date(endDate).getTime())) {
    return jsonError("startDate and endDate must be valid YYYY-MM-DD dates", 400);
  }
  if (Number(startDate.slice(0, 4)) !== year || Number(endDate.slice(0, 4)) !== year) {
    return jsonError(`startDate and endDate must fall within ${year}`, 400);
  }
  // A one-day season (start = end) is allowed
  if (endDate < startDate) {
    return jsonError("endDate must not be before startDate", 400);
  }

  const existing = await prisma.greenSeason.findUnique({ where: { greenId_year: { greenId, year } } });
  if (existing && overwrite !== true) {
    return jsonError(`A ${year} season override already exists. Send overwrite: true to replace it.`, 409);
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
