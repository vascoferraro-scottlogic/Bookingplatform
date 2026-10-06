import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseUserAgent, detectDeviceType, hashFingerprint, logTrackingEventBatch } from "@/lib/tracking";
import type { TrackingEventType } from "@prisma/client";

const VALID_EVENT_TYPES = new Set<string>(["PAGE_VIEW", "FEATURE_USE", "INTERACTION", "SESSION_START"]);
const MAX_EVENTS_PER_REQUEST = 50;
// Dev toggle: disable tracking rate limiter in non-production or via env
const DISABLE_TRACKING_RATE_LIMIT = process.env.DISABLE_TRACKING_RATE_LIMIT === "1" || process.env.NODE_ENV !== "production";

// Simple in-memory rate limiter: max 10 requests per IP per 10 seconds
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 10;

function isRateLimited(ip: string): boolean {
  if (DISABLE_TRACKING_RATE_LIMIT) return false;
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_MAX;
}

interface IncomingEvent {
  eventType: string;
  path: string;
  action?: string;
  entity?: string;
  entityId?: string;
  isPWA?: boolean;
  meta?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: { events?: IncomingEvent[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.events) || body.events.length === 0) {
    return NextResponse.json({ error: "events array required" }, { status: 400 });
  }

  if (body.events.length > MAX_EVENTS_PER_REQUEST) {
    return NextResponse.json({ error: `Max ${MAX_EVENTS_PER_REQUEST} events per request` }, { status: 400 });
  }

  const ua = req.headers.get("user-agent") ?? "";
  const parsed = parseUserAgent(ua);
  const deviceType = detectDeviceType(ua);
  const fingerprint = hashFingerprint(ua, ip);

  // Resolve session if authenticated (optional — anonymous is fine)
  const session = (await getServerSession(authOptions)) as {
    user: { id: string; tenantId?: string | null };
  } | null;

  const tenantId = session?.user?.tenantId ?? null;
  const userId = session?.user?.id ?? null;

  // Validate and map events
  const validEvents = [];
  for (const event of body.events) {
    if (!event.eventType || !VALID_EVENT_TYPES.has(event.eventType)) continue;
    if (!event.path || typeof event.path !== "string") continue;

    validEvents.push({
      tenantId,
      userId,
      sessionFingerprint: fingerprint,
      eventType: event.eventType as TrackingEventType,
      path: event.path.slice(0, 500),
      action: typeof event.action === "string" ? event.action.slice(0, 200) : undefined,
      entity: typeof event.entity === "string" ? event.entity.slice(0, 100) : undefined,
      entityId: typeof event.entityId === "string" ? event.entityId.slice(0, 100) : undefined,
      browserFamily: parsed.browserFamily,
      browserVersion: parsed.browserVersion,
      osFamily: parsed.osFamily,
      deviceType,
      isPWA: event.isPWA === true,
      meta: event.meta && typeof event.meta === "object" ? event.meta : undefined,
    });
  }

  if (validEvents.length > 0) {
    logTrackingEventBatch(validEvents);
  }

  return NextResponse.json({ accepted: validEvents.length });
}
