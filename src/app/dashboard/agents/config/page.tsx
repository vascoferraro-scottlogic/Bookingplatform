"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";

type Agent = { slug: string; name: string; description?: string };
type AgentConfig = {
  agent: { slug: string; name: string };
  enabled: boolean;
  config: Record<string, unknown>;
};

export default function AgentConfigPage() {
  const t = useTranslations("agents");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [configs, setConfigs] = useState<Record<string, AgentConfig>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    fetch("/api/agent/run")
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d?.agents)) setAgents(d.agents);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all(
      agents.map(a => fetch(`/api/agent/${a.slug}/config`).then(r => r.json().then(c => [a.slug, c] as const))),
    ).then(entries => {
      const next: Record<string, AgentConfig> = {};
      const nextDrafts: Record<string, string> = {};
      for (const [slug, cfg] of entries) {
        next[slug] = cfg;
        nextDrafts[slug] = JSON.stringify(cfg.config ?? {}, null, 2);
      }
      setConfigs(next);
      setDrafts(nextDrafts);
    });
  }, [agents]);

  async function toggleEnabled(slug: string, enabled: boolean) {
    setErrorMsg(""); setSuccessMsg("");
    const res = await fetch(`/api/agent/${slug}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json();
    if (!res.ok) { setErrorMsg(data.error ?? "Failed to update"); return; }
    setConfigs(prev => ({ ...prev, [slug]: data }));
    setSuccessMsg(`${slug} ${enabled ? "enabled" : "disabled"}.`);
  }

  async function saveConfig(slug: string) {
    setErrorMsg(""); setSuccessMsg("");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(drafts[slug]);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("must be an object");
    } catch (e) {
      setErrorMsg(`Invalid JSON for ${slug}: ${(e as Error).message}`);
      return;
    }
    const res = await fetch(`/api/agent/${slug}/config`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: parsed }),
    });
    const data = await res.json();
    if (!res.ok) { setErrorMsg(data.error ?? "Failed to save config"); return; }
    setConfigs(prev => ({ ...prev, [slug]: data }));
    setDrafts(prev => ({ ...prev, [slug]: JSON.stringify(data.config ?? {}, null, 2) }));
    setSuccessMsg(`Config saved for ${slug}.`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("config.title")}</h1>
        <Link href="/dashboard/agents" className="text-sm rounded border px-3 py-1.5 hover:bg-gray-50">{t("config.backToAgents")}</Link>
      </div>

      {errorMsg && <p className="text-red-600 text-sm rounded bg-red-50 border border-red-200 px-4 py-2">{errorMsg}</p>}
      {successMsg && <p className="text-green-700 text-sm rounded bg-green-50 border border-green-200 px-4 py-2">{successMsg}</p>}

      <p className="text-sm text-gray-600">
        {t("config.intro")}
      </p>

      <div className="space-y-4">
        {agents.map(a => {
          const cfg = configs[a.slug];
          return (
            <div key={a.slug} className="rounded-xl border bg-white p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-lg">{a.name}</h2>
                  {a.description && <p className="text-xs text-gray-500">{a.description}</p>}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <span>{cfg?.enabled ? t("config.enabled") : t("config.disabled")}</span>
                  <input
                    type="checkbox"
                    checked={cfg?.enabled ?? false}
                    onChange={e => toggleEnabled(a.slug, e.target.checked)}
                    className="h-5 w-5"
                  />
                </label>
              </div>
              <div>
                <label className="text-xs text-gray-600 font-medium">{t("config.configJsonLabel")}</label>
                <textarea
                  value={drafts[a.slug] ?? ""}
                  onChange={e => setDrafts(prev => ({ ...prev, [a.slug]: e.target.value }))}
                  className="w-full mt-1 rounded border p-2 text-xs font-mono"
                  rows={8}
                />
              </div>
              <div>
                <button
                  onClick={() => saveConfig(a.slug)}
                  className="rounded bg-green-600 px-4 py-1.5 text-sm text-white hover:bg-green-700"
                >
                  {t("config.saveConfig")}
                </button>
              </div>
            </div>
          );
        })}
        {agents.length === 0 && <p className="text-sm text-gray-400">{t("config.noAgents")}</p>}
      </div>
    </div>
  );
}
