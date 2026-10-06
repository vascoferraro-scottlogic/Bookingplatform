"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Props = { tenantId: string };

const inputCls =
  "w-full rounded-md border border-gray-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

export default function LocalityEditor({ tenantId }: Props) {
  const t = useTranslations("settings");
  const [locality, setLocality] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/admin/tenants/${tenantId}`)
      .then((r) => r.json())
      .then((t) => {
        if (t.locality) setLocality(t.locality);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [tenantId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    setSavedMsg(null);
    setError(null);
    const res = await fetch(`/api/admin/tenants/${tenantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locality: locality.trim() || null }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? t("locality.saveFailed"));
    } else {
      setSavedMsg(t("locality.saved"));
    }
  };

  if (!loaded) return <div className="text-gray-500">Loading…</div>;

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-white p-6 shadow-sm">
      <label className="block">
        <span className="text-sm font-medium text-gray-700">{t("locality.label")}</span>
        <input
          className={inputCls}
          value={locality}
          onChange={(e) => { setLocality(e.target.value); setSavedMsg(null); }}
          placeholder={t("locality.placeholder")}
          maxLength={60}
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
