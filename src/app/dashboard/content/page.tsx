"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import HelpHint from "@/components/help/HelpHint";

type Tenant = { id: string; name: string; slug: string };

type ContentSection = {
  id: string;
  type: string;
  status: string;
  enabled: boolean;
  order: number;
  title: string;
  content: string;
  createdBy: { id: string; name: string | null };
  updatedBy: { id: string; name: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

const SECTION_TYPES = ["HERO", "ABOUT", "PHOTO", "MAP", "CONTACT"] as const;
const STATUS_FILTERS = ["ALL", "DRAFT", "REVIEW", "PUBLISHED", "ARCHIVED"] as const;

const STATUS_TRANSITIONS: Record<string, { next: string; label: string }[]> = {
  DRAFT: [{ next: "REVIEW", label: "Submit for Review" }],
  REVIEW: [
    { next: "PUBLISHED", label: "Publish" },
    { next: "DRAFT", label: "Reject to Draft" },
  ],
  PUBLISHED: [{ next: "ARCHIVED", label: "Archive" }],
  ARCHIVED: [{ next: "DRAFT", label: "Re-draft" }],
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-200 text-gray-700",
  REVIEW: "bg-yellow-200 text-yellow-800",
  PUBLISHED: "bg-green-200 text-green-800",
  ARCHIVED: "bg-red-200 text-red-700",
};

const CONTENT_TEMPLATES: Record<string, object> = {
  HERO: { subheading: "", backgroundImageUrl: "", ctaText: "", ctaLink: "" },
  ABOUT: { body: "" },
  PHOTO: { images: [{ url: "", alt: "", caption: "" }] },
  MAP: { latitude: 0, longitude: 0, zoom: 14, address: "" },
  CONTACT: { email: "", phone: "", address: "", formEnabled: false },
};

export default function ContentPage() {
  const { data: session } = useSession();
  const t = useTranslations("settings");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState("");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [sections, setSections] = useState<ContentSection[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ type: "HERO" as string, title: "", content: "{}" });
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const role = (session?.user as any)?.role;

  useEffect(() => {
    // Platform admins only reach this page while impersonating; the layout
    // enforces this. The legacy tenant-picker UI is therefore disabled.
    void role;
    setIsPlatformAdmin(false);
  }, [role]);

  function loadSections(tenantId?: string) {
    const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
    fetch(`/api/content${qs}`)
      .then((r) => r.json())
      .then((d) => setSections(Array.isArray(d) ? d : []))
      .catch(() => {});
  }

  useEffect(() => { loadSections(selectedTenant || undefined); }, [selectedTenant]);

  function flash(msg: string) {
    setSuccessMsg(msg);
    setErrorMsg("");
    setTimeout(() => setSuccessMsg(""), 3000);
  }

  function flashError(msg: string) {
    setErrorMsg(msg);
    setSuccessMsg("");
  }

  function openCreate() {
    setEditingId(null);
    setForm({ type: "HERO", title: "", content: JSON.stringify(CONTENT_TEMPLATES.HERO, null, 2) });
    setShowForm(true);
  }

  function openEdit(s: ContentSection) {
    setEditingId(s.id);
    let prettyContent = s.content;
    try { prettyContent = JSON.stringify(JSON.parse(s.content), null, 2); } catch {}
    setForm({ type: s.type, title: s.title, content: prettyContent });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";

    if (!form.title.trim()) { flashError(t("content.titleRequired")); return; }

    let contentObj: object;
    try { contentObj = JSON.parse(form.content); } catch { flashError(t("content.contentMustBeJson")); return; }

    if (editingId) {
      const res = await fetch(`/api/content/${editingId}${qs}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: form.title, content: contentObj }),
      });
      if (res.ok) { flash("Section updated"); setShowForm(false); loadSections(selectedTenant || undefined); return; }
      const d = await res.json().catch(() => ({}));
      flashError(d.error ?? `Failed to update section (${res.status})`);
    } else {
      const res = await fetch(`/api/content${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: form.type, title: form.title, content: contentObj }),
      });
      if (res.ok) { flash("Section created"); setShowForm(false); loadSections(selectedTenant || undefined); return; }
      const d = await res.json().catch(() => ({}));
      flashError(d.error ?? `Failed to create section (${res.status})`);
    }
  }

  async function transitionStatus(id: string, newStatus: string) {
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const res = await fetch(`/api/content/${id}${qs}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) { flash(`Status → ${newStatus}`); loadSections(selectedTenant || undefined); return; }
    const d = await res.json().catch(() => ({}));
    flashError(d.error ?? `Failed to change status (${res.status})`);
  }

  async function toggleEnabled(id: string, current: boolean) {
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const res = await fetch(`/api/content/${id}${qs}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !current }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      flashError(d.error ?? `Failed to toggle visibility (${res.status})`);
      return;
    }
    loadSections(selectedTenant || undefined);
  }

  async function moveOrder(id: string, direction: "up" | "down") {
    const idx = filtered.findIndex((s) => s.id === id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= filtered.length) return;

    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const a = filtered[idx];
    const b = filtered[swapIdx];

    await Promise.all([
      fetch(`/api/content/${a.id}${qs}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: b.order }) }),
      fetch(`/api/content/${b.id}${qs}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: a.order }) }),
    ]);
    loadSections(selectedTenant || undefined);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this section?")) return;
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const res = await fetch(`/api/content/${id}${qs}`, { method: "DELETE" });
    if (res.ok) { flash("Section removed"); loadSections(selectedTenant || undefined); return; }
    const d = await res.json().catch(() => ({}));
    flashError(d.error ?? `Failed to delete section (${res.status})`);
  }

  const filtered = filter === "ALL" ? sections : sections.filter((s) => s.status === filter);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4 flex items-center gap-2">{t("content.title")} <HelpHint slug="edit-landing-page" /></h1>
      {errorMsg && <div className="mb-4 rounded bg-red-100 text-red-800 px-4 py-2" role="alert">{errorMsg}</div>}
      {successMsg && <div className="mb-4 rounded bg-green-100 text-green-800 px-4 py-2">{successMsg}</div>}

      {isPlatformAdmin && (
        <div className="mb-4">
          <label className="text-sm font-medium mr-2">Tenant:</label>
          <select value={selectedTenant} onChange={(e) => setSelectedTenant(e.target.value)} className="border rounded px-2 py-1">
            <option value="">— My Tenant —</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-sm font-medium ${filter === f ? "bg-green-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            {f} {f !== "ALL" ? `(${sections.filter((s) => s.status === f).length})` : `(${sections.length})`}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={openCreate} className="rounded bg-green-600 text-white px-4 py-2 hover:bg-green-700">
          {t("content.newSection")}
        </button>
        <Link href="/dashboard/content/preview" className="rounded border border-green-600 text-green-700 px-4 py-2 hover:bg-green-50 inline-flex items-center gap-1">
          {t("content.previewPage")}
        </Link>
      </div>

      {/* Create / Edit form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 border rounded p-4 bg-gray-50 space-y-3">
          <h2 className="font-semibold text-lg">{editingId ? t("content.editSectionTitle") : t("content.newSectionTitle")}</h2>

          {!editingId && (
            <div>
              <label className="block text-sm font-medium mb-1">{t("content.typeLabel")}</label>
              <select
                value={form.type}
                onChange={(e) => {
                  const t = e.target.value;
                  setForm({ ...form, type: t, content: JSON.stringify(CONTENT_TEMPLATES[t] ?? {}, null, 2) });
                }}
                className="border rounded px-2 py-1 w-full"
              >
                {SECTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">{t("content.titleLabel")}</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="border rounded px-2 py-1 w-full" required />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">{t("content.contentJsonLabel")}</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={8}
              className="border rounded px-2 py-1 w-full font-mono text-sm"
            />
          </div>

          <div className="flex gap-2">
            <button type="submit" className="rounded bg-green-600 text-white px-4 py-2 hover:bg-green-700">
              {editingId ? t("content.saveChanges") : t("content.create")}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded border px-4 py-2 hover:bg-gray-100">
              {t("content.cancel")}
            </button>
          </div>
        </form>
      )}

      {/* Sections table */}
      {filtered.length === 0 ? (
        <p className="text-gray-500">{t("content.noSections")}</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((s, idx) => (
            <div key={s.id} className="border rounded p-4 flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${STATUS_COLORS[s.status] ?? ""}`}>{s.status}</span>
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{s.type}</span>
                <span className="font-medium flex-1">{s.title}</span>
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={s.enabled} onChange={() => toggleEnabled(s.id, s.enabled)} />
                  {t("content.visible")}
                </label>
              </div>

              <div className="flex items-center gap-2 text-sm">
                {/* Order controls */}
                <button onClick={() => moveOrder(s.id, "up")} disabled={idx === 0} className="px-2 py-0.5 border rounded disabled:opacity-30">↑</button>
                <button onClick={() => moveOrder(s.id, "down")} disabled={idx === filtered.length - 1} className="px-2 py-0.5 border rounded disabled:opacity-30">↓</button>
                <span className="text-gray-400 text-xs">order: {s.order}</span>

                {/* Status transitions */}
                {(STATUS_TRANSITIONS[s.status] ?? []).map((t) => (
                  <button
                    key={t.next}
                    onClick={() => transitionStatus(s.id, t.next)}
                    className="px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 text-xs"
                  >
                    {t.label}
                  </button>
                ))}

                <button onClick={() => openEdit(s)} className="px-2 py-0.5 rounded border hover:bg-gray-100 text-xs">Edit</button>
                <button onClick={() => handleDelete(s.id)} className="px-2 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50 text-xs">Delete</button>
              </div>

              <details className="text-xs text-gray-500">
                <summary className="cursor-pointer">Content JSON</summary>
                <pre className="mt-1 bg-gray-100 p-2 rounded overflow-x-auto">{(() => { try { return JSON.stringify(JSON.parse(s.content), null, 2); } catch { return s.content; } })()}</pre>
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
