"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

type Membership = {
  tenantId: string;
  tenant: { id: string; name: string; slug: string; brandColor: string; locality?: string | null };
  role: string;
};

/**
 * Small dropdown shown only when the signed-in user has more than one active
 * membership. Lets them switch which club they're working with right now.
 * Calls the guard endpoint then updates the JWT via NextAuth's
 * `useSession().update()`.
 */
export default function TenantSwitcher() {
  const { data: session, update } = useSession();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [busy, setBusy] = useState(false);
  const t = useTranslations("common");

  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/auth/memberships")
      .then((r) => (r.ok ? r.json() : []))
      .then(setMemberships)
      .catch(() => setMemberships([]));
  }, [session?.user]);

  if (memberships.length < 2) return null;

  const activeTenantId = (session?.user as { activeTenantId?: string } | undefined)?.activeTenantId;

  const switchTo = async (tenantId: string) => {
    if (busy || tenantId === activeTenantId) return;
    setBusy(true);
    const res = await fetch("/api/auth/memberships/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId }),
    });
    if (res.ok) {
      await update({ activeTenantId: tenantId });
      // Reload so SSR pages pick up the new context.
      window.location.reload();
    }
    setBusy(false);
  };

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-500">{t("tenantSwitcher.label")}</label>
      <select
        className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
        value={activeTenantId ?? ""}
        onChange={(e) => switchTo(e.target.value)}
        disabled={busy}
      >
        {memberships.map((m) => (
          <option key={m.tenantId} value={m.tenantId}>
            {m.tenant.name}{m.tenant.locality ? ` — ${m.tenant.locality}` : ""} ({m.role.toLowerCase().replace("_", " ")})
          </option>
        ))}
      </select>
    </div>
  );
}
