"use client";

import { useTranslations } from "next-intl";

type DailyForecast = {
  temperatureMax: number;
  temperatureMin: number;
  precipitation: number;
  windSpeed: number;
  weatherCode: number;
  description: string;
};

type HourlyForecast = {
  time: string;
  temperature: number;
  precipitation: number;
  weatherCode: number;
  windSpeed: number;
  description: string;
};

type WeatherData = {
  available: boolean;
  date?: string;
  daily?: DailyForecast;
  hourly?: HourlyForecast[] | null;
};

function weatherEmoji(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 3) return "⛅";
  if (code <= 48) return "🌫️";
  if (code <= 57) return "🌧️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "🌨️";
  if (code <= 82) return "🌦️";
  if (code <= 86) return "🌨️";
  if (code >= 95) return "⛈️";
  return "🌤️";
}

export default function WeatherCard({ weather }: { weather: WeatherData | null }) {
  const t = useTranslations("bookings");
  if (!weather || !weather.available || !weather.daily) return null;

  const { daily, hourly } = weather;

  return (
    <div className="rounded-xl border bg-gradient-to-r from-blue-50 to-sky-50 p-4 mb-4">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-3xl">{weatherEmoji(daily.weatherCode)}</span>
        <div>
          <p className="font-semibold text-gray-800">{daily.description}</p>
          <p className="text-sm text-gray-500">
            {daily.temperatureMin}°C — {daily.temperatureMax}°C
            {daily.precipitation > 0 && <span className="ml-2">💧 {daily.precipitation}mm</span>}
            <span className="ml-2">💨 {daily.windSpeed} km/h</span>
          </p>
        </div>
      </div>

      {hourly && hourly.length > 0 && (
        <div className="mt-3 border-t border-blue-100 pt-3">
          <p className="text-xs text-gray-400 mb-2">{t("weather.hourlyForecast")}</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {hourly.map((h) => {
              const hour = h.time.split("T")[1]?.slice(0, 5) ?? h.time;
              return (
                <div key={h.time} className="flex flex-col items-center min-w-[3.5rem] text-xs">
                  <span className="text-gray-500">{hour}</span>
                  <span className="text-lg">{weatherEmoji(h.weatherCode)}</span>
                  <span className="font-medium">{h.temperature}°</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
