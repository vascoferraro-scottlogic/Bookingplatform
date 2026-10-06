"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";

interface Stats {
  period: string;
  totalEvents: number;
  uniqueVisitors: number;
  dailyCounts: { day: string; count: number }[];
  browsers: { name: string; count: number }[];
  devices: { name: string; count: number }[];
  pwa: { isPWA: boolean; count: number }[];
  topPages: { path: string; count: number }[];
  featureUsage: { action: string; count: number }[];
  topInteractions: { action: string; count: number }[];
}

const PERIODS = ["7d", "30d", "90d"] as const;

export default function AnalyticsPage() {
  const { data: session } = useSession();
  const t = useTranslations("admin");
  const [stats, setStats] = useState<Stats | null>(null);
  const [period, setPeriod] = useState<string>("7d");
  const [loading, setLoading] = useState(true);

  const role = (session?.user as any)?.role;
  const acting = (session?.user as any)?.actingAs ?? null;
  const effectiveRole = acting ? acting.role : role;
  const isAdmin = effectiveRole === "TENANT_ADMIN";

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    fetch(`/api/tracking/stats?period=${period}`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [period, isAdmin]);

  if (!isAdmin) {
    return <p className="text-gray-500">{t("analytics.noAccess")}</p>;
  }

  const pwaCount = stats?.pwa.find((p) => p.isPWA)?.count ?? 0;
  const browserCount = stats?.pwa.find((p) => !p.isPWA)?.count ?? 0;
  const maxDaily = Math.max(1, ...(stats?.dailyCounts.map((d) => d.count) ?? [1]));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">{t("analytics.title")}</h1>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-sm rounded-md ${period === p ? "bg-green-600 text-white" : "text-gray-600 hover:bg-gray-200"}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-gray-400">{t("analytics.loading")}</p>
      ) : !stats ? (
        <p className="text-red-500">{t("analytics.loadFailed")}</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label={t("analytics.totalEvents")} value={stats.totalEvents} />
            <StatCard label={t("analytics.uniqueVisitors")} value={stats.uniqueVisitors} />
            <StatCard label={t("analytics.pwaUsers")} value={pwaCount} />
            <StatCard label={t("analytics.browserUsers")} value={browserCount} />
          </div>

          {/* Daily traffic chart (CSS bars) */}
          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{t("analytics.dailyTraffic")}</h2>
            <div className="flex items-end gap-1 h-40 bg-gray-50 rounded-lg p-2 overflow-x-auto">
              {stats.dailyCounts.map((d) => (
                <div key={d.day} className="flex flex-col items-center flex-1 min-w-[24px]" title={`${d.day}: ${d.count}`}>
                  <div
                    className="w-full bg-green-500 rounded-t"
                    style={{ height: `${(d.count / maxDaily) * 100}%`, minHeight: d.count > 0 ? 4 : 0 }}
                  />
                  <span className="text-[10px] text-gray-400 mt-1 truncate w-full text-center">
                    {d.day.slice(5)}
                  </span>
                </div>
              ))}
              {stats.dailyCounts.length === 0 && <p className="text-gray-400 m-auto">{t("analytics.noData")}</p>}
            </div>
          </section>

          {/* Browser and Device breakdown side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <BreakdownTable title={t("analytics.browserBreakdown")} items={stats.browsers} />
            <BreakdownTable title={t("analytics.deviceBreakdown")} items={stats.devices} />
          </div>

          {/* PWA vs Browser */}
          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{t("analytics.pwaVsBrowser")}</h2>
            <div className="flex gap-4">
              <BarSegment label="PWA" count={pwaCount} total={pwaCount + browserCount} color="bg-green-500" />
              <BarSegment label="Browser" count={browserCount} total={pwaCount + browserCount} color="bg-blue-500" />
            </div>
          </section>

          {/* Top Pages */}
          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{t("analytics.topPages")}</h2>
            <div className="bg-white rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="px-4 py-2">{t("analytics.path")}</th>
                    <th className="px-4 py-2 text-right">{t("analytics.views")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topPages.map((p, i) => (
                    <tr key={p.path} className={i % 2 === 0 ? "bg-gray-50" : ""}>
                      <td className="px-4 py-2 font-mono text-gray-700">{p.path}</td>
                      <td className="px-4 py-2 text-right text-gray-600">{p.count}</td>
                    </tr>
                  ))}
                  {stats.topPages.length === 0 && (
                    <tr><td colSpan={2} className="px-4 py-4 text-gray-400 text-center">{t("analytics.noPageViews")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Feature Usage */}
          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{t("analytics.featureUsage")}</h2>
            <div className="bg-white rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="px-4 py-2">{t("analytics.feature")}</th>
                    <th className="px-4 py-2 text-right">{t("analytics.count")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.featureUsage.map((f, i) => (
                    <tr key={f.action} className={i % 2 === 0 ? "bg-gray-50" : ""}>
                      <td className="px-4 py-2 text-gray-700">{formatAction(f.action)}</td>
                      <td className="px-4 py-2 text-right text-gray-600">{f.count}</td>
                    </tr>
                  ))}
                  {stats.featureUsage.length === 0 && (
                    <tr><td colSpan={2} className="px-4 py-4 text-gray-400 text-center">{t("analytics.noFeatureUsage")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Top Interactions */}
          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">{t("analytics.topInteractions")}</h2>
            <div className="bg-white rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="px-4 py-2">{t("analytics.action")}</th>
                    <th className="px-4 py-2 text-right">{t("analytics.count")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topInteractions.map((a, i) => (
                    <tr key={a.action} className={i % 2 === 0 ? "bg-gray-50" : ""}>
                      <td className="px-4 py-2 text-gray-700">{formatAction(a.action)}</td>
                      <td className="px-4 py-2 text-right text-gray-600">{a.count}</td>
                    </tr>
                  ))}
                  {stats.topInteractions.length === 0 && (
                    <tr><td colSpan={2} className="px-4 py-4 text-gray-400 text-center">{t("analytics.noInteractions")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// ─── Helper components ───────────────────────────────────────

function StatCard({ label, value }: { label: string; value: number }) {
  const locale = useLocale();
  return (
    <div className="bg-white rounded-lg border p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-800">{formatNumber(value, locale)}</p>
    </div>
  );
}

function BreakdownTable({ title, items }: { title: string; items: { name: string; count: number }[] }) {
  const t = useTranslations("admin");
  const total = items.reduce((s, i) => s + i.count, 0) || 1;
  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-700 mb-3">{title}</h2>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.name}>
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>{item.name}</span>
              <span>{item.count} ({Math.round((item.count / total) * 100)}%)</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full" style={{ width: `${(item.count / total) * 100}%` }} />
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="text-gray-400 text-sm">{t("analytics.noData")}</p>}
      </div>
    </section>
  );
}

function BarSegment({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex-1">
      <div className="flex justify-between text-sm text-gray-600 mb-1">
        <span>{label}</span>
        <span>{count} ({pct}%)</span>
      </div>
      <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function formatAction(action: string | null): string {
  if (!action) return "—";
  return action.replace(/\./g, " › ").replace(/_/g, " ");
}
