export const locales = ["en", "cy"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
