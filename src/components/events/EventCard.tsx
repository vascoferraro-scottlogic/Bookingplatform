"use client";

import { formatCurrency, formatDateCustom } from "@/lib/format";
import { useTranslations } from "next-intl";

type EventData = {
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
  tenantName?: string;
  tenantLocality?: string | null;
};

const CATEGORY_COLORS: Record<string, string> = {
  SOCIAL: "bg-blue-100 text-blue-700",
  COMPETITION: "bg-red-100 text-red-700",
  LEAGUE: "bg-purple-100 text-purple-700",
  OPEN_DAY: "bg-yellow-100 text-yellow-800",
  TOURNAMENT: "bg-orange-100 text-orange-700",
  OTHER: "bg-gray-100 text-gray-600",
};

const CATEGORY_LABELS: Record<string, string> = {
  SOCIAL: "Social",
  COMPETITION: "Competition",
  LEAGUE: "League",
  OPEN_DAY: "Open Day",
  TOURNAMENT: "Tournament",
  OTHER: "Other",
};

const FORMAT_LABELS: Record<string, string> = {
  KNOCKOUT: "Knockout",
  AMERICAN: "American",
  LEAGUE_FORMAT: "League",
  CANADIAN: "Canadian",
  OTHER_FORMAT: "Other",
};

const PLAYER_COUNT_LABELS: Record<string, string> = {
  SINGLES: "Singles",
  PAIRS: "Pairs",
  TRIPLES: "Triples",
  FOURS: "Fours",
};

function formatFee(pence: number, currency: string, locale: string) {
  return formatCurrency(pence, locale, currency);
}

function formatEventDate(iso: string, locale: string) {
  return formatDateCustom(iso + "T00:00:00", locale, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export default function EventCard({ event, locale = "en" }: { event: EventData; locale?: string }) {
  const t = useTranslations("events");
  return (
    <div className="border rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow">
      {event.imageUrl && (
        <img src={event.imageUrl} alt={event.title} className="w-full h-40 object-cover rounded mb-3" />
      )}

      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${CATEGORY_COLORS[event.category] ?? "bg-gray-100 text-gray-600"}`}>
          {CATEGORY_LABELS[event.category] ?? event.category}
        </span>
        {event.format && (
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{FORMAT_LABELS[event.format] ?? event.format}</span>
        )}
        {event.playerCount && (
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{PLAYER_COUNT_LABELS[event.playerCount] ?? event.playerCount}</span>
        )}
        {event.tenantName && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-indigo-100 text-indigo-700">{event.tenantName}{event.tenantLocality ? ` — ${event.tenantLocality}` : ""}</span>
        )}
      </div>

      <h3 className="font-semibold text-lg mb-1">{event.title}</h3>

      <div className="flex items-center gap-3 text-sm text-gray-500 mb-2">
        <span>📅 {formatEventDate(event.date, locale)}</span>
        <span>🕐 {event.startTime}{event.endTime ? ` – ${event.endTime}` : ""}</span>
      </div>

      <p className="text-sm text-gray-600 mb-3 line-clamp-3">{event.description}</p>

      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
        {event.location && <span>📍 {event.location}</span>}
        {event.capacity != null && <span>👥 {t("card.capacity", { count: event.capacity })}</span>}
        {event.entryFee != null && <span>💷 {formatFee(event.entryFee, event.currency, locale)}</span>}
      </div>
    </div>
  );
}
