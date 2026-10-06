"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/format";
import HelpHint from "@/components/help/HelpHint";

type User = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  suspended: boolean;
  createdAt: string;
  _count: { bookings: number; submittedTasks: number };
};

type UserDetail = User & {
  bookings: { id: string; date: string; status: string }[];
};

type Tenant = { id: string; name: string; slug: string };

export default function UsersPage() {
  const { data: session } = useSession();
  const locale = useLocale();
  const t = useTranslations("admin");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [successMsg, setSuccessMsg] = useState("");

  const isPlatformAdmin = false; // platform admins only reach this page while impersonating; layout enforces this
  void session;

  // Fetch tenant list for platform admins
  useEffect(() => {
    if (!isPlatformAdmin) return;
    fetch("/api/admin/tenants")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (Array.isArray(data)) setTenants(data); })
      .catch(() => {});
  }, [isPlatformAdmin]);

  function loadUsers(tenantId?: string) {
    const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
    fetch(`/api/admin/users${qs}`)
      .then((r) => r.json())
      .then((d) => setUsers(Array.isArray(d) ? d : []))
      .catch(() => {});
  }

  useEffect(() => {
    if (isPlatformAdmin && !selectedTenant) { setUsers([]); return; }
    loadUsers(selectedTenant || undefined);
  }, [selectedTenant, isPlatformAdmin]);

  async function toggleSuspend(user: User) {
    setSuccessMsg("");
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suspended: !user.suspended }),
    });
    if (res.ok) {
      setSuccessMsg(`${user.name || user.email} ${user.suspended ? "activated" : "suspended"} successfully.`);
      loadUsers(selectedTenant || undefined);
      if (detail?.id === user.id) loadDetail(user.id);
    }
  }

  function loadDetail(id: string) {
    fetch(`/api/admin/users/${id}`)
      .then((r) => r.json())
      .then((d) => setDetail(d))
      .catch(() => {});
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">{t("users.title")} <HelpHint slug="invite-members" /></h1>

      {successMsg && (
        <p className="text-green-600 text-sm rounded bg-green-50 border border-green-200 px-4 py-2">{successMsg}</p>
      )}

      {isPlatformAdmin && (
        <div>
          <label className="text-sm font-medium text-gray-700 mr-2">{t("users.tenantLabel")}</label>
          <select
            value={selectedTenant}
            onChange={(e) => { setSelectedTenant(e.target.value); setDetail(null); }}
            className="rounded border p-2 text-sm"
          >
            <option value="">{t("users.selectClub")}</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name} (/{t.slug})</option>
            ))}
          </select>
        </div>
      )}

      {isPlatformAdmin && !selectedTenant ? (
        <p className="text-gray-400">{t("users.selectTenantPrompt")}</p>
      ) : (
        <div className="flex gap-6">
          {/* User list */}
          <div className="flex-1 space-y-2">
            <p className="text-sm text-gray-500">{t("users.userCount", { count: users.length })}</p>
            {users.map((u) => (
              <div
                key={u.id}
                onClick={() => loadDetail(u.id)}
                className={`rounded-xl border bg-white p-4 flex justify-between items-center cursor-pointer hover:border-green-400 transition ${detail?.id === u.id ? "border-green-500 ring-1 ring-green-300" : ""}`}
              >
                <div>
                  <p className="font-medium">
                    {u.name || <span className="text-gray-400 italic">{t("users.noName")}</span>}
                    {u.suspended && <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">{t("users.suspended")}</span>}
                  </p>
                  <p className="text-sm text-gray-500">{u.email}</p>
                  <p className="text-xs text-gray-400">{u.role} · {u._count.bookings} bookings · {u._count.submittedTasks} tasks</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleSuspend(u); }}
                  className={`text-xs px-3 py-1 rounded ${u.suspended ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-red-100 text-red-700 hover:bg-red-200"}`}
                >
                  {u.suspended ? t("users.activate") : t("users.suspend")}
                </button>
              </div>
            ))}
            {users.length === 0 && <p className="text-gray-400">{t("users.noUsers")}</p>}
          </div>

          {/* Detail panel */}
          {detail && (
            <div className="w-80 shrink-0 rounded-xl border bg-white p-6 shadow space-y-4 self-start sticky top-6">
              <h2 className="font-semibold text-lg">{detail.name || t("users.detail.unnamed")}</h2>
              <dl className="text-sm space-y-2">
                <dt className="text-gray-500">{t("users.detail.email")}</dt>
                <dd>{detail.email}</dd>
                <dt className="text-gray-500">{t("users.detail.role")}</dt>
                <dd>{detail.role}</dd>
                <dt className="text-gray-500">{t("users.detail.status")}</dt>
                <dd>{detail.suspended ? <span className="text-red-600 font-medium">{t("users.detail.suspended")}</span> : <span className="text-green-600 font-medium">{t("users.detail.active")}</span>}</dd>
                <dt className="text-gray-500">{t("users.detail.joined")}</dt>
                <dd>{formatDate(detail.createdAt, locale)}</dd>
                <dt className="text-gray-500">{t("users.detail.bookings")}</dt>
                <dd>{detail._count.bookings}</dd>
                <dt className="text-gray-500">{t("users.detail.tasksSubmitted")}</dt>
                <dd>{detail._count.submittedTasks}</dd>
              </dl>

              {detail.bookings.length > 0 && (
                <div>
                  <h3 className="font-medium text-sm text-gray-700 mb-1">{t("users.detail.recentBookings")}</h3>
                  <ul className="space-y-1">
                    {detail.bookings.map((b) => (
                      <li key={b.id} className="text-xs flex justify-between">
                        <span>{b.date}</span>
                        <span className={`px-1.5 rounded ${
                          b.status === "CONFIRMED" ? "bg-green-100 text-green-700" :
                          b.status === "CANCELLED" ? "bg-red-100 text-red-700" :
                          "bg-yellow-100 text-yellow-700"
                        }`}>{b.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <button
                onClick={() => toggleSuspend(detail)}
                className={`w-full text-sm py-2 rounded ${detail.suspended ? "bg-green-600 text-white hover:bg-green-700" : "bg-red-600 text-white hover:bg-red-700"}`}
              >
                {detail.suspended ? t("users.detail.activateUser") : t("users.detail.suspendUser")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
