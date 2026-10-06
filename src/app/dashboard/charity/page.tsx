"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

type Status = {
  country: string;
  supportedCountry: boolean;
  flagEnabled: boolean;
  available: boolean;
  configured: boolean;
  supportedCountries: string[];
};

export default function CharityOverviewPage() {
  const t = useTranslations("charity");
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/charity/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setStatus(s))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>{t("overview.loading")}</p>;
  if (!status) return <p className="text-red-600">{t("overview.loadFailed")}</p>;

  if (!status.supportedCountry) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold mb-2">{t("overview.title")}</h1>
        <div className="rounded border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <p className="font-semibold">{t("overview.notAvailable")}</p>
          <p className="text-sm mt-2">
            {t("overview.notAvailableExplanation", { country: status.country })}
          </p>
          <p className="text-sm mt-2">
            {t("overview.notAvailableAction")}
          </p>
        </div>
      </div>
    );
  }

  if (!status.flagEnabled) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold mb-2">{t("overview.title")}</h1>
        <div className="rounded border border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold">{t("overview.flagDisabled")}</p>
          <p className="text-sm mt-2">
            {t("overview.flagDisabledExplanation", { country: status.country, flag: "charity" })}
          </p>
          <p className="text-sm mt-2">
            {t("overview.flagDisabledNote")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">{t("overview.title")}</h1>
      <p className="text-sm text-slate-600 mb-6">
        {t("overview.description", { regulator: status.country === "GB" ? "the Charity Commission / OSCR" : "CCNI" })}
      </p>

      {!status.configured && (
        <div className="rounded border border-amber-200 bg-amber-50 p-4 mb-6 text-amber-900">
          <p className="font-semibold">{t("overview.configureFirst")}</p>
          <p className="text-sm mt-1">
            {t("overview.configureHint")}
          </p>
          <Link
            href="/dashboard/charity/settings"
            className="inline-block mt-3 px-4 py-2 bg-green-700 text-white rounded hover:bg-green-800"
          >
            {t("overview.openSettings")}
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/dashboard/charity/settings"
          className="block rounded border border-slate-200 p-4 hover:border-green-700 hover:bg-green-50"
        >
          <div className="text-2xl">⚙️</div>
          <div className="font-semibold mt-2">{t("overview.settingsCard")}</div>
          <div className="text-sm text-slate-600">
            {t("overview.settingsDescription")}
          </div>
        </Link>
        <Link
          href="/dashboard/charity/ledger"
          className={`block rounded border border-slate-200 p-4 ${
            status.configured ? "hover:border-green-700 hover:bg-green-50" : "opacity-50 pointer-events-none"
          }`}
        >
          <div className="text-2xl">📒</div>
          <div className="font-semibold mt-2">{t("overview.ledgerCard")}</div>
          <div className="text-sm text-slate-600">
            {t("overview.ledgerDescription")}
          </div>
        </Link>
        <Link
          href="/dashboard/charity/reports"
          className={`block rounded border border-slate-200 p-4 ${
            status.configured ? "hover:border-green-700 hover:bg-green-50" : "opacity-50 pointer-events-none"
          }`}
        >
          <div className="text-2xl">📊</div>
          <div className="font-semibold mt-2">{t("overview.reportsCard")}</div>
          <div className="text-sm text-slate-600">
            {t("overview.reportsDescription")}
          </div>
        </Link>
        <Link
          href="/dashboard/charity/tar"
          className={`block rounded border border-slate-200 p-4 ${
            status.configured ? "hover:border-green-700 hover:bg-green-50" : "opacity-50 pointer-events-none"
          }`}
        >
          <div className="text-2xl">📝</div>
          <div className="font-semibold mt-2">{t("overview.tarCard")}</div>
          <div className="text-sm text-slate-600">
            {t("overview.tarDescription")}
          </div>
        </Link>
      </div>
    </div>
  );
}
