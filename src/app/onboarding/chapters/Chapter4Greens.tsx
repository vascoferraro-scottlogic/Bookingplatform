"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { ChapterShell, Field, inputClass } from "./shared";
import type { ChapterProps } from "./shared";

type Green = { id: string; name: string; allWeather: boolean; seasonStartMMDD: string | null; seasonEndMMDD: string | null; rinks: { id: string; name: string }[] };

export default function Chapter4Greens({ onAdvance }: ChapterProps) {
  const t = useTranslations("onboarding");
  const [greens, setGreens] = useState<Green[]>([]);
  const [newName, setNewName] = useState("");
  const [newRinkCount, setNewRinkCount] = useState(6);
  const [newAllWeather, setNewAllWeather] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/greens");
    if (res.ok) setGreens(await res.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  const addGreen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    const rinks = Array.from({ length: newRinkCount }, (_, i) => ({ name: `Rink ${i + 1}` }));
    await fetch("/api/admin/greens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), rinks, allWeather: newAllWeather }),
    });
    setNewName("");
    setNewRinkCount(6);
    setNewAllWeather(false);
    setBusy(false);
    await load();
  };

  const removeGreen = async (id: string) => {
    if (!confirm("Remove this green?")) return;
    await fetch(`/api/admin/greens/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <ChapterShell
      title={t("chapters.greens")}
      intro="Add each playing green and how many rinks it has. You can rename or remove them later."
      onSubmit={(e) => { e.preventDefault(); onAdvance(); }}
      submitLabel={greens.length > 0 ? "Done — continue" : "Continue without greens"}
    >
      {greens.length > 0 && (
        <ul className="space-y-2">
          {greens.map((g) => (
            <li key={g.id} className="flex items-center justify-between bg-gray-50 rounded p-3 border border-gray-200">
              <div>
                <span className="font-medium">{g.name}</span>
                <span className="text-sm text-gray-500 ml-2">{g.rinks.length} rink{g.rinks.length === 1 ? "" : "s"}</span>
                {g.allWeather && <span className="text-xs bg-cyan-100 text-cyan-700 px-1.5 py-0.5 rounded ml-2">All weather</span>}
                {!g.allWeather && g.seasonStartMMDD && (
                  <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded ml-2">
                    Season: {g.seasonStartMMDD} – {g.seasonEndMMDD}
                  </span>
                )}
              </div>
              <button type="button" onClick={() => removeGreen(g.id)} className="text-sm text-red-600 hover:text-red-700">Remove</button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t pt-4 space-y-3">
        <p className="text-sm font-medium text-gray-800">Add a green</p>
        <Field label="Green name">
          <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Top green" />
        </Field>
        <Field label="Number of rinks">
          <input type="number" min={1} max={12} className={inputClass} value={newRinkCount} onChange={(e) => setNewRinkCount(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={newAllWeather} onChange={(e) => setNewAllWeather(e.target.checked)} />
          All-weather surface (open year-round)
        </label>
        <button
          type="button"
          onClick={addGreen}
          disabled={busy || !newName.trim()}
          className="px-4 py-2 rounded-md border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add green"}
        </button>
      </div>
    </ChapterShell>
  );
}
