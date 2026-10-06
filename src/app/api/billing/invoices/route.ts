import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";

/**
 * GET /api/billing/invoices
 *
 * Returns invoices for the current tenant. Paginated.
 * Query params: ?page=1&limit=20&status=PAID|PENDING
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));
  const status = url.searchParams.get("status") as "PAID" | "PENDING" | null;

  const where: Record<string, unknown> = { tenantId };
  if (status) where.status = status;

  const [invoices, total] = await Promise.all([
    prisma.tenantPayment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { lineItems: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.tenantPayment.count({ where }),
  ]);

  return NextResponse.json({ invoices, total, page, limit });
}
