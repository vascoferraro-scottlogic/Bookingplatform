"use client";

import { useEffect, useState } from "react";
import { formatShortRef } from "@/lib/refs";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/format";
import { RevenueChart } from "@/components/billing/RevenueChart";
import { PlanDistribution } from "@/components/billing/PlanDistribution";
import { ChurnChart } from "@/components/billing/ChurnChart";

interface RevenueReport {
  mrr: number;
  arr: number;
  totalRevenue: number;
  outstanding: number;
  activeTenants: number;
  arpt: number;
  byPlan: { planId: string; planName: string; tenants: number; mrr: number }[];
  byMonth: { month: string; revenue: number }[];
}

interface ChurnReport {
  totalChurned: number;
  churnRate: number;
  byMonth: { month: string; count: number }[];
  churned: { tenantId: string; tenantName: string; churnedAt: string; lastPayment: string | null }[];
}

interface Invoice {
  id: string;
  tenantId: string;
  amount: number;
  status: string;
  invoiceRef: string | null;
  createdAt: string;
}

export default function PlatformFinancePage() {
  const locale = useLocale();
  const t = useTranslations("admin");
  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [churn, setChurn] = useState<ChurnReport | null>(null);
  const [recentPayments, setRecentPayments] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/reports/revenue").then((r) => r.json()),
      fetch("/api/admin/reports/churn").then((r) => r.json()),
      fetch("/api/admin/payments").then((r) => r.json()),
    ])
      .then(([rev, ch, payments]) => {
        setRevenue(rev);
        setChurn(ch);
        setRecentPayments(Array.isArray(payments) ? payments.slice(0, 20) : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-500">{t("platform.finance.loading")}</p>;
  if (!revenue || !churn) return <p className="text-red-500">{t("platform.finance.failed")}</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("platform.finance.title")}</h1>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <KPI label={t("platform.finance.mrr")} value={`£${(revenue.mrr / 100).toFixed(0)}`} />
        <KPI label={t("platform.finance.arr")} value={`£${(revenue.arr / 100).toFixed(0)}`} />
        <KPI label={t("platform.finance.activeTenants")} value={String(revenue.activeTenants)} />
        <KPI label={t("platform.finance.arpt")} value={`£${(revenue.arpt / 100).toFixed(0)}`} />
        <KPI label={t("platform.finance.outstanding")} value={`£${(revenue.outstanding / 100).toFixed(0)}`} />
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RevenueChart data={revenue.byMonth} />
        <PlanDistribution data={revenue.byPlan} />
      </div>

      {/* Churn */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChurnChart data={churn.byMonth} />
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">{t("platform.finance.churnSummary")}</h3>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500">{t("platform.finance.totalChurned")}</dt>
              <dd className="text-xl font-semibold">{churn.totalChurned}</dd>
            </div>
            <div>
              <dt className="text-gray-500">{t("platform.finance.churnRate")}</dt>
              <dd className="text-xl font-semibold">{churn.churnRate}%</dd>
            </div>
          </dl>
          {churn.churned.length > 0 && (
            <ul className="mt-4 max-h-40 space-y-1 overflow-y-auto text-xs text-gray-600">
              {churn.churned.map((t) => (
                <li key={t.tenantId}>{t.tenantName} — {formatDate(t.churnedAt, locale)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Outstanding Invoices */}
      <div className="rounded-xl bg-white shadow">
        <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-700">{t("platform.finance.outstandingInvoices")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">{t("platform.finance.ref")}</th>
                <th className="px-4 py-3">{t("platform.finance.amount")}</th>
                <th className="px-4 py-3">{t("platform.finance.date")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recentPayments.filter((p) => p.status === "PENDING").map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{p.invoiceRef ?? formatShortRef(p.id)}</td>
                  <td className="px-4 py-3">£{(p.amount / 100).toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(p.createdAt, locale)}</td>
                </tr>
              ))}
              {recentPayments.filter((p) => p.status === "PENDING").length === 0 && (
                <tr><td colSpan={3} className="px-4 py-3 text-center text-gray-400">{t("platform.finance.noOutstanding")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Payments */}
      <div className="rounded-xl bg-white shadow">
        <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-700">{t("platform.finance.recentPayments")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">{t("platform.finance.ref")}</th>
                <th className="px-4 py-3">{t("platform.finance.amount")}</th>
                <th className="px-4 py-3">{t("platform.finance.status")}</th>
                <th className="px-4 py-3">{t("platform.finance.date")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {recentPayments.slice(0, 20).map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{p.invoiceRef ?? formatShortRef(p.id)}</td>
                  <td className="px-4 py-3">£{(p.amount / 100).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle(p.status)}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(p.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

function statusStyle(status: string) {
  switch (status) {
    case "PAID": return "bg-green-100 text-green-700";
    case "PENDING": return "bg-yellow-100 text-yellow-700";
    case "FAILED": return "bg-red-100 text-red-700";
    default: return "bg-gray-100 text-gray-600";
  }
}
