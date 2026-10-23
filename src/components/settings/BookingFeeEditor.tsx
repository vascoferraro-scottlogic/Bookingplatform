"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Props = { tenantId: string };

const inputCls =
  "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

export default function BookingFeeEditor({ tenantId }: Props) {
  const t = useTranslations("settings");
  const [fee, setFee] = useState("10.00");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/admin/tenants/${tenantId}`)
      .then((r) => r.json())
      .then((tenant) => {
        if (typeof tenant.bookingFeePence === "number") setFee((tenant.bookingFeePence / 100).toFixed(2));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [tenantId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setSavedMsg(null);
    setError(null);
    const pounds = Number(fee);
    if (fee.trim() === "" || !Number.isFinite(pounds) || pounds < 0) {
      setError(t("bookingFee.invalid"));
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/admin/tenants/${tenantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingFeePence: Math.round(pounds * 100) }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? t("bookingFee.saveFailed"));
    } else {
      setSavedMsg(t("bookingFee.saved"));
    }
  };

  if (!loaded) return <div className="text-gray-500">Loading…</div>;

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-white p-6 shadow-sm">
      <label className="block">
        <span className="text-sm font-medium text-gray-700">{t("bookingFee.label")}</span>
        <input
          className={inputCls}
          type="number"
          min="0"
          step="0.01"
          value={fee}
          onChange={(e) => { setFee(e.target.value); setSavedMsg(null); }}
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {savedMsg && <p className="text-sm text-emerald-600">{savedMsg}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
