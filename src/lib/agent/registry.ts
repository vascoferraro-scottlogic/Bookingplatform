import type { BaseAgent } from "@/lib/agent/base-agent";
import { DetectionAgent } from "@/lib/agent/agents/detector";
import { TriageAgent } from "@/lib/agent/agents/triager";
import { FundingApplicationAgent } from "@/lib/agent/agents/funding";
import { NoShowRiskAgent } from "@/lib/agent/agents/no-show";

/**
 * Registry of all agents. Detection and No-Show run first (in any order —
 * independent), then Triage (processes maintenance tasks from detector),
 * then Funding (independent). No-Show→Reminder committer sends messages.
 */
const agents: BaseAgent[] = [
  new DetectionAgent(),
  new NoShowRiskAgent(),
  new TriageAgent(),
  new FundingApplicationAgent(),
];

const bySlug = new Map<string, BaseAgent>(agents.map((a) => [a.slug, a]));

export function getAgent(slug: string): BaseAgent | undefined {
  return bySlug.get(slug);
}

export function getAllAgents(): BaseAgent[] {
  return agents;
}

/** Slugs in the recommended execution order. */
export const AGENT_ORDER: readonly string[] = ["detector", "no-show", "triager", "funding-app"];

