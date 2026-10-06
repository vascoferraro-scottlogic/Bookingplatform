"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";

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
  featureFlags: string | null;
}

export default function PlanComparisonPage() {
  const t = useTranslations("billing");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/plans")
      .then((r) => r.json())
      .then((data) => setPlans(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-500">{t("plans.loadingPlans")}</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard/billing" className="text-sm text-green-700 hover:underline">{t("plans.backToBilling")}</Link>
        <h1 className="text-2xl font-bold">{t("plans.title")}</h1>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <div key={plan.id} className="flex flex-col rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold">{plan.name}</h2>
            {plan.description && <p className="mt-1 text-sm text-gray-500">{plan.description}</p>}
            <p className="mt-4 text-3xl font-bold">
              £{(plan.priceMonthlyPence / 100).toFixed(0)}
              <span className="text-base font-normal text-gray-500">{t("plans.perMonth")}</span>
            </p>
            {plan.trialDays > 0 && (
              <p className="mt-1 text-xs text-green-600">{t("plans.freeTrial", { days: plan.trialDays })}</p>
            )}
            <ul className="mt-6 flex-1 space-y-2 text-sm">
              <Feature label={t("plans.membersLabel")} value={plan.maxMembers === 0 ? t("plans.unlimited") : String(plan.maxMembers)} />
              <Feature label={t("plans.greensLabel")} value={plan.maxGreens === 0 ? t("plans.unlimited") : String(plan.maxGreens)} />
              <Feature label={t("plans.streamingLabel")} value={tierLabel(plan.includedStreamingTier, t)} />
            </ul>
            <div className="mt-6 rounded bg-gray-50 px-3 py-2 text-center text-xs text-gray-500">
              {t("plans.contactAdmin")}
            </div>
          </div>
        ))}
      </div>

      {plans.length === 0 && (
        <p className="text-gray-400">{t("plans.noPlans")}</p>
      )}
    </div>
  );
}

function Feature({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between border-b border-gray-100 pb-1">
      <span className="text-gray-600">{label}</span>
      <span className="font-medium">{value}</span>
    </li>
  );
}

function tierLabel(tier: string, t: (key: string) => string): string {
  switch (tier) {
    case "NONE": return t("plans.tierNone");
    case "BRONZE": return t("plans.tierBronze");
    case "SILVER": return t("plans.tierSilver");
    case "GOLD": return t("plans.tierGold");
    default: return tier;
  }
}
