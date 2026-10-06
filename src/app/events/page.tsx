"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import EventCard from "@/components/events/EventCard";

const CATEGORIES = ["ALL", "SOCIAL", "COMPETITION", "LEAGUE", "OPEN_DAY", "TOURNAMENT", "OTHER"] as const;

type EventWithTenant = {
  id: string;
  title: string;
  description: string;
  category: string;
  format: string | null;
  playerCount: string | null;
  date: string;
  startTime: string;
  endTime: string | null;
  location: string | null;
  capacity: number | null;
  entryFee: number | null;
  currency: string;
  imageUrl: string | null;
  visibility: string;
  tenant: { name: string; slug: string; brandColor: string };
};

export default function GlobalEventsPage() {
  const t = useTranslations("common");
  const [events, setEvents] = useState<EventWithTenant[]>([]);
  const [category, setCategory] = useState("ALL");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (category !== "ALL") params.set("category", category);
    fetch(`/api/public/events?${params}`)
      .then((r) => r.json())
      .then((d) => setEvents(Array.isArray(d) ? d : []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [category]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-green-700 px-6 py-8 text-center">
        <h1 className="text-3xl font-bold text-white">{t("globalEvents.title")}</h1>
        <p className="text-green-100 mt-2">{t("globalEvents.subtitle")}</p>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Category filter */}
        <div className="flex gap-2 flex-wrap mb-6">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                category === cat
                  ? "bg-green-600 text-white border-green-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-green-400"
              }`}
            >
              {cat === "ALL" ? "All" : cat === "OPEN_DAY" ? "Open Day" : cat.charAt(0) + cat.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-gray-400 text-center py-12">{t("globalEvents.loading")}</p>
        ) : events.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">{t("globalEvents.noEvents")}</p>
            <Link href="/" className="text-green-600 hover:underline mt-4 inline-block">
              {t("globalEvents.browseClubs")}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {events.map((ev) => (
              <Link key={ev.id} href={`/${ev.tenant.slug}`} className="block">
                <EventCard
                  event={{
                    ...ev,
                    tenantName: ev.tenant.name,
                  }}
                />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Footer CTA */}
      <section className="py-8 px-4 text-center">
        <p className="text-gray-500 mb-3">{t("globalEvents.registerCta")}</p>
        <Link
          href="/auth/register"
          className="inline-block rounded-lg bg-green-600 px-6 py-3 text-white font-medium hover:bg-green-700"
        >
          {t("globalEvents.registerNow")}
        </Link>
      </section>
    </main>
  );
}
