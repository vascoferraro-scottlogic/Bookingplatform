# Parked plan: UK midge forecast badge (`#midge-forecast`)

**Status as of 2026-05-05**: parked. Design complete, implementation not
started. `Tenant.country` dependency has landed (charity plan shipped it).
No blockers — ready to pick up.

## Why parked

Lower priority than charity/onboarding work that was in flight. Now
unblocked and promoted to Next on the roadmap.

## What shipped

Nothing yet — plan only.

## What's left (refined plan)

Extend the existing booking weather widget with a UK-only midge risk indicator.
No external midge API exists for free; derive a heuristic index from the
weather data we already fetch from Open-Meteo (temperature, wind, humidity,
time-of-day) and surface it inside the existing `WeatherCard`. **Gated on
`Tenant.country ∈ {GB, NI}`** + per-tenant `midgeForecast` feature flag
(default-on for GB/NI when flag row absent).

### Steps

1. **Extend Open-Meteo fetch with humidity** — `src/app/api/bookings/weather/route.ts`: add `relative_humidity_2m` to the `hourly` query (both code paths), and `relative_humidity_2m_mean` to the `daily` query. Daily-only branch (>=3 days out) accepts "no midge detail >3d out" to keep API calls minimal.

2. **Create midge heuristic module** — new `src/lib/midge.ts`:
   - `isUkCountry(country: string | null | undefined): boolean` — true for `"GB"` or `"NI"`.
   - `MidgeRisk = "none" | "low" | "moderate" | "high" | "severe"`.
   - `computeMidgeRisk({ tempC, windKph, humidityPct, hourLocal })` — Highland Midge (Culicoides impunctatus) thrives at: temp 9–25°C, wind <7 mph (~11 kph), humidity >75%, dawn/dusk peaks (esp. 6–9pm). Weighted score → bands; document in comments.
   - `summariseDayRisk(hourly: HourlySample[])` → `{ overall: MidgeRisk, peakWindow?: { start, end, risk } }`.
   - Pure functions, no DB / no fetch.

3. **Wire midge into the weather route** — load `tenant.country`; when `isUkCountry(country)` and feature flag enabled, compute midge from daily mean (outer days) or hourly samples (≤3-day). Add to response as `midge: { available, risk?, peakWindow? }`. Never throw — degrade silently.

4. **Feature flag default-on for GB/NI** — `midgeForecast`, free-string in existing `FeatureFlag` table; **no schema change**. Read with `isFeatureEnabled(tenantId, "midgeForecast")`. Treat *missing flag row* as enabled when `isUkCountry(country)`, disabled otherwise. Helper `shouldShowMidge({ tenantId, country })` co-located in `src/lib/midge.ts`.

5. **Render in `WeatherCard`** — `src/components/booking/WeatherCard.tsx`: extend `WeatherData` with optional `midge` block; render 🦟 badge with risk colour + optional peak-window line. Renders nothing when absent (backwards-compatible).

6. **Tests** — `src/lib/__tests__/midge.test.ts`:
   - `isUkCountry` truth-table over `"GB"` / `"NI"` / `"IE"` / `"ES"` / `"US"` / null / undefined.
   - `computeMidgeRisk` fixtures: cold+windy → none; warm+still+humid+evening → severe; warm+windy → low.
   - `summariseDayRisk` peak-window picker.
   - `shouldShowMidge` flag interplay (explicit false in GB → off; absent in GB → on; IE → off regardless).

7. **Help article** — `content/help/en/bookings/midge-forecast.md`: short page on what the badge means, calculation, how to disable.

### Phasing

- Phase A (backend + tests): steps 1, 2, 3, 4, 6 — independently shippable; UI ignores new field.
- Phase B (UI): step 5 — visible in both `availability` (public) and `dashboard/bookings` automatically.
- Phase C (docs): step 7 — parallel with B.

Dependencies: 2 → 3 → 4 → 5; 1 parallel with 2; 6 depends on 2; 7 independent.

### Relevant files

- `src/app/api/bookings/weather/route.ts` — extend Open-Meteo query + attach `midge`.
- `src/lib/midge.ts` — **new**. Heuristic + country gate + `shouldShowMidge`.
- `src/lib/features.ts` — reuse `isFeatureEnabled`; no changes.
- `src/components/booking/WeatherCard.tsx` — render badge.
- `src/app/[slug]/availability/client.tsx` — consumer; no edits.
- `src/app/dashboard/bookings/page.tsx` — consumer; no edits.
- `src/lib/__tests__/midge.test.ts` — **new**.
- `content/help/en/bookings/midge-forecast.md` — **new**.

### Scope decisions

- **Heuristic, not scraping.** No Smidge / midgeforecast.co.uk dependency; ToS-clean, free, reliable.
- **UK = `Tenant.country ∈ {"GB", "NI"}`**, mirroring charity-plan convention.
- **Hard dependency** on charity plan's `Tenant.country` migration — LANDED.
- **Default-on for GB/NI** with absent flag row = enabled; explicit `false` disables. No flag migration.
- **Excluded**: agent prompt integration (UI-only v1), historical midge data, push alerts, badge >3-day outlook.

### Open questions

1. **NI encoding** — `"NI"` isn't strict ISO-3166-1 (UK = `"GB"`, NI sub = `"GB-NIR"`). Mirror whatever the charity plan uses; charity plan uses `"NI"` as a literal enum value — confirmed.
2. **Heuristic provenance** — cite a midge-ecology source in the help article? Recommend yes; cautious "estimated" wording.
3. **Disable toggle UX** — platform-admin feature-flags page (v1) vs tenant-visible `/dashboard/settings` (doesn't exist yet). Recommend platform flags v1.

## Resume signals

- Any session touching the weather route or booking UI.
- User asks for midge / weather enhancement.

## Cross-refs

- `DECISIONS.md` 2026-05-03 — "Midge forecast feature: gating + dependency"
- `ROADMAP.md` — Next
- `IN_FLIGHT.md` — Just parked
