"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { ChapterShell } from "./shared";
import type { ChapterProps } from "./shared";

// Toggles shown in the wizard. The `agent` (maintenance agent) flag is
// deliberately not listed: it's mandatory for every club (set on at
// provisioning, locked by the flags API). It can be displayed as a
// "what's already on" item but isn't toggleable here.
const TOGGLES: { key: string; label: string; desc: string; dependsOn?: string }[] = [
  { key: "messaging", label: "Let members chat", desc: "In-app messaging between members and staff." },
  { key: "events", label: "Use the events module", desc: "Create and manage events from the dashboard." },
  {
    key: "publicEvents",
    label: "Show events publicly",
    desc: "Show your events on your public homepage.",
    dependsOn: "events",
  },
  { key: "publicAvailability", label: "Public availability", desc: "Visitors can see green availability without logging in." },
];

type Flag = { key: string; enabled: boolean };

export default function Chapter7Features({ tenantId, onAdvance }: ChapterProps) {
  const t = useTranslations("onboarding");
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agentOn, setAgentOn] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    const res = await fetch(`/api/admin/tenants/${tenantId}/flags`);
    if (!res.ok) return;
    const data: Flag[] = await res.json();
    const map: Record<string, boolean> = {};
    for (const f of data) map[f.key] = f.enabled;
    setFlags(map);
    setAgentOn(!!map.agent);
    setLoaded(true);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (key: string, enabled: boolean) => {
    if (!tenantId) return;
    // Optimistic update, with cascade: turning off a parent turns off any
    // children that depend on it.
    setFlags((s) => {
      const next = { ...s, [key]: enabled };
      if (!enabled) {
        for (const t of TOGGLES) {
          if (t.dependsOn === key) next[t.key] = false;
        }
      }
      return next;
    });
    await fetch(`/api/admin/tenants/${tenantId}/flags`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, enabled }),
    });
    // If we cascaded any children off, persist those too.
    if (!enabled) {
      for (const t of TOGGLES) {
        if (t.dependsOn === key) {
          await fetch(`/api/admin/tenants/${tenantId}/flags`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: t.key, enabled: false }),
          });
        }
      }
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await onAdvance();
    setBusy(false);
  };

  if (!loaded) return <div className="text-gray-500">{t("loading")}</div>;

  return (
    <ChapterShell
      title={t("chapters.features")}
      intro="Turn on the parts of the platform you want to use. You can flip these any time later."
      onSubmit={submit}
      busy={busy}
    >
      <ul className="space-y-3">
        {TOGGLES.map((t) => {
          const parentOff = !!t.dependsOn && !flags[t.dependsOn];
          const parentLabel = t.dependsOn
            ? TOGGLES.find((x) => x.key === t.dependsOn)?.label
            : null;
          return (
            <li
              key={t.key}
              className={`flex items-start justify-between rounded p-3 border border-gray-200 ${
                parentOff ? "bg-gray-100 opacity-60" : "bg-gray-50"
              }`}
            >
              <div className="pr-4">
                <div className="font-medium text-gray-900">{t.label}</div>
                <div className="text-sm text-gray-500">{t.desc}</div>
                {parentOff && parentLabel && (
                  <div className="text-xs text-amber-700 mt-1">
                    Enable “{parentLabel}” first.
                  </div>
                )}
              </div>
              <label className={`relative inline-flex items-center mt-1 ${parentOff ? "cursor-not-allowed" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={!!flags[t.key]}
                  disabled={parentOff}
                  onChange={(e) => toggle(t.key, e.target.checked)}
                />
                <div className="w-11 h-6 bg-gray-300 peer-checked:bg-emerald-600 rounded-full transition relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition peer-checked:after:translate-x-5 peer-disabled:opacity-50"></div>
              </label>
            </li>
          );
        })}

        {/* Mandatory feature: shown for awareness only when enabled, never toggleable. */}
        {agentOn && (
          <li className="flex items-start justify-between bg-emerald-50 rounded p-3 border border-emerald-200">
            <div className="pr-4">
              <div className="font-medium text-gray-900 flex items-center gap-2">
                Maintenance agent
                <span className="text-[10px] uppercase tracking-wide bg-emerald-600 text-white px-1.5 py-0.5 rounded">
                  Always on
                </span>
              </div>
              <div className="text-sm text-gray-600">
                AI agents help triage and prioritise maintenance jobs. Included with every organisation.
              </div>
            </div>
            <div className="text-xs text-emerald-700 mt-1 whitespace-nowrap">Included</div>
          </li>
        )}
      </ul>
    </ChapterShell>
  );
}
