import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating } from "@/lib/api-utils";

/**
 * GET /api/admin/billing/invoices
 *
 * Platform-level invoice list. Paginated JSON by default.
 * Add ?format=csv for full CSV export (no pagination).
 * Query: ?status=PENDING&page=1&limit=50
 */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") as "PAID" | "PENDING" | "FAILED" | null;
  const format = url.searchParams.get("format");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  if (format === "csv") {
    const invoices = await prisma.tenantPayment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { tenant: { select: { name: true } } },
    });

    const rows = [
      ["Invoice Ref", "Tenant", "Amount (£)", "Status", "Period Start", "Period End", "Date"].join(","),
      ...invoices.map((inv) => [
        inv.invoiceRef ?? inv.id,
        `"${inv.tenant?.name ?? "Unknown"}"`,
        (inv.amount / 100).toFixed(2),
        inv.status,
        inv.periodStart?.toISOString().slice(0, 10) ?? "",
        inv.periodEnd?.toISOString().slice(0, 10) ?? "",
        inv.createdAt.toISOString().slice(0, 10),
      ].join(",")),
    ];

    return new NextResponse(rows.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="platform-invoices.csv"',
      },
    });
  }

  // JSON paginated
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)));

  const [invoices, total] = await Promise.all([
    prisma.tenantPayment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { tenant: { select: { name: true } } },
    }),
    prisma.tenantPayment.count({ where }),
  ]);

  return NextResponse.json({ invoices, total, page, limit });
}
