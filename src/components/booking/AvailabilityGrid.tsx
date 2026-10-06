"use client";

import { useTranslations } from "next-intl";

type RinkData = {
  id: string;
  name: string;
  bookedSlots: string[];
};

type SeasonWindow = { start: string; end: string } | null;

type GreenData = {
  id: string;
  name: string;
  rinks: RinkData[];
  season?: {
    open: boolean;
    allWeather: boolean;
    window: SeasonWindow;
  };
};

type Config = {
  openingTime: string;
  closingTime: string;
};

function generateTimeSlots(open: string, close: string): string[] {
  const slots: string[] = [];
  const [oh] = open.split(":").map(Number);
  const [ch] = close.split(":").map(Number);
  let h = oh;
  while (h < ch) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    h += 1;
  }
  return slots;
}

export default function AvailabilityGrid({
  greens,
  config,
  date,
  onDateChange,
  onSlotClick,
}: {
  greens: GreenData[];
  config: Config;
  date: string;
  onDateChange: (date: string) => void;
  onSlotClick?: (rink: RinkData, timeSlot: string) => void;
}) {
  const t = useTranslations("bookings");
  const timeSlots = generateTimeSlots(config.openingTime, config.closingTime);

  return (
    <div>
      <input
        type="date"
        value={date}
        onChange={(e) => onDateChange(e.target.value)}
        className="mt-2 rounded border p-2"
      />
      <div className="mt-4 space-y-6">
        {greens.map((green) => {
          const season = green.season;
          const isOpen = season ? season.open : true;

          return (
            <div key={green.id}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-medium text-green-700">{green.name}</h3>
                {season?.allWeather && (
                  <span className="text-xs bg-cyan-100 text-cyan-700 px-1.5 py-0.5 rounded">{t("grid.allWeather")}</span>
                )}
                {season && !season.allWeather && season.window && (
                  <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                    {t("grid.season", { start: season.window.start, end: season.window.end })}
                  </span>
                )}
              </div>

              {!isOpen ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-500">
                  {t("grid.closedForSeason")}
                  {season?.window && (
                    <span className="block text-xs mt-1">
                      {t("grid.nextSeason", { start: season.window.start, end: season.window.end })}
                    </span>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th className="border bg-gray-50 px-3 py-2 text-left text-gray-600 font-medium">{t("grid.time")}</th>
                        {green.rinks.map((rink) => (
                          <th key={rink.id} className="border bg-gray-50 px-3 py-2 text-center font-medium">{rink.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {timeSlots.map((slot) => (
                        <tr key={slot}>
                          <td className="border px-3 py-2 font-medium text-gray-600 whitespace-nowrap">{slot}</td>
                          {green.rinks.map((rink) => {
                            const isBooked = rink.bookedSlots.includes(slot);
                            return isBooked ? (
                              <td key={rink.id} className="border px-3 py-2 bg-red-100 text-red-700 text-center text-xs">
                                {t("grid.booked")}
                              </td>
                            ) : (
                              <td
                                key={rink.id}
                                className={`border px-3 py-2 bg-green-50 text-green-700 text-center text-xs ${
                                  onSlotClick ? "cursor-pointer hover:bg-green-200 transition-colors" : ""
                                }`}
                                {...(onSlotClick ? {
                                  role: "button",
                                  "aria-label": `Book ${rink.name} at ${slot}`,
                                  onClick: () => onSlotClick(rink, slot),
                                } : {})}
                              >
                                {t("grid.open")}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {greens.length === 0 && <p className="text-gray-400">{t("grid.noGreens")}</p>}
      </div>
    </div>
  );
}
