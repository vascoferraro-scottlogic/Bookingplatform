"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { formatDateTime, formatDate } from "@/lib/format";
import Link from "next/link";

type Application = {
  id: string;
  clubName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  country: string;
  region: string | null;
  notes: string | null;
  status: string;
  decisionNotes: string | null;
  reviewedAt: string | null;
  reviewedById: string | null;
  tenantId: string | null;
  tenant: { id: string; name: string; slug: string; status: string } | null;
  createdAt: string;
};

type ActionMode = "approve" | "reject" | "more-info" | null;

type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  acceptUrl: string;
};

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("admin");
  const { update } = useSession();
  const [app, setApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [helpBusy, setHelpBusy] = useState(false);

  const loadInvitations = (appId: string) => {
    fetch(`/api/admin/applications/${appId}/invitation`)
      .then((r) => (r.ok ? r.json() : { invitations: [] }))
      .then((d) => setInvitations(d.invitations ?? []))
      .catch(() => setInvitations([]));
  };

  useEffect(() => {
    fetch(`/api/admin/applications/${params.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setApp(d);
        if (d) {
          setSlug(deriveSlug(d.clubName));
          if (d.tenantId) loadInvitations(d.id);
        }
      })
      .catch(() => setApp(null))
      .finally(() => setLoading(false));
  }, [params.id]);

  const copyLink = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 2000);
    } catch {
      // ignore
    }
  };

  async function submitAction() {
    if (!actionMode || !app) return;
    setError("");
    if (actionMode !== "approve" && !decisionNotes.trim()) {
      setError("Decision notes are required.");
      return;
    }
    setSubmitting(true);
    const body =
      actionMode === "approve"
        ? { slug: slug.trim() || undefined, decisionNotes: decisionNotes.trim() || undefined }
        : { decisionNotes: decisionNotes.trim() };
    const res = await fetch(`/api/admin/applications/${app.id}/${actionMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Action failed");
      return;
    }
    const data = await res.json();
    setSuccess(
      actionMode === "approve"
        ? `Approved. Tenant '${data.slug}' created and invitation sent.`
        : actionMode === "reject"
          ? "Application rejected and applicant notified."
          : "Follow-up requested and applicant notified.",
    );
    setActionMode(null);
    // Refresh
    setTimeout(() => router.refresh(), 500);
    fetch(`/api/admin/applications/${params.id}`)
      .then((r) => r.json())
      .then((d) => {
        setApp(d);
        if (d?.tenantId) loadInvitations(d.id);
      });
  }

  if (loading) return <p className="text-gray-500">{t("platform.applicationDetail.loading")}</p>;
  if (!app) return <p className="text-red-600">{t("platform.applicationDetail.notFound")}</p>;

  const isFinalised = app.status === "APPROVED" || app.status === "REJECTED";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/dashboard/platform/applications"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          {t("platform.applicationDetail.allApplications")}
        </Link>
        <h1 className="text-2xl font-bold text-gray-800 mt-2">{app.clubName}</h1>
        <div className="text-sm text-gray-500">
          Submitted {formatDateTime(app.createdAt, locale)}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 bg-white rounded-xl shadow p-5">
        <Field label={t("platform.applicationDetail.contactName")}>{app.contactName}</Field>
        <Field label={t("platform.applicationDetail.email")}>
          <a className="text-green-700 hover:underline" href={`mailto:${app.contactEmail}`}>
            {app.contactEmail}
          </a>
        </Field>
        <Field label={t("platform.applicationDetail.phone")}>{app.contactPhone ?? <em className="text-gray-400">none</em>}</Field>
        <Field label={t("platform.applicationDetail.countryRegion")}>
          {app.country}
          {app.region && <span className="text-gray-400"> / {app.region}</span>}
        </Field>
        <Field label="Status">
          <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
            {app.status.replace(/_/g, " ").toLowerCase()}
          </span>
        </Field>
        {app.tenant && (
          <Field label={t("platform.applicationDetail.provisionedTenant")}>
            <Link
              href={`/dashboard/platform/tenants/${app.tenant.id}`}
              className="text-green-700 hover:underline"
            >
              {app.tenant.name} ({app.tenant.slug})
            </Link>
            <span className="ml-2 text-xs text-gray-500">[{app.tenant.status}]</span>
            {app.tenant.slug.startsWith("t-") && (
              <p className="text-xs text-gray-500 mt-1">
                Placeholder slug — the club admin picks the public URL during onboarding.
              </p>
            )}
            {app.tenant.status === "ACTIVE" && (
              <Link
                href={`/${app.tenant.slug}`}
                target="_blank"
                rel="noreferrer"
                className="ml-3 text-xs text-gray-500 hover:underline"
              >
                view public site ↗
              </Link>
            )}
          </Field>
        )}
        {app.notes && (
          <div className="sm:col-span-2">
            <div className="text-xs uppercase text-gray-500 mb-1">{t("platform.applicationDetail.notesFromApplicant")}</div>
            <div className="bg-gray-50 rounded p-3 whitespace-pre-wrap text-gray-700">
              {app.notes}
            </div>
          </div>
        )}
        {app.decisionNotes && (
          <div className="sm:col-span-2">
            <div className="text-xs uppercase text-gray-500 mb-1">{t("platform.applicationDetail.decisionNotes")}</div>
            <div className="bg-amber-50 border border-amber-200 rounded p-3 whitespace-pre-wrap text-gray-700">
              {app.decisionNotes}
            </div>
          </div>
        )}
      </div>

      {success && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-green-800 text-sm">
          {success}
        </div>
      )}

      {app.status === "APPROVED" && app.tenant && app.tenant.status === "ONBOARDING" && (
        <div className="bg-white rounded-xl shadow p-5 space-y-3 border-l-4 border-emerald-500">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t("platform.applicationDetail.nextSteps")}</h2>
            <p className="text-sm text-gray-600">
              {t("platform.applicationDetail.nextStepsIntro")}
            </p>
          </div>
          <ol className="text-sm text-gray-700 list-decimal pl-5 space-y-1">
            <li>Send the invitation link below to the club&rsquo;s contact.</li>
            <li>They set a password, sign in, and land on the onboarding wizard.</li>
            <li>The wizard guides them through 10 chapters: about, organisation, location, hours, greens, people, agent knowledge, features, subscription, and review.</li>
            <li>When they press <span className="font-semibold">Go live</span>, the tenant flips to ACTIVE, queued invitations are released, and the public URL works.</li>
          </ol>
          <div className="border-t pt-3">
            <p className="text-sm text-gray-600 mb-2">
              Need to help drive the wizard? You can impersonate them and act as a tenant admin for this club. Your real identity is preserved in the audit log.
            </p>
            <button
              type="button"
              disabled={helpBusy}
              onClick={async () => {
                if (!app.tenant) return;
                setError("");
                setHelpBusy(true);
                try {
                  const res = await fetch("/api/platform/impersonation", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      tenantId: app.tenant.id,
                      reason: `Driving onboarding for ${app.tenant.name}`,
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    setError(data.error ?? "Could not start impersonation.");
                    setHelpBusy(false);
                    return;
                  }
                  await update({ actingAs: data.actingAs });
                  router.push("/onboarding");
                } catch {
                  setError("Network error starting impersonation.");
                  setHelpBusy(false);
                }
              }}
              className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {helpBusy ? "Starting…" : t("platform.applicationDetail.helpDriveOnboarding")}
            </button>
          </div>
        </div>
      )}

      {invitations.length > 0 && (
        <div className="bg-white rounded-xl shadow p-5 space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{t("platform.applicationDetail.invitationLinks")}</h2>
            <p className="text-sm text-gray-500">
              {t("platform.applicationDetail.invitationLinksHint")}
            </p>
          </div>
          <ul className="space-y-2">
            {invitations.map((inv) => {
              const expired = new Date(inv.expiresAt) < new Date();
              const statusLabel =
                inv.status === "ACCEPTED" ? "accepted"
                : inv.status === "PENDING" && expired ? "expired"
                : inv.status.toLowerCase();
              const statusClass =
                inv.status === "ACCEPTED" ? "bg-green-100 text-green-800"
                : statusLabel === "expired" ? "bg-gray-100 text-gray-600"
                : "bg-amber-100 text-amber-800";
              return (
                <li key={inv.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm">
                      <div className="font-medium text-gray-800">{inv.email}</div>
                      <div className="text-xs text-gray-500">
                        {inv.role.replace(/_/g, " ").toLowerCase()} · expires {formatDate(inv.expiresAt, locale)}
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusClass}`}>
                      {statusLabel}
                    </span>
                  </div>
                  {inv.status === "PENDING" && !expired && (
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={inv.acceptUrl}
                        className="flex-1 text-xs font-mono bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-gray-700"
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <button
                        type="button"
                        onClick={() => copyLink(inv.acceptUrl, inv.id)}
                        className="px-3 py-1.5 text-xs rounded border border-gray-300 hover:bg-gray-50 whitespace-nowrap"
                      >
                        {copied === inv.id ? "Copied ✓" : "Copy link"}
                      </button>
                      <a
                        href={inv.acceptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 text-xs rounded border border-gray-300 hover:bg-gray-50 whitespace-nowrap"
                      >
                        Open
                      </a>
                    </div>
                  )}
                  {inv.acceptedAt && (
                    <div className="text-xs text-gray-500">
                      Accepted {formatDateTime(inv.acceptedAt, locale)}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!isFinalised && !actionMode && (
        <div className="flex gap-2">
          <button
            onClick={() => { setActionMode("approve"); setDecisionNotes(""); setError(""); }}
            className="px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700"
          >
            Approve
          </button>
          <button
            onClick={() => { setActionMode("more-info"); setDecisionNotes(""); setError(""); }}
            className="px-4 py-2 rounded-lg bg-amber-500 text-white font-medium hover:bg-amber-600"
          >
            Request more info
          </button>
          <button
            onClick={() => { setActionMode("reject"); setDecisionNotes(""); setError(""); }}
            className="px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700"
          >
            Reject
          </button>
        </div>
      )}

      {actionMode && (
        <div className="bg-white rounded-xl shadow p-5 space-y-4">
          <h2 className="text-lg font-semibold capitalize">
            {actionMode === "more-info" ? "Request more info" : actionMode}
          </h2>

          {actionMode === "approve" && (
            <label className="block">
              <span className="block text-sm font-medium text-gray-700 mb-1">
                Slug (URL)
              </span>
              <div className="flex items-center">
                <span className="text-gray-500 text-sm pr-2">/</span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  className="flex-1 rounded-lg border p-2"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                If the slug is taken, we'll auto-suffix it.
              </p>
            </label>
          )}

          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              {actionMode === "approve" ? "Notes for applicant (optional)" : "Notes for applicant"}
              {actionMode !== "approve" && <span className="text-red-600">*</span>}
            </span>
            <textarea
              value={decisionNotes}
              onChange={(e) => setDecisionNotes(e.target.value)}
              rows={4}
              className="w-full rounded-lg border p-2"
              placeholder={
                actionMode === "more-info"
                  ? "What do you need from them? e.g. 'Could you confirm how many greens you have?'"
                  : actionMode === "reject"
                    ? "Why is this being rejected? (visible to the applicant)"
                    : "Anything to share alongside the welcome email."
              }
            />
          </label>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={submitAction}
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:bg-gray-400"
            >
              {submitting ? "Submitting…" : "Confirm"}
            </button>
            <button
              onClick={() => setActionMode(null)}
              className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 font-medium hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase text-gray-500 mb-1">{label}</div>
      <div className="text-gray-800">{children}</div>
    </div>
  );
}

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "club";
}
