"use client";

import { useEffect, useState } from "react";
import { formatShortRef } from "@/lib/refs";

interface TenantPayment {
  id: string;
  invoiceRef?: string | null;
  amount: number;
  status: string;
  tenant?: { name?: string | null };
  createdAt: string;
}

interface BookingPayment {
  id: string;
  bookingId: string;
  amount: number;
  status: string;
  booking?: { id: string; date?: string | null; tenantId?: string | null };
  createdAt: string;
}

export default function PlatformPaymentsPage() {
  type Tenant = { id: string; name?: string | null; slug?: string | null };
  type BookingOption = { id: string; date?: string | null };

  const [tenantPayments, setTenantPayments] = useState<TenantPayment[]>([]);
  const [bookingPayments, setBookingPayments] = useState<BookingPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantForBooking, setSelectedTenantForBooking] = useState("");
  const [tenantBookings, setTenantBookings] = useState<BookingOption[]>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/payments");
      if (res.ok) {
        const data = await res.json();
        setTenantPayments(data.tenantPayments ?? []);
        setBookingPayments(data.bookingPayments ?? []);
      }
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Load tenants for dropdown (platform admin context)
  useEffect(() => {
    fetch("/api/admin/tenants")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTenants(Array.isArray(data) ? data : []))
      .catch(() => setTenants([]));
  }, []);

  // When a tenant is chosen for booking lookup, fetch its bookings
  useEffect(() => {
    if (!selectedTenantForBooking) return setTenantBookings([]);
    fetch(`/api/admin/bookings?tenantId=${encodeURIComponent(selectedTenantForBooking)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTenantBookings(Array.isArray(data) ? data : []))
      .catch(() => setTenantBookings([]));
  }, [selectedTenantForBooking]);

  async function simulateTenant(id: string, action: "paid" | "failed") {
    setBusy((s) => ({ ...s, [id]: true }));
    try {
      await fetch("/api/payments/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: action === "paid" ? "payment_succeeded" : "payment_failed", paymentId: id }),
      });
      await load();
    } finally {
      setBusy((s) => ({ ...s, [id]: false }));
    }
  }

  async function simulateBooking(bookingId: string, action: "paid" | "failed") {
    setBusy((s) => ({ ...s, [bookingId]: true }));
    try {
      await fetch("/api/payments/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: action === "paid" ? "payment.completed" : "payment.failed", bookingId }),
      });
      await load();
    } finally {
      setBusy((s) => ({ ...s, [bookingId]: false }));
    }
  }

  if (loading) return <p className="text-gray-500">Loading payments…</p>;

  return (
    <div className="space-y-6">
      {/* Manual stub controls */}
      <div className="rounded-xl bg-white p-4 shadow">
        <h3 className="text-sm font-semibold mb-3">Manual Stub — Create Payment</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <form onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget as HTMLFormElement & { tenantId: HTMLSelectElement; amount: HTMLInputElement; processNow: HTMLInputElement };
            const tenantId = form.tenantId.value.trim();
            const amount = Math.round(parseFloat(form.amount.value || "0") * 100);
            const processNow = form.processNow.checked;
            if (!tenantId || amount <= 0) return;
            setLoading(true);
            try {
              await fetch('/api/admin/payments/create-tenant', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId, amount, processNow }),
              });
              await load();
            } finally { setLoading(false); }
          }}>
            <div className="grid gap-2">
              <label className="text-xs text-gray-500">Tenant ID</label>
              <select name="tenantId" className="rounded border px-3 py-2 text-sm">
                <option value="">— select tenant —</option>
                {tenants.map((t) => (<option key={t.id} value={t.id}>{t.name ?? t.id}{t.slug ? ` (/${t.slug})` : ''}</option>))}
              </select>
              <label className="text-xs text-gray-500">Amount (£)</label>
              <input name="amount" type="number" step="0.01" className="rounded border px-3 py-2 text-sm" />
              <label className="flex items-center gap-2"><input name="processNow" type="checkbox" /> Process now (invoke stub)</label>
              <div><button type="submit" className="rounded bg-blue-600 px-3 py-1 text-sm text-white">Create Tenant Payment</button></div>
            </div>
          </form>

          <form onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget as HTMLFormElement & { tenantId: HTMLSelectElement; bookingId: HTMLSelectElement | HTMLInputElement; amount: HTMLInputElement; processNow: HTMLInputElement };
            const tenantId = form.tenantId?.value?.trim();
            const bookingId = form.bookingId.value.trim();
            const amount = Math.round(parseFloat(form.amount.value || "0") * 100);
            const processNow = form.processNow.checked;
            if (!bookingId || amount <= 0) return;
            setLoading(true);
            try {
              await fetch('/api/admin/payments/create-booking', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId, amount, processNow }),
              });
              await load();
            } finally { setLoading(false); }
          }}>
            <div className="grid gap-2">
              <label className="text-xs text-gray-500">Tenant (for booking lookup)</label>
              <select name="tenantId" value={selectedTenantForBooking} onChange={(e) => setSelectedTenantForBooking(e.target.value)} className="rounded border px-3 py-2 text-sm">
                <option value="">— optional —</option>
                {tenants.map((t) => (<option key={t.id} value={t.id}>{t.name ?? t.id}{t.slug ? ` (/${t.slug})` : ''}</option>))}
              </select>
              <label className="text-xs text-gray-500">Booking ID</label>
              {selectedTenantForBooking ? (
                <select name="bookingId" className="rounded border px-3 py-2 text-sm">
                  <option value="">— select booking —</option>
                  {tenantBookings.map((b) => (
                    <option key={b.id} value={b.id}>{b.date ? `${new Date(b.date).toLocaleString()} — ${formatShortRef(b.id)}` : formatShortRef(b.id)}</option>
                  ))}
                </select>
              ) : (
                <input name="bookingId" className="rounded border px-3 py-2 text-sm" />
              )}
              <label className="text-xs text-gray-500">Amount (£)</label>
              <input name="amount" type="number" step="0.01" className="rounded border px-3 py-2 text-sm" />
              <label className="flex items-center gap-2"><input name="processNow" type="checkbox" /> Process now (mark paid)</label>
              <div><button type="submit" className="rounded bg-blue-600 px-3 py-1 text-sm text-white">Create Booking Payment</button></div>
            </div>
          </form>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Platform Payments (Admin)</h1>
        <div>
          <button onClick={load} className="rounded border px-3 py-1 text-sm">Refresh</button>
        </div>
      </div>

      <div className="rounded-xl bg-white shadow">
        <h2 className="border-b px-4 py-3 text-sm font-semibold text-gray-700">Tenant Invoices (Pending)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Ref</th>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tenantPayments.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-3 text-center text-gray-400">No pending tenant invoices</td></tr>
              )}
                {tenantPayments.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{p.invoiceRef ?? formatShortRef(p.id)}</td>
                  <td className="px-4 py-3">{p.tenant?.name ?? "Unknown"}</td>
                  <td className="px-4 py-3">£{(p.amount / 100).toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(p.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button disabled={!!busy[p.id]} onClick={() => simulateTenant(p.id, "paid")} className="rounded bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50">Mark Paid</button>
                      <button disabled={!!busy[p.id]} onClick={() => simulateTenant(p.id, "failed")} className="rounded border px-3 py-1 text-xs disabled:opacity-50">Mark Failed</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl bg-white shadow">
        <h2 className="border-b px-4 py-3 text-sm font-semibold text-gray-700">Booking Payments (Pending)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Booking</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {bookingPayments.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-3 text-center text-gray-400">No pending booking payments</td></tr>
              )}
              {bookingPayments.map((bp) => (
                <tr key={bp.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{formatShortRef(bp.booking?.id ?? bp.bookingId)}</td>
                  <td className="px-4 py-3">£{(bp.amount / 100).toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-500">{bp.booking?.date ? new Date(bp.booking.date).toLocaleString() : new Date(bp.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button disabled={!!busy[bp.bookingId]} onClick={() => simulateBooking(bp.bookingId, "paid")} className="rounded bg-green-600 px-3 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50">Mark Paid</button>
                      <button disabled={!!busy[bp.bookingId]} onClick={() => simulateBooking(bp.bookingId, "failed")} className="rounded border px-3 py-1 text-xs disabled:opacity-50">Mark Failed</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

