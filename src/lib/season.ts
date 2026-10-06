/**
 * Per-green season logic.
 *
 * Pure functions — no Prisma, no I/O. Easy to unit-test.
 *
 * A green's season is determined by:
 *   1. `allWeather === true` → always open
 *   2. A `GreenSeason` row for the requested year → use its startDate/endDate
 *   3. Recurring `seasonStartMMDD` / `seasonEndMMDD` → auto-derive for the year
 *   4. Neither set → treated as always open (same as pre-feature behaviour)
 */

export interface GreenSeasonRow {
  year: number;
  startDate: string; // ISO date e.g. "2027-03-15"
  endDate: string;
}

export interface GreenSeasonInfo {
  allWeather: boolean;
  seasonStartMMDD: string | null; // "04-01"
  seasonEndMMDD: string | null;   // "09-30"
  seasons?: GreenSeasonRow[];
}

export interface SeasonWindow {
  start: string; // ISO date
  end: string;   // ISO date
}

/**
 * Is a green open for bookings on the given date?
 */
export function isGreenOpenOn(green: GreenSeasonInfo, dateStr: string): boolean {
  if (green.allWeather) return true;

  const d = new Date(dateStr);
  const year = d.getFullYear();

  // Check this year's window
  const window = seasonWindowForYear(green, year);
  if (!window) return true; // no season configured → always open

  if (d >= new Date(window.start) && d <= new Date(window.end)) return true;

  // For wrap-around seasons (end in next year), also check the previous year's
  // window — a Jan/Feb date might fall inside last year's Nov→Feb window.
  const prevWindow = seasonWindowForYear(green, year - 1);
  if (prevWindow && new Date(prevWindow.end) >= new Date(prevWindow.start)) {
    // Only relevant if previous window wraps (end year > start year)
    if (new Date(prevWindow.end).getFullYear() > new Date(prevWindow.start).getFullYear()) {
      if (d >= new Date(prevWindow.start) && d <= new Date(prevWindow.end)) return true;
    }
  }

  return false;
}

/**
 * Return the season window that applies for a given date's year,
 * or null if no season is configured (meaning "always open").
 */
export function seasonWindowForDate(
  green: GreenSeasonInfo,
  dateStr: string,
): SeasonWindow | null {
  const year = new Date(dateStr).getFullYear();
  return seasonWindowForYear(green, year);
}

/**
 * Return the season window for a specific year:
 *   - per-year GreenSeason override wins
 *   - else derive from recurring MM-DD
 *   - else null (no season set)
 */
export function seasonWindowForYear(
  green: GreenSeasonInfo,
  year: number,
): SeasonWindow | null {
  // Per-year override
  const override = green.seasons?.find((s) => s.year === year);
  if (override) {
    return { start: override.startDate, end: override.endDate };
  }

  // Recurring MM-DD
  if (green.seasonStartMMDD && green.seasonEndMMDD) {
    return recurringWindowForYear(green.seasonStartMMDD, green.seasonEndMMDD, year);
  }

  return null;
}

/**
 * Derive a full-date window from a recurring MM-DD pair for a given year.
 *
 * Handles wrap-around (e.g. "11-01" → "02-28" means Nov year → Feb year+1).
 */
export function recurringWindowForYear(
  startMMDD: string,
  endMMDD: string,
  year: number,
): SeasonWindow {
  const start = `${year}-${startMMDD}`;

  // If end < start (e.g. 11-01 → 02-28), the season wraps into the next year
  const end = endMMDD < startMMDD
    ? `${year + 1}-${endMMDD}`
    : `${year}-${endMMDD}`;

  return { start, end };
}

/**
 * Given a green and today's date, return the list of years (up to `horizon`
 * years ahead) for which a bookable season window exists.
 *
 * A year is bookable if:
 *   - It has a per-year GreenSeason override, OR
 *   - The recurring MM-DD pattern applies (i.e. both fields are set)
 *
 * For allWeather greens every year in the range is bookable.
 */
export function bookableYears(
  green: GreenSeasonInfo,
  todayStr: string,
  horizon: number = 2,
): number[] {
  const todayYear = new Date(todayStr).getFullYear();
  const years: number[] = [];

  for (let y = todayYear; y <= todayYear + horizon; y++) {
    if (green.allWeather) {
      years.push(y);
      continue;
    }

    // Has an explicit override for this year?
    if (green.seasons?.some((s) => s.year === y)) {
      years.push(y);
      continue;
    }

    // Has a recurring pattern?
    if (green.seasonStartMMDD && green.seasonEndMMDD) {
      years.push(y);
    }
  }

  return years;
}

/**
 * Human-readable season label for a green on a given year.
 */
export function seasonLabel(green: GreenSeasonInfo, year: number): string {
  if (green.allWeather) return "All weather — open year-round";

  const window = seasonWindowForYear(green, year);
  if (!window) return "No season configured";

  return `${window.start} – ${window.end}`;
}
