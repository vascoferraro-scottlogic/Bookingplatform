const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Escape one CSV cell. Cells that start with = + - @ (or a tab / CR) are
 * prefixed with ' so spreadsheets don't run them as formulas (CSV injection).
 * Plain numbers, including negative amounts, are left alone. Cells containing
 * quotes, commas or line breaks are quoted with "" escaping.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === undefined || value === null) return "";
  let s = String(value);
  if (!PLAIN_NUMBER.test(s) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
