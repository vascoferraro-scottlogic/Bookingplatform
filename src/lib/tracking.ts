import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";
import type { TrackingEventType } from "@prisma/client";

// ─── UA Parsing (lightweight, no external deps) ─────────────

interface ParsedUA {
  browserFamily: string;
  browserVersion: string | null;
  osFamily: string;
}

const BROWSER_PATTERNS: [RegExp, string][] = [
  [/Edg(?:e|A)?\/(\S+)/, "Edge"],
  [/OPR\/(\S+)/, "Opera"],
  [/SamsungBrowser\/(\S+)/, "Samsung Internet"],
  [/Chrome\/(\S+)/, "Chrome"],
  [/Firefox\/(\S+)/, "Firefox"],
  [/Version\/(\S+).*Safari/, "Safari"],
  [/MSIE (\S+)/, "Internet Explorer"],
  [/Trident\/.*rv:(\S+)/, "Internet Explorer"],
];

const OS_PATTERNS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Mac OS X/, "macOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
  [/CrOS/, "ChromeOS"],
];

export function parseUserAgent(ua: string): ParsedUA {
  let browserFamily = "Other";
  let browserVersion: string | null = null;

  for (const [pattern, name] of BROWSER_PATTERNS) {
    const match = ua.match(pattern);
    if (match) {
      browserFamily = name;
      browserVersion = match[1]?.split(".")[0] ?? null;
      break;
    }
  }

  let osFamily = "Other";
  for (const [pattern, name] of OS_PATTERNS) {
    if (pattern.test(ua)) {
      osFamily = name;
      break;
    }
  }

  return { browserFamily, browserVersion, osFamily };
}

export function detectDeviceType(ua: string): string {
  if (/Mobi|Android.*Mobile|iPhone|iPod/.test(ua)) return "mobile";
  if (/iPad|Android(?!.*Mobile)|Tablet/.test(ua)) return "tablet";
  return "desktop";
}

// ─── Fingerprint ─────────────────────────────────────────────

export function hashFingerprint(ua: string, ip: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${ua}|${ip}|${day}`).digest("hex").slice(0, 16);
}

// ─── Server-side logging ─────────────────────────────────────

interface TrackingParams {
  tenantId?: string | null;
  userId?: string | null;
  sessionFingerprint: string;
  eventType: TrackingEventType;
  path: string;
  action?: string;
  entity?: string;
  entityId?: string;
  browserFamily: string;
  browserVersion?: string | null;
  osFamily: string;
  deviceType: string;
  isPWA?: boolean;
  meta?: Record<string, unknown>;
}

/**
 * Log a tracking event. Fire-and-forget — never throws.
 */
export function logTrackingEvent(params: TrackingParams): void {
  prisma.trackingEvent
    .create({
      data: {
        tenantId: params.tenantId ?? null,
        userId: params.userId ?? null,
        sessionFingerprint: params.sessionFingerprint,
        eventType: params.eventType,
        path: params.path,
        action: params.action ?? null,
        entity: params.entity ?? null,
        entityId: params.entityId ?? null,
        browserFamily: params.browserFamily,
        browserVersion: params.browserVersion ?? null,
        osFamily: params.osFamily,
        deviceType: params.deviceType,
        isPWA: params.isPWA ?? false,
        meta: params.meta ? JSON.stringify(params.meta) : null,
      },
    })
    .catch(() => {
      // Tracking failures must never break user flows
    });
}

/**
 * Log a batch of tracking events. Fire-and-forget — never throws.
 */
export function logTrackingEventBatch(events: TrackingParams[]): void {
  prisma.trackingEvent
    .createMany({
      data: events.map((e) => ({
        tenantId: e.tenantId ?? null,
        userId: e.userId ?? null,
        sessionFingerprint: e.sessionFingerprint,
        eventType: e.eventType,
        path: e.path,
        action: e.action ?? null,
        entity: e.entity ?? null,
        entityId: e.entityId ?? null,
        browserFamily: e.browserFamily,
        browserVersion: e.browserVersion ?? null,
        osFamily: e.osFamily,
        deviceType: e.deviceType,
        isPWA: e.isPWA ?? false,
        meta: e.meta ? JSON.stringify(e.meta) : null,
      })),
    })
    .catch(() => {
      // Tracking failures must never break user flows
    });
}
