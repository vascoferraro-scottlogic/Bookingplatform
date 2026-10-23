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

export const DEFAULT_CLUB_TIMEZONE = "Europe/London";

/**
 * Normalise a date-only string ("2027-03-15") or an ISO instant to a
 * "YYYY-MM-DD" calendar date. Date-only values are used as-is; instants are
 * converted to the club's timezone (D-05), never the server's.
 */
export function clubDateString(dateStr: string, timeZone: string = DEFAULT_CLUB_TIMEZONE): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(dateStr));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The current calendar year in the club's timezone. */
export function currentClubYear(timeZone: string = DEFAULT_CLUB_TIMEZONE, now: Date = new Date()): number {
  return Number(clubDateString(now.toISOString(), timeZone).slice(0, 4));
}

/** Strict MM-DD check: month 01–12 and a day valid for that month (02-29 allowed). */
export function isValidMMDD(value: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

const yearOf = (isoDate: string) => Number(isoDate.slice(0, 4));

/** 02-29 in a non-leap year means 28 Feb. */
function clampLeapDay(mmdd: string, year: number): string {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return mmdd === "02-29" && !leap ? "02-28" : mmdd;
}

/**
 * Is a green open for bookings on the given date?
 *
 * `dateStr` is a date-only string or an ISO instant (converted to club time).
 */
export function isGreenOpenOn(
  green: GreenSeasonInfo,
  dateStr: string,
  timeZone: string = DEFAULT_CLUB_TIMEZONE,
): boolean {
  if (green.allWeather) return true;

  const d = clubDateString(dateStr, timeZone);
  const year = yearOf(d);

  // Check this year's window
  const window = seasonWindowForYear(green, year);
  if (!window) return true; // no season configured → always open

  if (d >= window.start && d <= window.end) return true;

  // For wrap-around seasons (end in next year), also check the previous year's
  // window — a Jan/Feb date might fall inside last year's Nov→Feb window.
  const prevWindow = seasonWindowForYear(green, year - 1);
  if (prevWindow && yearOf(prevWindow.end) > yearOf(prevWindow.start)) {
    if (d >= prevWindow.start && d <= prevWindow.end) return true;
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
  timeZone: string = DEFAULT_CLUB_TIMEZONE,
): SeasonWindow | null {
  const year = yearOf(clubDateString(dateStr, timeZone));
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
  // If end < start (e.g. 11-01 → 02-28), the season wraps into the next year
  const endYear = endMMDD < startMMDD ? year + 1 : year;

  return {
    start: `${year}-${clampLeapDay(startMMDD, year)}`,
    end: `${endYear}-${clampLeapDay(endMMDD, endYear)}`,
  };
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
  timeZone: string = DEFAULT_CLUB_TIMEZONE,
): number[] {
  const todayYear = yearOf(clubDateString(todayStr, timeZone));
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
