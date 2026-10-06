import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertPermissionOrFail, Permission } from "@/lib/permissions";
import { resolveTenantId } from "@/lib/tenant";
import { checkCharityGate } from "@/lib/charity/feature-gate";
import { charityGateError } from "@/lib/charity/api-helpers";
import {
  buildReceiptsAndPayments,
  buildStatementOfAssetsAndLiabilities,
} from "@/lib/charity/reports";

/**
 * GET /api/charity/tar/context?yearId=...
 *
 * Aggregates platform data for the given financial year period so the
 * LLM suggest endpoint (and the wizard sidebar) can display/use it.
 *
 * Returns: { charitySettings, financials, events, bookings, members,
 *            maintenance, streaming, priorTAR }
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;
  const permErr = await assertPermissionOrFail(session, tenantId, Permission.charity_edit);
  if (permErr) return permErr;
  const gate = await checkCharityGate(tenantId);
  const gateErr = charityGateError(gate);
  if (gateErr) return gateErr;

  const url = new URL(req.url);
  const yearId = url.searchParams.get("yearId");
  if (!yearId) return jsonError("yearId required");

  const year = await prisma.charityFinancialYear.findFirst({
    where: { id: yearId, tenantId },
  });
  if (!year) return jsonError("yearId not found", 404);

  const { startDate, endDate } = year;

  // ── Parallel fetches ──────────────────────────────────────
  const [
    settings,
    rp,
    soal,
    events,
    bookingCount,
    uniqueBookers,
    totalMembers,
    newMembers,
    maintenanceEntries,
    streamSessions,
    streamViewerCount,
    priorTAR,
    trustees,
  ] = await Promise.all([
    // Charity settings (number, regulator, narratives)
    prisma.charitySettings.findUnique({
      where: { tenantId },
      select: {
        charityNumber: true,
        regulator: true,
        yearEndMonth: true,
        yearEndDay: true,
        reservesPolicy: true,
        publicBenefitStatement: true,
      },
    }),

    // Full R&P report (reuse existing builder)
    buildReceiptsAndPayments(tenantId, yearId),

    // Statement of Assets & Liabilities
    buildStatementOfAssetsAndLiabilities(tenantId, yearId),

    // Events in the year period (published only)
    prisma.event.findMany({
      where: {
        tenantId,
        status: "PUBLISHED",
        date: { gte: startDate, lte: endDate },
      },
      select: {
        title: true,
        category: true,
        visibility: true,
        date: true,
        description: true,
      },
      orderBy: { date: "asc" },
    }),

    // Booking count in the period
    prisma.booking.count({
      where: {
        tenantId,
        date: { gte: startDate, lte: endDate },
        status: { in: ["APPROVED", "CONFIRMED"] },
      },
    }),

    // Unique bookers
    prisma.booking.findMany({
      where: {
        tenantId,
        date: { gte: startDate, lte: endDate },
        status: { in: ["APPROVED", "CONFIRMED"] },
      },
      select: { userId: true },
      distinct: ["userId"],
    }),

    // Total active members at year-end
    prisma.membership.count({
      where: { tenantId, status: "ACTIVE" },
    }),

    // New members during the period (joined within startDate..endDate)
    prisma.membership.count({
      where: {
        tenantId,
        status: "ACTIVE",
        startedAt: {
          gte: new Date(startDate),
          lte: new Date(endDate + "T23:59:59Z"),
        },
      },
    }),

    // Maintenance activities in the period
    prisma.maintenanceHistory.findMany({
      where: {
        tenantId,
        performedAt: {
          gte: new Date(startDate),
          lte: new Date(endDate + "T23:59:59Z"),
        },
      },
      select: {
        activityType: true,
        description: true,
        performedAt: true,
      },
      orderBy: { performedAt: "asc" },
    }),

    // Stream sessions in the period
    prisma.streamSession.count({
      where: {
        tenantId,
        startedAt: {
          gte: new Date(startDate),
          lte: new Date(endDate + "T23:59:59Z"),
        },
      },
    }),

    // Total stream viewers in the period
    prisma.streamViewer.count({
      where: {
        streamSession: {
          tenantId,
          startedAt: {
            gte: new Date(startDate),
            lte: new Date(endDate + "T23:59:59Z"),
          },
        },
      },
    }),

    // Prior year's TAR (for carry-forward)
    prisma.charityTAR
      .findFirst({
        where: {
          tenantId,
          financialYear: {
            endDate: { lt: startDate },
          },
        },
        orderBy: { financialYear: { endDate: "desc" } },
        select: { sections: true, status: true },
      }),

    // Trustees (TENANT_ADMIN members)
    prisma.membership.findMany({
      where: { tenantId, status: "ACTIVE", role: "TENANT_ADMIN" },
      select: { user: { select: { name: true, email: true } } },
    }),
  ]);

  // ── Shape the response ────────────────────────────────────
  const eventsByCategory: Record<string, number> = {};
  const publicEvents: string[] = [];
  for (const e of events) {
    eventsByCategory[e.category] = (eventsByCategory[e.category] ?? 0) + 1;
    if (e.visibility === "PUBLIC") publicEvents.push(e.title);
  }

  const maintenanceSummary: Record<string, number> = {};
  for (const m of maintenanceEntries) {
    maintenanceSummary[m.activityType] =
      (maintenanceSummary[m.activityType] ?? 0) + 1;
  }

  return NextResponse.json({
    charitySettings: settings,
    trustees: trustees.map((t) => ({
      name: t.user.name,
      email: t.user.email,
    })),
    financials: {
      receiptsAndPayments: {
        totalReceipts: rp.grandTotals.receipts,
        totalPayments: rp.grandTotals.payments,
        netMovement: rp.grandTotals.net,
        receiptCategories: rp.receipts.map((r) => ({
          label: r.label,
          total: r.total,
        })),
        paymentCategories: rp.payments.map((p) => ({
          label: p.label,
          total: p.total,
        })),
      },
      assetsAndLiabilities: {
        bankBalance: soal.bankBalanceAtEnd,
        totalAssets: soal.totalAssets,
        totalLiabilities: soal.totalLiabilities,
        netAssets: soal.netAssets,
      },
    },
    events: {
      total: events.length,
      byCategory: eventsByCategory,
      publicEventTitles: publicEvents,
      list: events.map((e) => ({
        title: e.title,
        date: e.date,
        category: e.category,
        visibility: e.visibility,
        description: e.description,
      })),
    },
    bookings: {
      total: bookingCount,
      uniqueBookers: uniqueBookers.length,
    },
    members: {
      totalActive: totalMembers,
      newDuringYear: newMembers,
    },
    maintenance: {
      totalActivities: maintenanceEntries.length,
      byType: maintenanceSummary,
    },
    streaming: {
      sessions: streamSessions,
      viewers: streamViewerCount,
    },
    priorTAR: priorTAR
      ? {
          sections: JSON.parse(priorTAR.sections),
          status: priorTAR.status,
        }
      : null,
  });
}
