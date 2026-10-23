/**
 * Shared time-slot helpers (client-safe, no I/O). Used by the availability
 * grid, the booking modal and the booking API so they agree on what a slot is.
 */

export const DEFAULT_OPENING_TIME = "08:00";
export const DEFAULT_CLOSING_TIME = "20:00";
export const DEFAULT_TIMEZONE = "Europe/London";

/** Slots are one hour long. */
export const SLOT_MINUTES = 60;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes after midnight for a strict "HH:MM" string, or null if malformed. */
export function parseTimeSlot(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = HHMM.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Hourly slot start times from `open` up to (not including) `close`,
 * keeping the opening minutes: 08:30–12:00 gives 08:30, 09:30, 10:30, 11:30.
 */
export function generateTimeSlots(open: string, close: string): string[] {
  const start = parseTimeSlot(open);
  const end = parseTimeSlot(close);
  if (start === null || end === null) return [];
  const slots: string[] = [];
  for (let t = start; t < end; t += SLOT_MINUTES) {
    slots.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  }
  return slots;
}

/** Is `date` a real calendar date in strict YYYY-MM-DD form? */
export function isValidIsoDate(date: unknown): date is string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** Today's date (YYYY-MM-DD) in the given IANA timezone. */
export function todayInTimezone(timezone: string | null | undefined, now: Date = new Date()): string {
  const tz = timezone || DEFAULT_TIMEZONE;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
}
