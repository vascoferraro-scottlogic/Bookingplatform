"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

type Federation = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  billingMode: string;
  memberCount: number;
};

export default function FederationPage() {
  const t = useTranslations("settings.federation");
  const [federations, setFederations] = useState<Federation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function loadFederations() {
    fetch("/api/federations")
      .then((r) => (r.ok ? r.json() : []))
      .then(setFederations)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadFederations(); }, []);

  async function handleCreate() {
    setError("");
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/federations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
    });
    setCreating(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? t("createFailed"));
      return;
    }
    setNewName("");
    setNewDesc("");
    setShowCreate(false);
    setSuccess(t("created"));
    setTimeout(() => setSuccess(""), 3000);
    loadFederations();
  }

  if (loading) {
    return <div className="p-6 text-gray-500">Loading…</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <nav className="text-sm text-gray-500">
        <Link href="/dashboard/settings">{t("breadcrumb")}</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-700">{t("title")}</span>
      </nav>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="text-gray-600 text-sm mt-1">{t("intro")}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {t("create")}
        </button>
      </div>

      {success && (
        <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          {success}
        </div>
      )}

      {showCreate && (
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">{t("name")}</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("namePlaceholder")}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{t("descriptionLabel")}</label>
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder={t("descriptionPlaceholder")}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={creating} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {t("save")}
            </button>
            <button onClick={() => { setShowCreate(false); setError(""); }} className="rounded-md border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {federations.length === 0 ? (
        <p className="text-gray-500 text-sm">{t("noFederations")}</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-white">
          {federations.map((f) => (
            <li key={f.id}>
              <Link href={`/dashboard/federation/${f.id}`} className="flex items-center justify-between px-4 py-4 hover:bg-gray-50">
                <div>
                  <p className="font-medium text-gray-900">{f.name}</p>
                  <p className="text-sm text-gray-500">
                    {t("members", { count: f.memberCount })} · {f.billingMode.replace(/_/g, " ").toLowerCase()}
                  </p>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                  f.status === "ACTIVE" ? "bg-green-100 text-green-700" :
                  f.status === "SUSPENDED" ? "bg-amber-100 text-amber-700" :
                  "bg-gray-100 text-gray-600"
                }`}>
                  {f.status === "ACTIVE" ? t("active") : f.status === "SUSPENDED" ? t("suspended") : t("dissolved")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
