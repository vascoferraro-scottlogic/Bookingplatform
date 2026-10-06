"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/format";
import { ChapterShell } from "./shared";
import type { ChapterProps } from "./shared";

interface Plan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceMonthlyPence: number;
  trialDays: number;
  maxMembers: number;
  maxGreens: number;
  includedStreamingTier: string;
}

/**
 * Chapter 8 — Subscription.
 *
 * Plan picker + attestation. Selects a PlatformPlan for the tenant's
 * billing profile. Defaults to Starter if none selected. The existing
 * attestation flow is preserved as fallback for tenants who skip selection.
 */
export default function Chapter8Subscription({ tenantId, onAdvance }: ChapterProps) {
  const locale = useLocale();
  const t = useTranslations("onboarding");
  const [attestedAt, setAttestedAt] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    Promise.all([
      fetch("/api/onboarding/subscription").then((r) => r.json()),
      fetch("/api/plans").then((r) => r.json()),
    ])
      .then(([sub, planData]) => {
        setAttestedAt(sub.attestedAt ?? null);
        if (sub.planId) setSelectedPlanId(sub.planId);
        const planList = Array.isArray(planData) ? planData : [];
        setPlans(planList);
        // Default to first (cheapest) plan if none selected
        if (!sub.planId && planList.length > 0) {
          setSelectedPlanId(planList[0].id);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [tenantId]);

  const attestAndContinue = async () => {
    setError("");
    setBusy(true);
    if (!attestedAt) {
      const res = await fetch("/api/onboarding/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: selectedPlanId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not record subscription.");
        setBusy(false);
        return;
      }
      const data = await res.json();
      setAttestedAt(data.attestedAt);
    }
    setBusy(false);
    await onAdvance();
  };

  if (!loaded) return <div className="text-gray-500">{t("loading")}</div>;

  return (
    <ChapterShell
      title={t("chapters.subscription")}
      intro="Choose a plan that fits your organisation. You can change plan later by contacting the platform team."
    >
      {/* Plan Cards */}
      {plans.length > 0 && !attestedAt && (
        <div className="grid gap-4 sm:grid-cols-3">
          {plans.map((plan) => (
            <button
              key={plan.id}
              type="button"
              onClick={() => setSelectedPlanId(plan.id)}
              className={`rounded-lg border-2 p-4 text-left transition ${
                selectedPlanId === plan.id
                  ? "border-emerald-500 bg-emerald-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <h3 className="font-semibold">{plan.name}</h3>
              <p className="mt-1 text-2xl font-bold">
                £{(plan.priceMonthlyPence / 100).toFixed(0)}
                <span className="text-sm font-normal text-gray-500">/mo</span>
              </p>
              {plan.trialDays > 0 && (
                <p className="mt-1 text-xs text-emerald-600">{plan.trialDays}-day free trial</p>
              )}
              {plan.description && (
                <p className="mt-2 text-xs text-gray-500">{plan.description}</p>
              )}
              <ul className="mt-3 space-y-1 text-xs text-gray-600">
                <li>{plan.maxMembers === 0 ? "Unlimited" : plan.maxMembers} members</li>
                {plan.maxGreens > 0 && (
                  <li>{plan.maxGreens} greens</li>
                )}
                <li>Streaming: {plan.includedStreamingTier === "NONE" ? "Not included" : plan.includedStreamingTier}</li>
              </ul>
            </button>
          ))}
        </div>
      )}

      {/* Fallback / info box */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-5 space-y-3">
        <div className="flex items-baseline gap-3">
          <h3 className="text-lg font-semibold">Pay by invoice</h3>
        </div>
        <p className="text-sm text-gray-700">
          By confirming below you're telling the platform team you intend to settle up by
          invoice. We'll be in touch with the details. You can still go live straight away —
          we don't gate your launch on a payment landing.
        </p>
        <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
          <li>No card or bank details are needed at this stage.</li>
          <li>Stripe / direct-debit / proper billing will replace this later.</li>
        </ul>
      </div>

      {attestedAt ? (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-emerald-800 text-sm">
          ✓ Confirmed on {formatDateTime(attestedAt, locale)}. You’re good to move on.
        </div>
      ) : (
        <p className="text-sm text-gray-600">
          Select a plan above, then click continue.
        </p>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="pt-4 border-t flex items-center gap-3">
        <button
          type="button"
          onClick={attestAndContinue}
          disabled={busy}
          className="px-5 py-2 rounded-md bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          {attestedAt ? "Continue" : busy ? t("shared.saving") : "Confirm & continue"}
        </button>
      </div>
    </ChapterShell>
  );
}
