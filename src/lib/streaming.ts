import { prisma } from "@/lib/prisma";
import { StreamingTier, StreamStatus } from "@prisma/client";

// ─── Tier Definitions ────────────────────────────────────────

export const TIER_CONFIG: Record<
  StreamingTier,
  { maxConcurrentStreams: number; archiveRetentionDays: number; priceMonthlyPence: number }
> = {
  NONE: { maxConcurrentStreams: 0, archiveRetentionDays: 0, priceMonthlyPence: 0 },
  BRONZE: { maxConcurrentStreams: 1, archiveRetentionDays: 0, priceMonthlyPence: 2000 },
  SILVER: { maxConcurrentStreams: 3, archiveRetentionDays: 7, priceMonthlyPence: 5000 },
  GOLD: { maxConcurrentStreams: 999, archiveRetentionDays: 30, priceMonthlyPence: 10000 },
};

// ─── Subscription Helpers ────────────────────────────────────

export async function getTenantSubscription(tenantId: string) {
  return prisma.tenantSubscription.findUnique({ where: { tenantId } });
}

export async function upsertSubscription(tenantId: string, tier: StreamingTier) {
  const config = TIER_CONFIG[tier];
  return prisma.tenantSubscription.upsert({
    where: { tenantId },
    update: {
      tier,
      maxConcurrentStreams: config.maxConcurrentStreams,
      archiveRetentionDays: config.archiveRetentionDays,
      priceMonthlyPence: config.priceMonthlyPence,
      status: "ACTIVE",
    },
    create: {
      tenantId,
      tier,
      maxConcurrentStreams: config.maxConcurrentStreams,
      archiveRetentionDays: config.archiveRetentionDays,
      priceMonthlyPence: config.priceMonthlyPence,
      status: "ACTIVE",
    },
  });
}

// ─── Stream Lifecycle ────────────────────────────────────────

export async function getActiveLiveStreams(tenantId: string) {
  return prisma.streamSession.count({
    where: { tenantId, status: StreamStatus.LIVE },
  });
}

export async function canStartStream(tenantId: string): Promise<{ allowed: boolean; reason?: string }> {
  const sub = await getTenantSubscription(tenantId);
  if (!sub || sub.tier === "NONE") {
    return { allowed: false, reason: "No streaming subscription active" };
  }
  if (sub.status !== "ACTIVE") {
    return { allowed: false, reason: "Subscription is not active" };
  }
  const liveCount = await getActiveLiveStreams(tenantId);
  if (liveCount >= sub.maxConcurrentStreams) {
    return { allowed: false, reason: `Concurrent stream limit reached (${sub.maxConcurrentStreams})` };
  }
  return { allowed: true };
}

export async function getLiveViewerCount(streamSessionId: string): Promise<number> {
  return prisma.streamViewer.count({
    where: { streamSessionId, leftAt: null },
  });
}

// ─── Token Validation ────────────────────────────────────────

export async function validateStreamToken(token: string): Promise<{ valid: boolean; streamSessionId?: string; tokenId?: string }> {
  const record = await prisma.streamToken.findUnique({ where: { token } });
  if (!record) return { valid: false };
  if (record.expiresAt < new Date()) return { valid: false };
  if (record.maxUses && record.useCount >= record.maxUses) return { valid: false };
  return { valid: true, streamSessionId: record.streamSessionId, tokenId: record.id };
}

export async function incrementTokenUse(tokenId: string) {
  return prisma.streamToken.update({
    where: { id: tokenId },
    data: { useCount: { increment: 1 } },
  });
}

// ─── Signaling (in-memory, per-stream) ───────────────────────

type SignalMessage = {
  type: "offer" | "answer" | "ice-candidate";
  from: string;
  payload: unknown;
};

const streamSignals = new Map<string, SignalMessage[]>();

export function pushSignal(streamId: string, message: SignalMessage) {
  if (!streamSignals.has(streamId)) {
    streamSignals.set(streamId, []);
  }
  streamSignals.get(streamId)!.push(message);
}

export function getSignals(streamId: string, since = 0): SignalMessage[] {
  const signals = streamSignals.get(streamId) ?? [];
  return signals.slice(since);
}

export function clearSignals(streamId: string) {
  streamSignals.delete(streamId);
}
