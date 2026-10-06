"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTrack } from "@/components/TrackingProvider";
import { useTranslations, useLocale } from "next-intl";
import { formatCurrency } from "@/lib/format";

type Tenant = { id: string; name: string; slug: string };

type EventItem = {
  id: string;
  title: string;
  description: string;
  category: string;
  format: string | null;
  playerCount: string | null;
  date: string;
  startTime: string;
  endTime: string | null;
  location: string | null;
  capacity: number | null;
  entryFee: number | null;
  currency: string;
  imageUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  visibility: string;
  status: string;
  tenant: { id: string; name: string; slug: string };
  createdBy: { id: string; name: string | null };
  updatedBy: { id: string; name: string | null } | null;
  createdAt: string;
  updatedAt: string;
};

const CATEGORIES = ["SOCIAL", "COMPETITION", "LEAGUE", "OPEN_DAY", "TOURNAMENT", "OTHER"] as const;
const FORMATS = ["KNOCKOUT", "AMERICAN", "LEAGUE_FORMAT", "CANADIAN", "OTHER_FORMAT"] as const;
const PLAYER_COUNTS = ["SINGLES", "PAIRS", "TRIPLES", "FOURS"] as const;
const STATUS_FILTERS = ["ALL", "DRAFT", "PUBLISHED"] as const;
const COMPETITIVE_CATEGORIES = ["COMPETITION", "TOURNAMENT", "LEAGUE"];

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-200 text-gray-700",
  PUBLISHED: "bg-green-200 text-green-800",
};

const CATEGORY_COLORS: Record<string, string> = {
  SOCIAL: "bg-blue-100 text-blue-700",
  COMPETITION: "bg-red-100 text-red-700",
  LEAGUE: "bg-purple-100 text-purple-700",
  OPEN_DAY: "bg-yellow-100 text-yellow-800",
  TOURNAMENT: "bg-orange-100 text-orange-700",
  OTHER: "bg-gray-100 text-gray-600",
};

const CATEGORY_LABELS: Record<string, string> = {
  SOCIAL: "Social",
  COMPETITION: "Competition",
  LEAGUE: "League",
  OPEN_DAY: "Open Day",
  TOURNAMENT: "Tournament",
  OTHER: "Other",
};

const FORMAT_LABELS: Record<string, string> = {
  KNOCKOUT: "Knockout",
  AMERICAN: "American",
  LEAGUE_FORMAT: "League",
  CANADIAN: "Canadian",
  OTHER_FORMAT: "Other",
};

const PLAYER_COUNT_LABELS: Record<string, string> = {
  SINGLES: "Singles",
  PAIRS: "Pairs",
  TRIPLES: "Triples",
  FOURS: "Fours",
};

function emptyForm() {
  // Default date to today and start time to next round hour from now, so the form
  // never opens with empty `required` time/date inputs (which render a deceptive
  // ghost placeholder like "12:30 PM" that looks like a real value).
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  const startTime = `${String(nextHour.getHours()).padStart(2, "0")}:00`;
  return {
    title: "", description: "", category: "SOCIAL" as string,
    format: "" as string, playerCount: "" as string,
    date: today, startTime, endTime: "",
    location: "", capacity: "" as string, entryFee: "" as string,
    currency: "GBP", imageUrl: "",
    contactName: "", contactEmail: "", contactPhone: "",
    visibility: "MEMBERS_ONLY" as string,
  };
}

