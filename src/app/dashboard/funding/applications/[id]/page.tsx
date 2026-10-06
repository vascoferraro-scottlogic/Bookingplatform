"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";

type Question = {
  id: string;
  label: string;
  helpText: string | null;
};

type Response = {
  id: string;
  questionId: string | null;
  questionLabel: string;
  content: string;
  source: "MANUAL" | "AI_DRAFT" | "AI_APPROVED";
};

type Application = {
  id: string;
  status: string;
  amountRequested: number | null;
  amountAwarded: number | null;
  submittedAt: string | null;
  decisionAt: string | null;
  notes: string | null;
  opportunity: {
    id: string;
    name: string;
    funder: string;
    description: string;
    deadline: string | null;
    questions: Question[];
  };
  responses: Response[];
  createdBy: { id: string; name: string | null; email: string };
};

type DraftProposal = {
  id: string;
  confidence: number;
  reasoning: string;
  payload: {
    applicationId: string;
    questionId?: string;
    questionLabel: string;
    draftText: string;
    confidence: number;
    reasoning: string;
  };
};

function formatPence(pence: number): string {
  return `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 0 })}`;
}

export default function ApplicationDetailPage() {
    // Refine a single answer in place. Calls the new per-response refine
    // endpoint with the user's optional instruction. Returns true on success.
    async function refineResponse(
      responseId: string,
      instruction?: string,
    ): Promise<boolean> {
      setSaving(true);
      try {
        const r = await fetch(
          `/api/funding/applications/${id}/responses/${responseId}/refine`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ instruction: instruction ?? "" }),
          },
        );
        if (!r.ok) {
          alert(t("application.refineFailed"));
          return false;
        }
        load();
        return true;
      } finally {
        setSaving(false);
      }
    }

    // First-draft helper for a question that has no response yet: create an
    // empty response, then immediately refine it. The user gets a populated
    // answer in one click.
    async function draftFirstAnswer(questionId: string) {
      setSaving(true);
      try {
        const r = await fetch(`/api/funding/applications/${id}/responses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId, content: "" }),
        });
        if (!r.ok) return;
        const created = await r.json();
        if (created?.id) {
          await fetch(
            `/api/funding/applications/${id}/responses/${created.id}/refine`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            },
          );
        }
        load();
      } finally {
        setSaving(false);
      }
    }

    // Whole-application drafting still uses the agent + proposal-inbox flow.
    async function improveAllWithAI() {
      setDrafting(true);
      await fetch(`/api/funding/applications/${id}/draft`, {
        method: "POST",
      });
      load();
      setDrafting(false);
    }
  const t = useTranslations("funding");
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [app, setApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newQuestion, setNewQuestion] = useState("");
  const [newAnswer, setNewAnswer] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftProposals, setDraftProposals] = useState<DraftProposal[]>([]);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const uniqueQuestions = app?.opportunity?.questions
    ? Array.from(new Map(app.opportunity.questions.map((q) => [q.id, q])).values())
    : [];

// Inline editable response component (must be top-level)
function EditableResponse({ resp, t, saving, setSaving, load, appId, onRefine }: {
  resp: Response,
  t: any,
  saving: boolean,
  setSaving: (v: boolean) => void,
  load: () => void,
  appId: string,
  onRefine: (responseId: string, instruction?: string) => Promise<boolean>,
}) {
  const [editing, setEditing] = useState(resp.content === "");
  const [value, setValue] = useState(resp.content);
  const [showRefine, setShowRefine] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [refining, setRefining] = useState(false);
  useEffect(() => {
    setValue(resp.content);
  }, [resp.content]);

  async function saveEdit() {
    setSaving(true);
    await fetch(`/api/funding/applications/${appId}/responses/${resp.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: value }),
    });
    setEditing(false);
    load();
    setSaving(false);
  }

  async function runRefine() {
    setRefining(true);
    try {
      const ok = await onRefine(resp.id, instruction.trim() || undefined);
      if (ok) {
        setShowRefine(false);
        setInstruction("");
      }
    } finally {
      setRefining(false);
    }
  }

  return (
    <div className="border rounded p-3">
      <p className="font-medium text-sm">{resp.questionLabel}</p>
      {editing ? (
        <>
          <textarea
            className="border rounded px-3 py-1.5 w-full text-sm h-20 mt-2"
            value={value}
            onChange={e => setValue(e.target.value)}
            disabled={saving}
          />
          <div className="flex gap-2 mt-2 items-center">
            <button
              onClick={saveEdit}
              disabled={saving || !value.trim()}
              className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700 disabled:opacity-50"
            >
              {t("application.save")}
            </button>
            {resp.content !== "" && (
              <button
                onClick={() => { setEditing(false); setValue(resp.content); }}
                disabled={saving}
                className="text-gray-600 border px-3 py-1 rounded text-sm hover:bg-gray-100 disabled:opacity-50"
              >
                {t("application.cancel")}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 whitespace-pre-wrap">{resp.content || <span className="text-gray-400 italic">No answer yet</span>}</p>
          <div className="flex items-center gap-2 mt-2">
            <p className="text-xs text-gray-400">
              {t(`application.source${resp.source === "MANUAL" ? "Manual" : resp.source === "AI_DRAFT" ? "AiDraft" : "AiApproved"}`)}
            </p>
            <button
              onClick={() => setEditing(true)}
              disabled={saving || refining}
              className="text-blue-600 text-xs underline ml-2 disabled:opacity-50"
            >
              {t("application.editResponse")}
            </button>
            <button
              onClick={() => setShowRefine((v) => !v)}
              disabled={saving || refining}
              className="btn btn-ai"
              title={t("application.improveWithAI")}
            >
              <span className="btn-ai__icon">✨</span>
              {t("application.improveWithAI").toUpperCase()}
            </button>
          </div>
          {showRefine && (
            <div className="mt-3 border-t pt-3 space-y-2">
              <textarea
                className="border rounded px-3 py-1.5 w-full text-sm h-16"
                placeholder={t("application.refineInstructionPlaceholder")}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                disabled={refining}
              />
              <div className="flex gap-2">
                <button
                  onClick={runRefine}
                  disabled={refining}
                  className="bg-purple-600 text-white px-3 py-1 rounded text-sm hover:bg-purple-700 disabled:opacity-50"
                >
                  {refining ? t("application.refineRunning") : t("application.refineSubmit")}
                </button>
                <button
                  onClick={() => { setShowRefine(false); setInstruction(""); }}
                  disabled={refining}
                  className="text-gray-600 border px-3 py-1 rounded text-sm hover:bg-gray-100 disabled:opacity-50"
                >
                  {t("application.refineCancel")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
  const load = useCallback(() => {
    fetch(`/api/funding/applications/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setApp)
      .finally(() => setLoading(false));
    // Also load pending AI proposals for this application.
    fetch(`/api/agent/proposals?status=PENDING&kind=FUNDING_APPLICATION_DRAFT&limit=50`)
      .then((r) => (r.ok ? r.json() : { proposals: [] }))
      .then((data) => {
        const all: DraftProposal[] = (data.proposals ?? [])
          .map((p: { id: string; confidence: number; reasoning: string; payload: string }) => {
            try {
              return { ...p, payload: JSON.parse(p.payload) };
            } catch {
              return null;
            }
          })
          .filter(
            (p: DraftProposal | null): p is DraftProposal =>
              p !== null && p.payload?.applicationId === id,
          );
        setDraftProposals(all);
      })
      .catch(() => setDraftProposals([]));
  }, [id]);

  useEffect(load, [load]);

  // Initialize collapsed state map when questions load
  useEffect(() => {
    if (!app?.opportunity?.questions) return;
    const map: Record<string, boolean> = {};
    // default collapsed to true for a denser, more scannable UI
    app.opportunity.questions.forEach((q) => { map[q.id] = true; });
    setCollapsedMap(map);
  }, [app?.opportunity?.questions]);

  async function updateStatus(status: string) {
    setSaving(true);
    await fetch(`/api/funding/applications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    load();
    setSaving(false);
  }

  async function deleteApplication() {
    if (!confirm(t("application.confirmDelete"))) return;
    await fetch(`/api/funding/applications/${id}`, { method: "DELETE" });
    router.push("/dashboard/funding");
  }

  async function addResponse(e: React.FormEvent) {
    e.preventDefault();
    if (!newQuestion.trim()) return;
    setSaving(true);
    await fetch(`/api/funding/applications/${id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionLabel: newQuestion.trim(),
        content: newAnswer.trim(),
      }),
    });
    setNewQuestion("");
    setNewAnswer("");
    load();
    setSaving(false);
  }

  async function generateDrafts() {
    setDrafting(true);
    try {
      await fetch(`/api/funding/applications/${id}/draft`, { method: "POST" });
      load();
    } finally {
      setDrafting(false);
    }
  }

  async function approveDraft(proposalId: string) {
    setBusyProposalId(proposalId);
    try {
      await fetch(`/api/agent/proposals/${proposalId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      load();
    } finally {
      setBusyProposalId(null);
    }
  }

  async function rejectDraft(proposalId: string) {
    setBusyProposalId(proposalId);
    try {
      await fetch(`/api/agent/proposals/${proposalId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Not suitable" }),
      });
      load();
    } finally {
      setBusyProposalId(null);
    }
  }

  if (loading) return <p className="p-4">Loading…</p>;
  if (!app) return <p className="p-4 text-red-600">Application not found.</p>;

  const isDraft = app.status === "DRAFT";

  return (
    <div className="max-w-3xl space-y-6">
      {/* debug JSON removed to simplify the page for users */}
      <Link href="/dashboard/funding" className="text-sm text-green-700 hover:underline">
        {t("application.backToOverview")}
      </Link>

      <div>
        <h1 className="text-2xl font-bold">{app.opportunity.name}</h1>
        <p className="text-gray-500">{app.opportunity.funder}</p>
      </div>

      {/* Status & metadata */}
      <div className="grid grid-cols-2 gap-4 bg-gray-50 rounded p-4">
        <div>
          <p className="text-sm text-gray-500">{t("application.status")}</p>
          <p className="font-medium">{t(`status.${app.status}`)}</p>
        </div>
        {app.amountRequested && (
          <div>
            <p className="text-sm text-gray-500">{t("application.amountRequested")}</p>
            <p className="font-medium">{formatPence(app.amountRequested)}</p>
          </div>
        )}
        {app.amountAwarded && (
          <div>
            <p className="text-sm text-gray-500">{t("application.amountAwarded")}</p>
            <p className="font-medium">{formatPence(app.amountAwarded)}</p>
          </div>
        )}
        {app.submittedAt && (
          <div>
            <p className="text-sm text-gray-500">{t("application.submittedAt")}</p>
            <p className="font-medium">{new Date(app.submittedAt).toLocaleDateString("en-GB")}</p>
          </div>
        )}
        {app.decisionAt && (
          <div>
            <p className="text-sm text-gray-500">{t("application.decisionAt")}</p>
            <p className="font-medium">{new Date(app.decisionAt).toLocaleDateString("en-GB")}</p>
          </div>
        )}
        {app.notes && (
          <div className="col-span-2">
            <p className="text-sm text-gray-500">{t("application.notes")}</p>
            <p>{app.notes}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {isDraft && (
          <>
            <button
              onClick={() => updateStatus("SUBMITTED")}
              disabled={saving}
              className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {t("application.submit")}
            </button>
            <button
              onClick={generateDrafts}
              disabled={drafting || saving}
              className="bg-purple-600 text-white px-3 py-1.5 rounded text-sm hover:bg-purple-700 disabled:opacity-50"
            >
              {drafting ? t("application.aiDrafting") : t("application.aiGenerate")}
            </button>
            <button
              onClick={deleteApplication}
              disabled={saving}
              className="bg-red-600 text-white px-3 py-1.5 rounded text-sm hover:bg-red-700 disabled:opacity-50"
            >
              {t("application.delete")}
            </button>
          </>
        )}
        {app.status === "SUBMITTED" && (
          <button
            onClick={() => updateStatus("PENDING_DECISION")}
            disabled={saving}
            className="bg-amber-600 text-white px-3 py-1.5 rounded text-sm hover:bg-amber-700 disabled:opacity-50"
          >
            Mark Pending Decision
          </button>
        )}
        {(app.status === "SUBMITTED" || app.status === "PENDING_DECISION") && (
          <>
            <button
              onClick={() => updateStatus("APPROVED")}
              disabled={saving}
              className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700 disabled:opacity-50"
            >
              Mark Approved
            </button>
            <button
              onClick={() => updateStatus("REJECTED")}
              disabled={saving}
              className="bg-red-600 text-white px-3 py-1.5 rounded text-sm hover:bg-red-700 disabled:opacity-50"
            >
              Mark Rejected
            </button>
            <button
              onClick={() => updateStatus("WITHDRAWN")}
              disabled={saving}
              className="text-gray-600 border px-3 py-1.5 rounded text-sm hover:bg-gray-100 disabled:opacity-50"
            >
              {t("application.withdraw")}
            </button>
          </>
        )}
      </div>

      {/* Draft proposals are shown inline under each question now; top-level list removed */}

      {/* Responses grouped by question */}
      <section>
        <h2 className="text-xl font-semibold mb-3">{t("application.responses")}</h2>
        {/* Collapsible Q/A blocks */}
        {uniqueQuestions.map((q, idx) => {
          // Use top-level collapsed map instead of per-item hooks
          const collapsed = collapsedMap[q.id] ?? false;
          // Find the latest response for this question (manual, approved, or AI draft)
          const allResps = app.responses.filter((r) => r.questionId === q.id);
          const resp = allResps.length > 0 ? allResps[allResps.length - 1] : null;
          const aiDrafts = draftProposals.filter((dp) => dp.payload.questionId === q.id);
          return (
            <div key={q.id} className="mb-6 border rounded bg-gray-50">
              <div className="flex items-center justify-between p-3 cursor-pointer select-none" onClick={() => setCollapsedMap(prev => ({ ...prev, [q.id]: !prev[q.id] }))}>
                <span className="font-medium text-sm">{q.label}</span>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setCollapsedMap(prev => ({ ...prev, [q.id]: !prev[q.id] })); }}
                  className="ml-2 text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100"
                  aria-label={collapsed ? 'Show response' : 'Hide response'}
                >
                  {collapsed ? 'Show' : 'Hide'}
                </button>
              </div>
              {!collapsed && (
                <div className="p-3 pt-0">
                  {q.helpText && <p className="text-xs text-gray-500 mb-2">{q.helpText}</p>}
                  {resp ? (
                    <EditableResponse
                      resp={resp}
                      t={t}
                      saving={saving}
                      setSaving={setSaving}
                      load={load}
                      appId={app.id}
                      onRefine={refineResponse}
                    />
                  ) : (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={async () => {
                          setSaving(true);
                          await fetch(`/api/funding/applications/${id}/responses`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ questionId: q.id, content: "" }),
                          });
                          load();
                          setSaving(false);
                        }}
                        disabled={saving}
                        className="text-xs text-green-700 hover:underline disabled:opacity-50"
                      >
                        {t("application.startAnswer")}
                      </button>
                      <button
                        onClick={() => draftFirstAnswer(q.id)}
                        disabled={saving}
                        className="btn btn-ai"
                        title={t("application.draftFirstWithAI")}
                      >
                        <span className="btn-ai__icon">✨</span>
                        {t("application.draftFirstWithAI").toUpperCase()}
                      </button>
                    </div>
                  )}
                  {/* AI Drafts for this question (still show approve/reject for legacy, but main workflow is now iterative) */}
                  {aiDrafts.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {aiDrafts.map((dp) => (
                        <div key={dp.id} className="border-2 border-purple-200 rounded p-3 bg-purple-50">
                          <p className="text-xs text-gray-500 mb-1">AI Draft</p>
                          <p className="whitespace-pre-wrap text-sm">{dp.payload.draftText}</p>
                          <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                            <span>{t("application.aiConfidence")}: {Math.round(dp.payload.confidence * 100)}%</span>
                            <span>·</span>
                            <span>{dp.payload.reasoning}</span>
                          </div>
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => approveDraft(dp.id)}
                              disabled={busyProposalId === dp.id}
                              className="bg-green-600 text-white px-3 py-1 rounded text-xs hover:bg-green-700 disabled:opacity-50"
                            >
                              {t("application.aiApprove")}
                            </button>
                            <button
                              onClick={() => rejectDraft(dp.id)}
                              disabled={busyProposalId === dp.id}
                              className="bg-red-600 text-white px-3 py-1 rounded text-xs hover:bg-red-700 disabled:opacity-50"
                            >
                              {t("application.aiReject")}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {/* Freeform responses (no questionId) */}
        {app.responses.filter((r) => !r.questionId).length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-medium mb-2">Other responses</h3>
            <div className="space-y-3">
              {app.responses.filter((r) => !r.questionId).map((resp) => (
                <EditableResponse
                  key={resp.id}
                  resp={resp}
                  t={t}
                  saving={saving}
                  setSaving={setSaving}
                  load={load}
                  appId={app.id}
                  onRefine={refineResponse}
                />
              ))}
            </div>
          </div>
        )}
        {/* Add response form for freeform questions */}
        <form onSubmit={addResponse} className="border rounded p-3 bg-gray-50 space-y-3 mt-8">
          <h3 className="text-sm font-medium">{t("application.addResponse")}</h3>
          <div>
            <label className="block text-sm mb-1">{t("application.question")}</label>
            <input
              type="text"
              className="border rounded px-3 py-1.5 w-full text-sm"
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              placeholder="e.g. Describe your organisation and its purpose"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">{t("application.answer")}</label>
            <textarea
              className="border rounded px-3 py-1.5 w-full text-sm h-20"
              value={newAnswer}
              onChange={(e) => setNewAnswer(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={saving || !newQuestion.trim()}
            className="bg-green-600 text-white px-3 py-1.5 rounded text-sm hover:bg-green-700 disabled:opacity-50"
          >
            {t("application.addResponse")}
          </button>
        </form>

        {/* Review all answers with AI */}
        <div className="mt-8 flex justify-end">
          <button
            onClick={improveAllWithAI}
            disabled={drafting}
            className="bg-purple-700 text-white px-4 py-2 rounded text-sm hover:bg-purple-800 disabled:opacity-50"
          >
            ✨ {t("application.improveAllWithAI")}
          </button>
        </div>
      </section>
    </div>
  );
}
