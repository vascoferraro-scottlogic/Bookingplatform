import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating } from "@/lib/api-utils";

/**
 * GET /api/admin/reports/costs
 *
 * Returns platform-wide agent LLM cost data:
 * - totalSpend (all time, cents)
 * - thisMonth (cents)
 * - perTenant (tenantId, tenantName, spend, budget, tokensIn, tokensOut)
 * - byModel (model, spend, runs)
 * - byMonth (month, spend)
 */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  // Total spend (all time)
  const totalAgg = await prisma.agentRun.aggregate({
    _sum: { costsCents: true, tokensIn: true, tokensOut: true },
  });
  const totalSpend = totalAgg._sum.costsCents ?? 0;
  const totalTokensIn = totalAgg._sum.tokensIn ?? 0;
  const totalTokensOut = totalAgg._sum.tokensOut ?? 0;

  // This month
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thisMonthAgg = await prisma.agentRun.aggregate({
    where: { startedAt: { gte: monthStart } },
    _sum: { costsCents: true },
  });
  const thisMonth = thisMonthAgg._sum.costsCents ?? 0;

  // Per-tenant spend + budget
  const tenantSpend = await prisma.agentRun.groupBy({
    by: ["tenantId"],
    where: { tenantId: { not: null } },
    _sum: { costsCents: true, tokensIn: true, tokensOut: true },
    _count: true,
    orderBy: { _sum: { costsCents: "desc" } },
  });

  const tenantIds = tenantSpend.map((t) => t.tenantId!).filter(Boolean);
  const [tenants, budgets] = await Promise.all([
    prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }),
    prisma.tenantAgentBudget.findMany({ where: { tenantId: { in: tenantIds } }, select: { tenantId: true, monthlyCapCents: true, currentSpendCents: true } }),
  ]);

  const tenantMap = new Map(tenants.map((t) => [t.id, t.name]));
  const budgetMap = new Map(budgets.map((b) => [b.tenantId, b]));

  const perTenant = tenantSpend.map((t) => ({
    tenantId: t.tenantId,
    tenantName: tenantMap.get(t.tenantId!) ?? "Unknown",
    spend: t._sum.costsCents ?? 0,
    tokensIn: t._sum.tokensIn ?? 0,
    tokensOut: t._sum.tokensOut ?? 0,
    runs: t._count,
    budgetCap: budgetMap.get(t.tenantId!)?.monthlyCapCents ?? 0,
    currentMonthSpend: budgetMap.get(t.tenantId!)?.currentSpendCents ?? 0,
  }));

  // By model
  const modelSpend = await prisma.agentRun.groupBy({
    by: ["model"],
    where: { model: { not: null } },
    _sum: { costsCents: true },
    _count: true,
    orderBy: { _sum: { costsCents: "desc" } },
  });
  const byModel = modelSpend.map((m) => ({
    model: m.model ?? "unknown",
    spend: m._sum.costsCents ?? 0,
    runs: m._count,
  }));

  // By month (last 12)
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const runs = await prisma.agentRun.findMany({
    where: { startedAt: { gte: twelveMonthsAgo }, costsCents: { gt: 0 } },
    select: { costsCents: true, startedAt: true },
  });
  const monthBuckets = new Map<string, number>();
  for (const r of runs) {
    const key = r.startedAt.toISOString().slice(0, 7);
    monthBuckets.set(key, (monthBuckets.get(key) ?? 0) + r.costsCents);
  }
  const byMonth = Array.from(monthBuckets.entries())
    .map(([month, spend]) => ({ month, spend }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return NextResponse.json({
    totalSpend,
    thisMonth,
    totalTokensIn,
    totalTokensOut,
    totalRuns: totalAgg._sum ? undefined : 0,
    perTenant,
    byModel,
    byMonth,
  });
}
