"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatNumber } from "@/lib/format";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const PERIODS = ["7d", "30d", "90d"] as const;
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const COLOURS = ["#16a34a", "#2563eb", "#9333ea", "#ea580c", "#64748b", "#dc2626"];

interface BookingInsights {
  period: string;
  totalBookings: number;
  confirmedBookings: number;
  cancelledBookings: number;
  cancellationRate: number;
  totalRevenue: number;
  dailyBookings: { day: string; count: number }[];
  revenueByDay: { day: string; total: number }[];
  peakHours: { dow: number; timeSlot: string; count: number }[];
  topBookers: { userId: string; name: string; count: number }[];
  greenUtilisation: { greenName: string; count: number }[];
}

interface MemberInsights {
  period: string;
  totalMembers: number;
  newMembers: number;
  membersByWeek: { week: string; count: number }[];
  roleBreakdown: { role: string; count: number }[];
  activeBookers: number;
  activeMessagers: number;
  dormantMembers: number;
  topActive: { userId: string; name: string; bookings: number; messages: number; total: number }[];
}

interface OperationsInsights {
  period: string;
  tasks: {
    total: number;
    closed: number;
    completionRate: number;
    avgDaysToClose: number;
    byCategory: { category: string; count: number }[];
    byPriority: { priority: string; count: number }[];
  };
  events: {
    total: number;
    published: number;
    upcoming: number;
    byCategory: { category: string; count: number }[];
  };
}

type Tab = "bookings" | "members" | "operations";

export default function InsightsPage() {
  const { data: session } = useSession();
  const t = useTranslations("insights");
  const locale = useLocale();
  const [bookingData, setBookingData] = useState<BookingInsights | null>(null);
  const [memberData, setMemberData] = useState<MemberInsights | null>(null);
  const [opsData, setOpsData] = useState<OperationsInsights | null>(null);
  const [period, setPeriod] = useState<string>("30d");
  const [tab, setTab] = useState<Tab>("bookings");
  const [loading, setLoading] = useState(true);

  const role = (session?.user as any)?.role;
  const acting = (session?.user as any)?.actingAs ?? null;
  const effectiveRole = acting ? acting.role : role;
  const isAdmin = effectiveRole === "TENANT_ADMIN";

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/insights/bookings?period=${period}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/insights/members?period=${period}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/insights/operations?period=${period}`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([b, m, o]) => { setBookingData(b); setMemberData(m); setOpsData(o); })
      .catch(() => { setBookingData(null); setMemberData(null); setOpsData(null); })
      .finally(() => setLoading(false));
  }, [period, isAdmin]);

  if (!isAdmin) {
    return <p className="text-gray-500">{t("noAccess")}</p>;
  }

  return (
    <div className="space-y-8">
      {/* Header + period selector */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">{t("title")}</h1>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-sm rounded-md ${
                period === p
                  ? "bg-green-600 text-white"
                  : "text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t(`period.${p}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Tab selector */}
      <div className="flex gap-1 border-b">
        {(["bookings", "members", "operations"] as const).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === tb
                ? "border-green-600 text-green-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t(`${tb}.title`)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-400">{t("loading")}</p>
      ) : tab === "bookings" ? (
        <BookingsTab data={bookingData} t={t} locale={locale} />
      ) : tab === "members" ? (
        <MembersTab data={memberData} t={t} locale={locale} />
      ) : (
        <OperationsTab data={opsData} t={t} locale={locale} />
      )}
    </div>
  );
}

// ─── Tab panels ──────────────────────────────────────────────

