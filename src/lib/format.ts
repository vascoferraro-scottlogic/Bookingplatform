/**
 * Locale-aware date/number formatting utilities.
 *
 * These are thin wrappers around `Intl` that accept a locale string
 * (typically from useLocale() or getLocale()). They avoid importing
 * next-intl directly so they can be used in both client and server contexts.
 */

type DateStyle = "short" | "medium" | "long" | "full";

const LOCALE_MAP: Record<string, string> = {
  en: "en-GB",
  cy: "cy-GB",
};

function resolve(locale: string): string {
  return LOCALE_MAP[locale] ?? locale;
}

/** Format a date string or Date object with a predefined style. */
export function formatDate(value: string | Date, locale: string, style: DateStyle = "medium"): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString(resolve(locale), { dateStyle: style });
}

/** Format a date with explicit options (weekday, month, day, etc.). */
export function formatDateCustom(
  value: string | Date,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString(resolve(locale), options);
}

/** Format a datetime (date + time) with locale. */
export function formatDateTime(value: string | Date, locale: string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString(resolve(locale));
}

/** Format time only. */
export function formatTime(value: string | Date, locale: string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleTimeString(resolve(locale), { hour: "2-digit", minute: "2-digit" });
}

/** Format currency (pence → pounds). Currency stays GBP regardless of locale. */
export function formatCurrency(pence: number, locale: string, currency = "GBP"): string {
  return new Intl.NumberFormat(resolve(locale), { style: "currency", currency }).format(pence / 100);
}

/** Format a plain number with locale grouping. */
export function formatNumber(value: number, locale: string): string {
  return value.toLocaleString(resolve(locale));
}
