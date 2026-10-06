"use client";

import { useEffect, useState } from "react";
import { formatShortRef } from "@/lib/refs";
import { useSession } from "next-auth/react";
import AvailabilityGrid from "@/components/booking/AvailabilityGrid";
import WeatherCard from "@/components/booking/WeatherCard";
import { useTrack } from "@/components/TrackingProvider";
import { getClientEffectiveRole } from "@/lib/effective-role-client";
import { useTranslations } from "next-intl";

type Tenant = { id: string; name: string; slug: string };

type Member = { id: string; name: string | null; email: string };

type Booking = {
  id: string;
  date: string;
  status: string;
  adminOverride?: boolean;
  overrideReason?: string;
  slots: { rink: { name: string }; timeSlot: string; playerName?: string; greenName?: string }[];
  user?: { id: string; name: string; email: string };
  bookedByUser?: { id: string; name: string; email: string } | null;
  payment?: { id: string; status: string; amount: number; checkoutUrl?: string };
};

export default function BookingsPage() {
  const { data: session } = useSession();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [availability, setAvailability] = useState<any[]>([]);
  const [tenantConfig, setTenantConfig] = useState<{
    openingTime: string; closingTime: string; seasonStart: string | null; seasonEnd: string | null;
  } | null>(null);
  const [weather, setWeather] = useState<any>(null);

  // Booking modal state
  const [bookingRink, setBookingRink] = useState<{ id: string; name: string; bookedSlots: string[] } | null>(null);
  const [bookingTimeSlot, setBookingTimeSlot] = useState("");
  const [bookingPlayerName, setBookingPlayerName] = useState("");
  const [bookingError, setBookingError] = useState("");
  const [bookingLoading, setBookingLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // Book-on-behalf state (admin only)
  const [members, setMembers] = useState<Member[]>([]);
  const [bookForUserId, setBookForUserId] = useState("");
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const eff = getClientEffectiveRole(session);
  // Non-impersonating platform admins are redirected away from this page by
  // the dashboard layout, so the legacy tenant-picker UI is now dead. We keep
  // the variable to avoid a structural rewrite.
  const isPlatformAdmin = false;
  const isAdmin = eff.isTenantAdminEffective;
  const { trackFeature, trackAction } = useTrack();
  const t = useTranslations("bookings");
  const tc = useTranslations("common");

  useEffect(() => { trackFeature("booking.grid_opened", "Booking"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch member list for admin's "Book for..." picker
  useEffect(() => {
    if (!isAdmin) return;
    const qs = selectedTenant ? `?tenantId=${encodeURIComponent(selectedTenant)}` : "";
    fetch(`/api/admin/users${qs}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setMembers(Array.isArray(data) ? data : []))
      .catch(() => setMembers([]));
  }, [isAdmin, selectedTenant]);

  // Fetch tenant list only for platform admins
  useEffect(() => {
    if (!isPlatformAdmin) return;
    fetch("/api/admin/tenants")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (Array.isArray(data)) setTenants(data); })
      .catch(() => {});
  }, [isPlatformAdmin]);

  function loadData(tenantId?: string) {
    const qs = tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : "";
    const bqs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
    fetch(`/api/bookings${bqs}`)
      .then((r) => r.json())
      .then((d) => setBookings(Array.isArray(d) ? d : []))
      .catch(() => {});
    fetch(`/api/bookings/availability?date=${date}${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d === "object" && !Array.isArray(d)) {
          setAvailability(Array.isArray(d.greens) ? d.greens : []);
          if (d.config) setTenantConfig(d.config);
        } else {
          setAvailability(Array.isArray(d) ? d : []);
        }
      })
      .catch(() => {});
    fetch(`/api/bookings/weather?date=${date}${qs}`)
      .then((r) => r.json())
      .then((d) => setWeather(d))
      .catch(() => setWeather(null));
  }

  // Reload when tenant selection or date changes
  useEffect(() => {
    if (isPlatformAdmin && !selectedTenant) {
      setBookings([]);
      setAvailability([]);
      return;
    }
    loadData(selectedTenant || undefined);
  }, [selectedTenant, isPlatformAdmin, date]);

  function generateTimeSlots(open: string, close: string): string[] {
    const slots: string[] = [];
    const [oh, om] = open.split(":").map(Number);
    const [ch, cm] = close.split(":").map(Number);
    let h = oh, m = om;
    while (h < ch || (h === ch && m < cm)) {
      slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      h += 1;
    }
    return slots;
  }

  const timeSlots = tenantConfig
    ? generateTimeSlots(tenantConfig.openingTime, tenantConfig.closingTime)
    : ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"];

  async function updateStatus(id: string, status: string) {
    const res = await fetch(`/api/bookings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setSuccessMsg("");
      alert(err.error ?? `Failed to ${status.toLowerCase()} booking`);
      return;
    }
    setSuccessMsg(`Booking ${status.toLowerCase()} successfully.`);
    trackAction(`booking.${status.toLowerCase()}`, "Booking", id);
    loadData(selectedTenant || undefined);
  }

  function openBookingModal(rink: any, preselectedSlot?: string) {
    const bookedSlots: string[] = (rink.bookingSlots ?? []).map((s: any) => s.timeSlot);
    setBookingRink({ id: rink.id, name: rink.name, bookedSlots });
    setBookingTimeSlot(preselectedSlot && !bookedSlots.includes(preselectedSlot) ? preselectedSlot : "");
    setBookingPlayerName("");
    setBookingError("");
    setBookForUserId("");
    setShowOverride(false);
    setOverrideReason("");
  }

  async function handleBook() {
    if (!bookingRink || !bookingTimeSlot) return;
    setBookingLoading(true);
    setBookingError("");
    try {
      const body: Record<string, unknown> = {
        date,
        slots: [{ rinkId: bookingRink.id, timeSlot: bookingTimeSlot, playerName: bookingPlayerName || undefined }],
      };
      if (selectedTenant) body.tenantId = selectedTenant;
      if (bookForUserId) body.bookForUserId = bookForUserId;
      if (showOverride) {
        body.adminOverride = true;
        body.overrideReason = overrideReason;
      }
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setBookingError(err.error ?? "Booking failed");
      } else {
        const bookingRes = await res.json().catch(() => null);
        setBookingRink(null);
        const target = bookForUserId
          ? members.find((m) => m.id === bookForUserId)?.name ?? "member"
          : "you";
        const ref = bookingRes?.id ? ` Ref: ${formatShortRef(bookingRes.id)}` : "";
        setSuccessMsg(`Booking requested for ${target} successfully!${ref}`);
        trackAction("booking.created", "Booking");
        loadData(selectedTenant || undefined);
      }
    } catch {
      setBookingError("Network error, please try again");
    } finally {
      setBookingLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      {successMsg && <p className="text-green-600 text-sm rounded bg-green-50 border border-green-200 px-4 py-2">{successMsg}</p>}

      {isPlatformAdmin && (
        <div>
          <label className="text-sm font-medium text-gray-700 mr-2">Tenant:</label>
          <select
            value={selectedTenant}
            onChange={(e) => setSelectedTenant(e.target.value)}
            className="rounded border p-2 text-sm"
          >
            <option value="">— Select a club —</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name} (/{t.slug})</option>
            ))}
          </select>
        </div>
      )}

      {isPlatformAdmin && !selectedTenant ? (
        <p className="text-gray-400">{t("selectTenant")}</p>
      ) : (
        <>

      {/* Availability grid */}
      <section>
        <h2 className="text-lg font-semibold">{t("availability")}</h2>
        <WeatherCard weather={weather} />
        <AvailabilityGrid
          greens={availability.map((green: any) => ({
            id: green.id,
            name: green.name,
            season: green.season ?? undefined,
            rinks: (green.rinks ?? []).map((rink: any) => ({
              id: rink.id,
              name: rink.name,
              bookedSlots: (rink.bookingSlots ?? []).map((s: any) => s.timeSlot),
            })),
          }))}
          config={{
            openingTime: tenantConfig?.openingTime ?? "09:00",
            closingTime: tenantConfig?.closingTime ?? "18:00",
          }}
          date={date}
          onDateChange={setDate}
          onSlotClick={(rink, slot) => openBookingModal(rink, slot)}
        />
      </section>

      {/* Bookings list */}
      <section>
        <h2 className="text-lg font-semibold">{isAdmin ? t("allBookings") : t("myBookings")}</h2>
        <div className="mt-2 space-y-2">
          {bookings.map((b) => (
            <div key={b.id} className="rounded border bg-white p-4 flex justify-between items-start">
              <div>
                <p className="font-medium">{b.date}</p>
                {isAdmin && (
                  <p className="text-xs text-gray-400">Ref: <span className="font-mono">{formatShortRef(b.id)}</span></p>
                )}
                {isAdmin && b.user && (
                  <p className="text-xs text-gray-400">{b.user.name ?? b.user.email}</p>
                )}
                {b.bookedByUser && b.bookedByUser.id !== b.user?.id && (
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                    Booked by {b.bookedByUser.name ?? b.bookedByUser.email}
                  </span>
                )}
                {b.adminOverride && (
                  <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded" title={b.overrideReason ?? ""}>
                    Override
                  </span>
                )}
                <p className="text-sm text-gray-500">
                  {b.slots.map((s) => `${s.greenName ? s.greenName + " — " : ""}${s.rink.name} ${s.timeSlot}`).join(", ")}
                </p>
              </div>
              <div className="flex flex-col gap-1 items-end">
                <span className={`text-xs font-medium px-2 py-1 rounded ${
                  b.status === "CONFIRMED" ? "bg-green-100 text-green-700" :
                  b.status === "CANCELLED" ? "bg-red-100 text-red-700" :
                  b.status === "NO_SHOW" ? "bg-orange-100 text-orange-700" :
                  "bg-yellow-100 text-yellow-700"
                }`}>
                  {b.status}
                </span>
                {isAdmin && (
                  <div className="flex gap-1 mt-1 flex-wrap justify-end">
                    {b.status === "REQUESTED" && (
                      <>
                        <button onClick={() => updateStatus(b.id, "APPROVED")} className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">{t("actions.approve")}</button>
                        <button onClick={() => updateStatus(b.id, "CANCELLED")} className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">{t("actions.reject")}</button>
                      </>
                    )}
                    {b.status === "APPROVED" && (
                      <button onClick={() => updateStatus(b.id, "RESERVED")} className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700">{t("actions.sendToPayment")}</button>
                    )}
                    {b.status === "RESERVED" && (
                      <button onClick={() => updateStatus(b.id, "CONFIRMED")} className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">{t("actions.confirm")}</button>
                    )}
                    {b.status === "CONFIRMED" && new Date(b.date).getTime() <= Date.now() && (
                      <button onClick={() => updateStatus(b.id, "NO_SHOW")} className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded hover:bg-orange-200">{t("actions.markNoShow")}</button>
                    )}
                    {["APPROVED", "RESERVED", "CONFIRMED"].includes(b.status) && (
                      <button onClick={() => updateStatus(b.id, "CANCELLED")} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200">Cancel</button>
                    )}
                  </div>
                )}
                {!isAdmin && ["REQUESTED", "APPROVED"].includes(b.status) && (
                  <button onClick={() => updateStatus(b.id, "CANCELLED")} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200">Cancel</button>
                )}
                {b.status === "RESERVED" && b.payment?.status === "PENDING" && (
                  <button
                    onClick={async () => {
                      const res = await fetch(`/api/bookings/${b.id}/checkout`, { method: "POST" });
                      if (res.ok) {
                        setSuccessMsg("Payment completed!");
                        loadData(selectedTenant || undefined);
                      } else {
                        const err = await res.json().catch(() => ({}));
                        alert(err.error ?? "Payment failed");
                      }
                    }}
                    className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                  >
                    Pay £{((b.payment?.amount ?? 0) / 100).toFixed(2)}
                  </button>
                )}
                {b.payment && (
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    b.payment.status === "PAID" ? "bg-green-100 text-green-700" :
                    b.payment.status === "REFUNDED" ? "bg-blue-100 text-blue-700" :
                    "bg-yellow-100 text-yellow-700"
                  }`}>
                    £{(b.payment.amount / 100).toFixed(2)} {b.payment.status}
                  </span>
                )}
              </div>
            </div>
          ))}
          {bookings.length === 0 && <p className="text-gray-400">{t("noBookings")}</p>}
        </div>
      </section>
        </>
      )}

      {/* Booking modal */}
      {bookingRink && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4">
            <h2 className="text-lg font-bold">{t("modal.bookRink", { rink: bookingRink.name })}</h2>
            <p className="text-sm text-gray-500">{date}</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("modal.timeSlot")}</label>
              <select
                value={bookingTimeSlot}
                onChange={(e) => setBookingTimeSlot(e.target.value)}
                className="w-full rounded border p-2 text-sm"
              >
                <option value="">{t("modal.selectTime")}</option>
                {timeSlots.filter((s) => !bookingRink.bookedSlots.includes(s)).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("modal.playerName")}</label>
              <input
                type="text"
                value={bookingPlayerName}
                onChange={(e) => setBookingPlayerName(e.target.value)}
                className="w-full rounded border p-2 text-sm"
                placeholder={t("modal.playerNamePlaceholder")}
              />
            </div>
            {isAdmin && members.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t("modal.bookFor")}</label>
                <select
                  value={bookForUserId}
                  onChange={(e) => setBookForUserId(e.target.value)}
                  className="w-full rounded border p-2 text-sm"
                >
                  <option value="">{t("modal.myself")}</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name ?? m.email}</option>
                  ))}
                </select>
              </div>
            )}
            {isAdmin && (
              <div className="border-t pt-3">
                <button
                  type="button"
                  onClick={() => setShowOverride(!showOverride)}
                  className="text-sm text-amber-700 hover:underline"
                >
                  {showOverride ? `▾ ${t("modal.adminOverride")}` : `▸ ${t("modal.adminOverride")}`}
                </button>
                {showOverride && (
                  <div className="mt-2">
                    <textarea
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      className="w-full rounded border p-2 text-sm"
                      placeholder={t("modal.overridePlaceholder")}
                      rows={2}
                    />
                  </div>
                )}
              </div>
            )}
            {bookingError && <p className="text-sm text-red-600">{bookingError}</p>}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setBookingRink(null)}
                className="px-4 py-2 text-sm rounded border text-gray-600 hover:bg-gray-50"
              >
                {tc("actions.cancel")}
              </button>
              <button
                onClick={handleBook}
                disabled={!bookingTimeSlot || bookingLoading}
                className="px-4 py-2 text-sm rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {bookingLoading ? t("modal.booking") : t("modal.requestBooking")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
