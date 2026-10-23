/** Shared account rules for registration, password reset and invitations (FR-AUTH-001/002). */

export const MIN_PASSWORD_LENGTH = 8;

/** Emails are compared and stored in lower case (D-16). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Returns an error message, or null when the password is acceptable. */
export function passwordRuleError(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  return null;
}
