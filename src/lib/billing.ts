import { prisma } from "@/lib/prisma";
import type { BillingStatus, PaymentStatus } from "@prisma/client";
import { paymentProvider } from "@/lib/payments";

// ─── Invoice Generation ─────────────────────────────────────────────

export interface GenerateInvoiceResult {
  paymentId: string;
  tenantId: string;
  amount: number;
  lineItems: { description: string; totalPricePence: number; category: string }[];
}

/**
 * Generate an invoice (TenantPayment + InvoiceLineItems) for a single
 * tenant's current billing period. Advances the period on the profile.
 *
 * Returns null if the tenant has no billing profile or is not due.
 */
export async function generateInvoice(
  tenantId: string,
  options?: { dryRun?: boolean },
): Promise<GenerateInvoiceResult | null> {
  const profile = await prisma.tenantBillingProfile.findUnique({
    where: { tenantId },
    include: { plan: true },
  });

  if (!profile) return null;
  if (profile.billingStatus === "CANCELLED" || profile.billingStatus === "SUSPENDED") return null;

  // Check if period has elapsed
  if (profile.currentPeriodEnd > new Date()) return null;

  const lineItems: { description: string; unitPricePence: number; totalPricePence: number; category: "PLATFORM_SUBSCRIPTION" | "STREAMING_TIER" }[] = [];

  // Platform subscription line
  lineItems.push({
    description: `${profile.plan.name} plan — monthly subscription`,
    unitPricePence: profile.plan.priceMonthlyPence,
    totalPricePence: profile.plan.priceMonthlyPence,
    category: "PLATFORM_SUBSCRIPTION",
  });

  // Streaming tier addon (if not included in plan)
  const subscription = await prisma.tenantSubscription.findUnique({ where: { tenantId } });
  if (subscription && subscription.priceMonthlyPence > 0) {
    // Only charge if streaming tier exceeds what's included in the plan
    const includedTierPrice = getTierPrice(profile.plan.includedStreamingTier);
    const addon = subscription.priceMonthlyPence - includedTierPrice;
    if (addon > 0) {
      lineItems.push({
        description: `Streaming ${subscription.tier} tier addon`,
        unitPricePence: addon,
        totalPricePence: addon,
        category: "STREAMING_TIER",
      });
    }
  }

  const totalAmount = lineItems.reduce((sum, li) => sum + li.totalPricePence, 0);
  const periodStart = profile.currentPeriodEnd;
  const periodEnd = addMonth(periodStart);
  const invoiceRef = generateInvoiceRef(tenantId, periodStart);

  if (options?.dryRun) {
    return { paymentId: "dry-run", tenantId, amount: totalAmount, lineItems };
  }

  // Create payment + line items in a transaction
  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.tenantPayment.create({
      data: {
        tenantId,
        billingProfileId: profile.id,
        amount: totalAmount,
        status: "PENDING",
        type: "SUBSCRIPTION",
        invoiceRef,
        periodStart: profile.currentPeriodEnd,
        periodEnd,
      },
    });

    for (let i = 0; i < lineItems.length; i++) {
      await tx.invoiceLineItem.create({
        data: {
          paymentId: p.id,
          description: lineItems[i].description,
          quantity: 1,
          unitPricePence: lineItems[i].unitPricePence,
          totalPricePence: lineItems[i].totalPricePence,
          category: lineItems[i].category,
          sortOrder: i,
        },
      });
    }

    // Advance the billing period
    await tx.tenantBillingProfile.update({
      where: { id: profile.id },
      data: {
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        // If trial ended, move to ACTIVE
        billingStatus: profile.billingStatus === "TRIAL" && profile.trialEndsAt && profile.trialEndsAt <= new Date()
          ? "ACTIVE"
          : profile.billingStatus,
      },
    });

    return p;
  });

  // If the tenant's profile uses an external payment method, invoke the provider.
  try {
    if (profile.paymentMethod && profile.paymentMethod !== "INVOICE") {
      const result = await paymentProvider.chargeTenantPayment(payment.id);
      if (result.status === "PAID") {
        await prisma.tenantPayment.update({ where: { id: payment.id }, data: { status: "PAID" } });
      } else if (result.status === "FAILED") {
        await prisma.tenantPayment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
      }
    }
  } catch (err) {
    // Leave payment as PENDING on provider errors; reconciliation can occur via webhooks.
  }

  return { paymentId: payment.id, tenantId, amount: totalAmount, lineItems };
}

/**
 * Generate invoices for all tenants whose billing period has elapsed.
 */
export async function generateAllInvoices(options?: { dryRun?: boolean }): Promise<GenerateInvoiceResult[]> {
  const dueProfiles = await prisma.tenantBillingProfile.findMany({
    where: {
      currentPeriodEnd: { lte: new Date() },
      billingStatus: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] },
    },
    select: { tenantId: true },
  });

  const results: GenerateInvoiceResult[] = [];
  for (const { tenantId } of dueProfiles) {
    const result = await generateInvoice(tenantId, options);
    if (result) results.push(result);
  }
  return results;
}

// ─── Revenue & Reporting ────────────────────────────────────────────

export interface RevenueReport {
  mrr: number; // Monthly Recurring Revenue (pence)
  arr: number; // Annual (MRR × 12)
  totalRevenue: number; // sum of all PAID TenantPayments
  outstanding: number; // sum of all PENDING TenantPayments
  activeTenants: number;
  arpt: number; // Average Revenue Per Tenant (pence)
  byPlan: { planId: string; planName: string; tenants: number; mrr: number }[];
  byMonth: { month: string; revenue: number }[];
}

