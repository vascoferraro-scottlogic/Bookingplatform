/**
 * Vendor-agnostic observability seam.
 *
 * - Always emits a structured JSON line to stdout/stderr, so the local Docker
 *   stack has real, greppable observability with zero setup (`docker compose
 *   logs`).
 * - When a Better Stack source token is configured, also ships the event via
 *   `@logtail/next` (lazy-loaded so the no-token path never touches the SDK).
 *   Mirrors the optional-SDK pattern the codebase already uses for Unleash.
 *
 * Every event carries the blue/green `color` + `release` so a bad phased
 * rollout is attributable to a colour × release cohort.
 */

export type ObsLevel = "info" | "warn" | "error";
export type ObsContext = Record<string, unknown>;

/** Per-container deployment identity, read at runtime (not build time). */
export function deploymentContext() {
  return {
    color: process.env.APP_COLOR ?? "unknown",
    release: process.env.APP_VERSION ?? "unknown",
  };
}

function betterStackEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_BETTER_STACK_SOURCE_TOKEN);
}

async function shipToBetterStack(level: ObsLevel, message: string, fields: ObsContext) {
  try {
    const { Logger } = await import("@logtail/next");
    const log = new Logger();
    if (level === "error") log.error(message, fields);
    else if (level === "warn") log.warn(message, fields);
    else log.info(message, fields);
    await log.flush();
  } catch (err) {
    // Observability must never break the request path.
    console.error(
      JSON.stringify({ level: "error", message: "observability ship failed", error: String(err) }),
    );
  }
}

/** Emit a structured event (stdout always; Better Stack when configured). */
export function logEvent(level: ObsLevel, message: string, fields: ObsContext = {}) {
  const enriched = {
    level,
    message,
    ...deploymentContext(),
    ...fields,
    time: new Date().toISOString(),
  };
  console[level === "error" ? "error" : "log"](JSON.stringify(enriched));
  if (betterStackEnabled()) void shipToBetterStack(level, message, enriched);
}

/** Capture an error with the deployment context plus any extra attribution. */
export function captureError(error: unknown, context: ObsContext = {}) {
  const err = error instanceof Error ? error : new Error(String(error));
  logEvent("error", err.message, {
    error_name: err.name,
    stack: err.stack,
    ...context,
  });
}
