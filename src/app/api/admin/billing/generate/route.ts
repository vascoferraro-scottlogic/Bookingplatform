import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { generateInvoice, generateAllInvoices } from "@/lib/billing";

/**
 * POST /api/admin/billing/generate
 *
 * Generate invoices. Body:
 *   { tenantId?: string, dryRun?: boolean }
 *
 * If tenantId is provided, generates for one tenant.
 * If omitted, generates for all due tenants.
 *
 * PLATFORM_ADMIN only (not impersonating).
 */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const body = await req.json().catch(() => ({}));
  const { tenantId, dryRun } = body as { tenantId?: string; dryRun?: boolean };

  if (tenantId) {
    const result = await generateInvoice(tenantId, { dryRun });
    if (!result) {
      return NextResponse.json({ message: "No invoice due for this tenant (profile missing, not due, or suspended)" }, { status: 200 });
    }

    if (!dryRun) {
      logAudit({ session, action: "billing.invoice.generated", entity: "TenantPayment", entityId: result.paymentId, tenantId, meta: { amount: result.amount } });
    }

    return NextResponse.json({ generated: 1, results: [result], dryRun: !!dryRun });
  }

  // Bulk generation
  const results = await generateAllInvoices({ dryRun });

  if (!dryRun) {
    logAudit({ session, action: "billing.invoice.bulk_generated", entity: "TenantPayment", meta: { count: results.length, totalAmount: results.reduce((s, r) => s + r.amount, 0) } });
  }

  return NextResponse.json({ generated: results.length, results, dryRun: !!dryRun });
}
