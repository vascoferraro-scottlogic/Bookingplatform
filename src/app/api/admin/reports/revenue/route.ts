import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating } from "@/lib/api-utils";
import { getRevenueReport } from "@/lib/billing";

/**
 * GET /api/admin/reports/revenue
 *
 * Returns MRR, ARR, total revenue, outstanding, by-plan breakdown,
 * and monthly revenue trend. PLATFORM_ADMIN only.
 * Add ?format=csv for a CSV download.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const report = await getRevenueReport();

  const url = new URL(req.url);
  if (url.searchParams.get("format") === "csv") {
    const rows = [
      ["Metric", "Value"].join(","),
      ["MRR (£)", (report.mrr / 100).toFixed(2)].join(","),
      ["ARR (£)", (report.arr / 100).toFixed(2)].join(","),
      ["Total Revenue (£)", (report.totalRevenue / 100).toFixed(2)].join(","),
      ["Outstanding (£)", (report.outstanding / 100).toFixed(2)].join(","),
      ["Active Tenants", report.activeTenants].join(","),
      ["ARPT (£)", (report.arpt / 100).toFixed(2)].join(","),
      "",
      ["Plan", "Tenants", "MRR (£)"].join(","),
      ...report.byPlan.map((p) => [p.planName, p.tenants, (p.mrr / 100).toFixed(2)].join(",")),
      "",
      ["Month", "Revenue (£)"].join(","),
      ...report.byMonth.map((m) => [m.month, (m.revenue / 100).toFixed(2)].join(",")),
    ];
    return new NextResponse(rows.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="revenue-report.csv"',
      },
    });
  }

  return NextResponse.json(report);
}
