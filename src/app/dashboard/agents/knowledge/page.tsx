"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";

type Entry = {
  id: string;
  scope: "GLOBAL" | "REGIONAL" | "TENANT";
  region: string | null;
  category: string;
  title: string;
  content: string;
  priority: number;
  active: boolean;
  source: string;
  agent: { slug: string; name: string } | null;
  tenant: { id: string; name: string } | null;
  createdAt: string;
};
type Agent = { slug: string; name: string };

const SCOPES: Entry["scope"][] = ["GLOBAL", "REGIONAL", "TENANT"];

export default function KnowledgePage() {
  const t = useTranslations("agents");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [scopeFilter, setScopeFilter] = useState<string>("");
  const [agentFilter, setAgentFilter] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({
    scope: "TENANT" as Entry["scope"],
    region: "",
    agentSlug: "",
    category: "",
    title: "",
    content: "",
    priority: 0,
  });

  useEffect(() => {
    fetch("/api/agent/run").then(r => r.json()).then(d => {
      if (Array.isArray(d?.agents)) setAgents(d.agents);
    }).catch(() => {});
  }, []);

  function reload() {
    const qs = new URLSearchParams();
    if (scopeFilter) qs.set("scope", scopeFilter);
    if (agentFilter) qs.set("agentSlug", agentFilter);
    fetch(`/api/agent/knowledge?${qs.toString()}`)
      .then(r => r.json())
      .then(d => setEntries(Array.isArray(d?.entries) ? d.entries : []))
      .catch(() => {});
  }

  useEffect(reload, [scopeFilter, agentFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function createEntry() {
    setErrorMsg(""); setSuccessMsg("");
    const body: Record<string, unknown> = {
      scope: draft.scope,
      category: draft.category,
      title: draft.title,
      content: draft.content,
      priority: draft.priority,
    };
    if (draft.region) body.region = draft.region;
    if (draft.agentSlug) body.agentSlug = draft.agentSlug;
    const res = await fetch("/api/agent/knowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) { setErrorMsg(data.error ?? "Failed to create"); return; }
    setSuccessMsg(t("knowledge.created"));
    setShowNew(false);
    setDraft({ scope: "TENANT", region: "", agentSlug: "", category: "", title: "", content: "", priority: 0 });
    reload();
  }

  async function toggleActive(e: Entry) {
    const res = await fetch(`/api/agent/knowledge/${e.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !e.active }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorMsg(data.error ?? "Failed to toggle");
      return;
    }
    reload();
  }

  async function deleteEntry(e: Entry) {
    if (!confirm(t("knowledge.deleteConfirm", { title: e.title }))) return;
    const res = await fetch(`/api/agent/knowledge/${e.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorMsg(data.error ?? "Failed to delete");
      return;
    }
    setSuccessMsg(t("knowledge.deleted"));
    reload();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("knowledge.title")}</h1>
        <Link href="/dashboard/agents" className="text-sm rounded border px-3 py-1.5 hover:bg-gray-50">{t("knowledge.backToAgents")}</Link>
      </div>

      {errorMsg && <p className="text-red-600 text-sm rounded bg-red-50 border border-red-200 px-4 py-2">{errorMsg}</p>}
      {successMsg && <p className="text-green-700 text-sm rounded bg-green-50 border border-green-200 px-4 py-2">{successMsg}</p>}

      <p className="text-sm text-gray-600">
        {t("knowledge.intro")}
      </p>

      <div className="flex gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-600">{t("knowledge.scopeLabel")}</label>
          <select value={scopeFilter} onChange={e => setScopeFilter(e.target.value)} className="rounded border p-2 text-sm">
            <option value="">{t("knowledge.allScopes")}</option>
            {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600">{t("knowledge.agentLabel")}</label>
          <select value={agentFilter} onChange={e => setAgentFilter(e.target.value)} className="rounded border p-2 text-sm">
            <option value="">{t("knowledge.anyAgent")}</option>
            {agents.map(a => <option key={a.slug} value={a.slug}>{a.name}</option>)}
          </select>
        </div>
        <button
          onClick={() => setShowNew(s => !s)}
          className="ml-auto rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700"
        >
          {showNew ? t("knowledge.cancel") : t("knowledge.newEntry")}
        </button>
      </div>

      {showNew && (
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <h2 className="font-semibold">{t("knowledge.newEntryTitle")}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600">{t("knowledge.scopeLabel")}</label>
              <select
                value={draft.scope}
                onChange={e => setDraft({ ...draft, scope: e.target.value as Entry["scope"] })}
                className="w-full rounded border p-2 text-sm"
              >
                {SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600">{t("knowledge.agentOptional")}</label>
              <select
                value={draft.agentSlug}
                onChange={e => setDraft({ ...draft, agentSlug: e.target.value })}
                className="w-full rounded border p-2 text-sm"
              >
                <option value="">{t("knowledge.allAgents")}</option>
                {agents.map(a => <option key={a.slug} value={a.slug}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600">{t("knowledge.categoryLabel")}</label>
              <input
                value={draft.category}
                onChange={e => setDraft({ ...draft, category: e.target.value })}
                placeholder={t("knowledge.categoryPlaceholder")}
                className="w-full rounded border p-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600">{t("knowledge.regionLabel")}</label>
              <input
                value={draft.region}
                onChange={e => setDraft({ ...draft, region: e.target.value })}
                placeholder={t("knowledge.regionPlaceholder")}
                className="w-full rounded border p-2 text-sm"
                disabled={draft.scope !== "REGIONAL"}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-600">{t("knowledge.titleLabel")}</label>
              <input
                value={draft.title}
                onChange={e => setDraft({ ...draft, title: e.target.value })}
                className="w-full rounded border p-2 text-sm"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-600">{t("knowledge.contentLabel")}</label>
              <textarea
                value={draft.content}
                onChange={e => setDraft({ ...draft, content: e.target.value })}
                rows={4}
                className="w-full rounded border p-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600">{t("knowledge.priorityLabel")}</label>
              <input
                type="number"
                value={draft.priority}
                onChange={e => setDraft({ ...draft, priority: parseInt(e.target.value, 10) || 0 })}
                className="w-full rounded border p-2 text-sm"
              />
            </div>
          </div>
          <div>
            <button onClick={createEntry} className="rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700">
              {t("knowledge.create")}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {entries.map(e => (
          <div key={e.id} className={`rounded border bg-white p-3 ${e.active ? "" : "opacity-60"}`}>
            <div className="flex items-center gap-2 text-xs">
              <span className={`px-2 py-0.5 rounded font-mono ${
                e.scope === "GLOBAL" ? "bg-purple-100 text-purple-700" :
                e.scope === "REGIONAL" ? "bg-blue-100 text-blue-700" :
                "bg-green-100 text-green-700"
              }`}>{e.scope}</span>
              <span className="bg-gray-100 px-2 py-0.5 rounded">{e.category}</span>
              {e.region && <span className="text-gray-500 font-mono">{e.region}</span>}
              {e.agent && <span className="text-indigo-600">→ {e.agent.name}</span>}
              {e.tenant && <span className="text-gray-500">· {e.tenant.name}</span>}
              <span className="text-gray-400 ml-auto">{e.source}</span>
            </div>
            <h3 className="font-medium mt-1">{e.title}</h3>
            <p className="text-sm text-gray-700 whitespace-pre-wrap mt-1">{e.content}</p>
            <div className="flex gap-2 mt-2 text-xs">
              <button onClick={() => toggleActive(e)} className="rounded border px-2 py-0.5 hover:bg-gray-50">
                {e.active ? t("knowledge.deactivate") : t("knowledge.activate")}
              </button>
              <button onClick={() => deleteEntry(e)} className="rounded border border-red-300 text-red-600 px-2 py-0.5 hover:bg-red-50">
                {t("knowledge.delete")}
              </button>
              <span className="text-gray-400 ml-auto">priority {e.priority}</span>
            </div>
          </div>
        ))}
        {entries.length === 0 && <p className="text-sm text-gray-400">{t("knowledge.noEntries")}</p>}
      </div>
    </div>
  );
}
