"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";

type MemberClub = {
  tenant: { id: string; name: string; slug: string; locality: string | null };
  billingMode: string;
  joinedAt: string;
};

type Invite = {
  id: string;
  token: string;
  status: string;
  expiresAt: string;
  inviteeTenant: { id: string; name: string; slug: string; locality: string | null };
  inviterTenant: { id: string; name: string; slug: string };
};

type FederationDetail = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  maxClubs: number;
  memberships: MemberClub[];
  invites: Invite[];
};

export default function FederationDetailPage() {
  const t = useTranslations("settings.federation");
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [federation, setFederation] = useState<FederationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteSlug, setInviteSlug] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  function loadDetail() {
    fetch(`/api/federations/${params.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setFederation)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadDetail(); }, [params.id]);

  async function handleInvite() {
    setInviteError("");
    setInviteSuccess("");
    if (!inviteSlug.trim()) return;
    setInviting(true);
    const res = await fetch(`/api/federations/${params.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantSlug: inviteSlug.trim() }),
    });
    setInviting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setInviteError(body.error ?? t("inviteFailed"));
      return;
    }
    setInviteSlug("");
    setInviteSuccess(t("inviteSent"));
    setTimeout(() => setInviteSuccess(""), 3000);
    loadDetail();
  }

  async function handleLeave() {
    setLeaving(true);
    const res = await fetch(`/api/federations/${params.id}/leave`, { method: "POST" });
    setLeaving(false);
    if (res.ok) {
      router.push("/dashboard/federation");
    }
  }

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;
  if (!federation) return <div className="p-6 text-red-500">Federation not found.</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <nav className="text-sm text-gray-500">
        <Link href="/dashboard/settings">{t("breadcrumb")}</Link>
        <span className="mx-2">/</span>
        <Link href="/dashboard/federation">{t("title")}</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-700">{federation.name}</span>
      </nav>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{federation.name}</h1>
          {federation.description && <p className="text-gray-600 text-sm mt-1">{federation.description}</p>}
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${
          federation.status === "ACTIVE" ? "bg-green-100 text-green-700" :
          federation.status === "SUSPENDED" ? "bg-amber-100 text-amber-700" :
          "bg-gray-100 text-gray-600"
        }`}>
          {federation.status === "ACTIVE" ? t("active") : federation.status === "SUSPENDED" ? t("suspended") : t("dissolved")}
        </span>
      </div>

      {/* Member clubs */}
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("memberClubs")}</h2>
        <ul className="divide-y rounded-xl border bg-white">
          {federation.memberships.map((m) => (
            <li key={m.tenant.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{m.tenant.name}</p>
                {m.tenant.locality && <p className="text-xs text-gray-500">{m.tenant.locality}</p>}
              </div>
              <div className="text-right text-xs text-gray-500">
                <p>{t("joined")} {new Date(m.joinedAt).toLocaleDateString()}</p>
                <p>{m.billingMode.replace(/_/g, " ").toLowerCase()}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Pending invitations */}
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("pendingInvites")}</h2>
        {federation.invites.length === 0 ? (
          <p className="text-sm text-gray-500">{t("noInvites")}</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-white">
            {federation.invites.map((inv) => (
              <li key={inv.id} className="px-4 py-3">
                <p className="font-medium text-gray-900">{inv.inviteeTenant.name}</p>
                {inv.inviteeTenant.locality && <p className="text-xs text-gray-500">{inv.inviteeTenant.locality}</p>}
                <p className="text-xs text-gray-400 mt-1">
                  {t("invitedBy", { name: inv.inviterTenant.name })} · {t("expires", { date: new Date(inv.expiresAt).toLocaleDateString() })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Invite form */}
      {federation.status === "ACTIVE" && (
        <section>
          <h2 className="text-lg font-semibold mb-3">{t("inviteClub")}</h2>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700">{t("inviteSlugLabel")}</label>
              <input
                value={inviteSlug}
                onChange={(e) => setInviteSlug(e.target.value)}
                placeholder={t("inviteSlugPlaceholder")}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm"
              />
            </div>
            <button
              onClick={handleInvite}
              disabled={inviting}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {t("sendInvite")}
            </button>
          </div>
          {inviteError && <p className="text-sm text-red-600 mt-2">{inviteError}</p>}
          {inviteSuccess && <p className="text-sm text-green-700 mt-2">{inviteSuccess}</p>}
        </section>
      )}

      {/* Leave */}
      <section className="pt-4 border-t">
        {!confirmLeave ? (
          <button
            onClick={() => setConfirmLeave(true)}
            className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50"
          >
            {t("leave")}
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-red-700">{t("leaveConfirm")}</p>
            <div className="flex gap-2">
              <button
                onClick={handleLeave}
                disabled={leaving}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {t("leave")}
              </button>
              <button
                onClick={() => setConfirmLeave(false)}
                className="rounded-md border px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="pt-2">
        <Link href="/dashboard/federation" className="text-sm text-emerald-700 hover:underline">
          {t("backToList")}
        </Link>
      </div>
    </div>
  );
}
