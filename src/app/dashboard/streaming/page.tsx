"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useTrack } from "@/components/TrackingProvider";

type StreamSession = {
  id: string;
  title: string;
  status: "IDLE" | "LIVE" | "ENDED" | "ARCHIVED";
  visibility: "MEMBERS_ONLY" | "PUBLIC";
  streamKey: string;
  rink: { name: string; green: { name: string } };
  event: { id: string; title: string } | null;
  createdBy: { id: string; name: string | null };
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  _count: { viewers: number };
};

type Rink = { id: string; name: string; greenId: string };
type Green = { id: string; name: string; rinks: Rink[] };

export default function StreamingPage() {
  const t = useTranslations("streaming");
  const { trackFeature } = useTrack();
  const [streams, setStreams] = useState<StreamSession[]>([]);
  const [greens, setGreens] = useState<Green[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: "", rinkId: "", visibility: "MEMBERS_ONLY" });
  const [error, setError] = useState("");

  useEffect(() => { trackFeature("streaming", "page_view"); }, [trackFeature]);

  useEffect(() => {
    fetchStreams();
    fetchGreens();
  }, []);

  async function fetchStreams() {
    const res = await fetch("/api/streaming");
    if (res.ok) setStreams(await res.json());
    setLoading(false);
  }

  async function fetchGreens() {
    const res = await fetch("/api/bookings/greens");
    if (res.ok) setGreens(await res.json());
  }

  async function createStream(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/streaming", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || t("failedCreate"));
      return;
    }
    setShowCreate(false);
    setForm({ title: "", rinkId: "", visibility: "MEMBERS_ONLY" });
    fetchStreams();
  }

  async function startStream(id: string) {
    const res = await fetch(`/api/streaming/${id}/start`, { method: "POST" });
    if (res.ok) fetchStreams();
    else {
      const data = await res.json();
      alert(data.error || t("failedStart"));
    }
  }

  async function stopStream(id: string) {
    if (!confirm(t("stopConfirm"))) return;
    const res = await fetch(`/api/streaming/${id}/stop`, { method: "POST" });
    if (res.ok) fetchStreams();
  }

  async function deleteStream(id: string) {
    if (!confirm(t("deleteConfirm"))) return;
    const res = await fetch(`/api/streaming/${id}`, { method: "DELETE" });
    if (res.ok) fetchStreams();
  }

  const statusColor = (status: string) => {
    switch (status) {
      case "LIVE": return "bg-red-500 text-white";
      case "IDLE": return "bg-yellow-100 text-yellow-800";
      case "ENDED": return "bg-gray-100 text-gray-800";
      case "ARCHIVED": return "bg-blue-100 text-blue-800";
      default: return "bg-gray-100";
    }
  };

  if (loading) return <div className="p-6">{t("loading")}</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
        >
          {showCreate ? t("cancel") : t("newStream")}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={createStream} className="border p-4 rounded mb-6 space-y-3">
          <h2 className="font-semibold">{t("createTitle")}</h2>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <input
            type="text"
            placeholder={t("streamTitlePlaceholder")}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full border rounded px-3 py-2"
            required
          />
          <select
            value={form.rinkId}
            onChange={(e) => setForm({ ...form, rinkId: e.target.value })}
            className="w-full border rounded px-3 py-2"
            required
          >
            <option value="">{t("selectRinkPlaceholder")}</option>
            {greens.map((g) =>
              g.rinks.map((r) => (
                <option key={r.id} value={r.id}>
                  {g.name} — {r.name}
                </option>
              ))
            )}
          </select>
          <select
            value={form.visibility}
            onChange={(e) => setForm({ ...form, visibility: e.target.value })}
            className="w-full border rounded px-3 py-2"
          >
            <option value="MEMBERS_ONLY">{t("visibilityMembersOnly")}</option>
            <option value="PUBLIC">{t("visibilityPublic")}</option>
          </select>
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
            {t("create")}
          </button>
        </form>
      )}

      {streams.length === 0 ? (
        <p className="text-gray-500">{t("noStreams")}</p>
      ) : (
        <div className="space-y-3">
          {streams.map((stream) => (
            <div key={stream.id} className="border rounded p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{stream.title}</h3>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(stream.status)}`}>
                    {stream.status}
                  </span>
                  <span className="text-xs text-gray-500">
                    {stream.visibility === "PUBLIC" ? t("publicBadge") : t("membersBadge")}
                  </span>
                </div>
                <p className="text-sm text-gray-600">
                  {stream.rink.green.name} — {stream.rink.name}
                  {stream.event && ` • ${stream.event.title}`}
                </p>
                {stream.status === "LIVE" && (
                  <p className="text-sm text-red-600">
                    {t("watchingCount", { count: stream._count.viewers })}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {stream.status === "IDLE" && (
                  <>
                    <a href={`/dashboard/streaming/${stream.id}`} className="text-blue-600 text-sm hover:underline">
                      {t("manage")}
                    </a>
                    <button onClick={() => startStream(stream.id)} className="bg-red-500 text-white text-sm px-3 py-1 rounded">
                      {t("goLive")}
                    </button>
                    <button onClick={() => deleteStream(stream.id)} className="text-red-400 text-sm hover:underline">
                      {t("delete")}
                    </button>
                  </>
                )}
                {stream.status === "LIVE" && (
                  <>
                    <a href={`/dashboard/streaming/${stream.id}`} className="text-blue-600 text-sm hover:underline">
                      {t("control")}
                    </a>
                    <button onClick={() => stopStream(stream.id)} className="bg-gray-700 text-white text-sm px-3 py-1 rounded">
                      {t("stop")}
                    </button>
                  </>
                )}
                {(stream.status === "ENDED" || stream.status === "ARCHIVED") && (
                  <>
                    <a href={`/dashboard/streaming/${stream.id}`} className="text-blue-600 text-sm hover:underline">
                      {t("metrics")}
                    </a>
                    <button onClick={() => deleteStream(stream.id)} className="text-red-400 text-sm hover:underline">
                      {t("delete")}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
