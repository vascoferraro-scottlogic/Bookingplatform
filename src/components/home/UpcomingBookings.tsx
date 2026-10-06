"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDateCustom } from "@/lib/format";

interface Booking {
  id: string;
  date: string;
  status: string;
  slots: { rink: { name: string }; timeSlot: string; greenName?: string }[];
}

const STATUS_COLORS: Record<string, string> = {
  REQUESTED: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-blue-100 text-blue-800",
  RESERVED: "bg-purple-100 text-purple-800",
  CONFIRMED: "bg-green-100 text-green-800",
  CANCELLED: "bg-gray-100 text-gray-500",
};

export default function UpcomingBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const locale = useLocale();
  const t = useTranslations("common");

  useEffect(() => {
    fetch("/api/bookings")
      .then((r) => r.json())
      .then((data: Booking[]) => {
        const today = new Date().toISOString().slice(0, 10);
        const upcoming = data
          .filter((b) => b.date >= today && b.status !== "CANCELLED")
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 3);
        setBookings(upcoming);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border bg-white p-6 shadow-sm animate-pulse">
        <div className="h-5 w-40 bg-gray-200 rounded mb-4" />
        <div className="space-y-3">
          <div className="h-12 bg-gray-100 rounded" />
          <div className="h-12 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800">{t("upcomingBookings.title")}</h3>
        <Link href="/dashboard/bookings" className="text-sm text-green-600 hover:underline">
          {t("upcomingBookings.viewAll")}
        </Link>
      </div>
      {bookings.length === 0 ? (
        <p className="text-sm text-gray-500">{t("upcomingBookings.noUpcoming")}</p>
      ) : (
        <ul className="space-y-3">
          {bookings.map((b) => (
            <li key={b.id} className="flex items-center justify-between rounded-md bg-gray-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-800">
                  {formatDateCustom(b.date + "T00:00:00", locale, { weekday: "short", month: "short", day: "numeric" })}
                </p>
                <p className="text-xs text-gray-500">
                  {b.slots.map((s) => `${s.greenName ? s.greenName + " — " : ""}${s.rink.name} @ ${s.timeSlot}`).join(", ")}
                </p>
              </div>
              <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${STATUS_COLORS[b.status] ?? "bg-gray-100 text-gray-600"}`}>
                {b.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
