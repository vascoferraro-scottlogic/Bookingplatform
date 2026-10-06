/**
 * Topic clustering for the detector (and any other batch-of-messages agent).
 *
 * Discipline: cheap, deterministic, dependency-free. Embeddings are a
 * future upgrade — for now, lexical token overlap (Jaccard) within the
 * same channel and time window is good enough to catch the obvious
 * "members all moaning about the same rink in the same hour" case which
 * is the failure mode that motivated step 3c (decisions log 2026-05-03).
 *
 * Algorithm: union-find. For each pair of messages (i, j) with i < j, if
 *  - same channelId, AND
 *  - createdAt within DEFAULT_WINDOW_MS, AND
 *  - body token-overlap (Jaccard, stop-words stripped) >= DEFAULT_THRESHOLD,
 * merge the clusters containing i and j. Returns the resulting clusters
 * as arrays of message ids.
 */

const DEFAULT_THRESHOLD = 0.35;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 60 min

// Mirrors the stop-word list in maintenance-task-create.ts. Kept duplicated
// (rather than imported) because the lists may diverge — committers are
// title-domain, this is body-domain.
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "has", "have",
  "are", "was", "were", "but", "not", "you", "your", "our", "out",
  "any", "all", "there", "here", "they", "them", "their", "its", "his",
  "her", "him", "she", "anyone", "someone", "really", "just", "now",
  "today", "yesterday", "tomorrow", "very", "much", "more", "less",
  "still", "again", "also", "again",
]);

function tokenise(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
  );
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface ClusterableMessage {
  id: string;
  channelId: string;
  body: string;
  createdAt: Date;
  userId: string;
}

export interface ClusterOptions {
  threshold?: number;
  windowMs?: number;
}

export interface MessageCluster {
  /** Message ids in the cluster, in input order. */
  messageIds: string[];
  /** Distinct user ids who contributed to the cluster. */
  participantCount: number;
  /** Channel id of the cluster (clusters are channel-scoped). */
  channelId: string;
  /** Convenience: representative (highest-token-density) message id. */
  representativeId: string;
}

/**
 * Cluster a list of messages by topical similarity. Order in the output
 * mirrors input order of the cluster's first member.
 */
export function clusterMessages(
  messages: ClusterableMessage[],
  opts: ClusterOptions = {},
): MessageCluster[] {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;

  const n = messages.length;
  if (n === 0) return [];

  const tokens = messages.map((m) => tokenise(m.body));
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]; // path compression
      i = parent[i];
    }
    return i;
  };
  const union = (i: number, j: number): void => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (messages[i].channelId !== messages[j].channelId) continue;
      const dt = Math.abs(messages[i].createdAt.getTime() - messages[j].createdAt.getTime());
      if (dt > windowMs) continue;
      if (jaccardSimilarity(tokens[i], tokens[j]) >= threshold) {
        union(i, j);
      }
    }
  }

  // Group indices by their root.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = groups.get(r);
    if (arr) arr.push(i);
    else groups.set(r, [i]);
  }

  const clusters: MessageCluster[] = [];
  for (const indices of groups.values()) {
    indices.sort((a, b) => a - b); // preserve input order
    const messageIds = indices.map((i) => messages[i].id);
    const distinctUsers = new Set(indices.map((i) => messages[i].userId));
    // Representative = member with the most non-stop-word tokens.
    let bestIdx = indices[0];
    let bestSize = tokens[bestIdx].size;
    for (const i of indices) {
      if (tokens[i].size > bestSize) {
        bestSize = tokens[i].size;
        bestIdx = i;
      }
    }
    clusters.push({
      messageIds,
      participantCount: distinctUsers.size,
      channelId: messages[indices[0]].channelId,
      representativeId: messages[bestIdx].id,
    });
  }

  // Stable order: clusters sorted by their first message's input position.
  clusters.sort((a, b) => {
    const ai = messages.findIndex((m) => m.id === a.messageIds[0]);
    const bi = messages.findIndex((m) => m.id === b.messageIds[0]);
    return ai - bi;
  });

  return clusters;
}
