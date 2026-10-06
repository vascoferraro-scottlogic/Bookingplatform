"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate, formatDateTime } from "@/lib/format";
import Link from "next/link";

type Green = {
  id: string;
  name: string;
  rinks: { id: string; name: string }[];
};

type FeatureFlag = {
  id: string;
  key: string;
  enabled: boolean;
};

type TenantStatus = "LEAD" | "ONBOARDING" | "ACTIVE" | "SUSPENDED" | "CHURNED";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  status: TenantStatus;
  goLiveAt: string | null;
  brandColor: string;
  logoUrl: string | null;
  locale: string;
  seasonStart: string | null;
  seasonEnd: string | null;
  openingTime: string;
  closingTime: string;
  createdAt: string;
  greens: Green[];
  featureFlags: FeatureFlag[];
};

const STATUS_BADGE: Record<TenantStatus, string> = {
  LEAD: "bg-gray-100 text-gray-700",
  ONBOARDING: "bg-amber-100 text-amber-800",
  ACTIVE: "bg-green-100 text-green-700",
  SUSPENDED: "bg-red-100 text-red-700",
  CHURNED: "bg-gray-200 text-gray-500",
};

export default function TenantDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("admin");
  const { update } = useSession();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    fetch(`/api/admin/tenants/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      })
      .then((d) => setTenant(d))
      .catch(() => setError(t("platform.tenantDetail.tenantNotFound")));
  }

  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startImpersonation() {
    if (!tenant) return;
    setError("");
    setSuccessMsg("");
    setBusy(true);
    try {
      const res = await fetch("/api/platform/impersonation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id, reason: reason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not start impersonation.");
        setBusy(false);
        return;
      }
      await update({ actingAs: data.actingAs });
      // ONBOARDING tenants land on the wizard; others on their tenant home.
      const dest = tenant.status === "ONBOARDING" ? "/onboarding" : "/" + tenant.slug;
      router.push(dest);
      router.refresh();
    } catch {
      setError("Network error starting impersonation.");
      setBusy(false);
    }
  }

  async function setStatus(next: TenantStatus) {
    if (!tenant) return;
    if (next === "CHURNED" && !confirm(`Mark ${tenant.name} as CHURNED? This soft-deletes the tenant.`)) return;
    if (next === "SUSPENDED" && !confirm(`Suspend ${tenant.name}? Members will be locked out until you reactivate.`)) return;
    setError("");
    setSuccessMsg("");
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/tenants/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? data.message ?? "Status change failed.");
      } else {
        setSuccessMsg(`Tenant status set to ${next}.`);
        load();
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !tenant) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/platform" className="text-sm text-green-700 hover:underline">{t("platform.tenantDetail.backToTenants")}</Link>
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (!tenant) {
    return <p className="text-gray-500">{t("platform.tenantDetail.loading")}</p>;
  }

  const status = tenant.status ?? (tenant.active ? "ACTIVE" : "SUSPENDED");
  const canImpersonate = status === "ACTIVE" || status === "ONBOARDING";

  return (
    <div className="space-y-6">
      <Link href="/dashboard/platform" className="text-sm text-green-700 hover:underline">{t("platform.tenantDetail.backToTenants")}</Link>

      <div className="flex items-center gap-3">
        <div className="h-4 w-4 rounded-full" style={{ backgroundColor: tenant.brandColor }} />
        <h1 className="text-2xl font-bold">{tenant.name}</h1>
        <span className="text-sm text-gray-400">/{tenant.slug}</span>
        <span className={`ml-2 text-xs px-2 py-0.5 rounded ${STATUS_BADGE[status]}`}>{status}</span>
        <Link href={`/dashboard/platform/tenants/${id}/billing`} className="ml-auto rounded bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200">
          {t("platform.tenantDetail.viewBilling")}
        </Link>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {successMsg && <p className="text-green-600 text-sm rounded bg-green-50 border border-green-200 px-4 py-2">{successMsg}</p>}

      {/* Tenant-plane: read-only. Edits require impersonation. */}
      <div className="rounded-xl bg-white p-6 shadow space-y-4">
        <div className="flex justify-between items-start gap-3">
          <div>
            <h2 className="font-semibold">{t("platform.tenantDetail.tenantContent")}</h2>
            <p className="text-xs text-gray-500 mt-1">
              {t("platform.tenantDetail.tenantContentDescription")}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt className="text-gray-500">{t("platform.tenantDetail.publicUrl")}</dt>
          <dd className="font-mono">
            {tenant.slug.startsWith("t-") ? (
              <span className="inline-block px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-600">PLACEHOLDER</span>
            ) : tenant.goLiveAt ? (
              <span>/{tenant.slug} <span className="ml-1 text-xs text-emerald-700">[LIVE]</span></span>
            ) : (
              <span>/{tenant.slug} <span className="ml-1 text-xs text-amber-700">[CHOSEN, not yet live]</span></span>
            )}
          </dd>
          <dt className="text-gray-500">{t("platform.tenantDetail.locale")}</dt><dd>{tenant.locale}</dd>
          <dt className="text-gray-500">{t("platform.tenantDetail.season")}</dt><dd>{tenant.seasonStart && tenant.seasonEnd ? `${tenant.seasonStart} — ${tenant.seasonEnd}` : t("platform.tenantDetail.seasonNotSet")}</dd>
          <dt className="text-gray-500">{t("platform.tenantDetail.hours")}</dt><dd>{tenant.openingTime} – {tenant.closingTime}</dd>
          <dt className="text-gray-500">{t("platform.tenantDetail.brandColour")}</dt><dd className="font-mono">{tenant.brandColor}</dd>
          <dt className="text-gray-500">{t("platform.tenantDetail.logoUrl")}</dt><dd className="truncate">{tenant.logoUrl ?? <span className="text-gray-400">—</span>}</dd>
          <dt className="text-gray-500">{t("platform.tenantDetail.created")}</dt><dd>{formatDate(tenant.createdAt, locale)}</dd>
          {tenant.goLiveAt && (
            <>
              <dt className="text-gray-500">{t("platform.tenantDetail.wentLive")}</dt>
              <dd>{formatDateTime(tenant.goLiveAt, locale)}</dd>
            </>
          )}
        </dl>

        {canImpersonate ? (
          <div className="border-t pt-4 space-y-2">
            <label htmlFor="reason" className="block text-xs font-medium text-gray-600">
              {t("platform.tenantDetail.reasonLabel")}
            </label>
            <input
              id="reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("platform.tenantDetail.reasonPlaceholder")}
              className="w-full rounded border p-2 text-sm"
              maxLength={500}
              disabled={busy}
            />
            <button
              type="button"
              onClick={startImpersonation}
              disabled={busy}
              className="rounded bg-green-600 px-4 py-2 text-white text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {busy ? t("platform.tenantDetail.starting") : t("platform.tenantDetail.impersonateButton", { name: tenant.name })}
            </button>
          </div>
        ) : (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            {t("platform.tenantDetail.impersonationDisabled", { status })}
          </p>
        )}
      </div>

      {/* Greens — read-only summary */}
      <div className="rounded-xl bg-white p-6 shadow space-y-3">
        <h2 className="font-semibold">{t("platform.tenantDetail.greens", { count: tenant.greens.length })}</h2>
        {tenant.greens.length === 0 ? (
          <p className="text-sm text-gray-500">{t("platform.tenantDetail.noGreens")}</p>
        ) : (
          <ul className="space-y-2">
            {tenant.greens.map((g) => (
              <li key={g.id} className="rounded border p-3">
                <p className="font-medium">{g.name}</p>
                <p className="text-xs text-gray-500">{g.rinks.length} rink{g.rinks.length !== 1 ? "s" : ""}: {g.rinks.map((r) => r.name).join(", ") || "—"}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Feature flags — read-only on the platform plane */}
      <div className="rounded-xl bg-white p-6 shadow space-y-3">
        <h2 className="font-semibold">{t("platform.tenantDetail.featureFlags")}</h2>
        <p className="text-xs text-gray-500">
          {t("platform.tenantDetail.featureFlagsReadonly")}
        </p>
        {tenant.featureFlags.length === 0 ? (
          <p className="text-sm text-gray-500">{t("platform.tenantDetail.noFlags")}</p>
        ) : (
          <ul className="space-y-1">
            {tenant.featureFlags.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded border px-3 py-2">
                <span className="text-sm font-mono">{f.key}</span>
                <span className={`text-xs px-3 py-1 rounded ${f.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                  {f.enabled ? "Enabled" : "Disabled"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Platform-plane: lifecycle controls */}
      <div className="rounded-xl bg-white p-6 shadow space-y-3 border-l-4 border-purple-300">
        <div>
          <h2 className="font-semibold">{t("platform.tenantDetail.platformLifecycle")}</h2>
          <p className="text-xs text-gray-500 mt-1">
            {t("platform.tenantDetail.platformLifecycleDescription")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {status !== "ACTIVE" && status !== "CHURNED" && (
            <button
              type="button"
              onClick={() => setStatus("ACTIVE")}
              disabled={busy}
              className="rounded bg-green-600 px-3 py-1.5 text-white text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {t("platform.tenantDetail.activate")}
            </button>
          )}
          {status === "ACTIVE" && (
            <button
              type="button"
              onClick={() => setStatus("SUSPENDED")}
              disabled={busy}
              className="rounded bg-amber-600 px-3 py-1.5 text-white text-sm hover:bg-amber-700 disabled:opacity-50"
            >
              {t("platform.tenantDetail.suspendTenant")}
            </button>
          )}
          {status === "SUSPENDED" && (
            <button
              type="button"
              onClick={() => setStatus("ACTIVE")}
              disabled={busy}
              className="rounded bg-green-600 px-3 py-1.5 text-white text-sm hover:bg-green-700 disabled:opacity-50"
            >
              Reactivate
            </button>
          )}
          {status !== "CHURNED" && (
            <button
              type="button"
              onClick={() => setStatus("CHURNED")}
              disabled={busy}
              className="rounded border border-red-300 text-red-700 px-3 py-1.5 text-sm hover:bg-red-50 disabled:opacity-50"
            >
              Mark churned
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