export default function EventsPage() {
  const locale = useLocale();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState("");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [externalEvents, setExternalEvents] = useState<EventItem[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [tab, setTab] = useState<"own" | "external">("own");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [successMsg, setSuccessMsg] = useState("");
  const [formError, setFormError] = useState("");
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const acting = (session?.user as any)?.actingAs ?? null;
  const effectiveRole = acting ? acting.role : role;
  const isAdmin = effectiveRole === "TENANT_ADMIN";
  const { trackFeature } = useTrack();
  const t = useTranslations("events");

  useEffect(() => { trackFeature("events.dashboard_opened", "Event"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Platform admins reach this page only while impersonating; layout enforces it.
    void role;
    setIsPlatformAdmin(false);
  }, [role]);

  function loadEvents(tenantId?: string) {
    const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
    fetch(`/api/events${qs}`)
      .then((r) => r.json())
      .then((d) => {
        setEvents(Array.isArray(d.events) ? d.events : []);
        setExternalEvents(Array.isArray(d.externalEvents) ? d.externalEvents : []);
      })
      .catch(() => {});
  }

  useEffect(() => { loadEvents(selectedTenant || undefined); }, [selectedTenant]);

  function flash(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 5000);
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
  }

  function openEdit(e: EventItem) {
    setEditingId(e.id);
    setForm({
      title: e.title,
      description: e.description,
      category: e.category,
      format: e.format ?? "",
      playerCount: e.playerCount ?? "",
      date: e.date,
      startTime: e.startTime,
      endTime: e.endTime ?? "",
      location: e.location ?? "",
      capacity: e.capacity != null ? String(e.capacity) : "",
      entryFee: e.entryFee != null ? String((e.entryFee / 100).toFixed(2)) : "",
      currency: e.currency,
      imageUrl: e.imageUrl ?? "",
      contactName: e.contactName ?? "",
      contactEmail: e.contactEmail ?? "",
      contactPhone: e.contactPhone ?? "",
      visibility: e.visibility,
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");

    if (!form.title.trim()) { setFormError("Title is required"); return; }
    if (!form.description.trim()) { setFormError("Description is required"); return; }
    if (!form.date) { setFormError("Date is required"); return; }
    if (!form.startTime) { setFormError("Start time is required"); return; }
    if (form.endTime && form.startTime && form.endTime <= form.startTime) {
      setFormError("End time must be after start time");
      return;
    }

    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";

    const payload: Record<string, unknown> = {
      title: form.title,
      description: form.description,
      category: form.category,
      format: form.format || null,
      playerCount: form.playerCount || null,
      date: form.date,
      startTime: form.startTime,
      endTime: form.endTime || null,
      location: form.location || null,
      capacity: form.capacity ? Number(form.capacity) : null,
      entryFee: form.entryFee ? Math.round(parseFloat(form.entryFee) * 100) : null,
      currency: form.currency,
      imageUrl: form.imageUrl || null,
      contactName: form.contactName || null,
      contactEmail: form.contactEmail || null,
      contactPhone: form.contactPhone || null,
      visibility: form.visibility,
    };

    if (editingId) {
      const res = await fetch(`/api/events/${editingId}${qs}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) { flash("Event updated"); setShowForm(false); loadEvents(selectedTenant || undefined); }
    } else {
      const res = await fetch(`/api/events${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) { flash("Event created"); setShowForm(false); loadEvents(selectedTenant || undefined); }
    }
  }

  async function transitionStatus(id: string, newStatus: string) {
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const res = await fetch(`/api/events/${id}${qs}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) {
      const label = newStatus === "DRAFT" ? "Event unpublished" : newStatus === "PUBLISHED" ? "Event published" : `Status updated to ${newStatus}`;
      flash(label);
      loadEvents(selectedTenant || undefined);
    } else {
      const data = await res.json().catch(() => ({}));
      setFormError(data.error ?? "Failed to update event status");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this event?")) return;
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const res = await fetch(`/api/events/${id}${qs}`, { method: "DELETE" });
    if (res.ok) { flash("Event removed"); loadEvents(selectedTenant || undefined); }
  }

  function formatFee(pence: number, curr: string) {
    return formatCurrency(pence, locale, curr);
  }

  const filtered = filter === "ALL" ? events : events.filter((e) => e.status === filter);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">{t("title")}</h1>
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

      {/* Tab selector: Own events vs External */}
      {externalEvents.length > 0 && (
        <div className="flex gap-2 mb-4">
          <button onClick={() => setTab("own")} className={`px-3 py-1 rounded text-sm font-medium ${tab === "own" ? "bg-green-600 text-white" : "bg-gray-100 hover:bg-gray-200"}`}>
            My Club Events ({events.length})
          </button>
          <button onClick={() => setTab("external")} className={`px-3 py-1 rounded text-sm font-medium ${tab === "external" ? "bg-green-600 text-white" : "bg-gray-100 hover:bg-gray-200"}`}>
            Other Clubs ({externalEvents.length})
          </button>
        </div>
      )}

      {tab === "own" && (
        <>
          {/* Filter tabs */}
          <div className="flex gap-1 mb-4">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded text-sm font-medium ${filter === f ? "bg-green-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
              >
                {f} {f !== "ALL" ? `(${events.filter((ev) => ev.status === f).length})` : `(${events.length})`}
              </button>
            ))}
          </div>

          {isAdmin && (
            <button onClick={openCreate} className="mb-4 rounded bg-green-600 text-white px-4 py-2 hover:bg-green-700">
              + New Event
            </button>
          )}

          {/* Create / Edit form */}
          {showForm && (
            <form onSubmit={handleSubmit} className="mb-6 border rounded p-4 bg-gray-50 space-y-3">
              <h2 className="font-semibold text-lg">{editingId ? "Edit Event" : "New Event"}</h2>
              {formError && <div className="rounded bg-red-100 text-red-800 px-4 py-2 text-sm">{formError}</div>}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Title *</label>
                  <input value={form.title} onChange={(e) => { setForm({ ...form, title: e.target.value }); setFormError(""); }} className="border rounded px-2 py-1 w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Category *</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="border rounded px-2 py-1 w-full">
                    {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description *</label>
                <textarea value={form.description} onChange={(e) => { setForm({ ...form, description: e.target.value }); setFormError(""); }} rows={3} className="border rounded px-2 py-1 w-full" />
              </div>

              {COMPETITIVE_CATEGORIES.includes(form.category) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Format</label>
                    <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })} className="border rounded px-2 py-1 w-full">
                      <option value="">— None —</option>
                      {FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Players</label>
                    <select value={form.playerCount} onChange={(e) => setForm({ ...form, playerCount: e.target.value })} className="border rounded px-2 py-1 w-full">
                      <option value="">— None —</option>
                      {PLAYER_COUNTS.map((p) => <option key={p} value={p}>{PLAYER_COUNT_LABELS[p]}</option>)}
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Date *</label>
                  <input type="date" value={form.date} onChange={(e) => { setForm({ ...form, date: e.target.value }); setFormError(""); }} className="border rounded px-2 py-1 w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Start Time *</label>
                  <input type="time" value={form.startTime} onChange={(e) => { setForm({ ...form, startTime: e.target.value }); setFormError(""); }} className="border rounded px-2 py-1 w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">End Time <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input type="time" value={form.endTime} onChange={(e) => { setForm({ ...form, endTime: e.target.value }); setFormError(""); }} min={form.startTime || undefined} className="border rounded px-2 py-1 w-full" />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Location</label>
                  <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Club venue" className="border rounded px-2 py-1 w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Capacity</label>
                  <input type="number" min="1" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} className="border rounded px-2 py-1 w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Entry Fee (£)</label>
                  <input type="number" min="0" step="0.01" value={form.entryFee} onChange={(e) => setForm({ ...form, entryFee: e.target.value })} className="border rounded px-2 py-1 w-full" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Image URL</label>
                <input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} type="url" placeholder="https://..." className="border rounded px-2 py-1 w-full" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Contact Name</label>
                  <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} className="border rounded px-2 py-1 w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Contact Email</label>
                  <input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} type="email" className="border rounded px-2 py-1 w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Contact Phone</label>
                  <input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} type="tel" className="border rounded px-2 py-1 w-full" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Visibility</label>
                <select value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })} className="border rounded px-2 py-1">
                  <option value="MEMBERS_ONLY">Members Only</option>
                  <option value="PUBLIC">Public</option>
                </select>
              </div>

              <div className="flex gap-2">
                <button type="submit" className="rounded bg-green-600 text-white px-4 py-2 hover:bg-green-700">
                  {editingId ? "Save Changes" : "Create Event"}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="rounded border px-4 py-2 hover:bg-gray-100">
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Events list */}
          {filtered.length === 0 ? (
            <p className="text-gray-500">No events found.</p>
          ) : (
            <div className="space-y-3">
              {filtered.map((ev) => (
                <div key={ev.id} className="border rounded p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${STATUS_COLORS[ev.status] ?? ""}`}>{ev.status}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${CATEGORY_COLORS[ev.category] ?? ""}`}>{CATEGORY_LABELS[ev.category] ?? ev.category}</span>
                    {ev.visibility === "PUBLIC" && <span className="text-xs font-semibold px-2 py-0.5 rounded bg-teal-100 text-teal-700">Public</span>}
                    {ev.format && <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{FORMAT_LABELS[ev.format]}</span>}
                    {ev.playerCount && <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{PLAYER_COUNT_LABELS[ev.playerCount]}</span>}
                    <span className="font-medium flex-1">{ev.title}</span>
                    <span className="text-sm text-gray-500">{ev.date} {ev.startTime}{ev.endTime ? `–${ev.endTime}` : ""}</span>
                  </div>

                  <p className="text-sm text-gray-600 line-clamp-2">{ev.description}</p>

                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    {ev.capacity != null && <span className="text-xs text-gray-500">Capacity: {ev.capacity}</span>}
                    {ev.entryFee != null && <span className="text-xs text-gray-500">Fee: {formatFee(ev.entryFee, ev.currency)}</span>}
                    {ev.location && <span className="text-xs text-gray-500">📍 {ev.location}</span>}

                    {/* Status transitions */}
                    {isAdmin && ev.status === "DRAFT" && (
                      <button onClick={() => transitionStatus(ev.id, "PUBLISHED")} className="px-2 py-0.5 rounded bg-green-600 text-white hover:bg-green-700 text-xs">
                        Publish
                      </button>
                    )}
                    {isAdmin && ev.status === "PUBLISHED" && (
                      <button onClick={() => transitionStatus(ev.id, "DRAFT")} className="px-2 py-0.5 rounded bg-yellow-600 text-white hover:bg-yellow-700 text-xs">
                        Unpublish
                      </button>
                    )}

                    {isAdmin && <button onClick={() => openEdit(ev)} className="px-2 py-0.5 rounded border hover:bg-gray-100 text-xs">Edit</button>}
                    {isAdmin && <button onClick={() => handleDelete(ev.id)} className="px-2 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50 text-xs">Delete</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* External events tab */}
      {tab === "external" && (
        <div>
          {externalEvents.length === 0 ? (
            <p className="text-gray-500">No external events available.</p>
          ) : (
            <div className="space-y-3">
              {externalEvents.map((ev) => (
                <div key={ev.id} className="border rounded p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${CATEGORY_COLORS[ev.category] ?? ""}`}>{CATEGORY_LABELS[ev.category] ?? ev.category}</span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">{ev.tenant.name}</span>
                    {ev.format && <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{FORMAT_LABELS[ev.format]}</span>}
                    {ev.playerCount && <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{PLAYER_COUNT_LABELS[ev.playerCount]}</span>}
                    <span className="font-medium flex-1">{ev.title}</span>
                    <span className="text-sm text-gray-500">{ev.date} {ev.startTime}{ev.endTime ? `–${ev.endTime}` : ""}</span>
                  </div>
                  <p className="text-sm text-gray-600 line-clamp-2">{ev.description}</p>
                  <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                    {ev.capacity != null && <span>Capacity: {ev.capacity}</span>}
                    {ev.entryFee != null && <span>Fee: {formatFee(ev.entryFee, ev.currency)}</span>}
                    {ev.location && <span>📍 {ev.location}</span>}
                    {ev.contactName && <span>Contact: {ev.contactName}</span>}
                    {ev.contactEmail && <span>{ev.contactEmail}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