export async function getRevenueReport(): Promise<RevenueReport> {
  // Active billing profiles with plan join
  const profiles = await prisma.tenantBillingProfile.findMany({
    where: { billingStatus: { in: ["TRIAL", "ACTIVE"] } },
    include: { plan: true },
  });

  // MRR = sum of active plan prices + streaming addons
  let mrr = 0;
  const planMap = new Map<string, { planName: string; tenants: number; mrr: number }>();

  for (const p of profiles) {
    mrr += p.plan.priceMonthlyPence;
    const existing = planMap.get(p.planId) ?? { planName: p.plan.name, tenants: 0, mrr: 0 };
    existing.tenants++;
    existing.mrr += p.plan.priceMonthlyPence;
    planMap.set(p.planId, existing);
  }

  // Add streaming revenue
  const subscriptions = await prisma.tenantSubscription.findMany({
    where: { status: "ACTIVE", priceMonthlyPence: { gt: 0 } },
  });
  for (const s of subscriptions) {
    mrr += s.priceMonthlyPence;
  }

  const arr = mrr * 12;
  const activeTenants = profiles.length;
  const arpt = activeTenants > 0 ? Math.round(mrr / activeTenants) : 0;

  // Total revenue (all time, PAID only)
  const paidAgg = await prisma.tenantPayment.aggregate({
    where: { status: "PAID" },
    _sum: { amount: true },
  });
  const totalRevenue = paidAgg._sum.amount ?? 0;

  // Outstanding (PENDING)
  const pendingAgg = await prisma.tenantPayment.aggregate({
    where: { status: "PENDING" },
    _sum: { amount: true },
  });
  const outstanding = pendingAgg._sum.amount ?? 0;

  // By plan
  const byPlan = Array.from(planMap.entries()).map(([planId, v]) => ({
    planId,
    ...v,
  }));

  // Revenue by month (last 12 months)
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const paidPayments = await prisma.tenantPayment.findMany({
    where: { status: "PAID", createdAt: { gte: twelveMonthsAgo } },
    select: { amount: true, createdAt: true },
  });

  const monthBuckets = new Map<string, number>();
  for (const p of paidPayments) {
    const key = p.createdAt.toISOString().slice(0, 7); // "2026-04"
    monthBuckets.set(key, (monthBuckets.get(key) ?? 0) + p.amount);
  }
  const byMonth = Array.from(monthBuckets.entries())
    .map(([month, revenue]) => ({ month, revenue }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return { mrr, arr, totalRevenue, outstanding, activeTenants, arpt, byPlan, byMonth };
}

export interface ChurnReport {
  totalChurned: number;
  churnRate: number; // percentage
  byMonth: { month: string; count: number }[];
  churned: { tenantId: string; tenantName: string; churnedAt: Date; lastPayment: Date | null }[];
}

export async function getChurnReport(): Promise<ChurnReport> {
  const churnedTenants = await prisma.tenant.findMany({
    where: { status: "CHURNED" },
    select: {
      id: true,
      name: true,
      updatedAt: true,
      tenantPayments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  const totalActive = await prisma.tenant.count({ where: { status: "ACTIVE" } });
  const totalChurned = churnedTenants.length;
  const churnRate = (totalActive + totalChurned) > 0
    ? Math.round((totalChurned / (totalActive + totalChurned)) * 10000) / 100
    : 0;

  // Group by month
  const monthBuckets = new Map<string, number>();
  for (const t of churnedTenants) {
    const key = t.updatedAt.toISOString().slice(0, 7);
    monthBuckets.set(key, (monthBuckets.get(key) ?? 0) + 1);
  }
  const byMonth = Array.from(monthBuckets.entries())
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const churned = churnedTenants.map((t) => ({
    tenantId: t.id,
    tenantName: t.name,
    churnedAt: t.updatedAt,
    lastPayment: t.tenantPayments[0]?.createdAt ?? null,
  }));

  return { totalChurned, churnRate, byMonth, churned };
}

// ─── Helpers ────────────────────────────────────────────────────────

function getTierPrice(tier: string): number {
  switch (tier) {
    case "BRONZE": return 2000;
    case "SILVER": return 5000;
    case "GOLD": return 10000;
    default: return 0;
  }
}

function addMonth(date: Date): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + 1);
  return result;
}

function generateInvoiceRef(tenantId: string, periodStart: Date): string {
  const prefix = tenantId.slice(0, 6).toUpperCase();
  const month = periodStart.toISOString().slice(0, 7).replace("-", "");
  return `INV-${prefix}-${month}`;
}

/**
 * Format line items as CSV string.
 */
export function invoiceToCSV(
  invoice: { invoiceRef: string | null; periodStart: Date | null; periodEnd: Date | null; amount: number },
  lineItems: { description: string; quantity: number; unitPricePence: number; totalPricePence: number; category: string }[],
): string {
  const rows = [
    ["Invoice Ref", "Period Start", "Period End", "Total (£)"].join(","),
    [
      invoice.invoiceRef ?? "",
      invoice.periodStart?.toISOString().slice(0, 10) ?? "",
      invoice.periodEnd?.toISOString().slice(0, 10) ?? "",
      (invoice.amount / 100).toFixed(2),
    ].join(","),
    "",
    ["Description", "Quantity", "Unit Price (£)", "Total (£)", "Category"].join(","),
    ...lineItems.map((li) =>
      [
        `"${li.description}"`,
        li.quantity,
        (li.unitPricePence / 100).toFixed(2),
        (li.totalPricePence / 100).toFixed(2),
        li.category,
      ].join(","),
    ),
  ];
  return rows.join("\n");
}
