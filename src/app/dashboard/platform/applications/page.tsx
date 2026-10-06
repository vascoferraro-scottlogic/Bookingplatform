"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/format";
import Link from "next/link";

type ApplicationStatus =
  | "PENDING"
  | "IN_REVIEW"
  | "MORE_INFO_REQUESTED"
  | "APPROVED"
  | "REJECTED";

type Application = {
  id: string;
  clubName: string;
  contactName: string;
  contactEmail: string;
  country: string;
  region: string | null;
  status: ApplicationStatus;
  createdAt: string;
  reviewedAt: string | null;
  tenant: { id: string; name: string; slug: string } | null;
};

const STATUS_FILTERS: ("ALL" | ApplicationStatus)[] = [
  "ALL",
  "PENDING",
  "IN_REVIEW",
  "MORE_INFO_REQUESTED",
  "APPROVED",
  "REJECTED",
];

const STATUS_STYLES: Record<ApplicationStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  IN_REVIEW: "bg-blue-100 text-blue-800",
  MORE_INFO_REQUESTED: "bg-orange-100 text-orange-800",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
};

export default function ApplicationsPage() {
  const locale = useLocale();
  const t = useTranslations("admin");
  const [apps, setApps] = useState<Application[]>([]);
  const [filter, setFilter] = useState<"ALL" | ApplicationStatus>("ALL");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/applications")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setApps(Array.isArray(d) ? d : []))
      .catch(() => setApps([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => (filter === "ALL" ? apps : apps.filter((a) => a.status === filter)),
    [apps, filter],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: apps.length };
    for (const a of apps) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }, [apps]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">{t("platform.applications.title")}</h1>
        <p className="text-sm text-gray-600 mt-1">
          Clubs that have requested to join the platform via{" "}
          <Link href="/join" className="underline">/join</Link>.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-lg border ${
              filter === f
                ? "bg-green-600 text-white border-green-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {f === "ALL" ? "All" : f.replace(/_/g, " ").toLowerCase()}{" "}
            <span className="opacity-60">({counts[f] ?? 0})</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-gray-500">{t("platform.applications.loading")}</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-500">{t("platform.applications.noApplications")}</p>
      ) : (
        <div className="overflow-hidden rounded-xl bg-white shadow">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="p-3">{t("platform.applications.club")}</th>
                <th className="p-3">{t("platform.applications.contact")}</th>
                <th className="p-3">{t("platform.applications.country")}</th>
                <th className="p-3">{t("platform.applications.status")}</th>
                <th className="p-3">{t("platform.applications.submitted")}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((a) => (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="p-3 font-medium text-gray-800">{a.clubName}</td>
                  <td className="p-3">
                    <div>{a.contactName}</div>
                    <div className="text-xs text-gray-500">{a.contactEmail}</div>
                  </td>
                  <td className="p-3 text-gray-600">
                    {a.country}
                    {a.region && <span className="text-gray-400"> / {a.region}</span>}
                  </td>
                  <td className="p-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[a.status]}`}>
                      {a.status.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </td>
                  <td className="p-3 text-gray-500 text-xs">
                    {formatDate(a.createdAt, locale)}
                  </td>
                  <td className="p-3 text-right">
                    <Link
                      href={`/dashboard/platform/applications/${a.id}`}
                      className="text-green-700 hover:underline"
                    >
                      {t("platform.applications.review")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
