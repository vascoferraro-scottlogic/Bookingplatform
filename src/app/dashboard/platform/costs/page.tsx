"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";

const COLOURS = ["#16a34a", "#2563eb", "#9333ea", "#ea580c", "#64748b", "#dc2626"];

interface CostReport {
  totalSpend: number;
  thisMonth: number;
  totalTokensIn: number;
  totalTokensOut: number;
  perTenant: {
    tenantId: string;
    tenantName: string;
    spend: number;
    tokensIn: number;
    tokensOut: number;
    runs: number;
    budgetCap: number;
    currentMonthSpend: number;
  }[];
  byModel: { model: string; spend: number; runs: number }[];
  byMonth: { month: string; spend: number }[];
}

export default function PlatformCostsPage() {
  const t = useTranslations("admin");
  const [data, setData] = useState<CostReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/reports/costs")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-500">{t("platform.costs.loading")}</p>;
  if (!data) return <p className="text-red-500">{t("platform.costs.failed")}</p>;

  const byMonthFormatted = data.byMonth.map((d) => ({ month: d.month, spend: d.spend / 100 }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("platform.costs.title")}</h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPI label={t("platform.costs.totalSpend")} value={`£${(data.totalSpend / 100).toFixed(2)}`} />
        <KPI label={t("platform.costs.thisMonth")} value={`£${(data.thisMonth / 100).toFixed(2)}`} />
        <KPI label={t("platform.costs.tokensIn")} value={formatTokens(data.totalTokensIn)} />
        <KPI label={t("platform.costs.tokensOut")} value={formatTokens(data.totalTokensOut)} />
      </div>

      {/* Spend Trend */}
      <div className="rounded-xl bg-white p-6 shadow">
        <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("platform.costs.monthlySpendChart")}</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={byMonthFormatted}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `£${v}`} />
            <Tooltip formatter={(v) => `£${Number(v).toFixed(2)}`} />
            <Line type="monotone" dataKey="spend" stroke="#9333ea" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Model Breakdown */}
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("platform.costs.spendByModel")}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.byModel.map((m) => ({ name: m.model, spend: m.spend / 100 }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `£${v}`} />
              <Tooltip formatter={(v) => `£${Number(v).toFixed(2)}`} />
              <Bar dataKey="spend" radius={[4, 4, 0, 0]}>
                {data.byModel.map((_, i) => (
                  <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Model table fallback */}
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("platform.costs.modelDetails")}</h3>
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-gray-500">
              <tr>
                <th className="pb-2">{t("platform.costs.model")}</th>
                <th className="pb-2">{t("platform.costs.runs")}</th>
                <th className="pb-2">{t("platform.costs.spend")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.byModel.map((m) => (
                <tr key={m.model}>
                  <td className="py-2 font-mono text-xs">{m.model}</td>
                  <td className="py-2">{m.runs}</td>
                  <td className="py-2">£{(m.spend / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-Tenant Table */}
      <div className="rounded-xl bg-white shadow">
        <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-700">{t("platform.costs.perTenantCost")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">{t("platform.costs.runs")}</th>
                <th className="px-4 py-3">{t("platform.costs.totalSpend")}</th>
                <th className="px-4 py-3">{t("platform.costs.budgetCap")}</th>
                <th className="px-4 py-3">{t("platform.costs.monthSpend")}</th>
                <th className="px-4 py-3">{t("platform.costs.tokensInOut")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.perTenant.map((t) => (
                <tr key={t.tenantId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{t.tenantName}</td>
                  <td className="px-4 py-3">{t.runs}</td>
                  <td className="px-4 py-3">£{(t.spend / 100).toFixed(2)}</td>
                  <td className="px-4 py-3">{t.budgetCap > 0 ? `£${(t.budgetCap / 100).toFixed(2)}` : "∞"}</td>
                  <td className="px-4 py-3">
                    <span className={t.budgetCap > 0 && t.currentMonthSpend >= t.budgetCap ? "text-red-600 font-semibold" : ""}>
                      £{(t.currentMonthSpend / 100).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatTokens(t.tokensIn)} / {formatTokens(t.tokensOut)}</td>
                </tr>
              ))}
              {data.perTenant.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-3 text-center text-gray-400">{t("platform.costs.noRuns")}</td></tr>
              )}
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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
