"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

type Group = {
  id: string;
  name: string;
  description: string | null;
  isBuiltIn: boolean;
  _count: { grants: number; members: number };
};

export default function GroupsPage() {
  const t = useTranslations("settings.groups");
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  function loadGroups() {
    fetch("/api/groups")
      .then((r) => (r.ok ? r.json() : []))
      .then(setGroups)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadGroups(); }, []);

  async function handleCreate() {
    setError("");
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
    });
    setCreating(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? t("saveFailed"));
      return;
    }
    setNewName("");
    setNewDesc("");
    setShowCreate(false);
    loadGroups();
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
          {t("createGroup")}
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("groupName")}</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("groupNamePlaceholder")}
              className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t("description")}</label>
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder={t("descriptionPlaceholder")}
              className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {t("create")}
            </button>
            <button
              onClick={() => { setShowCreate(false); setError(""); }}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {groups.length === 0 ? (
        <p className="text-gray-500 text-sm">{t("noGroups")}</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-white">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`/dashboard/settings/groups/${g.id}`}
                className="flex items-center justify-between px-4 py-4 hover:bg-gray-50"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {g.name}
                    {g.isBuiltIn && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        {t("builtIn")}
                      </span>
                    )}
                  </p>
                  {g.description && <p className="text-sm text-gray-500">{g.description}</p>}
                </div>
                <div className="text-sm text-gray-500 text-right whitespace-nowrap">
                  <span>{t("grantCount", { count: g._count.grants })}</span>
                  <span className="mx-2">·</span>
                  <span>{t("memberCount", { count: g._count.members })}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
