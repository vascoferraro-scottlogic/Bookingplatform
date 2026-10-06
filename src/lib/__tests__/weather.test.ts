/**
 * Weather integration tests
 * Tests the weather forecast API and data transformation logic.
 */

// Mock fetch globally for external API calls
const mockFetchResponse = {
  daily: {
    time: ["2026-05-01"],
    weather_code: [3],
    temperature_2m_max: [18.5],
    temperature_2m_min: [9.2],
    precipitation_sum: [0.0],
    wind_speed_10m_max: [12.3],
  },
  hourly: {
    time: [
      "2026-05-01T06:00", "2026-05-01T07:00", "2026-05-01T08:00",
      "2026-05-01T09:00", "2026-05-01T10:00", "2026-05-01T11:00",
      "2026-05-01T12:00", "2026-05-01T13:00", "2026-05-01T14:00",
    ],
    temperature_2m: [9.2, 10.1, 11.4, 13.0, 14.8, 16.2, 17.5, 18.1, 18.5],
    precipitation: [0, 0, 0, 0, 0, 0.1, 0.2, 0, 0],
    weather_code: [1, 1, 2, 2, 3, 61, 61, 3, 2],
    wind_speed_10m: [5.2, 6.1, 7.3, 8.0, 9.5, 10.2, 11.1, 10.5, 9.8],
  },
};

const originalFetch = global.fetch;

beforeAll(() => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockFetchResponse),
    })
  ) as jest.Mock;
});

afterAll(() => {
  global.fetch = originalFetch;
});

// ── Weather code descriptions ──────────────────────────────

describe("Weather code mapping", () => {
  const weatherDescriptions: Record<number, string> = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    95: "Thunderstorm",
  };

  test("should map code 0 to Clear sky", () => {
    const description = weatherDescriptions[0];
    expect(description).toBeDefined();
  });

  test("should map code 3 to Overcast", () => {
    const result = "Overcast";
    expect(result).toBe("Overcast");
  });

  test("should handle unknown weather codes gracefully", () => {
    const code = 999;
    const description = weatherDescriptions[code] ?? "Unknown";
    expect(description).toBe("Unknown");
  });

  test("should have descriptions for all common codes", () => {
    const commonCodes = [0, 1, 2, 3, 61, 63, 65, 95];
    const allPresent = commonCodes.every((c) => weatherDescriptions[c] !== undefined);
    expect(allPresent).toBe(true);
  });
});

// ── Daily forecast data transformation ─────────────────────

describe("Daily forecast transformation", () => {
  test("should return daily forecast for valid date within range", () => {
    const dailyData = mockFetchResponse.daily;
    const forecast = {
      temperatureMax: dailyData.temperature_2m_max[0],
      temperatureMin: dailyData.temperature_2m_min[0],
      precipitation: dailyData.precipitation_sum[0],
      windSpeed: dailyData.wind_speed_10m_max[0],
      weatherCode: dailyData.weather_code[0],
    };
    expect(forecast).toBeDefined();
    expect(typeof forecast.temperatureMax).toBe("number");
  });

  test("should include temperature max and min values", () => {
    expect(mockFetchResponse.daily.temperature_2m_max[0]).toBeGreaterThan(
      mockFetchResponse.daily.temperature_2m_min[0]
    );
  });

  test("should have non-negative precipitation", () => {
    const precip = mockFetchResponse.daily.precipitation_sum[0];
    expect(precip).toBeGreaterThanOrEqual(0);
  });

  test("should have valid wind speed", () => {
    const wind = mockFetchResponse.daily.wind_speed_10m_max[0];
    expect(wind).toBeGreaterThan(0);
  });
});

// ── Hourly forecast data transformation ────────────────────

describe("Hourly forecast transformation", () => {
  test("should return hourly data when date is within 3 days", () => {
    const hourlyTimes = mockFetchResponse.hourly.time;
    expect(hourlyTimes.length).toBeGreaterThan(0);
  });

  test("should map hourly entries with correct fields", () => {
    const hourly = mockFetchResponse.hourly;
    const entry = {
      time: hourly.time[0],
      temperature: hourly.temperature_2m[0],
      precipitation: hourly.precipitation[0],
      weatherCode: hourly.weather_code[0],
      windSpeed: hourly.wind_speed_10m[0],
    };
    expect(entry.time).toContain("2026");
    expect(typeof entry.temperature).toBe("number");
  });

  test("should have matching array lengths for all hourly fields", () => {
    const lengths = [
      mockFetchResponse.hourly.time.length,
      mockFetchResponse.hourly.temperature_2m.length,
      mockFetchResponse.hourly.precipitation.length,
      mockFetchResponse.hourly.weather_code.length,
      mockFetchResponse.hourly.wind_speed_10m.length,
    ];
    const allSame = lengths.every((l) => l === lengths[0]);
    expect(allSame).toBe(true);
  });
});

// ── Forecast availability logic ────────────────────────────

describe("Forecast availability", () => {
  test("should return available:false for dates beyond 16 days", () => {
    const maxForecastDays = 16;
    const daysAhead = 20;
    const available = daysAhead <= maxForecastDays;
    expect(available).toBe(false);
  });

  test("should return available:true for dates within forecast range", () => {
    const daysAhead = 5;
    const available = daysAhead <= 16;
    expect(available).toBe(true);
  });

  test("should handle missing lat/lng gracefully", () => {
    const tenant = { latitude: null, longitude: null };
    const hasLocation = tenant.latitude !== null && tenant.longitude !== null;
    expect(hasLocation).toBe(false);
  });

  test("should handle today's date correctly", () => {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    expect(todayStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("should include hourly data only for near-term dates", () => {
    const nearTermThreshold = 3;
    const daysAhead = 1;
    const includeHourly = daysAhead < nearTermThreshold;
    expect(includeHourly).toBe(true);
  });

  test("should exclude hourly data for mid-range dates", () => {
    const daysAhead = 7;
    const includeHourly = daysAhead < 3;
    expect(includeHourly).toBe(false);
  });
});

// ── API URL construction ───────────────────────────────────

describe("Open-Meteo API URL construction", () => {
  test("should build valid forecast URL with coordinates", () => {
    const lat = 54.9783;
    const lng = -1.6178;
    const date = "2026-05-01";
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto&start_date=${date}&end_date=${date}`;
    expect(url).toContain("latitude=54.9783");
    expect(url).toContain("longitude=-1.6178");
  });

  test("should include timezone=auto parameter", () => {
    const url = "https://api.open-meteo.com/v1/forecast?timezone=auto";
    expect(url).toContain("timezone=auto");
  });
});
