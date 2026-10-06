"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

type TenantStatus = "ONBOARDING" | "ACTIVE" | "SUSPENDED";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  status: TenantStatus;
  brandColor: string;
  locale: string;
  locality?: string | null;
  _count: { users: number; greens: number };
};

export default function PlatformAdminPage() {
  const t = useTranslations("admin");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [form, setForm] = useState({
    name: "", slug: "", adminEmail: "", adminPassword: "", brandColor: "#16a34a", locale: "en",
    latitude: "", longitude: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function load() {
    fetch("/api/admin/tenants").then((r) => r.json()).then((d) => setTenants(Array.isArray(d) ? d : [])).catch(() => {});
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!form.name.trim()) { setError(t("platform.tenants.clubNameRequired")); return; }
    if (!form.slug.trim()) { setError(t("platform.tenants.slugRequired")); return; }
    if (!form.adminEmail.trim()) { setError(t("platform.tenants.adminEmailRequired")); return; }
    if (!form.adminPassword) { setError(t("platform.tenants.adminPasswordRequired")); return; }
    const res = await fetch("/api/admin/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        latitude: form.latitude ? parseFloat(form.latitude) : undefined,
        longitude: form.longitude ? parseFloat(form.longitude) : undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? `Failed to create club (${res.status})`);
    } else {
      setForm({ name: "", slug: "", adminEmail: "", adminPassword: "", brandColor: "#16a34a", locale: "en", latitude: "", longitude: "" });
      setSuccess(t("platform.tenants.created"));
      load();
    }
  }

  async function setStatus(id: string, nextActive: boolean) {
    setError("");
    setSuccess("");
    const res = await fetch(`/api/admin/tenants/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: nextActive }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to update tenant status");
      return;
    }
    setSuccess(`Tenant ${nextActive ? "activated" : "suspended"} successfully.`);
    load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("platform.tenants.title")}</h1>

      <form onSubmit={handleCreate} className="rounded-xl bg-white p-6 shadow space-y-3">
        <h2 className="font-semibold">{t("platform.tenants.createClub")}</h2>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {success && <p className="text-green-600 text-sm">{success}</p>}
        <div className="grid grid-cols-2 gap-3">
          <input placeholder={t("platform.tenants.clubNamePlaceholder")} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setError(""); }} className="rounded border p-2" />
          <input placeholder={t("platform.tenants.slugPlaceholder")} value={form.slug} onChange={(e) => { setForm({ ...form, slug: e.target.value }); setError(""); }} className="rounded border p-2" />
          <input type="email" placeholder={t("platform.tenants.adminEmailPlaceholder")} value={form.adminEmail} onChange={(e) => { setForm({ ...form, adminEmail: e.target.value }); setError(""); }} className="rounded border p-2" />
          <input type="password" placeholder={t("platform.tenants.adminPasswordPlaceholder")} value={form.adminPassword} onChange={(e) => { setForm({ ...form, adminPassword: e.target.value }); setError(""); }} className="rounded border p-2" />
          <input type="color" value={form.brandColor} onChange={(e) => setForm({ ...form, brandColor: e.target.value })} className="rounded border p-1 h-10" />
          <select value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })} className="rounded border p-2">
            <option value="en">English</option>
            <option value="cy">Cymraeg</option>
            <option value="fr">Français</option>
            <option value="gd">Gàidhlig</option>
          </select>
          <input type="text" placeholder={t("platform.tenants.latitudePlaceholder")} value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} className="rounded border p-2" />
          <input type="text" placeholder={t("platform.tenants.longitudePlaceholder")} value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} className="rounded border p-2" />
        </div>
        <button type="submit" className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700">{t("platform.tenants.create")}</button>
      </form>

      <div className="space-y-2">
        {tenants.map((tenant) => {
          // Status drives the badge and what (if anything) clicking does.
          // ONBOARDING is intentionally non-clickable: activation must go
          // through the proper go-live flow (impersonate → wizard → Go Live).
          const status: TenantStatus = tenant.status ?? (tenant.active ? "ACTIVE" : "SUSPENDED");
          const badge =
            status === "ACTIVE"
              ? { label: t("platform.tenants.active"), classes: "bg-green-100 text-green-700 hover:bg-green-200", title: "Click to suspend", clickable: true, nextActive: false }
              : status === "SUSPENDED"
                ? { label: t("platform.tenants.suspended"), classes: "bg-red-100 text-red-700 hover:bg-red-200", title: "Click to reactivate", clickable: true, nextActive: true }
                : { label: t("platform.tenants.onboarding"), classes: "bg-gray-100 text-gray-600 cursor-not-allowed", title: "Tenant must complete go-live (impersonate → wizard)", clickable: false, nextActive: false };
          return (
            <div key={tenant.id} className="rounded-xl border bg-white p-4 flex justify-between items-center">
              <div>
                <h3 className="font-semibold"><Link href={`/dashboard/platform/tenants/${tenant.id}`} className="hover:underline">{tenant.name}</Link> <span className="text-xs text-gray-400">/{tenant.slug}</span></h3>
                  <p className="text-xs text-gray-500">{tenant._count?.users ?? 0} users · {tenant._count?.greens ?? 0} greens · {tenant.locale}{tenant.locality ? ` · ${tenant.locality}` : ""}</p>
              </div>
              <button
                type="button"
                disabled={!badge.clickable}
                onClick={badge.clickable ? () => setStatus(tenant.id, badge.nextActive) : undefined}
                title={badge.title}
                className={`text-xs px-3 py-1 rounded ${badge.classes}`}
              >
                {badge.label}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
