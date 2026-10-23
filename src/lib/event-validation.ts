/**
 * Validate an optional non-negative number from an event request body
 * (capacity, entry fee). Returns an error message, or null when valid.
 * null / undefined / "" mean "not set".
 */
export function validateNonNegativeNumber(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (typeof value === "boolean" || !Number.isFinite(n) || n < 0) {
    return `${field} must be a non-negative number`;
  }
  return null;
}
