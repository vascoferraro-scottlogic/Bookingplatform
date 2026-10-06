import { Unleash } from "unleash-client";

// Lazily-initialised Unleash SDK singleton (#feature-management).
//
// Unleash is a CONTROL PLANE, not in the request path: the SDK evaluates flags
// locally from an in-memory copy and writes a fail-static backup to disk, so the
// app keeps serving last-known flags if Unleash is unreachable. We never make a
// per-request network call to Unleash.
//
// `getUnleash()` returns null when Unleash is not configured (no URL/token) — the
// pre-cutover default, in dev, and in tests — so callers fall back to Postgres and
// behaviour is unchanged until the Phase 2 migration sets the env.

const APP_NAME = process.env.UNLEASH_APP_NAME ?? "bookingplatform";

/** True when both the Unleash URL and a backend API token are configured. */
export function isUnleashConfigured(): boolean {
  return Boolean(process.env.UNLEASH_URL && process.env.UNLEASH_API_TOKEN);
}

// Guard against Next.js dev HMR / repeated module evaluation constructing more
// than one client (mirrors the prisma singleton pattern in src/lib/prisma.ts).
const globalForUnleash = globalThis as unknown as { unleash?: Unleash };

function createUnleash(): Unleash {
  const instance = new Unleash({
    url: process.env.UNLEASH_URL!,
    appName: APP_NAME,
    // Backend (client) token. Server-side only — never exposed to the browser.
    customHeaders: { Authorization: process.env.UNLEASH_API_TOKEN! },
    refreshInterval: 15_000,
    // The default storage provider writes a fs-cache backup to disk (OS tmpdir),
    // which is what gives us fail-static evaluation across restarts.
  });

  // An EventEmitter throws if an 'error' is emitted with no listener; Unleash
  // emits 'error' on transient fetch failures. Swallow them — the SDK keeps
  // serving from its in-memory / disk cache.
  instance.on("error", (err: unknown) => {
    console.error("[unleash] client error:", err);
  });

  return instance;
}

/**
 * The process-wide Unleash client, or null when Unleash is not configured.
 *
 * Construction is lazy: the first call when configured starts the SDK (which
 * begins polling and writing the disk cache). When unconfigured this is a cheap
 * no-op returning null.
 */
export function getUnleash(): Unleash | null {
  if (!isUnleashConfigured()) return null;
  if (!globalForUnleash.unleash) {
    globalForUnleash.unleash = createUnleash();
  }
  return globalForUnleash.unleash;
}
