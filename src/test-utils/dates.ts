// Date helpers so fixtures never go stale (hard-coded dates expire).

/** "YYYY-MM-DD" for today + `days` (UTC). */
export function isoDateFromToday(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A Date at UTC midnight, today + `days`. */
export function dateFromToday(days: number): Date {
  return new Date(`${isoDateFromToday(days)}T00:00:00.000Z`);
}

/** A Date `hours` from now. */
export function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3_600_000);
}
