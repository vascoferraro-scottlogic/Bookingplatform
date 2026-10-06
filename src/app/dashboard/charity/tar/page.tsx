"use client";

import { useEffect, useState, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate as formatDateLocale, formatCurrency } from "@/lib/format";

// ── Types ────────────────────────────────────────────────────

type SectionDef = {
  slug: string;
  title: string;
  guidance: string;
  dataKeys: string[];
  required: boolean;
};

type SectionData = {
  content?: string;
  suggestedContent?: string;
  lastEditedAt?: string;
  source?: "manual" | "suggested" | "carried_forward";
};

type Year = { id: string; startDate: string; endDate: string };

type TARData = {
  tar: {
    id: string;
    status: "DRAFT" | "FINALISED";
    sections: Record<string, SectionData>;
    generatedAt: string | null;
    finalisedAt: string | null;
  };
  sectionDefinitions: SectionDef[];
  regulator: string;
  year: Year;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContextData = Record<string, any>;

// ── Helpers ──────────────────────────────────────────────────

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

function penniesToPounds(pence: number, locale: string): string {
  return formatCurrency(pence, locale, "GBP");
}

// ── Component ────────────────────────────────────────────────

export default function TARWizardPage() {
  const locale = useLocale();
  const t = useTranslations("charity");
  const [years, setYears] = useState<Year[]>([]);
  const [selectedYearId, setSelectedYearId] = useState<string>("");
  const [tarData, setTarData] = useState<TARData | null>(null);
  const [context, setContext] = useState<ContextData | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [finalising, setFinalising] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [warnings, setWarnings] = useState<{ key: string; message: string }[]>([]);
  const [warningsDismissed, setWarningsDismissed] = useState(false);

  // Load years
  useEffect(() => {
    fetch("/api/charity/years")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Year[]) => {
        setYears(data);
        if (data.length > 0) setSelectedYearId(data[data.length - 1].id);
      })
      .finally(() => setLoading(false));
  }, []);

  // Load TAR + context when year changes
  useEffect(() => {
    if (!selectedYearId) return;
    setTarData(null);
    setContext(null);
    setError(null);
    setWarnings([]);
    setWarningsDismissed(false);

    Promise.all([
      fetch(`/api/charity/tar?yearId=${selectedYearId}`).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(`/api/charity/tar/context?yearId=${selectedYearId}`).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(`/api/charity/tar/readiness?yearId=${selectedYearId}`).then((r) =>
        r.ok ? r.json() : null,
      ),
    ]).then(([tar, ctx, readiness]) => {
      if (!tar) {
        setError(t("tar.loadFailed"));
        return;
      }
      setTarData(tar as TARData);
      setContext(ctx as ContextData);
      if (readiness?.warnings?.length) {
        setWarnings(readiness.warnings);
      }
      // Seed drafts from saved sections
      const d: Record<string, string> = {};
      for (const [slug, sec] of Object.entries(
        (tar as TARData).tar.sections,
      )) {
        if ((sec as SectionData).content)
          d[slug] = (sec as SectionData).content!;
      }
      setDrafts(d);
    });
  }, [selectedYearId]);

  const sections = tarData?.sectionDefinitions ?? [];
  const currentSection = sections[activeStep];
  const isFinalised = tarData?.tar.status === "FINALISED";

  // ── Save ────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!currentSection || !selectedYearId || isFinalised) return;
    setSaving(true);
    try {
      const res = await fetch("/api/charity/tar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yearId: selectedYearId,
          slug: currentSection.slug,
          content: drafts[currentSection.slug] ?? "",
          source: "manual",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTarData((prev) =>
          prev ? { ...prev, tar: { ...prev.tar, sections: data.sections } } : prev,
        );
      }
    } finally {
      setSaving(false);
    }
  }, [currentSection, selectedYearId, drafts, isFinalised]);

  // ── Suggest ─────────────────────────────────────────────────
  const handleSuggest = useCallback(async () => {
    if (!currentSection || !selectedYearId || !context || isFinalised) return;
    setSuggesting(true);
    try {
      // Pick only the data keys this section needs
      const sectionContext: Record<string, unknown> = {};
      for (const key of currentSection.dataKeys) {
        if (key in context) sectionContext[key] = context[key];
      }
      // Also include prior TAR carry-forward for this slug
      if (context.priorTAR) {
        const prior = context.priorTAR as {
          sections?: Record<string, SectionData>;
        };
        if (prior.sections?.[currentSection.slug]) {
          sectionContext.priorYearContent =
            prior.sections[currentSection.slug].content;
        }
      }

      const res = await fetch("/api/charity/tar/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yearId: selectedYearId,
          slug: currentSection.slug,
          context: sectionContext,
        }),
      });
      if (res.ok) {
        const { suggestedContent } = await res.json();
        setTarData((prev) => {
          if (!prev) return prev;
          const sections = { ...prev.tar.sections };
          sections[currentSection.slug] = {
            ...sections[currentSection.slug],
            suggestedContent,
          };
          return { ...prev, tar: { ...prev.tar, sections } };
        });
      } else if (res.status === 429) {
        setError(t("tar.rateLimited"));
      }
    } finally {
      setSuggesting(false);
    }
  }, [currentSection, selectedYearId, context, isFinalised]);

  // ── Accept suggestion ───────────────────────────────────────
  const handleAcceptSuggestion = useCallback(() => {
    if (!currentSection || isFinalised) return;
    const suggested =
      tarData?.tar.sections[currentSection.slug]?.suggestedContent;
    if (suggested) {
      setDrafts((prev) => ({ ...prev, [currentSection.slug]: suggested }));
    }
  }, [currentSection, tarData, isFinalised]);

  // ── Finalise ────────────────────────────────────────────────
  const handleFinalise = useCallback(async () => {
    if (!selectedYearId || isFinalised) return;
    if (!confirm(t("tar.finaliseConfirm")))
      return;
    setFinalising(true);
    setError(null);
    try {
      const res = await fetch("/api/charity/tar/finalise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearId: selectedYearId }),
      });
      if (res.ok) {
        const data = await res.json();
        setTarData((prev) =>
          prev
            ? {
                ...prev,
                tar: {
                  ...prev.tar,
                  status: data.status,
                  finalisedAt: data.finalisedAt,
                },
              }
            : prev,
        );
      } else {
        const data = await res.json();
        if (data.missingSections) {
          setError(t("tar.incompleteSections", { sections: data.missingSections.join(", ") }));
        } else {
          setError(data.message ?? "Finalise failed.");
        }
      }
    } finally {
      setFinalising(false);
    }
  }, [selectedYearId, isFinalised]);

  // ── Export ──────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!selectedYearId) return;
    const res = await fetch(
      `/api/charity/tar/export?yearId=${selectedYearId}`,
    );
    if (res.ok) {
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `TAR-${tarData?.year.startDate}-${tarData?.year.endDate}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const data = await res.json();
      setError(data.message ?? "Export failed.");
    }
  }, [selectedYearId, tarData]);

  // ── Render ─────────────────────────────────────────────────

  if (loading) return <p>{t("overview.loading")}</p>;

  if (years.length === 0) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold mb-2">{t("tar.title")}</h1>
        <p className="text-slate-600">
          {t("tar.noYears")}{" "}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{t("tar.title")}</h1>
        <select
          className="border rounded px-3 py-1.5 text-sm"
          value={selectedYearId}
          onChange={(e) => {
            setSelectedYearId(e.target.value);
            setActiveStep(0);
          }}
        >
          {years.map((y) => (
            <option key={y.id} value={y.id}>
              {formatDate(y.startDate)} – {formatDate(y.endDate)}
            </option>
          ))}
        </select>
      </div>

      {isFinalised && (
        <div className="rounded border border-green-200 bg-green-50 p-3 mb-4 text-green-900 text-sm">
          {t("tar.finalisedMessage", { date: tarData?.tar.finalisedAt
            ? formatDateLocale(tarData.tar.finalisedAt, locale)
            : "unknown" })}
        </div>
      )}

      {warnings.length > 0 && !warningsDismissed && !isFinalised && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 mb-4 text-amber-900 text-sm">
          <div className="flex justify-between items-start">
            <div>
              <p className="font-semibold">{t("tar.headsUp")}</p>
              <ul className="list-disc list-inside mt-1 space-y-0.5">
                {warnings.map((w) => (
                  <li key={w.key}>{w.message}</li>
                ))}
              </ul>
            </div>
            <button
              onClick={() => setWarningsDismissed(true)}
              className="text-amber-600 hover:text-amber-800 ml-3 shrink-0"
              aria-label="Dismiss warnings"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 mb-4 text-red-900 text-sm">
          {error}
        </div>
      )}

      {!tarData ? (
        <p>{t("tar.loadingTarData")}</p>
      ) : (
        <div className="flex gap-6">
          {/* ── Sidebar stepper ─────────────────────────── */}
          <nav className="w-56 shrink-0">
            <ol className="space-y-1">
              {sections.map((s, i) => {
                const filled = !!tarData.tar.sections[s.slug]?.content?.trim();
                const isActive = i === activeStep;
                return (
                  <li key={s.slug}>
                    <button
                      onClick={() => setActiveStep(i)}
                      className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 ${
                        isActive
                          ? "bg-green-100 text-green-900 font-semibold"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`w-5 h-5 flex items-center justify-center rounded-full text-xs ${
                          filled
                            ? "bg-green-600 text-white"
                            : "border border-slate-300 text-slate-400"
                        }`}
                      >
                        {filled ? "✓" : i + 1}
                      </span>
                      <span className="truncate">{s.title}</span>
                      {s.required && !filled && (
                        <span className="text-red-400 text-xs ml-auto">*</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>

            {/* Action buttons */}
            <div className="mt-6 space-y-2">
              {!isFinalised && (
                <button
                  onClick={handleFinalise}
                  disabled={finalising}
                  className="w-full px-3 py-2 bg-green-700 text-white rounded text-sm hover:bg-green-800 disabled:opacity-50"
                >
                  {finalising ? "Finalising…" : "Finalise TAR"}
                </button>
              )}
              {isFinalised && (
                <button
                  onClick={handleExport}
                  className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm hover:bg-slate-800"
                >
                  Export TAR
                </button>
              )}
            </div>
          </nav>

          {/* ── Main content area ───────────────────────── */}
          {currentSection && (
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold mb-1">
                {currentSection.title}
              </h2>
              <p className="text-sm text-slate-500 mb-4">
                {currentSection.guidance}
              </p>

              {/* Suggested content banner */}
              {tarData.tar.sections[currentSection.slug]
                ?.suggestedContent && (
                <div className="rounded border border-blue-200 bg-blue-50 p-3 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-blue-900">
                      AI Suggestion
                    </span>
                    {!isFinalised && (
                      <button
                        onClick={handleAcceptSuggestion}
                        className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                      >
                        Use this text
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-blue-900 whitespace-pre-wrap">
                    {
                      tarData.tar.sections[currentSection.slug]
                        .suggestedContent
                    }
                  </p>
                </div>
              )}

              {/* Editor */}
              <textarea
                className="w-full border rounded p-3 text-sm min-h-[200px] resize-y disabled:bg-slate-50"
                value={drafts[currentSection.slug] ?? ""}
                onChange={(e) =>
                  setDrafts((prev) => ({
                    ...prev,
                    [currentSection.slug]: e.target.value,
                  }))
                }
                disabled={isFinalised}
                placeholder={`Write the ${currentSection.title} section…`}
              />

              {/* Toolbar */}
              {!isFinalised && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-green-700 text-white rounded text-sm hover:bg-green-800 disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={handleSuggest}
                    disabled={suggesting || !context}
                    className="px-4 py-2 border border-blue-600 text-blue-700 rounded text-sm hover:bg-blue-50 disabled:opacity-50"
                  >
                    {suggesting ? "Generating…" : "✨ Suggest with AI"}
                  </button>
                  {activeStep > 0 && (
                    <button
                      onClick={() => setActiveStep((s) => s - 1)}
                      className="px-4 py-2 border rounded text-sm hover:bg-slate-50 ml-auto"
                    >
                      ← Back
                    </button>
                  )}
                  {activeStep < sections.length - 1 && (
                    <button
                      onClick={async () => {
                        await handleSave();
                        setActiveStep((s) => s + 1);
                      }}
                      className="px-4 py-2 bg-slate-700 text-white rounded text-sm hover:bg-slate-800"
                    >
                      Save &amp; Next →
                    </button>
                  )}
                </div>
              )}

              {/* Data context sidebar */}
              {context && currentSection.dataKeys.length > 0 && (
                <div className="mt-6 rounded border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold mb-2 text-slate-700">
                    Data for this section
                  </h3>
                  <ContextSidebar
                    dataKeys={currentSection.dataKeys}
                    context={context}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Context sidebar ──────────────────────────────────────────

function ContextSidebar({
  dataKeys,
  context,
}: {
  dataKeys: string[];
  context: ContextData;
}) {
  const locale = useLocale();
  return (
    <div className="space-y-3 text-sm">
      {dataKeys.includes("charitySettings") && context.charitySettings && (
        <ContextBlock title="Charity Details">
          <KV
            label="Regulator"
            value={(context.charitySettings as Record<string, string>).regulator}
          />
          <KV
            label="Charity No."
            value={
              (context.charitySettings as Record<string, string>).charityNumber ??
              "Not set"
            }
          />
        </ContextBlock>
      )}

      {dataKeys.includes("financials") && context.financials && (
        <ContextBlock title="Financial Summary">
          {(() => {
            const f = context.financials as {
              receiptsAndPayments: {
                totalReceipts: number;
                totalPayments: number;
                netMovement: number;
              };
              assetsAndLiabilities: { netAssets: number };
            };
            return (
              <>
                <KV
                  label="Total receipts"
                  value={penniesToPounds(f.receiptsAndPayments.totalReceipts, locale)}
                />
                <KV
                  label="Total payments"
                  value={penniesToPounds(f.receiptsAndPayments.totalPayments, locale)}
                />
                <KV
                  label="Net movement"
                  value={penniesToPounds(f.receiptsAndPayments.netMovement, locale)}
                />
                <KV
                  label="Net assets"
                  value={penniesToPounds(f.assetsAndLiabilities.netAssets, locale)}
                />
              </>
            );
          })()}
        </ContextBlock>
      )}

      {dataKeys.includes("events") && context.events && (
        <ContextBlock title="Events">
          {(() => {
            const e = context.events as {
              total: number;
              byCategory: Record<string, number>;
              publicEventTitles: string[];
            };
            return (
              <>
                <KV label="Total events" value={String(e.total)} />
                {Object.entries(e.byCategory).map(([cat, n]) => (
                  <KV key={cat} label={cat} value={String(n)} />
                ))}
                {e.publicEventTitles.length > 0 && (
                  <div className="mt-1">
                    <span className="text-slate-500">Public events:</span>
                    <ul className="list-disc list-inside ml-2">
                      {e.publicEventTitles.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            );
          })()}
        </ContextBlock>
      )}

      {dataKeys.includes("bookings") && context.bookings && (
        <ContextBlock title="Bookings">
          {(() => {
            const b = context.bookings as {
              total: number;
              uniqueBookers: number;
            };
            return (
              <>
                <KV label="Total bookings" value={String(b.total)} />
                <KV label="Unique bookers" value={String(b.uniqueBookers)} />
              </>
            );
          })()}
        </ContextBlock>
      )}

      {dataKeys.includes("members") && context.members && (
        <ContextBlock title="Members">
          {(() => {
            const m = context.members as {
              totalActive: number;
              newDuringYear: number;
            };
            return (
              <>
                <KV label="Active members" value={String(m.totalActive)} />
                <KV label="New this year" value={String(m.newDuringYear)} />
              </>
            );
          })()}
        </ContextBlock>
      )}

      {dataKeys.includes("streaming") && context.streaming && (
        <ContextBlock title="Live Streaming">
          {(() => {
            const s = context.streaming as {
              sessions: number;
              viewers: number;
            };
            return (
              <>
                <KV label="Sessions" value={String(s.sessions)} />
                <KV label="Total viewers" value={String(s.viewers)} />
              </>
            );
          })()}
        </ContextBlock>
      )}

      {dataKeys.includes("maintenance") && context.maintenance && (
        <ContextBlock title="Maintenance">
          {(() => {
            const m = context.maintenance as {
              totalActivities: number;
              byType: Record<string, number>;
            };
            return (
              <>
                <KV label="Activities" value={String(m.totalActivities)} />
                {Object.entries(m.byType).map(([t, n]) => (
                  <KV key={t} label={t.replace(/_/g, " ")} value={String(n)} />
                ))}
              </>
            );
          })()}
        </ContextBlock>
      )}

      {dataKeys.includes("trustees") && context.trustees && (
        <ContextBlock title="Trustees">
          {(context.trustees as { name: string; email: string }[]).map(
            (t, i) => (
              <KV key={i} label={t.name ?? "Unnamed"} value={t.email} />
            ),
          )}
        </ContextBlock>
      )}
    </div>
  );
}

function ContextBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="font-medium text-slate-900 mb-1">{title}</h4>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-600">
      <span>{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}
