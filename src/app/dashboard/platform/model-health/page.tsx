"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine,
} from "recharts";

// ── Types mirroring Prisma output ────────────────────────────────────────────

interface ModelVersion {
  id: string;
  version: string;
  status: string;
  rocAuc: number | null;
  averagePrecision: number | null;
  brier: number | null;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  threshold: number | null;
  rowsTotal: number | null;
  labelRate: number | null;
  trainedAt: string | null;
  promotedAt: string | null;
  featureSet: string | null;
  coefficients: string | null;
}

interface DriftCheck {
  id: string;
  modelVersion: string;
  checkedAt: string;
  sampleCount: number;
  rocAuc: number | null;
  calibrationError: number | null;
  positiveRate: number | null;
  deltaRocAuc: number | null;
  status: "HEALTHY" | "WARN" | "DRIFT";
}

interface Feature {
  key: string;
  label: string;
  kind: string;
  status: "AVAILABLE" | "ENROLLED" | "RETIRED";
  enrolledAt: string | null;
  retiredAt: string | null;
}

interface HealthData {
  activeVersion: ModelVersion | null;
  versionHistory: ModelVersion[];
  latestDriftCheck: DriftCheck | null;
  features: Feature[];
  sidecar: { status: string; modelLoaded: boolean; modelVersion?: string };
}

