"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import HelpHint from "@/components/help/HelpHint";

type Tenant = { id: string; name: string; slug: string };
type Rink = { id: string; name: string; greenId: string };
type GreenSeason = { id: string; year: number; startDate: string; endDate: string; note: string | null };
type Green = {
  id: string; name: string; tenantId: string;
  allWeather: boolean; seasonStartMMDD: string | null; seasonEndMMDD: string | null;
  rinks: Rink[]; seasons: GreenSeason[];
};

export default function GreensPage() {
  const { data: session } = useSession();
  const t = useTranslations("settings");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState("");
  const [greens, setGreens] = useState<Green[]>([]);
  const [newGreenName, setNewGreenName] = useState("");
  const [newGreenAllWeather, setNewGreenAllWeather] = useState(false);
  const [newGreenSeasonStart, setNewGreenSeasonStart] = useState("04-01");
  const [newGreenSeasonEnd, setNewGreenSeasonEnd] = useState("09-30");
  const [newRinkNames, setNewRinkNames] = useState<Record<string, string>>({});
  const [editingGreen, setEditingGreen] = useState<string | null>(null);
  const [editGreenName, setEditGreenName] = useState("");
  const [editingRink, setEditingRink] = useState<string | null>(null);
  const [editRinkName, setEditRinkName] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [seasonFormGreen, setSeasonFormGreen] = useState<string | null>(null);
  const [seasonYear, setSeasonYear] = useState(new Date().getFullYear() + 1);
  const [seasonStart, setSeasonStart] = useState("");
  const [seasonEnd, setSeasonEnd] = useState("");
  const [seasonNote, setSeasonNote] = useState("");

  const isPlatformAdmin = false; // platform admins only reach this page while impersonating; layout enforces this
  void session;

  // Fetch tenant list for platform admins
  useEffect(() => {
    if (!isPlatformAdmin) return;
    fetch("/api/admin/tenants")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (Array.isArray(data)) setTenants(data); })
      .catch(() => {});
  }, [isPlatformAdmin]);

  function loadGreens(tenantId?: string) {
    const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
    fetch(`/api/admin/greens${qs}`)
      .then((r) => r.json())
      .then((d) => setGreens(Array.isArray(d) ? d : []))
      .catch(() => {});
  }

  useEffect(() => {
    if (isPlatformAdmin && !selectedTenant) { setGreens([]); return; }
    loadGreens(selectedTenant || undefined);
  }, [selectedTenant, isPlatformAdmin]);

  function flash(msg: string, isError = false) {
    if (isError) { setErrorMsg(msg); setSuccessMsg(""); }
    else { setSuccessMsg(msg); setErrorMsg(""); }
  }

  // ── Create green ──
  async function handleCreateGreen(e: React.FormEvent) {
    e.preventDefault();
    if (!newGreenName.trim()) return;
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const res = await fetch(`/api/admin/greens${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newGreenName.trim(),
        allWeather: newGreenAllWeather,
        seasonStartMMDD: newGreenAllWeather ? null : newGreenSeasonStart || null,
        seasonEndMMDD: newGreenAllWeather ? null : newGreenSeasonEnd || null,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      flash(d.error ?? "Failed to create green", true);
      return;
    }
    setNewGreenName("");
    setNewGreenAllWeather(false);
    setNewGreenSeasonStart("04-01");
    setNewGreenSeasonEnd("09-30");
    flash(t("greens.greenCreated"));
    loadGreens(selectedTenant || undefined);
  }

  // ── Rename green ──
  async function handleRenameGreen(greenId: string) {
    if (!editGreenName.trim()) return;
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const res = await fetch(`/api/admin/greens/${greenId}${qs}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editGreenName.trim() }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      flash(d.error ?? "Failed to rename green", true);
      return;
    }
    setEditingGreen(null);
    flash(t("greens.greenRenamed"));
    loadGreens(selectedTenant || undefined);
  }

  // ── Toggle all-weather ──
  async function handleToggleAllWeather(g: Green) {
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const res = await fetch(`/api/admin/greens/${g.id}${qs}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allWeather: !g.allWeather }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      flash(d.error ?? "Failed to update green", true);
      return;
    }
    flash(g.allWeather ? t("greens.seasonalModeEnabled") : t("greens.allWeatherModeEnabled"));
    loadGreens(selectedTenant || undefined);
  }

  // ── Update season dates ──
  async function handleUpdateSeasonDates(greenId: string, startMMDD: string, endMMDD: string) {
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const res = await fetch(`/api/admin/greens/${greenId}${qs}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seasonStartMMDD: startMMDD, seasonEndMMDD: endMMDD }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      flash(d.error ?? "Failed to update season dates", true);
      return;
    }
    flash(t("greens.seasonDatesUpdated"));
    loadGreens(selectedTenant || undefined);
  }

  // ── Add season override ──
  async function handleAddSeason(greenId: string) {
    if (!seasonStart || !seasonEnd) { flash("Start and end dates required", true); return; }
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const res = await fetch(`/api/admin/greens/${greenId}/seasons${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: seasonYear, startDate: seasonStart, endDate: seasonEnd, note: seasonNote || null }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      flash(d.error ?? "Failed to add season override", true);
      return;
    }
    setSeasonFormGreen(null);
    setSeasonStart(""); setSeasonEnd(""); setSeasonNote("");
    flash(`Season override for ${seasonYear} added.`);
    loadGreens(selectedTenant || undefined);
  }

  // ── Delete season override ──
  async function handleDeleteSeason(greenId: string, year: number) {
    if (!confirm(`Remove the ${year} season override?`)) return;
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const res = await fetch(`/api/admin/greens/${greenId}/seasons${qs}&year=${year}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      flash(d.error ?? "Failed to delete season override", true);
      return;
    }
    flash(`Season override for ${year} removed.`);
    loadGreens(selectedTenant || undefined);
  }

  // ── Delete green ──
  async function handleDeleteGreen(greenId: string, greenName: string) {
    if (!confirm(t("greens.deleteConfirm", { name: greenName }))) return;
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const res = await fetch(`/api/admin/greens/${greenId}${qs}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      flash(d.error ?? "Failed to delete green", true);
      return;
    }
    flash(t("greens.greenDeleted"));
    loadGreens(selectedTenant || undefined);
  }

  // ── Add rink ──
  async function handleAddRink(e: React.FormEvent, greenId: string) {
    e.preventDefault();
    const name = newRinkNames[greenId]?.trim();
    if (!name) return;
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const res = await fetch(`/api/admin/greens/${greenId}/rinks${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      flash(d.error ?? "Failed to add rink", true);
      return;
    }
    setNewRinkNames((prev) => ({ ...prev, [greenId]: "" }));
    flash(t("greens.rinkAdded"));
    loadGreens(selectedTenant || undefined);
  }

  // ── Rename rink ──
  async function handleRenameRink(greenId: string, rinkId: string) {
    if (!editRinkName.trim()) return;
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const res = await fetch(`/api/admin/greens/${greenId}/rinks/${rinkId}${qs}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editRinkName.trim() }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      flash(d.error ?? "Failed to rename rink", true);
      return;
    }
    setEditingRink(null);
    flash(t("greens.rinkRenamed"));
    loadGreens(selectedTenant || undefined);
  }

  // ── Delete rink ──
  async function handleDeleteRink(greenId: string, rinkId: string, rinkName: string) {
    if (!confirm(`Delete rink "${rinkName}"? This cannot be undone.`)) return;
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    const res = await fetch(`/api/admin/greens/${greenId}/rinks/${rinkId}${qs}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      flash(d.error ?? "Failed to delete rink", true);
      return;
    }
    flash(t("greens.rinkDeleted"));
    loadGreens(selectedTenant || undefined);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">{t("greens.title")} <HelpHint slug="configure-greens" /></h1>

      {errorMsg && <p className="text-red-600 text-sm rounded bg-red-50 border border-red-200 px-4 py-2">{errorMsg}</p>}
      {successMsg && <p className="text-green-600 text-sm rounded bg-green-50 border border-green-200 px-4 py-2">{successMsg}</p>}

      {isPlatformAdmin && (
        <div>
          <label className="text-sm font-medium text-gray-700 mr-2">{t("greens.tenantLabel")}</label>
          <select
            value={selectedTenant}
            onChange={(e) => setSelectedTenant(e.target.value)}
            className="rounded border p-2 text-sm"
          >
            <option value="">{t("greens.selectClub")}</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name} (/{t.slug})</option>
            ))}
          </select>
        </div>
      )}

      {isPlatformAdmin && !selectedTenant ? (
        <p className="text-gray-400">{t("greens.selectTenantPrompt")}</p>
      ) : (
        <>
          {/* Add green form */}
          <form onSubmit={handleCreateGreen} className="rounded-xl bg-white p-6 shadow space-y-3">
            <h2 className="font-semibold">{t("greens.addGreenTitle")}</h2>
            <div className="flex gap-3">
              <input
                placeholder={t("greens.greenNamePlaceholder")}
                value={newGreenName}
                onChange={(e) => setNewGreenName(e.target.value)}
                className="flex-1 rounded border p-2"
                required
              />
              <button type="submit" className="rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700">{t("greens.addGreenButton")}</button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={newGreenAllWeather} onChange={(e) => setNewGreenAllWeather(e.target.checked)} />
              {t("greens.allWeatherLabel")}
            </label>
            {!newGreenAllWeather && (
              <div className="flex gap-3 items-center text-sm">
                <label>{t("greens.seasonLabel")}
                  <input type="text" placeholder={t("greens.seasonPlaceholder")} value={newGreenSeasonStart} onChange={(e) => setNewGreenSeasonStart(e.target.value)}
                    className="ml-1 w-20 rounded border p-1 text-sm" maxLength={5} />
                </label>
                <span>{t("greens.seasonTo")}</span>
                <input type="text" placeholder={t("greens.seasonPlaceholder")} value={newGreenSeasonEnd} onChange={(e) => setNewGreenSeasonEnd(e.target.value)}
                  className="w-20 rounded border p-1 text-sm" maxLength={5} />
              </div>
            )}
          </form>

          {/* Greens list */}
          <div className="space-y-4">
            {greens.map((g) => (
              <div key={g.id} className="rounded-xl border bg-white p-5 shadow-sm">
                {/* Green header */}
                <div className="flex items-center justify-between">
                  {editingGreen === g.id ? (
                    <div className="flex gap-2 flex-1 mr-2">
                      <input
                        value={editGreenName}
                        onChange={(e) => setEditGreenName(e.target.value)}
                        className="flex-1 rounded border p-1 text-sm"
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Escape") setEditingGreen(null); }}
                      />
                      <button onClick={() => handleRenameGreen(g.id)} className="rounded bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700">Save</button>
                      <button onClick={() => setEditingGreen(null)} className="rounded bg-gray-300 px-3 py-1 text-xs hover:bg-gray-400">Cancel</button>
                    </div>
                  ) : (
                    <h3 className="font-semibold text-lg">{g.name}</h3>
                  )}
                  <div className="flex gap-2">
                    {g.allWeather ? (
                      <span className="text-xs bg-cyan-100 text-cyan-700 px-2 py-0.5 rounded">{t("greens.allWeatherBadge")}</span>
                    ) : g.seasonStartMMDD && g.seasonEndMMDD ? (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">
                        Season: {g.seasonStartMMDD} – {g.seasonEndMMDD}
                      </span>
                    ) : null}
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                      {t("greens.rinkCount", { count: g.rinks.length })}
                    </span>
                    {editingGreen !== g.id && (
                      <>
                        <button
                          onClick={() => { setEditingGreen(g.id); setEditGreenName(g.name); }}
                          className="rounded bg-gray-200 px-3 py-1 text-xs hover:bg-gray-300"
                        >{t("greens.rename")}</button>
                        <button
                          onClick={() => handleDeleteGreen(g.id, g.name)}
                          className="rounded bg-red-100 text-red-700 px-3 py-1 text-xs hover:bg-red-200"
                        >{t("greens.delete")}</button>
                      </>
                    )}
                  </div>
                </div>

                {/* Season controls */}
                <div className="mt-3 rounded border border-gray-100 bg-gray-50 p-3 space-y-2 text-sm">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={g.allWeather} onChange={() => handleToggleAllWeather(g)} />
                      {t("greens.allWeatherLabel")}
                    </label>
                  </div>
                  {!g.allWeather && (
                    <div className="flex gap-2 items-center">
                      <span className="text-gray-500">{t("greens.defaultSeason")}</span>
                      <input type="text" placeholder={t("greens.seasonPlaceholder")} defaultValue={g.seasonStartMMDD ?? ""} maxLength={5}
                        className="w-20 rounded border p-1 text-sm"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== g.seasonStartMMDD) handleUpdateSeasonDates(g.id, v, g.seasonEndMMDD ?? "");
                        }} />
                      <span>{t("greens.seasonTo")}</span>
                      <input type="text" placeholder={t("greens.seasonPlaceholder")} defaultValue={g.seasonEndMMDD ?? ""} maxLength={5}
                        className="w-20 rounded border p-1 text-sm"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== g.seasonEndMMDD) handleUpdateSeasonDates(g.id, g.seasonStartMMDD ?? "", v);
                        }} />
                    </div>
                  )}
                  {/* Season overrides */}
                  {g.seasons.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-gray-500">{t("greens.seasonOverrides")}</span>
                      {g.seasons.map((s) => (
                        <div key={s.id} className="flex items-center gap-2 text-xs">
                          <span className="font-medium">{s.year}:</span>
                          <span>{s.startDate} – {s.endDate}</span>
                          {s.note && <span className="text-gray-400">({s.note})</span>}
                          <button onClick={() => handleDeleteSeason(g.id, s.year)} className="text-red-500 hover:underline">{t("greens.removeOverride")}</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {seasonFormGreen === g.id ? (
                    <div className="flex gap-2 items-end flex-wrap">
                      <label className="text-xs">Year:
                        <input type="number" value={seasonYear} onChange={(e) => setSeasonYear(+e.target.value)}
                          className="ml-1 w-20 rounded border p-1 text-sm" />
                      </label>
                      <label className="text-xs">Start:
                        <input type="date" value={seasonStart} onChange={(e) => setSeasonStart(e.target.value)}
                          className="ml-1 rounded border p-1 text-sm" />
                      </label>
                      <label className="text-xs">End:
                        <input type="date" value={seasonEnd} onChange={(e) => setSeasonEnd(e.target.value)}
                          className="ml-1 rounded border p-1 text-sm" />
                      </label>
                      <input type="text" placeholder="Note (optional)" value={seasonNote} onChange={(e) => setSeasonNote(e.target.value)}
                        className="rounded border p-1 text-sm flex-1" />
                      <button onClick={() => handleAddSeason(g.id)} className="rounded bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700">Save</button>
                      <button onClick={() => setSeasonFormGreen(null)} className="rounded bg-gray-300 px-3 py-1 text-xs hover:bg-gray-400">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => { setSeasonFormGreen(g.id); setSeasonYear(new Date().getFullYear() + 1); }}
                      className="text-xs text-green-700 hover:underline">{t("greens.addSeasonOverride")}</button>
                  )}
                </div>

                {/* Rinks list */}
                <div className="mt-3 space-y-2">
                  {g.rinks.map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded border px-3 py-2">
                      {editingRink === r.id ? (
                        <div className="flex gap-2 flex-1 mr-2">
                          <input
                            value={editRinkName}
                            onChange={(e) => setEditRinkName(e.target.value)}
                            className="flex-1 rounded border p-1 text-sm"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === "Escape") setEditingRink(null); }}
                          />
                          <button onClick={() => handleRenameRink(g.id, r.id)} className="rounded bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700">Save</button>
                          <button onClick={() => setEditingRink(null)} className="rounded bg-gray-300 px-3 py-1 text-xs hover:bg-gray-400">Cancel</button>
                        </div>
                      ) : (
                        <span className="text-sm">{r.name}</span>
                      )}
                      {editingRink !== r.id && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => { setEditingRink(r.id); setEditRinkName(r.name); }}
                            className="rounded bg-gray-200 px-2 py-1 text-xs hover:bg-gray-300"
                          >Rename</button>
                          <button
                            onClick={() => handleDeleteRink(g.id, r.id, r.name)}
                            className="rounded bg-red-100 text-red-700 px-2 py-1 text-xs hover:bg-red-200"
                          >Delete</button>
                        </div>
                      )}
                    </div>
                  ))}
                  {g.rinks.length === 0 && <p className="text-xs text-gray-400">No rinks yet.</p>}
                </div>

                {/* Add rink form */}
                <form onSubmit={(e) => handleAddRink(e, g.id)} className="mt-3 flex gap-2">
                  <input
                    placeholder="New rink name…"
                    value={newRinkNames[g.id] || ""}
                    onChange={(e) => setNewRinkNames((prev) => ({ ...prev, [g.id]: e.target.value }))}
                    className="flex-1 rounded border px-2 py-1 text-sm"
                  />
                  <button type="submit" className="rounded bg-gray-700 px-3 py-1 text-xs text-white hover:bg-gray-800">Add Rink</button>
                </form>
              </div>
            ))}
            {greens.length === 0 && <p className="text-gray-400">No greens yet. Add one above.</p>}
          </div>
        </>
      )}
    </div>
  );
}
