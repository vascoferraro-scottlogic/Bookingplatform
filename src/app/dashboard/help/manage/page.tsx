"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";

interface ShippedSlug {
  slug: string;
  title: string;
  category: string;
}

interface OverrideRow {
  id: string;
  slug: string;
  locale: string;
  enabled: boolean;
  title: string | null;
  body: string | null;
  updatedAt: string;
}

export default function HelpManagePage() {
  const [shipped, setShipped] = useState<ShippedSlug[]>([]);
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [editing, setEditing] = useState<{ slug: string; title: string; body: string; enabled: boolean } | null>(null);
  const [error, setError] = useState("");
  const [flagDisabled, setFlagDisabled] = useState(false);
  const t = useTranslations("help");
  const locale = useLocale();

  function loadShipped() {
    fetch("/api/help/shipped")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setShipped(Array.isArray(d) ? d : []))
      .catch(() => {});
  }
  function loadOverrides() {
    fetch("/api/help/overrides")
      .then((r) => {
        if (r.status === 403) {
          setFlagDisabled(true);
          return [];
        }
        return r.ok ? r.json() : [];
      })
      .then((d) => setOverrides(Array.isArray(d) ? d : []))
      .catch(() => {});
  }

  useEffect(() => {
    loadShipped();
    loadOverrides();
  }, []);

  function findOverride(slug: string): OverrideRow | undefined {
    return overrides.find((o) => o.slug === slug && o.locale === locale);
  }

  function startEdit(s: ShippedSlug) {
    const existing = findOverride(s.slug);
    setEditing({
      slug: s.slug,
      title: existing?.title ?? s.title,
      body: existing?.body ?? "",
      enabled: existing?.enabled ?? true,
    });
    setError("");
  }

  async function saveOverride() {
    if (!editing) return;
    const res = await fetch("/api/help/overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: editing.slug,
        locale,
        title: editing.title || null,
        body: editing.body || null,
        enabled: editing.enabled,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.message || j.error || "Failed to save");
      return;
    }
    setEditing(null);
    loadOverrides();
  }

  async function deleteOverride(id: string) {
    const res = await fetch(`/api/help/overrides?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) loadOverrides();
  }

  if (flagDisabled) {
    return (
      <div className="space-y-3 max-w-2xl">
        <h1 className="text-2xl font-bold">{t("manage.title")}</h1>
        <p className="text-sm text-gray-600">
          {t("manage.flagDisabled", { flag: "helpOverrides" })}
        </p>
        <Link href="/dashboard/help" className="text-green-700 hover:underline text-sm">{t("manage.backToHelp")}</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("manage.title")}</h1>
          <p className="text-sm text-gray-600">{t("manage.subtitle")}</p>
        </div>
        <Link href="/dashboard/help" className="text-green-700 hover:underline text-sm">{t("manage.backToHelp")}</Link>
      </div>

      {error && <p className="rounded bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">{error}</p>}

      {editing ? (
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <h2 className="font-semibold">{t("manage.editingSlug", { slug: editing.slug })}</h2>
          <label className="block text-sm">
            <span className="block mb-1 font-medium">{t("manage.titleLabel")}</span>
            <input
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              className="w-full rounded border border-gray-300 px-3 py-1.5"
            />
          </label>
          <label className="block text-sm">
            <span className="block mb-1 font-medium">{t("manage.bodyLabel")}</span>
            <textarea
              value={editing.body}
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              rows={14}
              className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-xs"
              placeholder={t("manage.bodyPlaceholder")}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editing.enabled}
              onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
            />
            {t("manage.visibleLabel")}
          </label>
          <div className="flex gap-2">
            <button onClick={saveOverride} className="rounded bg-green-600 text-white px-4 py-1.5 text-sm hover:bg-green-700">
              {t("manage.saveOverride")}
            </button>
            <button onClick={() => setEditing(null)} className="rounded border px-4 py-1.5 text-sm">
              {t("manage.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {shipped.map((s) => {
            const o = findOverride(s.slug);
            return (
              <div key={s.slug} className="flex items-center justify-between rounded-lg border bg-white px-4 py-3">
                <div>
                  <p className="font-medium text-sm">{o?.title ?? s.title}</p>
                  <p className="text-xs text-gray-500">
                    {s.category} &middot; {s.slug}
                    {o && (
                      <span className="ml-2 rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 uppercase tracking-wide text-[10px]">
                        {o.enabled ? t("manage.customised") : t("manage.hidden")}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => startEdit(s)} className="text-sm text-green-700 hover:underline">
                    {o ? t("manage.edit") : t("manage.override")}
                  </button>
                  {o && (
                    <button
                      onClick={() => deleteOverride(o.id)}
                      className="text-sm text-red-600 hover:underline"
                      title="Restore the shipped article"
                    >
                      {t("manage.restoreDefault")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
