import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/features";

const weatherDescriptions: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snowfall",
  73: "Moderate snowfall",
  75: "Heavy snowfall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

type Params = { params: Promise<{ slug: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const date = req.nextUrl.searchParams.get("date");

  if (!date) {
    return NextResponse.json({ error: "date parameter required" }, { status: 400 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, latitude: true, longitude: true, active: true },
  });

  if (!tenant || !tenant.active) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const flagOn = await isFeatureEnabled(tenant.id, "weather");
  if (!flagOn) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!tenant.latitude || !tenant.longitude) {
    return NextResponse.json({ available: false });
  }

  // Check if date is within 16 day forecast range
  const now = new Date();
  const target = new Date(date + "T00:00:00");
  const diffDays = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays > 16) {
    return NextResponse.json({ available: false });
  }

  // If date is less than 3 days away, fetch hourly too
  if (diffDays < 3) {
    const dailyRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${tenant.latitude}&longitude=${tenant.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto&start_date=${date}&end_date=${date}`
    );
    const dailyData = await dailyRes.json();

    const hourlyRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${tenant.latitude}&longitude=${tenant.longitude}&hourly=temperature_2m,precipitation,weather_code,wind_speed_10m&timezone=auto&start_date=${date}&end_date=${date}`
    );
    const hourlyData = await hourlyRes.json();

    const daily = {
      temperatureMax: dailyData.daily.temperature_2m_max[0],
      temperatureMin: dailyData.daily.temperature_2m_min[0],
      precipitation: dailyData.daily.precipitation_sum[0],
      windSpeed: dailyData.daily.wind_speed_10m_max[0],
      weatherCode: dailyData.daily.weather_code[0],
      description: weatherDescriptions[dailyData.daily.weather_code[0]] ?? "Unknown",
    };

    const hourly = (hourlyData.hourly.time as string[]).map((time: string, i: number) => ({
      time,
      temperature: hourlyData.hourly.temperature_2m[i],
      precipitation: hourlyData.hourly.precipitation[i],
      weatherCode: hourlyData.hourly.weather_code[i],
      windSpeed: hourlyData.hourly.wind_speed_10m[i],
      description: weatherDescriptions[hourlyData.hourly.weather_code[i]] ?? "Unknown",
    }));

    return NextResponse.json({ available: true, date, daily, hourly });
  }

  // 3-16 days out: daily only
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${tenant.latitude}&longitude=${tenant.longitude}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto&start_date=${date}&end_date=${date}`
  );
  const data = await res.json();

  const daily = {
    temperatureMax: data.daily.temperature_2m_max[0],
    temperatureMin: data.daily.temperature_2m_min[0],
    precipitation: data.daily.precipitation_sum[0],
    windSpeed: data.daily.wind_speed_10m_max[0],
    weatherCode: data.daily.weather_code[0],
    description: weatherDescriptions[data.daily.weather_code[0]] ?? "Unknown",
  };

  return NextResponse.json({ available: true, date, daily, hourly: null });
}
