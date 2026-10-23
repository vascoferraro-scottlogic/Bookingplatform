import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { defaultLocale, locales, type Locale } from "./config";

type Messages = Record<string, unknown>;

const isObject = (v: unknown): v is Messages => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep-merge `override` over `base`: keys missing from `override` keep the base string. */
function mergeMessages(base: Messages, override: Messages): Messages {
  const out: Messages = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = isObject(v) && isObject(base[k]) ? mergeMessages(base[k] as Messages, v) : v;
  }
  return out;
}

async function loadMessages(locale: Locale) {
  const common = (await import(`../../content/messages/ui/${locale}/common.json`)).default;
  const auth = (await import(`../../content/messages/ui/${locale}/auth.json`)).default;
  const bookings = (await import(`../../content/messages/ui/${locale}/bookings.json`)).default;
  const maintenance = (await import(`../../content/messages/ui/${locale}/maintenance.json`)).default;
  const events = (await import(`../../content/messages/ui/${locale}/events.json`)).default;
  const messaging = (await import(`../../content/messages/ui/${locale}/messaging.json`)).default;
  const settings = (await import(`../../content/messages/ui/${locale}/settings.json`)).default;
  const streaming = (await import(`../../content/messages/ui/${locale}/streaming.json`)).default;
  const help = (await import(`../../content/messages/ui/${locale}/help.json`)).default;
  const billing = (await import(`../../content/messages/ui/${locale}/billing.json`)).default;
  const agents = (await import(`../../content/messages/ui/${locale}/agents.json`)).default;
  const admin = (await import(`../../content/messages/ui/${locale}/admin.json`)).default;
  const onboarding = (await import(`../../content/messages/ui/${locale}/onboarding.json`)).default;
  const charity = (await import(`../../content/messages/ui/${locale}/charity.json`)).default;
  const funding = (await import(`../../content/messages/ui/${locale}/funding.json`)).default;
  const insights = (await import(`../../content/messages/ui/${locale}/insights.json`)).default;
  const modelops = (await import(`../../content/messages/ui/${locale}/modelops.json`)).default;
  const groups = (await import(`../../content/messages/ui/${locale}/groups.json`)).default;

  return {
    common, auth, bookings, maintenance, events, messaging,
    settings, streaming, help, billing, agents, admin, onboarding, charity,
    funding, insights, modelops, groups,
  } as Messages;
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const raw = store.get("locale")?.value;
  const locale: Locale = raw && (locales as readonly string[]).includes(raw)
    ? (raw as Locale)
    : defaultLocale;

  // English is the fallback (FR-I18N-002): a key missing from the chosen
  // locale shows the English string, never the raw key.
  const en = await loadMessages(defaultLocale);
  const messages = locale === defaultLocale ? en : mergeMessages(en, await loadMessages(locale));

  return { locale, messages };
});
