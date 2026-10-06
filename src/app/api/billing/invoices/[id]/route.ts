import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { invoiceToCSV } from "@/lib/billing";

/**
 * GET /api/billing/invoices/[id]
 *
 * Returns a single invoice with line items.
 * Add ?format=csv to get a CSV download.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { tenantId, error: tErr } = resolveTenantId(session);
  if (tErr) return tErr;

  const { id } = await params;

  const invoice = await prisma.tenantPayment.findFirst({
    where: { id, tenantId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });

  if (!invoice) {
    return jsonError("Invoice not found", 404);
  }

  const url = new URL(req.url);
  if (url.searchParams.get("format") === "csv") {
    const csv = invoiceToCSV(invoice, invoice.lineItems);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${invoice.invoiceRef ?? id}.csv"`,
      },
    });
  }

  return NextResponse.json(invoice);
}
