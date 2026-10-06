import { prisma } from "@/lib/prisma";
import { KnowledgeScope } from "@prisma/client";

export interface ResolvedKnowledge {
  category: string;
  title: string;
  content: string;
  scope: KnowledgeScope;
  priority: number;
}

/**
 * Resolve knowledge entries applicable to a tenant, layering scopes:
 *   GLOBAL (everyone) → REGIONAL (matching region) → TENANT (this tenant only)
 *
 * For each (category, title) tuple, the most-specific entry wins. So a
 * TENANT-scope entry overrides a GLOBAL one with the same title.
 *
 * Caller can scope by agentSlug to also include agent-specific knowledge,
 * or pass undefined to fetch all agent-agnostic + matching knowledge.
 */
export async function resolveKnowledge(opts: {
  tenantId: string;
  agentSlug?: string;
  category?: string;
  region?: string | null;
  limit?: number;
}): Promise<ResolvedKnowledge[]> {
  const { tenantId, agentSlug, category, region, limit = 50 } = opts;

  let agentId: string | null = null;
  if (agentSlug) {
    const def = await prisma.agentDefinition.findUnique({ where: { slug: agentSlug } });
    agentId = def?.id ?? null;
  }

  const rows = await prisma.agentKnowledge.findMany({
    where: {
      active: true,
      ...(category ? { category } : {}),
      OR: [
        { agentId: null },
        ...(agentId ? [{ agentId }] : []),
      ],
      AND: [
        {
          OR: [
            { scope: "GLOBAL" as const },
            ...(region ? [{ scope: "REGIONAL" as const, region }] : []),
            { scope: "TENANT" as const, tenantId },
          ],
        },
      ],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });

  // De-duplicate by (category, title) — most specific scope wins
  const SCOPE_RANK: Record<KnowledgeScope, number> = { GLOBAL: 0, REGIONAL: 1, TENANT: 2 };
  const winners = new Map<string, ResolvedKnowledge>();
  for (const r of rows) {
    const key = `${r.category}::${r.title}`;
    const existing = winners.get(key);
    if (!existing || SCOPE_RANK[r.scope] > SCOPE_RANK[existing.scope]) {
      winners.set(key, {
        category: r.category,
        title: r.title,
        content: r.content,
        scope: r.scope,
        priority: r.priority,
      });
    }
  }
  return Array.from(winners.values())
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}

/**
 * Cheap geographic bucket for REGIONAL knowledge. Buckets the world into 2°
 * lat/lng squares so e.g. central Scotland clubs land in the same region.
 *
 * Returns null when lat/lng are missing.
 */
export function regionForCoords(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null) return null;
  const latBucket = Math.floor(lat / 2) * 2;
  const lngBucket = Math.floor(lng / 2) * 2;
  return `LAT_${latBucket}_LNG_${lngBucket}`;
}

/** Format a list of resolved knowledge entries for inclusion in an LLM prompt. */
export function knowledgeToPromptText(entries: ResolvedKnowledge[]): string {
  if (entries.length === 0) return "(no domain knowledge available)";
  return entries
    .map((e) => `- [${e.scope}/${e.category}] ${e.title}: ${e.content}`)
    .join("\n");
}
