"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

type Tenant = { id: string; name: string; slug: string };

type Booking = {
  id: string;
  date: string;
  status: string;
  user: { id: string; name: string; email: string };
  slots: { rink: { name: string }; timeSlot: string; playerName?: string }[];
  payment?: { status: string; amount: number };
};

export default function AdminPage() {
  const { data: session } = useSession();
  const t = useTranslations("admin");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const role = (session?.user as any)?.role;

  // Fetch tenant list for platform admins
  useEffect(() => {
    // Platform admins reach this page only while impersonating; layout enforces it.
    void role;
    setIsPlatformAdmin(false);
  }, [role]);

  function loadBookings(tenantId?: string) {
    const url = tenantId
      ? `/api/bookings?tenantId=${encodeURIComponent(tenantId)}`
      : "/api/bookings";
    fetch(url)
      .then((r) => r.json())
      .then((data) => setBookings(Array.isArray(data) ? data : []))
      .catch(() => {});
  }

  // Load bookings when tenant selection changes (or immediately for tenant admins)
  useEffect(() => {
    if (isPlatformAdmin && !selectedTenant) {
      setBookings([]);
      return;
    }
    loadBookings(selectedTenant || undefined);
  }, [selectedTenant, isPlatformAdmin]);

  async function updateStatus(id: string, status: string) {
    await fetch(`/api/bookings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setSuccessMsg(`Booking ${status.toLowerCase()} successfully.`);
    loadBookings(selectedTenant || undefined);
  }

  const filtered = filter === "ALL" ? bookings : bookings.filter((b) => b.status === filter);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("bookingAdmin.title")}</h1>

      {successMsg && <p className="text-green-600 text-sm rounded bg-green-50 border border-green-200 px-4 py-2">{successMsg}</p>}

      {isPlatformAdmin && (
        <div>
          <label className="text-sm font-medium text-gray-700 mr-2">{t("bookingAdmin.tenantLabel")}</label>
          <select
            value={selectedTenant}
            onChange={(e) => { setSelectedTenant(e.target.value); setFilter("ALL"); }}
            className="rounded border p-2 text-sm"
          >
            <option value="">{t("bookingAdmin.selectClub")}</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name} (/{t.slug})</option>
            ))}
          </select>
        </div>
      )}

      {isPlatformAdmin && !selectedTenant ? (
        <p className="text-gray-400">{t("bookingAdmin.selectTenantPrompt")}</p>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap">
        {["ALL", "REQUESTED", "APPROVED", "RESERVED", "CONFIRMED", "CANCELLED"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`text-xs px-3 py-1 rounded ${filter === s ? "bg-green-600 text-white" : "bg-gray-100 text-gray-700"}`}
          >
            {s} {s !== "ALL" && `(${bookings.filter((b) => b.status === s).length})`}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((b) => (
          <div key={b.id} className="rounded-xl border bg-white p-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold">{b.date}</p>
                <p className="text-sm text-gray-500">{b.user.name ?? b.user.email}</p>
                <p className="text-xs text-gray-400">
                  {b.slots.map((s) => `${s.rink.name} ${s.timeSlot}${s.playerName ? ` (${s.playerName})` : ""}`).join(", ")}
                </p>
                {b.payment && (
                  <p className="text-xs mt-1">
                    {t("bookingAdmin.payment", { amount: (b.payment.amount / 100).toFixed(2), status: b.payment.status })}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1 items-end">
                <span className={`text-xs font-medium px-2 py-1 rounded ${
                  b.status === "CONFIRMED" ? "bg-green-100 text-green-700" :
                  b.status === "CANCELLED" ? "bg-red-100 text-red-700" :
                  "bg-yellow-100 text-yellow-700"
                }`}>{b.status}</span>
                <div className="flex gap-1 mt-1">
                  {b.status === "REQUESTED" && (
                    <>
                      <button onClick={() => updateStatus(b.id, "APPROVED")} className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">{t("bookingAdmin.approve")}</button>
                      <button onClick={() => updateStatus(b.id, "CANCELLED")} className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">{t("bookingAdmin.reject")}</button>
                    </>
                  )}
                  {b.status === "APPROVED" && (
                    <button onClick={() => updateStatus(b.id, "RESERVED")} className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700">{t("bookingAdmin.sendToPayment")}</button>
                  )}
                  {b.status === "RESERVED" && (
                    <button onClick={() => updateStatus(b.id, "CONFIRMED")} className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">{t("bookingAdmin.confirm")}</button>
                  )}
                  {["APPROVED", "RESERVED", "CONFIRMED"].includes(b.status) && (
                    <button onClick={() => updateStatus(b.id, "CANCELLED")} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200">{t("bookingAdmin.cancelAction")}</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-gray-400">{t("bookingAdmin.noBookings")}</p>}
      </div>
        </>
      )}
    </div>
  );
}
