/**
 * Booking time helpers (D-04, D-05, D-13).
 *
 * A booking's `date` is a "YYYY-MM-DD" string and each slot's `timeSlot` is
 * "HH:MM" local time at the club. The slot start is that wall-clock time in the
 * club's timezone (Europe/London when the club has none), never the server's.
 */

export const DEFAULT_TIMEZONE = "Europe/London";

export const CANCELLATION_WINDOW_HOURS = 48;

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant at which `date` + `timeSlot` starts in `timeZone`. */
export function slotStart(date: string, timeSlot: string, timeZone?: string | null): Date {
  const tz = timeZone || DEFAULT_TIMEZONE;
  const [y, m, d] = String(date).slice(0, 10).split("-").map(Number);
  const [hh, mm] = (timeSlot || "00:00").split(":").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  // Two passes settle the offset across a DST change.
  let result = wallAsUtc - zoneOffsetMs(wallAsUtc, tz);
  result = wallAsUtc - zoneOffsetMs(result, tz);
  return new Date(result);
}

/** Start of the earliest slot of a booking (midnight club time if it has none). */
export function bookingStart(
  booking: { date: string; slots?: { timeSlot: string }[] | null },
  timeZone?: string | null,
): Date {
  const times = (booking.slots ?? []).map((s) => slotStart(booking.date, s.timeSlot, timeZone).getTime());
  if (times.length === 0) return slotStart(booking.date, "00:00", timeZone);
  return new Date(Math.min(...times));
}

/** True when the booking starts MORE than `hours` from `now` (exactly `hours` is false). */
export function startsMoreThanHoursAway(start: Date, hours: number, now: Date = new Date()): boolean {
  return start.getTime() - now.getTime() > hours * 3_600_000;
}
