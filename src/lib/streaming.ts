import { prisma } from "@/lib/prisma";
import { Prisma, StreamingTier, StreamStatus } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import type { AppSession } from "@/lib/api-utils";

/** Prisma client or interactive-transaction client. */
type Db = Prisma.TransactionClient;

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

export async function getActiveLiveStreams(tenantId: string, db: Db = prisma) {
  return db.streamSession.count({
    where: { tenantId, status: StreamStatus.LIVE },
  });
}

export async function canStartStream(tenantId: string, db: Db = prisma): Promise<{ allowed: boolean; reason?: string }> {
  const sub = await db.tenantSubscription.findUnique({ where: { tenantId } });
  if (!sub || sub.tier === "NONE") {
    return { allowed: false, reason: "No streaming subscription active" };
  }
  if (sub.status !== "ACTIVE") {
    return { allowed: false, reason: "Subscription is not active" };
  }
  const liveCount = await getActiveLiveStreams(tenantId, db);
  if (liveCount >= sub.maxConcurrentStreams) {
    return { allowed: false, reason: `Concurrent stream limit reached (${sub.maxConcurrentStreams})` };
  }
  return { allowed: true };
}

/**
 * Move an IDLE stream to LIVE. The concurrency check and the status change run
 * in one serializable transaction so two simultaneous starts can't both pass.
 */
export async function startStreamAtomically(
  tenantId: string,
  streamId: string,
): Promise<{ started: boolean; reason?: string }> {
  return prisma.$transaction(
    async (tx) => {
      const { allowed, reason } = await canStartStream(tenantId, tx);
      if (!allowed) return { started: false, reason };
      const { count } = await tx.streamSession.updateMany({
        where: { id: streamId, tenantId, status: StreamStatus.IDLE },
        data: { status: StreamStatus.LIVE, startedAt: new Date() },
      });
      if (count === 0) return { started: false, reason: "Stream is no longer idle" };
      return { started: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/**
 * Archive ENDED streams older than the tenant's archiveRetentionDays (FR-STR-002).
 * Returns the number of streams archived.
 */
export async function archiveEndedStreams(tenantId: string): Promise<number> {
  const sub = await getTenantSubscription(tenantId);
  if (!sub) return 0;
  const cutoff = new Date(Date.now() - sub.archiveRetentionDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.streamSession.updateMany({
    where: { tenantId, status: StreamStatus.ENDED, endedAt: { lt: cutoff } },
    data: { status: StreamStatus.ARCHIVED },
  });
  return count;
}

export async function getLiveViewerCount(streamSessionId: string): Promise<number> {
  return prisma.streamViewer.count({
    where: { streamSessionId, leftAt: null },
  });
}

// ─── Token Validation ────────────────────────────────────────

/** A token is only valid for the stream it was issued for. */
export async function validateStreamToken(
  token: string,
  streamSessionId: string,
): Promise<{ valid: boolean; streamSessionId?: string; tokenId?: string; maxUses?: number | null }> {
  const record = await prisma.streamToken.findUnique({ where: { token } });
  if (!record) return { valid: false };
  if (record.streamSessionId !== streamSessionId) return { valid: false };
  if (record.expiresAt < new Date()) return { valid: false };
  if (record.maxUses !== null && record.useCount >= record.maxUses) return { valid: false };
  return { valid: true, streamSessionId: record.streamSessionId, tokenId: record.id, maxUses: record.maxUses };
}

/**
 * Take one use of a token. The limit is part of the UPDATE's WHERE clause, so
 * concurrent viewers can't exceed maxUses. Returns false when no use was left.
 */
export async function consumeTokenUse(tokenId: string, maxUses: number | null | undefined): Promise<boolean> {
  const { count } = await prisma.streamToken.updateMany({
    where: {
      id: tokenId,
      expiresAt: { gt: new Date() },
      ...(maxUses != null ? { useCount: { lt: maxUses } } : {}),
    },
    data: { useCount: { increment: 1 } },
  });
  return count === 1;
}

/** True when the request has a session or a valid token for this stream (no use is consumed). */
export async function hasStreamAccess(streamSessionId: string, token: string | null | undefined): Promise<boolean> {
  const session = (await getServerSession(authOptions)) as AppSession | null;
  if (session) return true;
  if (!token) return false;
  return (await validateStreamToken(token, streamSessionId)).valid;
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
