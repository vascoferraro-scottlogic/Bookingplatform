"use client";

type TrackingEventType = "PAGE_VIEW" | "FEATURE_USE" | "INTERACTION" | "SESSION_START";

interface QueuedEvent {
  eventType: TrackingEventType;
  path: string;
  action?: string;
  entity?: string;
  entityId?: string;
  isPWA?: boolean;
  meta?: Record<string, unknown>;
}

// ─── Browser / Device / PWA detection ────────────────────────

export function detectPWA(): boolean {
  if (typeof window === "undefined") return false;
  if ((window.navigator as any).standalone === true) return true;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return false;
}

// ─── Event queue with batching ───────────────────────────────

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL = 5_000;

function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0);

  const payload = JSON.stringify({ events: batch });

  // Prefer sendBeacon for reliability on page unload
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    const sent = navigator.sendBeacon("/api/tracking", new Blob([payload], { type: "application/json" }));
    if (sent) return;
  }

  // Fallback to fetch
  fetch("/api/tracking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // Tracking failures are silent
  });
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL);
}

/**
 * Queue a tracking event. Events are batched and sent every 5s,
 * or immediately on page visibility change / unload.
 */
export function trackEvent(
  eventType: TrackingEventType,
  data: Omit<QueuedEvent, "eventType" | "isPWA"> & { isPWA?: boolean },
) {
  queue.push({
    eventType,
    isPWA: data.isPWA ?? detectPWA(),
    ...data,
  });
  scheduleFlush();
}

/**
 * Track a page view for the given path.
 */
export function trackPageView(path: string) {
  trackEvent("PAGE_VIEW", { path });
}

/**
 * Track a feature being used.
 */
export function trackFeatureUse(action: string, path: string, entity?: string) {
  trackEvent("FEATURE_USE", { path, action, entity });
}

/**
 * Track a user interaction.
 */
export function trackInteraction(action: string, path: string, entity?: string, entityId?: string) {
  trackEvent("INTERACTION", { path, action, entity, entityId });
}

/**
 * Fire once per session: session start with device info.
 */
export function trackSessionStart(path: string) {
  trackEvent("SESSION_START", {
    path,
    meta: {
      viewport: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : undefined,
      referrer: typeof document !== "undefined" ? document.referrer || undefined : undefined,
      language: typeof navigator !== "undefined" ? navigator.language : undefined,
    },
  });
}

// ─── Lifecycle listeners ─────────────────────────────────────

let lifecycleAttached = false;

export function attachLifecycleListeners() {
  if (typeof window === "undefined" || lifecycleAttached) return;
  lifecycleAttached = true;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });

  window.addEventListener("pagehide", flush);
}
