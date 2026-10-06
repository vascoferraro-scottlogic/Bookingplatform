"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale } from "next-intl";
import { formatShortRef } from "@/lib/refs";
import { formatDate } from "@/lib/format";
import Link from "next/link";

interface BillingProfile {
  id: string;
  planId: string;
  plan: { name: string; priceMonthlyPence: number };
  billingStatus: string;
  billingContactName: string | null;
  billingContactEmail: string | null;
  paymentMethod: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
}

interface Payment {
  id: string;
  amount: number;
  status: string;
  invoiceRef: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}

interface BillingData {
  profile: BillingProfile | null;
  payments: Payment[];
  outstanding: number;
  totalRevenue: number;
}

const statusBadge: Record<string, string> = {
  TRIAL: "bg-blue-100 text-blue-700",
  ACTIVE: "bg-green-100 text-green-700",
  PAST_DUE: "bg-yellow-100 text-yellow-700",
  SUSPENDED: "bg-red-100 text-red-700",
  CANCELLED: "bg-gray-200 text-gray-500",
};

export default function TenantBillingPage() {
  const { id } = useParams<{ id: string }>();
  const locale = useLocale();
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  function load() {
    fetch(`/api/admin/tenants/${id}/billing`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function generateInvoice() {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/admin/billing/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: id }),
    });
    const result = await res.json();
    if (res.ok) {
      setMsg(result.generated > 0 ? `Invoice generated (£${(result.results[0].amount / 100).toFixed(2)})` : "No invoice due");
      load();
    } else {
      setMsg("Generation failed");
    }
    setBusy(false);
  }

  if (loading) return <p className="text-gray-500">Loading billing…</p>;

  const profile = data?.profile;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/dashboard/platform/tenants/${id}`} className="text-sm text-blue-600 hover:underline">← Back to tenant</Link>
        <h1 className="text-2xl font-bold">Tenant Billing</h1>
      </div>

      {/* Profile Card */}
      {profile ? (
        <div className="rounded-xl bg-white p-6 shadow space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold">{profile.plan.name}</h2>
            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge[profile.billingStatus] ?? "bg-gray-100"}`}>
              {profile.billingStatus}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div><dt className="text-gray-500">Monthly</dt><dd>£{(profile.plan.priceMonthlyPence / 100).toFixed(2)}</dd></div>
            <div><dt className="text-gray-500">Method</dt><dd>{profile.paymentMethod}</dd></div>
            <div><dt className="text-gray-500">Period End</dt><dd>{formatDate(profile.currentPeriodEnd, locale)}</dd></div>
            {profile.trialEndsAt && <div><dt className="text-gray-500">Trial Ends</dt><dd>{formatDate(profile.trialEndsAt, locale)}</dd></div>}
          </dl>
          {profile.billingContactEmail && (
            <p className="text-xs text-gray-500">Contact: {profile.billingContactName} ({profile.billingContactEmail})</p>
          )}
        </div>
      ) : (
        <p className="text-gray-400">No billing profile.</p>
      )}

      {/* Summary + Actions */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="rounded-xl bg-white p-4 shadow">
          <p className="text-xs text-gray-500">Total Revenue</p>
          <p className="text-lg font-semibold">£{((data?.totalRevenue ?? 0) / 100).toFixed(2)}</p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow">
          <p className="text-xs text-gray-500">Outstanding</p>
          <p className="text-lg font-semibold">£{((data?.outstanding ?? 0) / 100).toFixed(2)}</p>
        </div>
        <button
          onClick={generateInvoice}
          disabled={busy || !profile}
          className="rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
        >
          Generate Invoice
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>

      {/* Payment History */}
      <div className="rounded-xl bg-white shadow">
        <h3 className="border-b px-4 py-3 text-sm font-semibold text-gray-700">Payment History</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Ref</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(data?.payments ?? []).map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{p.invoiceRef ?? formatShortRef(p.id)}</td>
                  <td className="px-4 py-3">£{(p.amount / 100).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${paymentBadge(p.status)}`}>{p.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {p.periodStart ? `${formatDate(p.periodStart, locale)} – ${formatDate(p.periodEnd!, locale)}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(p.createdAt, locale)}</td>
                </tr>
              ))}
              {(data?.payments ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-4 py-3 text-center text-gray-400">No payments yet</td></tr>
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
