"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatShortRef } from "@/lib/refs";
import { formatDate } from "@/lib/format";
import Link from "next/link";

interface Plan {
  id: string;
  name: string;
  slug: string;
  priceMonthlyPence: number;
  maxMembers: number;
  maxGreens: number;
  includedStreamingTier: string;
}

interface BillingProfile {
  id: string;
  planId: string;
  plan: Plan;
  billingStatus: string;
  billingContactName: string | null;
  billingContactEmail: string | null;
  billingAddress: Record<string, string> | null;
  vatNumber: string | null;
  paymentMethod: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
}

interface Invoice {
  id: string;
  amount: number;
  status: string;
  invoiceRef: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  lineItems: { description: string; totalPricePence: number; category: string }[];
}

const statusBadge: Record<string, string> = {
  TRIAL: "bg-blue-100 text-blue-700",
  ACTIVE: "bg-green-100 text-green-700",
  PAST_DUE: "bg-yellow-100 text-yellow-700",
  SUSPENDED: "bg-red-100 text-red-700",
  CANCELLED: "bg-gray-200 text-gray-500",
};

export default function TenantBillingPage() {
  const locale = useLocale();
  const t = useTranslations("billing");
  const [profile, setProfile] = useState<BillingProfile | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [totalInvoices, setTotalInvoices] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Form state
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [vatNumber, setVatNumber] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/billing/profile").then((r) => r.ok ? r.json() : null),
      fetch("/api/billing/invoices?limit=10").then((r) => r.json()),
    ])
      .then(([prof, inv]) => {
        setProfile(prof);
        setInvoices(inv?.invoices ?? []);
        setTotalInvoices(inv?.total ?? 0);
        if (prof) {
          setContactName(prof.billingContactName ?? "");
          setContactEmail(prof.billingContactEmail ?? "");
          setVatNumber(prof.vatNumber ?? "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/billing/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        billingContactName: contactName || null,
        billingContactEmail: contactEmail || null,
        vatNumber: vatNumber || null,
      }),
    });
    if (res.ok) {
      setMsg(t("contact.saved"));
      const updated = await res.json();
      setProfile((prev) => prev ? { ...prev, ...updated } : prev);
    } else {
      setMsg(t("contact.saveFailed"));
    }
    setSaving(false);
  }

  if (loading) return <p className="text-gray-500">{t("loading")}</p>;

  if (!profile) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-gray-500">{t("noProfile")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      {/* Plan Card */}
      <div className="rounded-xl bg-white p-6 shadow">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">{profile.plan.name}</h2>
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge[profile.billingStatus] ?? "bg-gray-100"}`}>
                {profile.billingStatus}
              </span>
            </div>
            <p className="mt-1 text-2xl font-bold">£{(profile.plan.priceMonthlyPence / 100).toFixed(2)}<span className="text-sm font-normal text-gray-500">{t("plan.perMonth")}</span></p>
          </div>
          <Link href="/dashboard/billing/plans" className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
            {t("plan.comparePlans")}
          </Link>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div><dt className="text-gray-500">{t("plan.maxMembers")}</dt><dd className="font-medium">{profile.plan.maxMembers}</dd></div>
          <div><dt className="text-gray-500">{t("plan.maxGreens")}</dt><dd className="font-medium">{profile.plan.maxGreens}</dd></div>
          <div><dt className="text-gray-500">{t("plan.streaming")}</dt><dd className="font-medium">{profile.plan.includedStreamingTier}</dd></div>
          <div><dt className="text-gray-500">{t("plan.payment")}</dt><dd className="font-medium">{profile.paymentMethod}</dd></div>
        </dl>
        <div className="mt-4 flex gap-6 text-sm text-gray-500">
          <span>{t("plan.nextBilling")} <strong className="text-gray-900">{formatDate(profile.currentPeriodEnd, locale)}</strong></span>
          {profile.trialEndsAt && <span>{t("plan.trialEnds")} <strong className="text-gray-900">{formatDate(profile.trialEndsAt, locale)}</strong></span>}
        </div>
      </div>

      {/* Billing Contact Form */}
      <form onSubmit={saveProfile} className="rounded-xl bg-white p-6 shadow space-y-4">
        <h3 className="font-semibold">{t("contact.title")}</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t("contact.contactName")}</label>
            <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t("contact.contactEmail")}</label>
            <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t("contact.vatNumber")}</label>
            <input type="text" value={vatNumber} onChange={(e) => setVatNumber(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50">
            {t("contact.save")}
          </button>
          {msg && <span className="text-sm text-gray-600">{msg}</span>}
        </div>
      </form>

      {/* Invoice History */}
      <div className="rounded-xl bg-white shadow">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-700">{t("invoices.title")} ({totalInvoices})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">{t("invoices.ref")}</th>
                <th className="px-4 py-3">{t("invoices.amount")}</th>
                <th className="px-4 py-3">{t("invoices.status")}</th>
                <th className="px-4 py-3">{t("invoices.period")}</th>
                <th className="px-4 py-3">{t("invoices.date")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{inv.invoiceRef ?? formatShortRef(inv.id)}</td>
                  <td className="px-4 py-3">£{(inv.amount / 100).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${paymentBadge(inv.status)}`}>{inv.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {inv.periodStart ? `${formatDate(inv.periodStart, locale)} – ${formatDate(inv.periodEnd!, locale)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(inv.createdAt, locale)}</td>
                  <td className="px-4 py-3">
                    <a href={`/api/billing/invoices/${inv.id}?format=csv`} download className="text-xs text-blue-600 hover:underline">{t("invoices.csv")}</a>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-3 text-center text-gray-400">{t("invoices.noInvoices")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function paymentBadge(status: string) {
  switch (status) {
    case "PAID": return "bg-green-100 text-green-700";
    case "PENDING": return "bg-yellow-100 text-yellow-700";
    case "FAILED": return "bg-red-100 text-red-700";
    default: return "bg-gray-100 text-gray-600";
  }
}
