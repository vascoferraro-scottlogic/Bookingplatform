"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChapterShell } from "./shared";
import type { ChapterProps } from "./shared";

type Tenant = {
  name: string; slug: string; brandColor: string;
  status: string; goLiveAt: string | null;
  latitude: number | null; longitude: number | null;
  openingTime: string; closingTime: string;
  greens: { id: string; name: string; rinks: { id: string }[] }[];
};

type GoLiveStatus = {
  ready: boolean;
  blockers: string[];
  queuedInvitationCount: number;
  tenant: { slug: string; name: string; status: string; goLiveAt: string | null };
};

/**
 * Chapter 10 — Review & Go live. (File name kept as Chapter9Review.tsx for
 * git-history continuity; the wizard slot moved from 9 → 10 when we inserted
 * "organisation" at slot 2. See decisions log 2026-05-04.)
 *
 * The terminal chapter. Shows a summary of everything captured, lists any
 * remaining blockers, and offers the explicit "Go live" button. Pressing
 * it flips the tenant to ACTIVE, releases queued invitations, and locks
 * the slug.
 */
export default function Chapter9Review({ tenantId, onGoTo }: ChapterProps) {
  const t = useTranslations("onboarding");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [goLive, setGoLive] = useState<GoLiveStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ slug: string; releasedInvitations: number } | null>(null);

  const refresh = () => {
    if (!tenantId) return;
    fetch(`/api/admin/tenants/${tenantId}`).then((r) => r.json()).then(setTenant);
    fetch("/api/onboarding/go-live").then((r) => r.json()).then(setGoLive);
  };

  useEffect(() => {
    if (!tenantId) return;
    // Mark this chapter visited (not "complete" — go-live is the actual completion)
    fetch("/api/onboarding/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapter: 10 }),
    });
    refresh();
  }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const launch = async () => {
    setError("");
    setBusy(true);
    const res = await fetch("/api/onboarding/go-live", { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not go live.");
      refresh();
      return;
    }
    setSuccess({ slug: data.slug, releasedInvitations: data.releasedInvitations });
    refresh();
  };

  if (!tenant || !goLive) return <div className="text-gray-500">Loading review…</div>;

  const totalRinks = tenant.greens.reduce((sum, g) => sum + g.rinks.length, 0);
  const isLive = tenant.status === "ACTIVE" || !!tenant.goLiveAt;

  if (success || isLive) {
    return (
      <ChapterShell title="You're live!">
        <p className="text-gray-700">
          Congratulations — {tenant.name} is now live and members can sign in.
        </p>
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 space-y-2">
          <p className="text-sm text-emerald-800">
            Your public site is at <span className="font-mono">/{tenant.slug}</span>
          </p>
          {success && success.releasedInvitations > 0 && (
            <p className="text-sm text-emerald-800">
              {success.releasedInvitations} queued invitation{success.releasedInvitations === 1 ? "" : "s"} {success.releasedInvitations === 1 ? "has" : "have"} just been released to your people.
            </p>
          )}
        </div>
        <div className="flex gap-3 pt-4 border-t">
          <a href="/dashboard" className="px-5 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700">
            Go to dashboard
          </a>
          <a href={`/${tenant.slug}`} target="_blank" rel="noreferrer" className="px-5 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50">
            View public site
          </a>
        </div>
      </ChapterShell>
    );
  }

  return (
    <ChapterShell
      title={t("chapters.review")}
      intro="Last step. Have a look at the summary below, then press Go live when you're ready. This is what flips your club from preview to public."
    >
      <dl className="grid grid-cols-2 gap-4 bg-gray-50 rounded p-4 border border-gray-200">
        <div>
          <dt className="text-xs uppercase text-gray-500">Public address</dt>
          <dd className="font-mono text-sm">{tenant.slug.startsWith("t-") ? <span className="text-amber-700">not picked yet</span> : `/${tenant.slug}`}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-gray-500">Hours</dt>
          <dd className="text-sm">{tenant.openingTime} – {tenant.closingTime}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-gray-500">Greens</dt>
          <dd className="text-sm">{tenant.greens.length} green{tenant.greens.length === 1 ? "" : "s"} ({totalRinks} rinks)</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-gray-500">Location</dt>
          <dd className="text-sm">{tenant.latitude && tenant.longitude ? `${tenant.latitude.toFixed(3)}, ${tenant.longitude.toFixed(3)}` : "Not set"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-gray-500">Queued invites</dt>
          <dd className="text-sm">
            {goLive.queuedInvitationCount} {goLive.queuedInvitationCount === 1 ? "person waiting" : "people waiting"} (sent on go-live)
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase text-gray-500">Status</dt>
          <dd className="text-sm">
            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">{tenant.status}</span>
          </dd>
        </div>
      </dl>

      {goLive.blockers.length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-amber-900 text-sm space-y-2">
          <p className="font-medium">Before you can go live:</p>
          <ul className="list-disc pl-5 space-y-1">
            {goLive.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
          <p className="text-xs text-amber-800">Use the chapter list above to revisit any step.</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3 pt-4 border-t">
        <button
          type="button"
          onClick={launch}
          disabled={!goLive.ready || busy}
          className="px-5 py-2 rounded-md bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? "Going live…" : "Go live"}
        </button>
        <button
          type="button"
          onClick={() => onGoTo(1)}
          className="px-5 py-2 rounded-md text-gray-600 hover:text-gray-900"
        >
          Review from the start
        </button>
      </div>
    </ChapterShell>
  );
}
