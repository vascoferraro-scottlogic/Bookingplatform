import { NextResponse } from "next/server";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";
import { getRevenueReport, getChurnReport } from "@/lib/billing";

/**
 * GET /api/admin/reports/insights
 *
 * Platform-admin enterprise MI — cross-tenant KPIs across 9 domains:
 *   1. Adoption & usage
 *   2. Revenue & billing (with country/region breakdown)
 *   3. Retention & churn
 *   4. Operational quality
 *   5. Agent effectiveness (incl. detector chat→task conversion)
 *   6. Federation & funding
 *   7. Onboarding pipeline (application → activation time)
 *   8. Language & i18n (locale distribution, translation ROI)
 *   9. Feature usage (by tenant, country, region)
 *
 * PLATFORM_ADMIN only, non-impersonating.
 */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const thirtyDaysAgoISO = thirtyDaysAgo.toISOString().slice(0, 10);

  // ── Parallel batch 1: counts, reports, and groupings ──────────

  const [
    // Domain 1: Adoption & usage
    totalTenants,
    activeTenants,
    onboardingTenants,
    totalUsers,
    newUsers30d,
    tenantsGoneLive30d,
    onboardingCompletion,

    // Domain 2 & 3: Revenue & churn
    revenueReport,
    churnReport,

    // Domain 4: Operational quality
    totalBookings30d,
    confirmedBookings30d,
    cancelledBookings30d,
    totalTasks30d,
    closedTasks30d,
    totalEvents,
    publishedEvents,

    // Domain 5: Agent effectiveness
    totalAgentRuns30d,
    successfulRuns30d,
    failedRuns30d,
    totalProposals30d,
    approvedProposals30d,
    rejectedProposals30d,
    agentCosts30d,
    agentCostsByAgent,

    // Domain 6: Federation & funding
    totalFederations,
    activeFederations,
    totalFundingApps,
    fundingByStatus,

    // Domain 7: Onboarding pipeline
    activatedTenants,
    tenantApplications,

    // Domain 8: Language / locale
    tenantsByLocale,
    tenantsByCountry,

    // Domain 9: Feature usage (FEATURE_USE tracking events, 30d)
    featureUsageByAction,
  ] = await Promise.all([
    // ── Domain 1: Adoption ──
    prisma.tenant.count(),
    prisma.tenant.count({ where: { status: "ACTIVE" } }),
    prisma.tenant.count({ where: { status: "ONBOARDING" } }),
    prisma.user.count({ where: { suspended: false } }),
    prisma.user.count({ where: { suspended: false, createdAt: { gte: thirtyDaysAgo } } }),
    prisma.tenant.count({ where: { goLiveAt: { gte: thirtyDaysAgo } } }),
    prisma.onboardingProgress.findMany({
      select: { completedAt: true, currentChapter: true },
    }),

    // ── Domain 2 & 3: Revenue & churn ──
    getRevenueReport(),
    getChurnReport(),

    // ── Domain 4: Operational quality ──
    prisma.booking.count({ where: { date: { gte: thirtyDaysAgoISO } } }),
    prisma.booking.count({ where: { date: { gte: thirtyDaysAgoISO }, status: "CONFIRMED" } }),
    prisma.booking.count({ where: { date: { gte: thirtyDaysAgoISO }, status: "CANCELLED" } }),
    prisma.maintenanceTask.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.maintenanceTask.count({ where: { createdAt: { gte: thirtyDaysAgo }, status: "CLOSED" } }),
    prisma.event.count({ where: { date: { gte: thirtyDaysAgoISO } } }),
    prisma.event.count({ where: { date: { gte: thirtyDaysAgoISO }, status: "PUBLISHED" } }),

    // ── Domain 5: Agent effectiveness ──
    prisma.agentRun.count({ where: { startedAt: { gte: thirtyDaysAgo } } }),
    prisma.agentRun.count({ where: { startedAt: { gte: thirtyDaysAgo }, status: "COMPLETED" } }),
    prisma.agentRun.count({ where: { startedAt: { gte: thirtyDaysAgo }, status: "FAILED" } }),
    prisma.agentProposal.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.agentProposal.count({ where: { createdAt: { gte: thirtyDaysAgo }, status: "APPROVED" } }),
    prisma.agentProposal.count({ where: { createdAt: { gte: thirtyDaysAgo }, status: "REJECTED" } }),
    prisma.agentRun.aggregate({
      where: { startedAt: { gte: thirtyDaysAgo } },
      _sum: { costsCents: true, tokensIn: true, tokensOut: true },
    }),
    prisma.agentRun.groupBy({
      by: ["agentId"],
      where: { startedAt: { gte: thirtyDaysAgo } },
      _sum: { costsCents: true },
      _count: true,
      orderBy: { _sum: { costsCents: "desc" } },
      take: 10,
    }),

    // ── Domain 6: Federation & funding ──
    prisma.federation.count(),
    prisma.federation.count({ where: { status: "ACTIVE" } }),
    prisma.fundingApplication.count(),
    prisma.fundingApplication.groupBy({
      by: ["status"],
      _count: true,
    }),

    // ── Domain 7: Onboarding pipeline ──
    // Tenants that have gone live (have goLiveAt) — to compute time-to-activate
    prisma.tenant.findMany({
      where: { goLiveAt: { not: null } },
      select: { createdAt: true, goLiveAt: true, country: true },
    }),
    // TenantApplications — to track request→creation pipeline
    prisma.tenantApplication.findMany({
      select: { status: true, createdAt: true, reviewedAt: true, tenantId: true },
    }),

    // ── Domain 8: Language / locale ──
    prisma.tenant.groupBy({
      by: ["locale"],
      where: { status: { in: ["ACTIVE", "ONBOARDING"] } },
      _count: true,
    }),
    prisma.tenant.groupBy({
      by: ["country"],
      where: { status: { in: ["ACTIVE", "ONBOARDING"] } },
      _count: true,
    }),

    // ── Domain 9: Feature usage ──
    prisma.trackingEvent.groupBy({
      by: ["action"],
      where: { eventType: "FEATURE_USE", timestamp: { gte: thirtyDaysAgo } },
      _count: true,
      orderBy: { _count: { action: "desc" } },
      take: 30,
    }),
  ]);

  // ── Parallel batch 2: queries that depend on batch 1 results ──

  // Resolve agent names
  const agentIds = agentCostsByAgent.map((a) => a.agentId);

  // Detector agent — chat message → task conversion
  const detectorDef = await prisma.agentDefinition.findUnique({
    where: { slug: "detector" },
    select: { id: true },
  });

  const [
    agents,
    detectorRuns30d,
    detectorProposals30d,
    detectorApproved30d,
    tenantBookingLeaderboard,
    revenueByCountry,
    featureUsageByCountry,
    featureUsageByTenant,
  ] = await Promise.all([
    agentIds.length > 0
      ? prisma.agentDefinition.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),

    // Detector runs (30d)
    detectorDef
      ? prisma.agentRun.count({
          where: { agentId: detectorDef.id, startedAt: { gte: thirtyDaysAgo }, status: "COMPLETED" },
        })
      : Promise.resolve(0),

    // Detector proposals (MAINTENANCE_TASK_CREATE kind)
    detectorDef
      ? prisma.agentProposal.count({
          where: { agentId: detectorDef.id, kind: "MAINTENANCE_TASK_CREATE", createdAt: { gte: thirtyDaysAgo } },
        })
      : Promise.resolve(0),

    detectorDef
      ? prisma.agentProposal.count({
          where: {
            agentId: detectorDef.id,
            kind: "MAINTENANCE_TASK_CREATE",
            status: "APPROVED",
            createdAt: { gte: thirtyDaysAgo },
          },
        })
      : Promise.resolve(0),

    // Tenant leaderboard — top 10 by booking volume (30d)
    prisma.$queryRawUnsafe<
      { tenant_id: string; tenant_name: string; count: bigint }[]
    >(
      `SELECT b."tenantId" as tenant_id, t.name as tenant_name, COUNT(*)::bigint as count
       FROM "Booking" b
       JOIN "Tenant" t ON t.id = b."tenantId"
       WHERE b.date >= $1
       GROUP BY b."tenantId", t.name
       ORDER BY count DESC
       LIMIT 10`,
      thirtyDaysAgoISO,
    ),

    // Revenue by country — join billing profiles with tenant country
    prisma.$queryRawUnsafe<
      { country: string; tenant_count: bigint; mrr_pence: bigint }[]
    >(
      `SELECT t.country, COUNT(DISTINCT t.id)::bigint as tenant_count,
              COALESCE(SUM(p."priceMonthlyPence"), 0)::bigint as mrr_pence
       FROM "TenantBillingProfile" bp
       JOIN "Tenant" t ON t.id = bp."tenantId"
       JOIN "PlatformPlan" p ON p.id = bp."planId"
       WHERE bp."billingStatus" IN ('TRIAL', 'ACTIVE')
       GROUP BY t.country
       ORDER BY mrr_pence DESC`,
    ),

    // Feature usage by country (top 20 action × country combos, 30d)
    prisma.$queryRawUnsafe<
      { country: string; action: string; count: bigint }[]
    >(
      `SELECT t.country, te.action, COUNT(*)::bigint as count
       FROM "TrackingEvent" te
       JOIN "Tenant" t ON t.id = te."tenantId"
       WHERE te."eventType" = 'FEATURE_USE'
         AND te.timestamp >= $1
         AND te.action IS NOT NULL
       GROUP BY t.country, te.action
       ORDER BY count DESC
       LIMIT 40`,
      thirtyDaysAgo,
    ),

    // Feature usage by tenant — top 15 tenants by feature-use event count (30d)
    prisma.$queryRawUnsafe<
      { tenant_id: string; tenant_name: string; locale: string; country: string; count: bigint }[]
    >(
      `SELECT t.id as tenant_id, t.name as tenant_name, t.locale, t.country,
              COUNT(*)::bigint as count
       FROM "TrackingEvent" te
       JOIN "Tenant" t ON t.id = te."tenantId"
       WHERE te."eventType" = 'FEATURE_USE'
         AND te.timestamp >= $1
       GROUP BY t.id, t.name, t.locale, t.country
       ORDER BY count DESC
       LIMIT 15`,
      thirtyDaysAgo,
    ),
  ]);

  const agentNameMap = new Map(agents.map((a) => [a.id, a.name]));

  // ── Derived KPIs ──────────────────────────────────────────────

  // Adoption
  const completedOnboarding = onboardingCompletion.filter((o) => o.completedAt).length;
  const inProgressOnboarding = onboardingCompletion.filter((o) => !o.completedAt).length;
  const avgOnboardingChapter = inProgressOnboarding > 0
    ? Math.round(
        onboardingCompletion
          .filter((o) => !o.completedAt)
          .reduce((s, o) => s + o.currentChapter, 0) / inProgressOnboarding * 10
      ) / 10
    : 0;

  // Operational quality
  const bookingConfirmRate = totalBookings30d > 0
    ? Math.round((confirmedBookings30d / totalBookings30d) * 100) : 0;
  const bookingCancelRate = totalBookings30d > 0
    ? Math.round((cancelledBookings30d / totalBookings30d) * 100) : 0;
  const taskCompletionRate = totalTasks30d > 0
    ? Math.round((closedTasks30d / totalTasks30d) * 100) : 0;

  // Agent effectiveness
  const agentSuccessRate = totalAgentRuns30d > 0
    ? Math.round((successfulRuns30d / totalAgentRuns30d) * 100) : 0;
  const proposalApprovalRate = totalProposals30d > 0
    ? Math.round((approvedProposals30d / totalProposals30d) * 100) : 0;

  // Detector chat→task conversion
  const detectorApprovalRate = detectorProposals30d > 0
    ? Math.round((detectorApproved30d / detectorProposals30d) * 100) : 0;

  // Onboarding pipeline — time from tenant creation to go-live (days)
  const activationTimeDays = activatedTenants
    .filter((t) => t.goLiveAt)
    .map((t) => Math.round((t.goLiveAt!.getTime() - t.createdAt.getTime()) / 86400000));
  const avgActivationDays = activationTimeDays.length > 0
    ? Math.round(activationTimeDays.reduce((s, d) => s + d, 0) / activationTimeDays.length)
    : null;
  const medianActivationDays = activationTimeDays.length > 0
    ? (() => {
        const sorted = [...activationTimeDays].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
          ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
          : sorted[mid];
      })()
    : null;

  // Activation time by country
  const activationByCountry = new Map<string, number[]>();
  for (const t of activatedTenants) {
    if (!t.goLiveAt) continue;
    const days = Math.round((t.goLiveAt.getTime() - t.createdAt.getTime()) / 86400000);
    const arr = activationByCountry.get(t.country) ?? [];
    arr.push(days);
    activationByCountry.set(t.country, arr);
  }

  // Application pipeline stats
  const appsByStatus = new Map<string, number>();
  let totalAppReviewDays = 0;
  let reviewedAppCount = 0;
  for (const app of tenantApplications) {
    appsByStatus.set(app.status, (appsByStatus.get(app.status) ?? 0) + 1);
    if (app.reviewedAt) {
      totalAppReviewDays += Math.round(
        (app.reviewedAt.getTime() - app.createdAt.getTime()) / 86400000,
      );
      reviewedAppCount++;
    }
  }
  const avgReviewDays = reviewedAppCount > 0
    ? Math.round(totalAppReviewDays / reviewedAppCount) : null;

  // Language — active sessions by locale (via TrackingEvent SESSION_START)
  // Already have tenantsByLocale from batch 1. Summarise for the response.

  return NextResponse.json({
    generatedAt: now.toISOString(),
    period: "30d",

    adoption: {
      totalTenants,
      activeTenants,
      onboardingTenants,
      totalUsers,
      newUsers30d,
      tenantsGoneLive30d,
      onboardingCompleted: completedOnboarding,
      onboardingInProgress: inProgressOnboarding,
      avgOnboardingChapter,
    },

    revenue: {
      mrr: revenueReport.mrr,
      arr: revenueReport.arr,
      totalRevenue: revenueReport.totalRevenue,
      outstanding: revenueReport.outstanding,
      arpt: revenueReport.arpt,
      byPlan: revenueReport.byPlan,
      byMonth: revenueReport.byMonth,
      byCountry: revenueByCountry.map((r) => ({
        country: r.country,
        tenants: Number(r.tenant_count),
        mrrPence: Number(r.mrr_pence),
      })),
    },

    churn: {
      totalChurned: churnReport.totalChurned,
      churnRate: churnReport.churnRate,
      byMonth: churnReport.byMonth,
    },

    operations: {
      bookings30d: totalBookings30d,
      confirmed30d: confirmedBookings30d,
      cancelled30d: cancelledBookings30d,
      confirmRate: bookingConfirmRate,
      cancelRate: bookingCancelRate,
      tasks30d: totalTasks30d,
      tasksClosed30d: closedTasks30d,
      taskCompletionRate,
      events30d: totalEvents,
      eventsPublished30d: publishedEvents,
      tenantLeaderboard: tenantBookingLeaderboard.map((r) => ({
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        bookings: Number(r.count),
      })),
    },

    agents: {
      runs30d: totalAgentRuns30d,
      successful30d: successfulRuns30d,
      failed30d: failedRuns30d,
      successRate: agentSuccessRate,
      proposals30d: totalProposals30d,
      approved30d: approvedProposals30d,
      rejected30d: rejectedProposals30d,
      approvalRate: proposalApprovalRate,
      spend30d: agentCosts30d._sum.costsCents ?? 0,
      tokensIn30d: agentCosts30d._sum.tokensIn ?? 0,
      tokensOut30d: agentCosts30d._sum.tokensOut ?? 0,
      byAgent: agentCostsByAgent.map((a) => ({
        agentId: a.agentId,
        agentName: agentNameMap.get(a.agentId) ?? a.agentId,
        runs: a._count,
        spend: a._sum.costsCents ?? 0,
      })),
      detector: {
        runs30d: detectorRuns30d,
        taskProposals30d: detectorProposals30d,
        tasksApproved30d: detectorApproved30d,
        approvalRate: detectorApprovalRate,
      },
    },

    federationAndFunding: {
      totalFederations,
      activeFederations,
      totalFundingApplications: totalFundingApps,
      fundingByStatus: fundingByStatus.map((f) => ({
        status: f.status,
        count: f._count,
      })),
    },

    onboardingPipeline: {
      totalApplications: tenantApplications.length,
      applicationsByStatus: Object.fromEntries(appsByStatus),
      avgReviewDays,
      totalActivated: activationTimeDays.length,
      avgActivationDays,
      medianActivationDays,
      activationByCountry: Array.from(activationByCountry.entries()).map(
        ([country, days]) => ({
          country,
          count: days.length,
          avgDays: Math.round(days.reduce((s, d) => s + d, 0) / days.length),
        }),
      ),
    },

    language: {
      tenantsByLocale: tenantsByLocale.map((l) => ({
        locale: l.locale,
        count: l._count,
      })),
      tenantsByCountry: tenantsByCountry.map((c) => ({
        country: c.country,
        count: c._count,
      })),
    },

    featureUsage: {
      topFeatures30d: featureUsageByAction.map((f) => ({
        action: f.action ?? "unknown",
        count: f._count,
      })),
      byCountry: featureUsageByCountry.map((f) => ({
        country: f.country,
        action: f.action,
        count: Number(f.count),
      })),
      byTenant: featureUsageByTenant.map((f) => ({
        tenantId: f.tenant_id,
        tenantName: f.tenant_name,
        locale: f.locale,
        country: f.country,
        featureUses: Number(f.count),
      })),
    },
  });
}
