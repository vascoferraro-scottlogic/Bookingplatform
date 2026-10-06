"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, PieChart, Pie,
} from "recharts";

const COLOURS = ["#16a34a", "#2563eb", "#9333ea", "#ea580c", "#64748b", "#dc2626", "#0891b2", "#d97706"];

type Tab =
  | "adoption"
  | "revenue"
  | "churn"
  | "operations"
  | "agents"
  | "federation"
  | "onboarding"
  | "language"
  | "features";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InsightsData = Record<string, any>;

export default function PlatformInsightsPage() {
  const t = useTranslations("admin");
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("adoption");

  useEffect(() => {
    fetch("/api/admin/reports/insights")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-500">{t("insights.loading")}</p>;
  if (!data) return <p className="text-red-500">{t("insights.failed")}</p>;

  const tabs: { key: Tab; label: string }[] = [
    { key: "adoption", label: t("insights.tabs.adoption") },
    { key: "revenue", label: t("insights.tabs.revenue") },
    { key: "churn", label: t("insights.tabs.churn") },
    { key: "operations", label: t("insights.tabs.operations") },
    { key: "agents", label: t("insights.tabs.agents") },
    { key: "federation", label: t("insights.tabs.federation") },
    { key: "onboarding", label: t("insights.tabs.onboarding") },
    { key: "language", label: t("insights.tabs.language") },
    { key: "features", label: t("insights.tabs.features") },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("insights.title")}</h1>
      <p className="text-sm text-gray-500">
        {t("insights.generatedAt", { time: new Date(data.generatedAt).toLocaleString() })}
      </p>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b pb-1">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-t px-3 py-1.5 text-sm font-medium transition ${
              tab === key
                ? "bg-slate-700 text-white"
                : "text-gray-600 hover:bg-slate-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "adoption" && <AdoptionTab data={data.adoption} t={t} />}
      {tab === "revenue" && <RevenueTab data={data.revenue} t={t} />}
      {tab === "churn" && <ChurnTab data={data.churn} t={t} />}
      {tab === "operations" && <OperationsTab data={data.operations} t={t} />}
      {tab === "agents" && <AgentsTab data={data.agents} t={t} />}
      {tab === "federation" && <FederationTab data={data.federationAndFunding} t={t} />}
      {tab === "onboarding" && <OnboardingTab data={data.onboardingPipeline} t={t} />}
      {tab === "language" && <LanguageTab data={data.language} t={t} />}
      {tab === "features" && <FeaturesTab data={data.featureUsage} t={t} />}
    </div>
  );
}

/* ─── Shared KPI card ───────────────────────────────────────── */

function KPI({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

/* ─── Tab components ────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AdoptionTab({ data, t }: { data: any; t: any }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPI label={t("insights.adoption.totalTenants")} value={data.totalTenants} />
        <KPI label={t("insights.adoption.active")} value={data.activeTenants} />
        <KPI label={t("insights.adoption.onboarding")} value={data.onboardingTenants} />
        <KPI label={t("insights.adoption.totalUsers")} value={data.totalUsers} />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPI label={t("insights.adoption.newUsers30d")} value={data.newUsers30d} />
        <KPI label={t("insights.adoption.goneLive30d")} value={data.tenantsGoneLive30d} />
        <KPI label={t("insights.adoption.onboardingCompleted")} value={data.onboardingCompleted} />
        <KPI label={t("insights.adoption.avgChapter")} value={data.avgOnboardingChapter} />
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function RevenueTab({ data, t }: { data: any; t: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPI label={t("insights.revenue.mrr")} value={`£${(data.mrr / 100).toFixed(0)}`} />
        <KPI label={t("insights.revenue.arr")} value={`£${(data.arr / 100).toFixed(0)}`} />
        <KPI label={t("insights.revenue.totalRevenue")} value={`£${(data.totalRevenue / 100).toFixed(0)}`} />
        <KPI label={t("insights.revenue.arpt")} value={`£${(data.arpt / 100).toFixed(0)}`} />
      </div>

      {/* Revenue by month */}
      {data.byMonth?.length > 0 && (
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("insights.revenue.monthlyChart")}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.byMonth}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `£${v / 100}`} />
              <Tooltip formatter={(v) => `£${(Number(v) / 100).toFixed(0)}`} />
              <Line type="monotone" dataKey="revenue" stroke="#16a34a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Revenue by country */}
      {data.byCountry?.length > 0 && (
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("insights.revenue.byCountry")}</h3>
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-gray-500">
              <tr>
                <th className="pb-2">{t("insights.revenue.country")}</th>
                <th className="pb-2">{t("insights.revenue.tenants")}</th>
                <th className="pb-2">{t("insights.revenue.mrrLabel")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.byCountry.map((r: { country: string; tenants: number; mrrPence: number }) => (
                <tr key={r.country}>
                  <td className="py-2">{r.country}</td>
                  <td className="py-2">{r.tenants}</td>
                  <td className="py-2">£{(r.mrrPence / 100).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Revenue by plan */}
      {data.byPlan?.length > 0 && (
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("insights.revenue.byPlan")}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.byPlan.map((p: { planName: string; mrr: number }) => ({ name: p.planName, mrr: p.mrr / 100 }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `£${v}`} />
              <Tooltip formatter={(v) => `£${Number(v).toFixed(0)}`} />
              <Bar dataKey="mrr" radius={[4, 4, 0, 0]}>
                {data.byPlan.map((_: unknown, i: number) => (
                  <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChurnTab({ data, t }: { data: any; t: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KPI label={t("insights.churn.totalChurned")} value={data.totalChurned} />
        <KPI label={t("insights.churn.churnRate")} value={`${data.churnRate}%`} />
      </div>
      {data.byMonth?.length > 0 && (
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("insights.churn.monthlyChart")}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.byMonth}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function OperationsTab({ data, t }: { data: any; t: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPI label={t("insights.operations.bookings")} value={data.bookings30d} />
        <KPI label={t("insights.operations.confirmRate")} value={`${data.confirmRate}%`} />
        <KPI label={t("insights.operations.cancelRate")} value={`${data.cancelRate}%`} />
        <KPI label={t("insights.operations.tasks")} value={data.tasks30d} />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPI label={t("insights.operations.taskCompletion")} value={`${data.taskCompletionRate}%`} />
        <KPI label={t("insights.operations.events")} value={data.events30d} />
        <KPI label={t("insights.operations.eventsPublished")} value={data.eventsPublished30d} />
      </div>

      {/* Tenant leaderboard */}
      {data.tenantLeaderboard?.length > 0 && (
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("insights.operations.leaderboard")}</h3>
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-gray-500">
              <tr>
                <th className="pb-2">{t("insights.operations.tenant")}</th>
                <th className="pb-2">{t("insights.operations.bookingsCol")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.tenantLeaderboard.map((r: { tenantId: string; tenantName: string; bookings: number }) => (
                <tr key={r.tenantId}>
                  <td className="py-2">{r.tenantName}</td>
                  <td className="py-2">{r.bookings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AgentsTab({ data, t }: { data: any; t: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPI label={t("insights.agents.runs")} value={data.runs30d} />
        <KPI label={t("insights.agents.successRate")} value={`${data.successRate}%`} />
        <KPI label={t("insights.agents.proposals")} value={data.proposals30d} />
        <KPI label={t("insights.agents.approvalRate")} value={`${data.approvalRate}%`} />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KPI label={t("insights.agents.spend")} value={`£${((data.spend30d ?? 0) / 100).toFixed(2)}`} />
        <KPI label={t("insights.agents.tokensIn")} value={formatTokens(data.tokensIn30d ?? 0)} />
        <KPI label={t("insights.agents.tokensOut")} value={formatTokens(data.tokensOut30d ?? 0)} />
      </div>

      {/* Detector chat→task conversion */}
      {data.detector && (
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("insights.agents.detectorTitle")}</h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KPI label={t("insights.agents.detectorRuns")} value={data.detector.runs30d} />
            <KPI label={t("insights.agents.detectorProposals")} value={data.detector.taskProposals30d} />
            <KPI label={t("insights.agents.detectorApproved")} value={data.detector.tasksApproved30d} />
            <KPI label={t("insights.agents.detectorApprovalRate")} value={`${data.detector.approvalRate}%`} />
          </div>
        </div>
      )}

      {/* Per-agent breakdown */}
      {data.byAgent?.length > 0 && (
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("insights.agents.byAgent")}</h3>
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-gray-500">
              <tr>
                <th className="pb-2">{t("insights.agents.agentName")}</th>
                <th className="pb-2">{t("insights.agents.runsCol")}</th>
                <th className="pb-2">{t("insights.agents.spendCol")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.byAgent.map((a: { agentId: string; agentName: string; runs: number; spend: number }) => (
                <tr key={a.agentId}>
                  <td className="py-2">{a.agentName}</td>
                  <td className="py-2">{a.runs}</td>
                  <td className="py-2">£{(a.spend / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FederationTab({ data, t }: { data: any; t: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPI label={t("insights.federation.total")} value={data.totalFederations} />
        <KPI label={t("insights.federation.active")} value={data.activeFederations} />
        <KPI label={t("insights.federation.fundingApps")} value={data.totalFundingApplications} />
      </div>
      {data.fundingByStatus?.length > 0 && (
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("insights.federation.fundingByStatus")}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={data.fundingByStatus.map((f: { status: string; count: number }) => ({ name: f.status, value: f.count }))}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={(props) => `${props.name ?? ""}: ${props.value}`}
              >
                {data.fundingByStatus.map((_: unknown, i: number) => (
                  <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function OnboardingTab({ data, t }: { data: any; t: any }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KPI label={t("insights.onboarding.totalApplications")} value={data.totalApplications} />
        <KPI label={t("insights.onboarding.avgReviewDays")} value={data.avgReviewDays ?? "—"} />
        <KPI label={t("insights.onboarding.totalActivated")} value={data.totalActivated} />
        <KPI label={t("insights.onboarding.avgActivationDays")} value={data.avgActivationDays ?? "—"} />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KPI
          label={t("insights.onboarding.medianActivationDays")}
          value={data.medianActivationDays ?? "—"}
        />
      </div>

      {/* Application status breakdown */}
      {data.applicationsByStatus && Object.keys(data.applicationsByStatus).length > 0 && (
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("insights.onboarding.appsByStatus")}</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={Object.entries(data.applicationsByStatus).map(([status, count]) => ({ status, count }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="status" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Activation time by country */}
      {data.activationByCountry?.length > 0 && (
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("insights.onboarding.activationByCountry")}</h3>
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-gray-500">
              <tr>
                <th className="pb-2">{t("insights.onboarding.country")}</th>
                <th className="pb-2">{t("insights.onboarding.activated")}</th>
                <th className="pb-2">{t("insights.onboarding.avgDays")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.activationByCountry.map((r: { country: string; count: number; avgDays: number }) => (
                <tr key={r.country}>
                  <td className="py-2">{r.country}</td>
                  <td className="py-2">{r.count}</td>
                  <td className="py-2">{r.avgDays}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function LanguageTab({ data, t }: { data: any; t: any }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Tenants by locale */}
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("insights.language.byLocale")}</h3>
          {data.tenantsByLocale?.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={data.tenantsByLocale.map((l: { locale: string; count: number }) => ({ name: l.locale, value: l.count }))}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={(props) => `${props.name ?? ""}: ${props.value}`}
                >
                  {data.tenantsByLocale.map((_: unknown, i: number) => (
                    <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400">{t("insights.language.noData")}</p>
          )}
        </div>

        {/* Tenants by country */}
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("insights.language.byCountry")}</h3>
          {data.tenantsByCountry?.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={data.tenantsByCountry.map((c: { country: string; count: number }) => ({ name: c.country, value: c.count }))}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={(props) => `${props.name ?? ""}: ${props.value}`}
                >
                  {data.tenantsByCountry.map((_: unknown, i: number) => (
                    <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-gray-400">{t("insights.language.noData")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FeaturesTab({ data, t }: { data: any; t: any }) {
  return (
    <div className="space-y-6">
      {/* Top features globally */}
      {data.topFeatures30d?.length > 0 && (
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("insights.features.topFeatures")}</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.topFeatures30d.slice(0, 15)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="action" type="category" tick={{ fontSize: 10 }} width={140} />
              <Tooltip />
              <Bar dataKey="count" fill="#16a34a" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Feature usage by country */}
      {data.byCountry?.length > 0 && (
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("platform.insights.features.byCountry")}</h3>
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-gray-500">
              <tr>
                <th className="pb-2">{t("insights.features.country")}</th>
                <th className="pb-2">{t("insights.features.feature")}</th>
                <th className="pb-2">{t("insights.features.count")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.byCountry.map((r: { country: string; action: string; count: number }, i: number) => (
                <tr key={i}>
                  <td className="py-2">{r.country}</td>
                  <td className="py-2 font-mono text-xs">{r.action}</td>
                  <td className="py-2">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Feature usage by tenant */}
      {data.byTenant?.length > 0 && (
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="mb-4 text-sm font-semibold text-gray-700">{t("insights.features.byTenant")}</h3>
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase text-gray-500">
              <tr>
                <th className="pb-2">{t("insights.features.tenant")}</th>
                <th className="pb-2">{t("insights.features.locale")}</th>
                <th className="pb-2">{t("insights.features.countryCol")}</th>
                <th className="pb-2">{t("insights.features.uses")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.byTenant.map((r: { tenantId: string; tenantName: string; locale: string; country: string; featureUses: number }) => (
                <tr key={r.tenantId}>
                  <td className="py-2">{r.tenantName}</td>
                  <td className="py-2">{r.locale}</td>
                  <td className="py-2">{r.country}</td>
                  <td className="py-2">{r.featureUses}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
