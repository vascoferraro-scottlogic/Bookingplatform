"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { ChapterShell, Field, inputClass } from "./shared";
import type { ChapterProps } from "./shared";

type Membership = {
  id: string; role: string; kind: string; status: string;
  user: { email: string; name: string | null };
};
type Invitation = { id: string; email: string; role: string; kind: string; expiresAt: string };

export default function Chapter5People({ onAdvance }: ChapterProps) {
  const t = useTranslations("onboarding");
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("USER");
  const [kind, setKind] = useState("MEMBER");
  const [specialism, setSpecialism] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/onboarding/invite");
    if (res.ok) {
      const d = await res.json();
      setMemberships(d.memberships);
      setInvitations(d.invitations);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/onboarding/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(), name: name.trim() || undefined, role, kind,
        specialism: specialism.trim() || undefined,
      }),
    });
    if (res.ok) {
      setMsg(`Invitation stubbed for ${email}.`);
      setEmail(""); setName(""); setSpecialism("");
      await load();
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg(err.error || "Failed to invite.");
    }
    setBusy(false);
  };

  return (
    <ChapterShell
      title={t("chapters.people")}
      intro="Add anyone else who helps run the club. They'll get an invitation email (stubbed for now — view in the platform inspector)."
      onSubmit={(e) => { e.preventDefault(); onAdvance(); }}
      submitLabel="Done — continue"
      canSkip
      onSkip={onAdvance}
    >
      {(memberships.length > 0 || invitations.length > 0) && (
        <div className="space-y-2">
          {memberships.map((m) => (
            <div key={m.id} className="flex items-center justify-between bg-gray-50 rounded p-3 border border-gray-200">
              <div>
                <span className="font-medium">{m.user.name || m.user.email}</span>
                <span className="text-sm text-gray-500 ml-2">{m.role} · {m.kind} · {m.status}</span>
              </div>
            </div>
          ))}
          {invitations.map((i) => (
            <div key={i.id} className="flex items-center justify-between bg-amber-50 rounded p-3 border border-amber-200">
              <div>
                <span className="font-medium">{i.email}</span>
                <span className="text-sm text-amber-700 ml-2">invitation pending · {i.role}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t pt-4 space-y-3">
        <p className="text-sm font-medium text-gray-800">Invite someone</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Name (optional)">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="What they do">
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="TENANT_ADMIN">Club admin</option>
              <option value="MAINTENANCE">Greenkeeper / maintenance</option>
              <option value="USER">Member</option>
            </select>
          </Field>
          <Field label="Relationship">
            <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="MEMBER">Club member</option>
              <option value="STAFF">Staff (employed)</option>
              <option value="CONTRACTOR">Contractor (e.g. visiting greenkeeper)</option>
              <option value="VOLUNTEER">Volunteer</option>
            </select>
          </Field>
        </div>
        <Field label="What they specialise in (optional)" hint="Helps the maintenance agents tailor advice.">
          <input className={inputClass} value={specialism} onChange={(e) => setSpecialism(e.target.value)} placeholder="e.g. fescue greens, drainage" />
        </Field>
        {msg && <p className="text-sm text-gray-600">{msg}</p>}
        <button
          type="button"
          onClick={invite}
          disabled={busy || !email.trim()}
          className="px-4 py-2 rounded-md border border-emerald-600 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send invitation"}
        </button>
      </div>
    </ChapterShell>
  );
}