function BookingsTab({ data, t, locale }: { data: BookingInsights | null; t: any; locale: string }) {
  if (!data) return <p className="text-red-500">{t("loadFailed")}</p>;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label={t("bookings.totalBookings")} value={formatNumber(data.totalBookings, locale)} />
        <KPICard label={t("bookings.confirmedBookings")} value={formatNumber(data.confirmedBookings, locale)} />
        <KPICard label={t("bookings.cancellationRate")} value={`${data.cancellationRate}%`} alert={data.cancellationRate > 20} />
        <KPICard label={t("bookings.totalRevenue")} value={`£${(data.totalRevenue / 100).toFixed(2)}`} />
      </div>

      {/* Bookings over time */}
      <section className="rounded-xl bg-white p-6 shadow">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">{t("bookings.bookingsOverTime")}</h2>
        {data.dailyBookings.length === 0 ? (
          <p className="text-gray-400 text-sm">{t("bookings.noBookings")}</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.dailyBookings}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip labelFormatter={(v) => v} formatter={(v) => [v, t("bookings.bookingsTooltip")]} />
              <Line type="monotone" dataKey="count" stroke="#16a34a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* Revenue trend */}
      <section className="rounded-xl bg-white p-6 shadow">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">{t("bookings.revenueTrend")}</h2>
        {data.revenueByDay.length === 0 ? (
          <p className="text-gray-400 text-sm">{t("noData")}</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.revenueByDay.map((d) => ({ day: d.day, revenue: d.total / 100 }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `£${v}`} />
              <Tooltip formatter={(v) => [`£${Number(v).toFixed(2)}`, t("bookings.revenueTooltip")]} />
              <Line type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Green utilisation */}
        <section className="rounded-xl bg-white p-6 shadow">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">{t("occupancy.byGreen")}</h2>
          {data.greenUtilisation.length === 0 ? (
            <p className="text-gray-400 text-sm">{t("noData")}</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.greenUtilisation}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="greenName" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {data.greenUtilisation.map((_, i) => (
                    <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Peak hours heatmap */}
        <section className="rounded-xl bg-white p-6 shadow">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">{t("bookings.peakHours")}</h2>
          <PeakHoursGrid data={data.peakHours} />
        </section>
      </div>

      {/* Top bookers */}
      <section className="rounded-xl bg-white shadow">
        <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-700">{t("bookings.topBookers")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">{t("bookings.name")}</th>
                <th className="px-4 py-3 text-right">{t("bookings.count")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.topBookers.map((b) => (
                <tr key={b.userId} className="hover:bg-gray-50">
                  <td className="px-4 py-3">{b.name}</td>
                  <td className="px-4 py-3 text-right">{b.count}</td>
                </tr>
              ))}
              {data.topBookers.length === 0 && (
                <tr><td colSpan={2} className="px-4 py-4 text-center text-gray-400">{t("bookings.noBookings")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function MembersTab({ data, t, locale }: { data: MemberInsights | null; t: any; locale: string }) {
  if (!data) return <p className="text-red-500">{t("loadFailed")}</p>;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label={t("members.totalMembers")} value={formatNumber(data.totalMembers, locale)} />
        <KPICard label={t("members.newMembers")} value={formatNumber(data.newMembers, locale)} />
        <KPICard label={t("members.dormantMembers")} value={formatNumber(data.dormantMembers, locale)} alert={data.dormantMembers > data.totalMembers * 0.5} />
        <KPICard label={t("members.activeBookersLabel")} value={formatNumber(data.activeBookers, locale)} />
      </div>

      {/* Member growth chart */}
      <section className="rounded-xl bg-white p-6 shadow">
        <h2 className="mb-4 text-sm font-semibold text-gray-700">{t("members.memberGrowth")}</h2>
        {data.membersByWeek.length === 0 ? (
          <p className="text-gray-400 text-sm">{t("noData")}</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.membersByWeek}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#16a34a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Role breakdown */}
        <section className="rounded-xl bg-white p-6 shadow">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">{t("members.roleBreakdown")}</h2>
          {data.roleBreakdown.length === 0 ? (
            <p className="text-gray-400 text-sm">{t("noData")}</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.roleBreakdown} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis dataKey="role" type="category" tick={{ fontSize: 11 }} width={120} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {data.roleBreakdown.map((_, i) => (
                    <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Activity breakdown */}
        <section className="rounded-xl bg-white p-6 shadow">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">{t("members.activityBreakdown")}</h2>
          <div className="space-y-3">
            <ActivityBar label={t("members.activeBookersLabel")} count={data.activeBookers} total={data.totalMembers} color="bg-green-500" />
            <ActivityBar label={t("members.activeMessagersLabel")} count={data.activeMessagers} total={data.totalMembers} color="bg-blue-500" />
            <ActivityBar label={t("members.dormantMembers")} count={data.dormantMembers} total={data.totalMembers} color="bg-gray-400" />
          </div>
        </section>
      </div>

      {/* Top active members */}
      <section className="rounded-xl bg-white shadow">
        <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-700">{t("members.topActive")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">{t("bookings.name")}</th>
                <th className="px-4 py-3 text-right">{t("members.bookingsCol")}</th>
                <th className="px-4 py-3 text-right">{t("members.messagesCol")}</th>
                <th className="px-4 py-3 text-right">{t("members.totalCol")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.topActive.map((m) => (
                <tr key={m.userId} className="hover:bg-gray-50">
                  <td className="px-4 py-3">{m.name}</td>
                  <td className="px-4 py-3 text-right">{m.bookings}</td>
                  <td className="px-4 py-3 text-right">{m.messages}</td>
                  <td className="px-4 py-3 text-right font-medium">{m.total}</td>
                </tr>
              ))}
              {data.topActive.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-4 text-center text-gray-400">{t("noData")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const PRIORITY_COLOURS: Record<string, string> = {
  LOW: "#64748b",
  MEDIUM: "#2563eb",
  HIGH: "#ea580c",
  URGENT: "#dc2626",
};

function OperationsTab({ data, t, locale }: { data: OperationsInsights | null; t: any; locale: string }) {
  if (!data) return <p className="text-red-500">{t("loadFailed")}</p>;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label={t("operations.taskCompletion")} value={`${data.tasks.completionRate}%`} alert={data.tasks.completionRate < 50} />
        <KPICard label={t("operations.avgTimeToClose")} value={`${data.tasks.avgDaysToClose} ${t("operations.days")}`} />
        <KPICard label={t("operations.totalTasks")} value={formatNumber(data.tasks.total, locale)} />
        <KPICard label={t("operations.upcomingEvents")} value={formatNumber(data.events.upcoming, locale)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tasks by category */}
        <section className="rounded-xl bg-white p-6 shadow">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">{t("operations.tasksByCategory")}</h2>
          {data.tasks.byCategory.length === 0 ? (
            <p className="text-gray-400 text-sm">{t("noData")}</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.tasks.byCategory} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis dataKey="category" type="category" tick={{ fontSize: 10 }} width={100} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {data.tasks.byCategory.map((_, i) => (
                    <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Tasks by priority */}
        <section className="rounded-xl bg-white p-6 shadow">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">{t("operations.tasksByPriority")}</h2>
          {data.tasks.byPriority.length === 0 ? (
            <p className="text-gray-400 text-sm">{t("noData")}</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.tasks.byPriority}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="priority" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {data.tasks.byPriority.map((r, i) => (
                    <Cell key={i} fill={PRIORITY_COLOURS[r.priority] ?? COLOURS[i % COLOURS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Events by category */}
        <section className="rounded-xl bg-white p-6 shadow">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">{t("operations.eventsByCategory")}</h2>
          {data.events.byCategory.length === 0 ? (
            <p className="text-gray-400 text-sm">{t("noData")}</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.events.byCategory} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis dataKey="category" type="category" tick={{ fontSize: 10 }} width={100} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {data.events.byCategory.map((_, i) => (
                    <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Events summary */}
        <section className="rounded-xl bg-white p-6 shadow">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">{t("operations.eventsSummary")}</h2>
          <div className="space-y-3">
            <ActivityBar label={t("operations.publishedEvents")} count={data.events.published} total={data.events.total} color="bg-green-500" />
            <ActivityBar label={t("operations.draftEvents")} count={data.events.total - data.events.published} total={data.events.total} color="bg-gray-400" />
          </div>
          <div className="mt-4 text-sm text-gray-600">
            {t("operations.upcomingEvents")}: <span className="font-semibold">{data.events.upcoming}</span>
          </div>
        </section>
      </div>
    </div>
  );
}

// ─── Helper components ───────────────────────────────────────

function KPICard({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white p-4 shadow">
      <p className="text-xs text-gray-500">{label}</p>
      <p
        className={`text-2xl font-semibold ${
          alert ? "text-red-600" : "text-gray-800"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function PeakHoursGrid({
  data,
}: {
  data: { dow: number; timeSlot: string; count: number }[];
}) {
  if (data.length === 0) {
    return <p className="text-gray-400 text-sm">No data</p>;
  }

  // Collect unique time slots and build a matrix
  const slots = [...new Set(data.map((d) => d.timeSlot))].sort();
  const maxCount = Math.max(1, ...data.map((d) => d.count));

  const lookup = new Map<string, number>();
  for (const d of data) {
    lookup.set(`${d.dow}-${d.timeSlot}`, d.count);
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1" />
            {DOW_LABELS.map((d) => (
              <th key={d} className="px-2 py-1 text-gray-500 font-normal">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => (
            <tr key={slot}>
              <td className="px-2 py-1 text-gray-500 whitespace-nowrap">
                {slot}
              </td>
              {DOW_LABELS.map((_, dow) => {
                const count = lookup.get(`${dow}-${slot}`) ?? 0;
                const intensity =
                  count > 0 ? Math.max(0.15, count / maxCount) : 0;
                return (
                  <td key={dow} className="px-1 py-1">
                    <div
                      className="w-8 h-6 rounded"
                      style={{
                        backgroundColor:
                          count > 0
                            ? `rgba(22, 163, 74, ${intensity})`
                            : "#f3f4f6",
                      }}
                      title={`${DOW_LABELS[dow]} ${slot}: ${count}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm text-gray-600 mb-1">
        <span>{label}</span>
        <span>{count} ({pct}%)</span>
      </div>
      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
