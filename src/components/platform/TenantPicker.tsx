"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  brandColor: string;
  status?: "ACTIVE" | "ONBOARDING" | "SUSPENDED" | "CHURNED" | "LEAD";
};

/**
 * Tenant picker for platform admins. Selecting a tenant POSTs to
 * /api/platform/impersonation, updates the NextAuth session with the new
 * `actingAs` claim, then routes to the club homepage.
 *
 * `clearStaleClaim` — set when the server detected a stale `actingAs` claim
 * on the JWT (the impersonation row in the DB has already ended). The picker
 * clears the JWT claim on mount so the orange banner and middleware checks
 * stop honouring it.
 */
export default function TenantPicker({
  tenants,
  clearStaleClaim = false,
}: {
  tenants: Tenant[];
  clearStaleClaim?: boolean;
}) {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("common");

  // Reconcile a stale `actingAs` JWT claim once on mount.
  useEffect(() => {
    if (!clearStaleClaim) return;
    const acting = (session?.user as any)?.actingAs;
    if (!acting) return;
    update({ actingAs: null }).then(() => router.refresh());
    // We intentionally only run when clearStaleClaim is true; session is read
    // once. Re-running on session changes would loop after we clear the claim.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearStaleClaim]);

  async function pick(tenant: Tenant) {
    setError(null);
    setBusyId(tenant.id);
    try {
      const res = await fetch("/api/platform/impersonation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id, reason: reason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not start impersonation.");
        setBusyId(null);
        return;
      }
      // Push the new actingAs claim into the JWT/session.
      await update({ actingAs: data.actingAs });
      // ONBOARDING tenants don't have a public site yet; route to the wizard.
      const dest = tenant.status === "ONBOARDING" ? "/onboarding" : "/" + tenant.slug;
      router.push(dest);
      router.refresh();
    } catch {
      setError("Network error starting impersonation.");
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <label htmlFor="reason" className="block text-sm font-medium text-gray-700">
          {t("tenantPicker.reasonLabel")}
        </label>
        <input
          id="reason"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("tenantPicker.reasonPlaceholder")}
          className="mt-1 w-full rounded border p-2 text-sm"
          maxLength={500}
        />
        <p className="mt-1 text-xs text-gray-500">
          {t("tenantPicker.reasonHint")}
        </p>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <h2 className="text-lg font-semibold text-gray-800">{t("tenantPicker.clubs")}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tenants.map((tenant) => (
          <button
            key={tenant.id}
            type="button"
            onClick={() => pick(tenant)}
            disabled={busyId !== null}
            className="flex items-center gap-4 rounded-xl border bg-white p-6 shadow-sm hover:shadow-md transition-shadow text-left disabled:opacity-50"
          >
            <div
              className="h-10 w-10 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: tenant.brandColor }}
            >
              {tenant.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-green-700">{tenant.name}</p>
                {tenant.status === "ONBOARDING" && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">ONBOARDING</span>
                )}
              </div>
              <p className="text-xs text-gray-500">
                {busyId === tenant.id
                  ? t("tenantPicker.starting")
                  : tenant.status === "ONBOARDING"
                    ? t("tenantPicker.helpDrive", { name: tenant.name })
                    : t("tenantPicker.actAs", { name: tenant.name })}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
