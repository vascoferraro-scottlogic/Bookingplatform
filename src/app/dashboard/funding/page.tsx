"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

type Question = {
  id: string;
  label: string;
  helpText: string | null;
};

type Eligibility = {
  score: number;
  reasons: string[];
};

type TenantApplications = {
  count: number;
  latestStatus: string | null;
  latestApplicationId: string | null;
  lastSubmittedAt: string | null;
  isActive: boolean;
  canApply: boolean;
};

type Cadence = {
  funderIntervalMonths: number | null;
  tenantIntervalMonths: number | null;
  effectiveIntervalMonths: number | null;
  warningMonthsRemaining: number | null;
};

type Opportunity = {
  id: string;
  name: string;
  funder: string;
  description: string;
  deadline: string | null;
  maxAmount: number | null;
  tags: string[];
  tenantId: string | null;
  questions: Question[];
  eligibility: Eligibility;
  tenantApplications: TenantApplications;
  cadence: Cadence;
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-800",
  SUBMITTED: "bg-blue-100 text-blue-800",
  PENDING_DECISION: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  WITHDRAWN: "bg-gray-100 text-gray-600",
};

function formatPence(pence: number): string {
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 0 })}`;
}

function CadenceEditor({
  opportunityId,
  cadence,
  onSaved,
}: {
  opportunityId: string;
  cadence: Cadence;
  onSaved: () => void;
}) {
  const t = useTranslations("funding");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(cadence.tenantIntervalMonths?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    const months = value.trim() === "" ? null : parseInt(value, 10);
    await fetch(`/api/funding/opportunities/${opportunityId}/pref`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reapplyIntervalMonths: isNaN(months as number) ? null : months }),
    });
    setSaving(false);
    setSaved(true);
    setEditing(false);
    setTimeout(() => setSaved(false), 2000);
    onSaved();
  }

  if (!editing) {
    return (
      <span
        className="text-xs text-blue-600 underline cursor-pointer"
        onClick={() => setEditing(true)}
      >
        {cadence.tenantIntervalMonths != null
          ? `Your interval: ${cadence.tenantIntervalMonths}mo`
          : t("overview.setYourInterval")}
        {saved && <span className="ml-1 text-green-600">{t("overview.intervalSaved")}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min="1"
        className="border rounded px-1.5 py-0.5 text-xs w-16"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("overview.intervalPlaceholder")}
        autoFocus
      />
      <button
        disabled={saving}
        onClick={handleSave}
        className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded disabled:opacity-50"
      >
        {saving ? "…" : "Save"}
      </button>
      <button onClick={() => setEditing(false)} className="text-xs text-gray-500 px-1 py-0.5">
        ✕
      </button>
    </span>
  );
}

export default function FundingOverviewPage() {
  const t = useTranslations("funding");
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newOpp, setNewOpp] = useState({ name: "", funder: "", description: "", url: "", deadline: "" });
  const [addingOpp, setAddingOpp] = useState(false);
  const [addError, setAddError] = useState("");

  function loadData() {
    setLoading(true);
    fetch("/api/funding/opportunities")
      .then((r) => (r.ok ? r.json() : []))
      .then(setOpportunities)
      .finally(() => setLoading(false));
  }

  useEffect(loadData, []);

  async function handleAddOpportunity(e: React.FormEvent) {
    e.preventDefault();
    setAddingOpp(true);
    setAddError("");
    const res = await fetch("/api/funding/opportunities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newOpp.name.trim(),
        funder: newOpp.funder.trim(),
        description: newOpp.description.trim(),
        url: newOpp.url.trim() || undefined,
        deadline: newOpp.deadline || undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setAddError(data?.error ?? "Failed to create opportunity.");
      setAddingOpp(false);
      return;
    }
    setNewOpp({ name: "", funder: "", description: "", url: "", deadline: "" });
    setShowAddForm(false);
    setAddingOpp(false);
    loadData();
  }

  if (loading) return <p className="p-4">Loading…</p>;

  return (
    <div className="max-w-4xl space-y-8">
      <h1 className="text-2xl font-bold">{t("overview.title")}</h1>
      <p className="text-gray-600">{t("overview.description")}</p>

      <div className="flex justify-end">
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-sm bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700"
        >
          {t("overview.addOpportunity")}
        </button>
      </div>

      {/* Add opportunity form */}
      {showAddForm && (
        <form onSubmit={handleAddOpportunity} className="border rounded p-4 bg-gray-50 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t("opportunity.name")}</label>
              <input type="text" required className="border rounded px-3 py-1.5 w-full text-sm"
                value={newOpp.name} onChange={(e) => setNewOpp({ ...newOpp, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("opportunity.funder")}</label>
              <input type="text" required className="border rounded px-3 py-1.5 w-full text-sm"
                value={newOpp.funder} onChange={(e) => setNewOpp({ ...newOpp, funder: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("opportunity.description")}</label>
            <textarea required className="border rounded px-3 py-1.5 w-full text-sm h-16"
              value={newOpp.description} onChange={(e) => setNewOpp({ ...newOpp, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">{t("opportunity.url")}</label>
              <input type="url" className="border rounded px-3 py-1.5 w-full text-sm"
                value={newOpp.url} onChange={(e) => setNewOpp({ ...newOpp, url: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">{t("overview.deadline")}</label>
              <input type="date" className="border rounded px-3 py-1.5 w-full text-sm"
                value={newOpp.deadline} onChange={(e) => setNewOpp({ ...newOpp, deadline: e.target.value })} />
            </div>
          </div>
          {addError && <p className="text-red-600 text-sm">{addError}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={addingOpp}
              className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700 disabled:opacity-50">
              {t("opportunity.create")}
            </button>
            <button type="button" onClick={() => setShowAddForm(false)}
              className="text-gray-600 border px-3 py-1.5 rounded text-sm hover:bg-gray-100">
              {t("opportunity.cancel")}
            </button>
          </div>
        </form>
      )}

      {/* Unified per-awarding-body status list */}
      {opportunities.length === 0 ? (
        <p className="text-gray-500">{t("overview.noOpportunities")}</p>
      ) : (
        <div className="space-y-3">
          {opportunities.map((opp) => {
            const { tenantApplications: apps, cadence } = opp;
            const daysUntilDeadline = opp.deadline
              ? Math.ceil((new Date(opp.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
              : null;
            const deadlineSoon = daysUntilDeadline !== null && daysUntilDeadline >= 0 && daysUntilDeadline <= 30;
            const deadlinePassed = daysUntilDeadline !== null && daysUntilDeadline < 0;

            return (
              <div key={opp.id} className="border rounded p-4">
                <div className="flex justify-between items-start gap-4">
                  {/* Left: opportunity info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <p className="font-medium">{opp.name}</p>
                      {opp.tenantId ? (
                        <span className="text-xs bg-green-100 text-green-800 px-1.5 py-0.5 rounded">{t("opportunity.yours")}</span>
                      ) : (
                        <span className="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">{t("opportunity.platform")}</span>
                      )}
                      {opp.eligibility.score >= 70 && (
                        <span className="text-xs bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">
                          {t("overview.recommended")}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">{opp.funder}</p>
                    <p className="text-sm mt-1 text-gray-700">{opp.description}</p>

                    {/* Eligibility reasons */}
                    {opp.eligibility.reasons.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-1">
                        {opp.eligibility.reasons.map((r, i) => (
                          <span key={i} className="text-xs text-gray-500">✓ {r}</span>
                        ))}
                      </div>
                    )}

                    {/* Tags */}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {opp.tags.map((tag) => (
                        <span key={tag} className="text-xs bg-gray-100 px-2 py-0.5 rounded">{tag}</span>
                      ))}
                    </div>

                    {/* Cadence info row */}
                    <div className="flex flex-wrap items-center gap-3 mt-2">
                      {cadence.funderIntervalMonths != null && (
                        <span className="text-xs text-gray-500">
                          {t("overview.cadenceLabel")}: {t("overview.cadenceMonths", { months: cadence.funderIntervalMonths })}
                        </span>
                      )}
                      <CadenceEditor opportunityId={opp.id} cadence={cadence} onSaved={loadData} />
                    </div>

                    {/* Advisory warning */}
                    {cadence.warningMonthsRemaining != null && (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                        ⚠ {t("overview.cadenceWarning", { months: cadence.warningMonthsRemaining })}
                      </p>
                    )}
                  </div>

                  {/* Right: status + action */}
                  <div className="shrink-0 text-right space-y-1.5 min-w-[140px]">
                    {/* Deadline */}
                    {opp.deadline && (
                      <p className={`text-sm ${
                        deadlinePassed ? "text-red-600 line-through" :
                        deadlineSoon ? "text-amber-600 font-medium" :
                        "text-gray-500"
                      }`}>
                        {deadlinePassed
                          ? t("overview.deadlinePassed")
                          : deadlineSoon
                            ? t("overview.deadlineSoon", { days: daysUntilDeadline! })
                            : `${t("overview.deadline")}: ${new Date(opp.deadline).toLocaleDateString("en-GB")}`}
                      </p>
                    )}
                    {opp.maxAmount && (
                      <p className="text-sm text-gray-500">{t("overview.amount", { amount: formatPence(opp.maxAmount) })}</p>
                    )}

                    {/* Latest status badge */}
                    {apps.latestStatus && (
                      <div>
                        <span className={`inline-block text-xs px-2 py-1 rounded ${STATUS_COLORS[apps.latestStatus] ?? "bg-gray-100 text-gray-700"}`}>
                          {t(`status.${apps.latestStatus}`)}
                        </span>
                        {apps.count > 1 && (
                          <span className="block text-xs text-gray-400 mt-0.5">
                            {t("overview.rounds", { count: apps.count })}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Action button */}
                    {apps.isActive ? (
                      // Active application — view it
                      <Link
                        href={`/dashboard/funding/applications/${apps.latestApplicationId}`}
                        className="mt-1 inline-block text-sm border border-gray-300 text-gray-700 px-3 py-1 rounded hover:bg-gray-50"
                      >
                        {t("overview.inProgress")} →
                      </Link>
                    ) : !deadlinePassed ? (
                      // No active application — apply or re-apply
                      <Link
                        href={`/dashboard/funding/apply/${opp.id}`}
                        className="mt-1 inline-block text-sm bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
                      >
                        {apps.count > 0 ? t("overview.reapply") : t("overview.applyNow")}
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

