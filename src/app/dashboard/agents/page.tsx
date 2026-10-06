"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/format";
import Link from "next/link";
import { useTrack } from "@/components/TrackingProvider";

type Agent = { slug: string; name: string; description?: string };
type Decision = {
  id: string;
  action: string;
  confidence: number;
  reasoning: string;
  agent: { slug: string; name: string };
  taskId: string | null;
  sourceMessageId: string | null;
  previousPriority: string | null;
  newPriority: string | null;
  contextAdded: string | null;
  createdAt: string;
  feedback: {
    validityFeedback: string | null;
    priorityFeedback: string | null;
    assignmentFeedback: string | null;
    note: string | null;
  } | null;
  task: { id: string; title: string; status: string; priority: string } | null;
  sourceMessage: { id: string; content: string; user: { name: string }; channel: { name: string } } | null;
};
type Run = {
  id: string;
  agent: { slug: string; name: string };
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  summary: Record<string, unknown> | null;
  error: string | null;
};

export default function AgentDashboardPage() {
  const locale = useLocale();
  const t = useTranslations("agents");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeSlug, setActiveSlug] = useState<string>("");
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const { trackFeature } = useTrack();

  useEffect(() => { trackFeature("agent.dashboard_opened", "AgentDashboard"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load registered agents
  useEffect(() => {
    fetch("/api/agent/run")
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d?.agents)) {
          setAgents(d.agents);
          if (d.agents.length && !activeSlug) setActiveSlug(d.agents[0].slug);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function reload() {
    if (!activeSlug) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/agent/decisions?agentSlug=${activeSlug}&limit=50`).then(r => r.json()),
      fetch(`/api/agent/runs?agentSlug=${activeSlug}&limit=10`).then(r => r.json()),
    ])
      .then(([d, r]) => {
        setDecisions(Array.isArray(d?.decisions) ? d.decisions : []);
        setRuns(Array.isArray(r?.runs) ? r.runs : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(reload, [activeSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runAgent() {
    setErrorMsg(""); setSuccessMsg("");
    setRunning(true);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentSlug: activeSlug }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? "Failed to run agent");
      } else {
        const run = data?.runs?.[0];
        setSuccessMsg(formatRunOutcome(activeSlug, run));
        trackFeature("agent.run_triggered", "AgentRun");
        reload();
      }
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setRunning(false);
    }
  }

  async function submitFeedback(decisionId: string, body: Record<string, unknown>) {
    setErrorMsg(""); setSuccessMsg("");
    const res = await fetch(`/api/agent/decisions/${decisionId}/feedback`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorMsg(data.error ?? "Failed to submit feedback");
      return;
    }
    setSuccessMsg("Feedback recorded — the agent will learn from this.");
    trackFeature("agent.feedback_given", "AgentFeedback");
    reload();
  }

  const stats = useMemo(() => computeStats(decisions), [decisions]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">🤖 Agents</h1>
        <div className="flex gap-2">
          <Link href="/dashboard/agents/config" className="text-sm rounded border px-3 py-1.5 hover:bg-gray-50">Config</Link>
          <Link href="/dashboard/agents/knowledge" className="text-sm rounded border px-3 py-1.5 hover:bg-gray-50">Knowledge</Link>
        </div>
      </div>

      {errorMsg && <p className="text-red-600 text-sm rounded bg-red-50 border border-red-200 px-4 py-2">{errorMsg}</p>}
      {successMsg && <p className="text-green-700 text-sm rounded bg-green-50 border border-green-200 px-4 py-2">{successMsg}</p>}

      {/* Agent tabs */}
      <div className="flex gap-1 border-b">
        {agents.map(a => (
          <button
            key={a.slug}
            onClick={() => setActiveSlug(a.slug)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              activeSlug === a.slug
                ? "border-green-600 text-green-700 font-medium"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {a.name}
          </button>
        ))}
        {agents.length === 0 && <p className="text-sm text-gray-400 px-2 py-2">No agents registered. Run the seed.</p>}
      </div>

      {/* Stats + run button */}
      <div className="rounded-xl bg-white p-4 shadow-sm border flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-6 text-sm">
          <Stat label="Decisions (last 50)" value={stats.total} />
          <Stat label="With feedback" value={`${stats.withFeedback} (${stats.feedbackRate}%)`} />
          <Stat label="Marked correct" value={`${stats.correct} (${stats.accuracyRate}%)`} />
          <Stat label="Avg confidence" value={`${(stats.avgConfidence * 100).toFixed(0)}%`} />
        </div>
        <button
          onClick={runAgent}
          disabled={running || !activeSlug}
          className="rounded bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:bg-gray-300"
        >
          {running ? "Running…" : `Run ${agents.find(a => a.slug === activeSlug)?.name ?? "Agent"} now`}
        </button>
      </div>

      {/* Recent runs */}
      <div className="rounded-xl bg-white p-4 shadow-sm border">
        <h2 className="font-semibold mb-2 text-sm text-gray-700">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="text-xs text-gray-400">No runs yet.</p>
        ) : (
          <ul className="text-xs space-y-1">
            {runs.map(r => (
              <li key={r.id} className="flex gap-3">
                <span className={`font-mono ${
                  r.status === "COMPLETED" ? "text-green-700" :
                  r.status === "RUNNING" ? "text-blue-700" :
                  r.status === "RATE_LIMITED" ? "text-orange-700" : "text-red-700"
                }`}>{r.status}</span>
                <span className="text-gray-500">{formatDateTime(r.startedAt, locale)}</span>
                {r.durationMs !== null && <span className="text-gray-400">({(r.durationMs / 1000).toFixed(1)}s)</span>}
                {r.summary && <span className="text-gray-700">{summaryToSentence(r.agent.slug, r.summary)}</span>}
                {r.error && <span className="text-red-600 truncate" title={r.error}>{r.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Decisions list */}
      <div className="space-y-3">
        <h2 className="font-semibold text-sm text-gray-700">Decisions</h2>
        {loading && <p className="text-xs text-gray-400">Loading…</p>}
        {!loading && decisions.length === 0 && <p className="text-xs text-gray-400">No decisions yet for this agent.</p>}
        {decisions.map(d => (
          <DecisionCard key={d.id} decision={d} onFeedback={submitFeedback} />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function computeStats(decisions: Decision[]) {
  const total = decisions.length;
  const withFb = decisions.filter(d => d.feedback);
  const correct = withFb.filter(d => d.feedback?.validityFeedback === "CORRECT").length;
  const sumConf = decisions.reduce((s, d) => s + (d.confidence ?? 0), 0);
  return {
    total,
    withFeedback: withFb.length,
    feedbackRate: total ? Math.round((withFb.length / total) * 100) : 0,
    correct,
    accuracyRate: withFb.length ? Math.round((correct / withFb.length) * 100) : 0,
    avgConfidence: total ? sumConf / total : 0,
  };
}

/** Plain-English render of a run summary blob. */
function summaryToSentence(slug: string, summary: Record<string, unknown> | null | undefined): string {
  if (!summary) return "No details";
  const n = (k: string) => Number((summary as Record<string, unknown>)[k] ?? 0);
  const extras = (summary as { extras?: Record<string, unknown> }).extras ?? {};
  const e = (k: string) => Number(extras[k] ?? 0);

  if (slug === "detector") {
    const messages = n("itemsProcessed");
    const flagged = e("complaintsFlagged");
    const created = e("tasksCreated");
    if (messages === 0) return "No new messages to scan.";
    const parts = [pluralise(messages, "message", "messages") + " scanned"];
    if (flagged > 0) parts.push(pluralise(flagged, "complaint", "complaints") + " flagged");
    if (created > 0) parts.push(pluralise(created, "task", "tasks") + " created");
    if (flagged === 0 && created === 0) parts.push("nothing actionable");
    return parts.join(", ") + ".";
  }

  if (slug === "triager") {
    const tasks = n("itemsProcessed");
    const assigned = e("tasksAssigned");
    const prioritised = e("prioritiesChanged");
    if (tasks === 0) return "No unassigned tasks waiting.";
    const parts = [pluralise(tasks, "task", "tasks") + " reviewed"];
    if (assigned > 0) parts.push(pluralise(assigned, "assignment", "assignments") + " made");
    if (prioritised > 0) parts.push(pluralise(prioritised, "priority change", "priority changes"));
    if (assigned === 0 && prioritised === 0) parts.push("no changes applied");
    return parts.join(", ") + ".";
  }

  // Generic fallback
  const items = n("itemsProcessed");
  const decisions = n("decisionsRecorded");
  if (items === 0) return "Nothing to do.";
  return `${pluralise(items, "item", "items")} processed, ${pluralise(decisions, "decision", "decisions")} recorded.`;
}

function pluralise(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Friendly toast text for the "Run now" outcome. */
function formatRunOutcome(slug: string, run: { status?: string; summary?: Record<string, unknown> | null; error?: string } | undefined): string {
  if (!run) return "Run finished.";
  if (run.status === "COMPLETED") return summaryToSentence(slug, run.summary ?? null);
  if (run.status === "RATE_LIMITED") return "Hit the LLM provider's rate limit. Try again in a few minutes.";
  if (run.status === "FAILED") return run.error ? `Run failed: ${run.error}` : "Run failed. Check the recent runs list for details.";
  if (run.status === "RUNNING") return "Run started — refresh in a moment to see results.";
  return `Run finished (${run.status ?? "unknown"}).`;
}

function DecisionCard({
  decision,
  onFeedback,
}: {
  decision: Decision;
  onFeedback: (id: string, body: Record<string, unknown>) => void;
}) {
  const [note, setNote] = useState(decision.feedback?.note ?? "");
  const locale = useLocale();
  const fb = decision.feedback;
  const isComplaintAction = decision.agent.slug === "detector";
  const isTriageAction = decision.agent.slug === "triager";

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex justify-between items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-mono">{decision.action}</span>
            <span className="text-xs text-gray-500">confidence {(decision.confidence * 100).toFixed(0)}%</span>
            <span className="text-xs text-gray-400">· {formatDateTime(decision.createdAt, locale)}</span>
          </div>
          <p className="text-sm text-gray-800">{decision.reasoning}</p>
          {decision.task && (
            <p className="text-xs text-gray-500 mt-1">
              → Task: <span className="font-medium">{decision.task.title}</span>{" "}
              <span className="text-gray-400">[{decision.task.status} / {decision.task.priority}]</span>
            </p>
          )}
          {decision.sourceMessage && (
            <p className="text-xs text-gray-500 mt-1 italic">
              From #{decision.sourceMessage.channel.name} ({decision.sourceMessage.user.name}):
              &ldquo;{decision.sourceMessage.content.slice(0, 140)}{decision.sourceMessage.content.length > 140 ? "…" : ""}&rdquo;
            </p>
          )}
          {decision.previousPriority && decision.newPriority && (
            <p className="text-xs text-gray-500 mt-1">
              Priority: {decision.previousPriority} → <strong>{decision.newPriority}</strong>
            </p>
          )}
          {decision.contextAdded && (
            <p className="text-xs text-gray-500 mt-1">Context added: &ldquo;{decision.contextAdded}&rdquo;</p>
          )}
        </div>
      </div>

      {/* Feedback row */}
      <div className="mt-3 pt-3 border-t flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-600 font-medium">Feedback:</span>

        {isComplaintAction && (
          <FeedbackPills
            label="Validity"
            options={[
              { value: "CORRECT", label: "✓ Correct", colour: "green" },
              { value: "INCORRECT", label: "✗ Wrong", colour: "red" },
            ]}
            current={fb?.validityFeedback ?? null}
            onSelect={v => onFeedback(decision.id, { validity: v })}
          />
        )}

        {isTriageAction && (
          <>
            <FeedbackPills
              label="Priority"
              options={[
                { value: "CORRECT", label: "Right", colour: "green" },
                { value: "TOO_HIGH", label: "Too high", colour: "yellow" },
                { value: "TOO_LOW", label: "Too low", colour: "yellow" },
              ]}
              current={fb?.priorityFeedback ?? null}
              onSelect={v => onFeedback(decision.id, { priority: v })}
            />
            <FeedbackPills
              label="Assignment"
              options={[
                { value: "CORRECT", label: "Right person", colour: "green" },
                { value: "WRONG_PERSON", label: "Wrong person", colour: "red" },
              ]}
              current={fb?.assignmentFeedback ?? null}
              onSelect={v => onFeedback(decision.id, { assignment: v })}
            />
          </>
        )}

        <input
          placeholder="Optional note…"
          value={note}
          onChange={e => setNote(e.target.value)}
          onBlur={() => {
            if (note !== (fb?.note ?? "")) onFeedback(decision.id, { note });
          }}
          className="flex-1 min-w-[180px] rounded border px-2 py-1 text-xs"
        />
      </div>
    </div>
  );
}

function FeedbackPills({
  label, options, current, onSelect,
}: {
  label: string;
  options: { value: string; label: string; colour: "green" | "red" | "yellow" }[];
  current: string | null;
  onSelect: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-gray-500">{label}:</span>
      {options.map(o => {
        const selected = current === o.value;
        const base = "rounded px-2 py-0.5 border";
        const colourMap = {
          green: selected ? "bg-green-600 text-white border-green-600" : "border-green-300 text-green-700 hover:bg-green-50",
          red: selected ? "bg-red-600 text-white border-red-600" : "border-red-300 text-red-700 hover:bg-red-50",
          yellow: selected ? "bg-amber-500 text-white border-amber-500" : "border-amber-300 text-amber-700 hover:bg-amber-50",
        };
        return (
          <button key={o.value} className={`${base} ${colourMap[o.colour]}`} onClick={() => onSelect(o.value)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
