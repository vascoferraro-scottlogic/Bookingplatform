/**
 * Weather provider for the agent system (OpenWeatherMap One Call 3.0).
 *
 * Provides multi-day forecast data used by the Triage Agent when
 * evaluating weather-sensitive booking decisions.
 *
 * Env:
 *   AGENT_OWM_API_KEY  — required; missing = weather context disabled
 */

export interface AgentWeatherDay {
  date: string; // ISO date YYYY-MM-DD
  tempMaxC: number;
  tempMinC: number;
  precipitationMm: number;
  rainProbability: number; // 0-1
  rainLikelihood: "HIGH" | "MEDIUM" | "LOW";
  description: string;
}

export interface AgentWeatherForecast {
  available: boolean;
  reason?: string;
  days: AgentWeatherDay[];
}

function classifyRain(prob: number): AgentWeatherDay["rainLikelihood"] {
  if (prob >= 0.7) return "HIGH";
  if (prob >= 0.3) return "MEDIUM";
  return "LOW";
}

interface OwmDailyEntry {
  dt: number;
  temp: { min: number; max: number };
  pop: number;
  rain?: number;
  weather: { description: string }[];
}

interface OwmOneCallResponse {
  daily?: OwmDailyEntry[];
}

/**
 * Fetch a 7-day forecast for the supplied coordinates. Returns
 * `{ available: false }` when the API key is missing, the call fails, or
 * coordinates are missing — agents must handle this gracefully.
 */
export async function fetchWeatherForecast(
  lat: number | null,
  lng: number | null,
): Promise<AgentWeatherForecast> {
  if (lat == null || lng == null) {
    return { available: false, reason: "missing coordinates", days: [] };
  }
  const apiKey = process.env.AGENT_OWM_API_KEY;
  if (!apiKey) {
    return { available: false, reason: "AGENT_OWM_API_KEY not set", days: [] };
  }

  const url =
    `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lng}` +
    `&exclude=current,minutely,hourly,alerts&units=metric&appid=${apiKey}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    return { available: false, reason: `network: ${(e as Error).message}`, days: [] };
  }

  if (!res.ok) {
    return { available: false, reason: `http ${res.status}`, days: [] };
  }
  const json = (await res.json()) as OwmOneCallResponse;
  const daily = json.daily ?? [];

  const days: AgentWeatherDay[] = daily.slice(0, 7).map((d) => {
    const date = new Date(d.dt * 1000).toISOString().slice(0, 10);
    const prob = typeof d.pop === "number" ? d.pop : 0;
    return {
      date,
      tempMaxC: d.temp.max,
      tempMinC: d.temp.min,
      precipitationMm: d.rain ?? 0,
      rainProbability: prob,
      rainLikelihood: classifyRain(prob),
      description: d.weather?.[0]?.description ?? "unknown",
    };
  });

  return { available: true, days };
}

/** Format a forecast for inclusion in an LLM prompt. */
export function forecastToPromptText(f: AgentWeatherForecast): string {
  if (!f.available) return `(weather context unavailable: ${f.reason ?? "unknown"})`;
  if (f.days.length === 0) return "(no forecast days returned)";
  return f.days
    .map(
      (d) =>
        `- ${d.date}: ${d.description}, ${d.tempMinC.toFixed(0)}–${d.tempMaxC.toFixed(0)}°C, ` +
        `rain ${d.rainLikelihood} (${(d.rainProbability * 100).toFixed(0)}%, ${d.precipitationMm}mm)`,
    )
    .join("\n");
}
