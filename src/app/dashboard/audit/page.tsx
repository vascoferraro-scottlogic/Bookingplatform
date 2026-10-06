"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/format";

interface AuditEvent {
  id: string;
  timestamp: string;
  action: string;
  entity: string;
  entityId?: string;
  actorRole: string;
  piiAccess: boolean;
  meta?: string;
  actor: { id: string; name?: string; email: string; role: string };
  tenant?: { id: string; name: string } | null;
  actingAsRole?: string | null;
  actingAsTenantId?: string | null;
  actingAsTenant?: { id: string; name: string; slug: string } | null;
  impersonationId?: string | null;
}

const ACTION_DOMAINS = ["all", "auth", "booking", "waitlist", "task", "payment", "admin", "pii"];

function formatAction(action: string): string {
  return action.replace(/\./g, " › ").replace(/_/g, " ");
}

function formatTimestamp(ts: string, locale: string): string {
  return formatDateTime(ts, locale);
}

export default function AuditPage() {
  const { data: session } = useSession();
  const locale = useLocale();
  const t = useTranslations("admin");
  const role = (session?.user as any)?.role;
  const acting = (session?.user as any)?.actingAs ?? null;
  const effectiveRole = acting ? acting.role : role;
  const isAdmin = effectiveRole === "TENANT_ADMIN";
  // Layout redirects non-impersonating platform admins away, so this page
  // never sees the cross-tenant platform-admin variant — collapse the picker.
  const isPlatformAdmin = false;

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(false);

  // Filters
  const [actionFilter, setActionFilter] = useState("all");
  const [piiOnly, setPiiOnly] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedTenant, setSelectedTenant] = useState("");
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);

  // Load tenants for platform admin
  useEffect(() => {
    if (!isPlatformAdmin) return;
    fetch("/api/admin/tenants")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (Array.isArray(data)) setTenants(data); })
      .catch(() => {});
  }, [isPlatformAdmin]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (actionFilter !== "all") params.set("action", actionFilter);
    if (piiOnly) params.set("piiAccess", "true");
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (isPlatformAdmin && selectedTenant) params.set("tenantId", selectedTenant);

    fetch(`/api/audit?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setEvents(Array.isArray(data.events) ? data.events : []);
        setTotal(data.total ?? 0);
      })
      .catch(() => { setEvents([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [page, limit, actionFilter, piiOnly, fromDate, toDate, selectedTenant, isPlatformAdmin]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">{isAdmin ? t("audit.title") : t("audit.myActivity")}</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        {isPlatformAdmin && (
          <label className="flex flex-col text-sm">
            {t("audit.tenantFilter")}
            <select
              className="border rounded px-2 py-1 mt-1"
              value={selectedTenant}
              onChange={(e) => { setSelectedTenant(e.target.value); setPage(1); }}
            >
              <option value="">{t("audit.allTenants")}</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col text-sm">
          {t("audit.domainFilter")}
          <select
            className="border rounded px-2 py-1 mt-1"
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          >
            {ACTION_DOMAINS.map((d) => (
              <option key={d} value={d}>{d === "all" ? "All" : d.charAt(0).toUpperCase() + d.slice(1)}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-sm">
          {t("audit.fromFilter")}
          <input type="date" className="border rounded px-2 py-1 mt-1" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPage(1); }} />
        </label>

        <label className="flex flex-col text-sm">
          {t("audit.toFilter")}
          <input type="date" className="border rounded px-2 py-1 mt-1" value={toDate} onChange={(e) => { setToDate(e.target.value); setPage(1); }} />
        </label>

        <label className="flex items-center gap-1 text-sm mt-auto py-1">
          <input type="checkbox" checked={piiOnly} onChange={(e) => { setPiiOnly(e.target.checked); setPage(1); }} />
          {t("audit.piiOnly")}
        </label>
      </div>

      {/* Results */}
      {loading ? (
        <p className="text-gray-500">{t("audit.loading")}</p>
      ) : events.length === 0 ? (
        <p className="text-gray-500">{t("audit.noEvents")}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="p-2 border-b">{t("audit.time")}</th>
                  {isAdmin && <th className="p-2 border-b">{t("audit.actor")}</th>}
                  {isPlatformAdmin && <th className="p-2 border-b">{t("audit.tenant")}</th>}
                  <th className="p-2 border-b">{t("audit.action")}</th>
                  <th className="p-2 border-b">{t("audit.entity")}</th>
                  <th className="p-2 border-b">{t("audit.id")}</th>
                  <th className="p-2 border-b">{t("audit.pii")}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className={`border-b hover:bg-gray-50 ${ev.piiAccess ? "bg-yellow-50" : ""}`}>
                    <td className="p-2 whitespace-nowrap">{formatTimestamp(ev.timestamp, locale)}</td>
                    {isAdmin && (
                      <td className="p-2">
                        <span>{ev.actor.name ?? ev.actor.email}</span>
                        <span className="ml-1 text-xs text-gray-400">({ev.actorRole})</span>
                        {ev.actingAsRole && ev.actingAsTenant && (
                          <span className="ml-1 text-xs text-amber-700">
                            {t("audit.actingAs", { role: ev.actingAsRole, tenant: ev.actingAsTenant.name })}
                          </span>
                        )}
                      </td>
                    )}
                    {isPlatformAdmin && <td className="p-2">{ev.tenant?.name ?? "—"}</td>}
                    <td className="p-2">{formatAction(ev.action)}</td>
                    <td className="p-2">{ev.entity}</td>
                    <td className="p-2 font-mono text-xs">{ev.entityId ?? "—"}</td>
                    <td className="p-2 text-center">{ev.piiAccess ? "🔒" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-gray-500">{t("audit.eventCount", { count: total })}</span>
            <div className="flex gap-2">
              <button
                className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t("audit.prev")}
              </button>
              <span className="text-sm py-1">{t("audit.pageOf", { page, total: totalPages })}</span>
              <button
                className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("audit.next")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