// ── Small presentational helpers ─────────────────────────────────────────────

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    ACTIVE:   "bg-green-100 text-green-800",
    ARCHIVED: "bg-gray-100 text-gray-600",
    TRAINED:  "bg-blue-100 text-blue-800",
    REJECTED: "bg-red-100 text-red-700",
    FAILED:   "bg-red-100 text-red-700",
    TRAINING: "bg-yellow-100 text-yellow-800",
    HEALTHY:  "bg-green-100 text-green-800",
    WARN:     "bg-yellow-100 text-yellow-800",
    DRIFT:    "bg-red-100 text-red-700",
    ENROLLED: "bg-green-100 text-green-800",
    AVAILABLE:"bg-blue-100 text-blue-800",
    RETIRED:  "bg-gray-100 text-gray-500",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${colours[status] ?? "bg-gray-100"}`}>
      {status}
    </span>
  );
}

function fmt(n: number | null | undefined, dp = 3) {
  if (n == null) return "—";
  return n.toFixed(dp);
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ModelHealthPage() {
  const t = useTranslations("modelops");
  const [data, setData] = useState<HealthData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retraining, setRetraining] = useState(false);
  const [retrainMsg, setRetrainMsg] = useState<string | null>(null);
  const [driftRunning, setDriftRunning] = useState(false);
  const [featureLoading, setFeatureLoading] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    fetch("/api/admin/model/health")
      .then((r) => {
        if (!r.ok) return r.json().then((body) => { throw new Error(body.detail ?? body.error ?? `HTTP ${r.status}`); });
        return r.json();
      })
      .then(setData)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRetrain() {
    setRetraining(true);
    setRetrainMsg(null);
    try {
      const r = await fetch("/api/admin/model/retrain", { method: "POST" });
      const body = await r.json();
      if (r.ok) {
        setRetrainMsg(`Version ${body.version} — ${body.outcome}`);
        load();
      } else {
        setRetrainMsg(`Failed: ${body.error ?? "unknown error"}`);
      }
    } catch {
      setRetrainMsg(t("retrain.failed"));
    } finally {
      setRetraining(false);
    }
  }

  async function handleDriftCheck() {
    setDriftRunning(true);
    try {
      const r = await fetch("/api/admin/model/drift-check", { method: "POST" });
      if (r.ok) load();
    } catch {
      // ignore
    } finally {
      setDriftRunning(false);
    }
  }

  async function handleFeatureAction(key: string, action: "enroll" | "retire") {
    setFeatureLoading(key);
    try {
      const r = await fetch(`/api/admin/model/features/${key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (r.ok) load();
    } catch {
      // ignore
    } finally {
      setFeatureLoading(null);
    }
  }

  if (loading) return <p className="text-gray-500 p-6">{t("loading")}</p>;
  if (loadError) return (
    <div className="p-6">
      <p className="text-red-500 font-semibold">{t("failed")}</p>
      <p className="mt-1 text-xs text-gray-500 font-mono">{loadError}</p>
      <button onClick={load} className="mt-3 text-sm text-blue-600 underline">Retry</button>
    </div>
  );
  if (!data) return <p className="text-red-500 p-6">{t("failed")}</p>;

  const { activeVersion, versionHistory, latestDriftCheck, features, sidecar } = data;

  // Build coefficient data for the importance panel
  const coefData: { name: string; value: number }[] = (() => {
    if (!activeVersion?.coefficients) return [];
    try {
      const obj = JSON.parse(activeVersion.coefficients) as Record<string, number>;
      return Object.entries(obj)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    } catch { return []; }
  })();

  // History metrics for line chart
  const historyChartData = [...versionHistory]
    .filter((v) => v.rocAuc != null)
    .reverse()
    .map((v) => ({ version: v.version, rocAuc: v.rocAuc, f1: v.f1 }));

  const driftStatusColour = latestDriftCheck
    ? { HEALTHY: "#16a34a", WARN: "#ca8a04", DRIFT: "#dc2626" }[latestDriftCheck.status] ?? "#64748b"
    : "#64748b";

  const enrolledCount = features.filter((f) => f.status === "ENROLLED").length;
  const availableCount = features.filter((f) => f.status === "AVAILABLE").length;

  return (
    <div className="space-y-8 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>

        {/* Sidecar status pill */}
        <span className={`text-xs font-semibold px-3 py-1 rounded-full ${sidecar.status === "ok" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>
          {sidecar.status === "ok" ? t("sidecar.online") : t("sidecar.offline")}
          {sidecar.modelLoaded ? ` · ${t("sidecar.modelLoaded")}` : ` · ${t("sidecar.noModel")}`}
        </span>
      </div>

      {/* ── Active model KPIs ────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 mb-3">{t("activeModel.title")}</h2>
        {!activeVersion ? (
          <p className="text-gray-400 text-sm">{t("activeModel.noActive")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <KPI label={t("activeModel.version")} value={activeVersion.version} />
            <KPI label={t("activeModel.rocAuc")} value={fmt(activeVersion.rocAuc)} />
            <KPI label={t("activeModel.f1")} value={fmt(activeVersion.f1)} />
            <KPI label={t("activeModel.recall")} value={fmt(activeVersion.recall)} />
            <KPI label={t("activeModel.precision")} value={fmt(activeVersion.precision)} />
            <KPI label={t("activeModel.rows")} value={String(activeVersion.rowsTotal ?? "—")} sub={`${fmt(activeVersion.labelRate ? activeVersion.labelRate * 100 : null, 1)}% no-shows`} />
            <KPI label={t("activeModel.threshold")} value={fmt(activeVersion.threshold)} sub={t("activeModel.trainedAt") + ": " + fmtDate(activeVersion.trainedAt)} />
          </div>
        )}
      </section>

      {/* ── Retrain ──────────────────────────────────────────────────────── */}
      <section className="flex items-center gap-4">
        <button
          onClick={handleRetrain}
          disabled={retraining}
          className="rounded-lg bg-green-700 px-5 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
        >
          {retraining ? t("retrain.running") : t("retrain.button")}
        </button>
        {retrainMsg && <p className="text-sm text-gray-700">{retrainMsg}</p>}
      </section>

      {/* ── Metric history chart ──────────────────────────────────────────── */}
      {historyChartData.length > 1 && (
        <section className="rounded-xl bg-white p-6 shadow">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">{t("history.title")}</h2>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={historyChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="version" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="rocAuc" stroke="#16a34a" name="ROC-AUC" dot />
              <Line type="monotone" dataKey="f1" stroke="#2563eb" name="F1" dot />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* ── Drift ────────────────────────────────────────────────────────── */}
      <section className="rounded-xl bg-white p-6 shadow space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">{t("drift.title")}</h2>
          <button
            onClick={handleDriftCheck}
            disabled={driftRunning}
            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {driftRunning ? t("drift.running") : t("drift.runCheck")}
          </button>
        </div>
        {!latestDriftCheck ? (
          <p className="text-sm text-gray-400">{t("drift.noChecks")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg p-3 text-center" style={{ background: driftStatusColour + "1a" }}>
              <p className="text-xs text-gray-500">{t("drift.lastCheck")}</p>
              <StatusBadge status={latestDriftCheck.status} />
            </div>
            <KPI label={t("drift.rocAuc")} value={fmt(latestDriftCheck.rocAuc)} sub={latestDriftCheck.deltaRocAuc != null ? `Δ ${latestDriftCheck.deltaRocAuc.toFixed(3)}` : undefined} />
            <KPI label={t("drift.ece")} value={fmt(latestDriftCheck.calibrationError)} />
            <KPI label={t("drift.positiveRate")} value={fmt(latestDriftCheck.positiveRate)} />
            <KPI label={t("drift.samples")} value={String(latestDriftCheck.sampleCount)} sub={fmtDate(latestDriftCheck.checkedAt)} />
          </div>
        )}
      </section>

      {/* ── Feature registry ─────────────────────────────────────────────── */}
      <section className="rounded-xl bg-white p-6 shadow">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">{t("features.title")}</h2>
          <span className="text-xs text-gray-500">
            {t("features.summary", { enrolled: enrolledCount, available: availableCount, retired: features.filter((f) => f.status === "RETIRED").length })}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="py-2 pr-4">{t("features.label")}</th>
                <th className="py-2 pr-4">{t("features.key")}</th>
                <th className="py-2 pr-4">{t("features.kind")}</th>
                <th className="py-2 pr-4">{t("features.status")}</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {features.map((f) => (
                <tr key={f.key} className="border-b hover:bg-gray-50">
                  <td className="py-2 pr-4 font-medium">{f.label}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-gray-500">{f.key}</td>
                  <td className="py-2 pr-4 text-xs">{f.kind}</td>
                  <td className="py-2 pr-4"><StatusBadge status={f.status} /></td>
                  <td className="py-2 flex gap-2">
                    {f.status === "AVAILABLE" && (
                      <button
                        disabled={featureLoading === f.key}
                        onClick={() => handleFeatureAction(f.key, "enroll")}
                        className="rounded px-2 py-1 text-xs bg-green-100 text-green-800 hover:bg-green-200 disabled:opacity-50"
                      >
                        {t("features.enroll")}
                      </button>
                    )}
                    {f.status === "ENROLLED" && (
                      <button
                        disabled={featureLoading === f.key}
                        onClick={() => handleFeatureAction(f.key, "retire")}
                        className="rounded px-2 py-1 text-xs bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        {t("features.retire")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {availableCount > 0 && (
          <p className="mt-2 text-xs text-blue-600">
            ↑ {availableCount} new feature{availableCount > 1 ? "s" : ""} available — enroll and retrain to include.
          </p>
        )}
      </section>

      {/* ── Feature importance ───────────────────────────────────────────── */}
      <section className="rounded-xl bg-white p-6 shadow">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">{t("importance.title")}</h2>
        {coefData.length === 0 ? (
          <p className="text-sm text-gray-400">{t("importance.noData")}</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(200, coefData.length * 28)}>
            <BarChart data={coefData} layout="vertical" margin={{ left: 160 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={155} />
              <Tooltip />
              <ReferenceLine x={0} stroke="#64748b" />
              <Bar dataKey="value" name="Coefficient">
                {coefData.map((entry, i) => (
                  <Cell key={i} fill={entry.value >= 0 ? "#dc2626" : "#2563eb"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        <p className="mt-2 text-xs text-gray-400">Red = raises no-show risk · Blue = lowers no-show risk</p>
      </section>

      {/* ── Version history table ─────────────────────────────────────────── */}
      <section className="rounded-xl bg-white p-6 shadow">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">{t("history.title")}</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="py-2 pr-4">{t("history.version")}</th>
                <th className="py-2 pr-4">{t("history.status")}</th>
                <th className="py-2 pr-4">{t("history.rocAuc")}</th>
                <th className="py-2 pr-4">{t("history.f1")}</th>
                <th className="py-2 pr-4">{t("history.trainedAt")}</th>
                <th className="py-2">{t("history.promotedAt")}</th>
              </tr>
            </thead>
            <tbody>
              {versionHistory.map((v) => (
                <tr key={v.id} className="border-b hover:bg-gray-50">
                  <td className="py-2 pr-4 font-mono">{v.version}</td>
                  <td className="py-2 pr-4"><StatusBadge status={v.status} /></td>
                  <td className="py-2 pr-4">{fmt(v.rocAuc)}</td>
                  <td className="py-2 pr-4">{fmt(v.f1)}</td>
                  <td className="py-2 pr-4 text-xs text-gray-500">{fmtDate(v.trainedAt)}</td>
                  <td className="py-2 text-xs text-gray-500">{fmtDate(v.promotedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
