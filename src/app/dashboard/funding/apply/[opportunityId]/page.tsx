"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";

type Opportunity = {
  id: string;
  name: string;
  funder: string;
  description: string;
  deadline: string | null;
  maxAmount: number | null;
  minAmount: number | null;
  eligibilityNotes: string | null;
};

export default function ApplyPage() {
  const t = useTranslations("funding");
  const router = useRouter();
  const { opportunityId } = useParams<{ opportunityId: string }>();
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [notes, setNotes] = useState("");
  const [amountRequested, setAmountRequested] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/funding/opportunities")
      .then((r) => (r.ok ? r.json() : []))
      .then((opps: Opportunity[]) => {
        const opp = opps.find((o) => o.id === opportunityId);
        setOpportunity(opp ?? null);
      })
      .finally(() => setLoading(false));
  }, [opportunityId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const body: Record<string, unknown> = { opportunityId };
    if (notes.trim()) body.notes = notes.trim();
    if (amountRequested.trim()) {
      const pence = Math.round(parseFloat(amountRequested) * 100);
      if (isNaN(pence) || pence <= 0) {
        setError("Amount must be a positive number.");
        setSubmitting(false);
        return;
      }
      body.amountRequested = pence;
    }

    const res = await fetch("/api/funding/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Failed to create application.");
      setSubmitting(false);
      return;
    }

    const created = await res.json();
    router.push(`/dashboard/funding/applications/${created.id}${created.cadenceWarning ? "?cw=1" : ""}`);
  }

  if (loading) return <p className="p-4">Loading…</p>;
  if (!opportunity) return <p className="p-4 text-red-600">Opportunity not found.</p>;

  return (
    <div className="max-w-2xl">
      <Link href="/dashboard/funding" className="text-sm text-green-700 hover:underline">
        {t("application.backToOverview")}
      </Link>

      <h1 className="text-2xl font-bold mt-2 mb-1">{opportunity.name}</h1>
      <p className="text-gray-500 mb-4">{opportunity.funder}</p>
      <p className="mb-4">{opportunity.description}</p>

      {opportunity.eligibilityNotes && (
        <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4 text-sm text-blue-900">
          {opportunity.eligibilityNotes}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">{t("application.amountRequested")} (£)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            className="border rounded px-3 py-2 w-full"
            value={amountRequested}
            onChange={(e) => setAmountRequested(e.target.value)}
            placeholder={opportunity.maxAmount ? `Up to £${(opportunity.maxAmount / 100).toLocaleString()}` : ""}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">{t("application.notes")}</label>
          <textarea
            className="border rounded px-3 py-2 w-full h-24"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal notes about this application…"
          />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
        >
          {submitting ? "Creating…" : t("overview.newApplication")}
        </button>
      </form>
    </div>
  );
}
