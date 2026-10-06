"use client";

import { useEffect, useState, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/format";
import Link from "next/link";
import { useTrack } from "@/components/TrackingProvider";
import { formatShortRef } from "@/lib/refs";

type Audience = "TENANT" | "USER" | "PLATFORM" | "FEDERATION";
type Status = "PENDING" | "APPROVED" | "REJECTED" | "SUPERSEDED" | "EXPIRED";

interface Proposal {
  id: string;
  agentId: string;
  agent: { slug: string; name: string };
  kind: string;
  payload: string;
  payloadParsed: Record<string, unknown> | null;
  confidence: number;
  reasoning: string;
  audienceScope: Audience;
  status: Status;
  createdAt: string;
  rejectReason: string | null;
  committedEntityType: string | null;
  committedEntityId: string | null;
  committedAt: string | null;
}

type FilterKey = "PENDING" | "RECENT";

export default function AgentInboxPage() {
  const t = useTranslations("agents");
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("PENDING");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [openRejectId, setOpenRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const { trackFeature } = useTrack();

  useEffect(() => { trackFeature("agent.inbox_opened", "AgentInbox"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => {
    setLoading(true);
    setErrorMsg("");
    const status = filter === "RECENT" ? "ALL" : "PENDING";
    fetch(`/api/agent/proposals?status=${status}&limit=100`)
      .then((r) => r.json())
      .then((d) => setProposals(Array.isArray(d?.proposals) ? d.proposals : []))
      .catch(() => setErrorMsg("Failed to load proposals"))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { reload(); }, [reload]);

  async function approve(p: Proposal) {
    setBusyId(p.id);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/agent/proposals/${p.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(d.error ?? "Approval failed");
      } else {
        trackFeature("agent.proposal_approved", "AgentInbox");
        reload();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function submitReject(p: Proposal) {
    setBusyId(p.id);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/agent/proposals/${p.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(d.error ?? "Reject failed");
      } else {
        trackFeature("agent.proposal_rejected", "AgentInbox");
        setOpenRejectId(null);
        setRejectReason("");
        reload();
      }
    } finally {
      setBusyId(null);
    }
  }

  const counts = {
    pending: proposals.filter((p) => p.status === "PENDING").length,
    total: proposals.length,
  };

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">{t("inbox.title")}</h1>
        <Link href="/dashboard/agents" className="text-sm text-green-700 hover:underline">
          {t("inbox.backToDashboard")}
        </Link>
      </div>

      <p className="text-sm text-gray-600 mb-4">
        {t("inbox.intro")}
      </p>

      <div className="flex gap-2 mb-4 border-b">
        {(["PENDING", "RECENT"] as FilterKey[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-2 text-sm border-b-2 ${
              filter === f ? "border-green-700 text-green-800 font-semibold" : "border-transparent text-gray-600"
            }`}
          >
            {f === "PENDING" ? t("inbox.pendingTab", { count: counts.pending }) : t("inbox.recentTab")}
          </button>
        ))}
        <button
          onClick={reload}
          className="ml-auto px-3 py-1 text-xs text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
        >
          {t("inbox.refresh")}
        </button>
      </div>

      {errorMsg && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded">
          {errorMsg}
        </div>
      )}

      {loading && <div className="text-sm text-gray-500">{t("inbox.loading")}</div>}

      {!loading && proposals.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <div className="text-3xl mb-2">📭</div>
          <div>{filter === "PENDING" ? t("inbox.emptyPending") : t("inbox.emptyAll")}</div>
          {filter === "PENDING" && (
            <div className="text-xs mt-1">{t("inbox.emptyHint")}</div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            busy={busyId === p.id}
            onApprove={() => approve(p)}
            onOpenReject={() => { setOpenRejectId(p.id); setRejectReason(""); }}
            isRejectOpen={openRejectId === p.id}
            rejectReason={rejectReason}
            onRejectReasonChange={setRejectReason}
            onCancelReject={() => { setOpenRejectId(null); setRejectReason(""); }}
            onSubmitReject={() => submitReject(p)}
          />
        ))}
      </div>
    </div>
  );
}

function ProposalCard({
  proposal,
  busy,
  onApprove,
  onOpenReject,
  isRejectOpen,
  rejectReason,
  onRejectReasonChange,
  onCancelReject,
  onSubmitReject,
}: {
  proposal: Proposal;
  busy: boolean;
  onApprove: () => void;
  onOpenReject: () => void;
  isRejectOpen: boolean;
  rejectReason: string;
  onRejectReasonChange: (s: string) => void;
  onCancelReject: () => void;
  onSubmitReject: () => void;
}) {
  const t = useTranslations("agents");
  const p = proposal;
  const locale = useLocale();
  const isPending = p.status === "PENDING";
  const payload = (p.payloadParsed ?? {}) as Record<string, unknown>;
  const title = String(payload.title ?? t("inbox.noTitle"));
  const description = String(payload.description ?? "");
  const category = payload.category ? String(payload.category) : null;
  const priority = payload.priority ? String(payload.priority) : null;
  const participantCount = typeof payload.participantCount === "number" ? payload.participantCount : null;
  const toneLabel = payload.toneLabel ? String(payload.toneLabel) : null;
  const toneSeverity = typeof payload.toneSeverity === "number" ? payload.toneSeverity : null;

  return (
    <div className={`border rounded p-4 ${isPending ? "bg-white" : "bg-gray-50"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 mb-1">
            <span className="font-mono">{p.kind}</span>
            <span>•</span>
            <span>by {p.agent.name}</span>
            <span>•</span>
            <span>{formatDateTime(p.createdAt, locale)}</span>
            <StatusBadge status={p.status} />
          </div>
          <div className="font-semibold text-gray-900">{title}</div>
          {description && <div className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{description}</div>}

          <div className="flex items-center gap-3 mt-2 text-xs text-gray-600 flex-wrap">
            {category && <span className="px-2 py-0.5 bg-gray-100 rounded">{category}</span>}
            {priority && <span className={`px-2 py-0.5 rounded ${priorityClass(priority)}`}>{priority}</span>}
            {participantCount !== null && (
              <span>{t("inbox.voiceCount", { count: participantCount })}</span>
            )}
            {toneLabel && (
              <span>tone: {toneLabel}{toneSeverity !== null ? ` (${toneSeverity.toFixed(2)})` : ""}</span>
            )}
            <span>{t("inbox.confidence", { percent: (p.confidence * 100).toFixed(0) })}</span>
          </div>

          {p.reasoning && (
            <div className="text-xs text-gray-500 mt-2 italic">"{p.reasoning}"</div>
          )}

          {p.status === "REJECTED" && p.rejectReason && (
            <div className="text-xs text-red-700 mt-2">{t("inbox.rejectedReason", { reason: p.rejectReason })}</div>
          )}
          {p.status === "APPROVED" && p.committedEntityId && (
            <div className="text-xs text-green-700 mt-2">
              {t("inbox.appliedTo", { entityType: p.committedEntityType ?? "" })} <code>{formatShortRef(p.committedEntityId)}…</code>
              {p.committedAt && <> at {formatDateTime(p.committedAt, locale)}</>}
            </div>
          )}
        </div>

        {isPending && (
          <div className="flex flex-col gap-2 shrink-0">
            <button
              onClick={onApprove}
              disabled={busy}
              className="px-3 py-1 text-sm bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50"
            >
              {busy ? "…" : t("inbox.approve")}
            </button>
            <button
              onClick={onOpenReject}
              disabled={busy}
              className="px-3 py-1 text-sm border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              {t("inbox.reject")}
            </button>
          </div>
        )}
      </div>

      {isRejectOpen && (
        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded">
          <label className="block text-xs font-semibold text-amber-900 mb-1">
            {t("inbox.rejectReasonLabel")}
          </label>
          <textarea
            value={rejectReason}
            onChange={(e) => onRejectReasonChange(e.target.value)}
            placeholder={t("inbox.rejectReasonPlaceholder")}
            className="w-full text-sm border border-amber-300 rounded p-2"
            rows={2}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={onSubmitReject}
              disabled={busy}
              className="px-3 py-1 text-sm bg-amber-700 text-white rounded hover:bg-amber-800 disabled:opacity-50"
            >
              {busy ? "…" : t("inbox.confirmReject")}
            </button>
            <button
              onClick={onCancelReject}
              disabled={busy}
              className="px-3 py-1 text-sm border border-amber-300 text-amber-800 rounded hover:bg-amber-100 disabled:opacity-50"
            >
              {t("inbox.cancelReject")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const classes: Record<Status, string> = {
    PENDING: "bg-blue-100 text-blue-800",
    APPROVED: "bg-green-100 text-green-800",
    REJECTED: "bg-red-100 text-red-800",
    SUPERSEDED: "bg-gray-200 text-gray-700",
    EXPIRED: "bg-gray-200 text-gray-700",
  };
  return <span className={`px-1.5 py-0.5 rounded text-xs ${classes[status]}`}>{status}</span>;
}

function priorityClass(p: string): string {
  switch (p) {
    case "URGENT": return "bg-red-100 text-red-800";
    case "HIGH": return "bg-orange-100 text-orange-800";
    case "MEDIUM": return "bg-yellow-100 text-yellow-800";
    case "LOW": return "bg-gray-100 text-gray-700";
    default: return "bg-gray-100 text-gray-700";
  }
}
