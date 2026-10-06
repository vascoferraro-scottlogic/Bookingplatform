"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChapterShell, Field, inputClass } from "./shared";
import type { ChapterProps } from "./shared";

export default function Chapter1About({ tenantId, onAdvance }: ChapterProps) {
  const t = useTranslations("onboarding");
  const [name, setName] = useState("");
  const [brandColor, setBrandColor] = useState("#16a34a");
  const [logoUrl, setLogoUrl] = useState("");
  const [locale, setLocale] = useState("en");
  const [slug, setSlug] = useState("");
  const [originalSlug, setOriginalSlug] = useState("");
  const [slugLocked, setSlugLocked] = useState(false);
  const [slugCheck, setSlugCheck] = useState<{
    state: "idle" | "checking" | "available" | "unavailable";
    reason?: string;
  }>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/admin/tenants/${tenantId}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          setError(data.error ?? `Could not load tenant (${r.status}).`);
          setLoaded(true);
          return null;
        }
        return r.json();
      })
      .then((t) => {
        if (!t) return;
        setName(t.name ?? "");
        setBrandColor(t.brandColor ?? "#16a34a");
        setLogoUrl(t.logoUrl ?? "");
        setLocale(t.locale ?? "en");
        setOriginalSlug(t.slug ?? "");
        // Hide a placeholder slug from the input — it's a system handle, not
        // something the admin should see or edit verbatim.
        setSlug(t.slug && !t.slug.startsWith("t-") ? t.slug : "");
        setSlugLocked(t.status === "ACTIVE" || !!t.goLiveAt);
        setLoaded(true);
      })
      .catch((e) => {
        setError(`Could not load tenant: ${e?.message ?? "network error"}`);
        setLoaded(true);
      });
  }, [tenantId]);

  // Debounced availability check.
  useEffect(() => {
    if (!slug) {
      setSlugCheck({ state: "idle" });
      return;
    }
    if (slug === originalSlug) {
      setSlugCheck({ state: "available" });
      return;
    }
    setSlugCheck({ state: "checking" });
    const handle = setTimeout(() => {
      fetch(`/api/onboarding/slug?candidate=${encodeURIComponent(slug)}`)
        .then((r) => r.json())
        .then((data) => {
          setSlugCheck(data.available
            ? { state: "available" }
            : { state: "unavailable", reason: data.reason ?? "Not available" });
        })
        .catch(() => setSlugCheck({ state: "unavailable", reason: "Check failed" }));
    }, 350);
    return () => clearTimeout(handle);
  }, [slug, originalSlug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    if (!slug || slugCheck.state === "unavailable") {
      setError("Pick an available URL slug before continuing.");
      return;
    }
    if (slugCheck.state === "checking") {
      setError("Hold on — still checking that URL is available.");
      return;
    }
    setError("");
    setBusy(true);

    // Save slug first if it changed (and the tenant isn't live yet).
    if (!slugLocked && slug !== originalSlug) {
      const slugRes = await fetch("/api/onboarding/slug", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!slugRes.ok) {
        const data = await slugRes.json().catch(() => ({}));
        setError(data.error ?? "Could not save that URL.");
        setBusy(false);
        return;
      }
      setOriginalSlug(slug);
    }

    const res = await fetch(`/api/admin/tenants/${tenantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, brandColor, logoUrl: logoUrl || null, locale }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not save tenant.");
      setBusy(false);
      return;
    }
    setBusy(false);
    await onAdvance();
  };

  if (!loaded) return <div className="text-gray-500">{t("loading")}</div>;

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const slugStatusColor =
    slugCheck.state === "available" ? "text-emerald-700"
    : slugCheck.state === "unavailable" ? "text-red-700"
    : "text-gray-500";
  const slugStatusLabel =
    slugCheck.state === "checking" ? "checking…"
    : slugCheck.state === "available" ? (slug === originalSlug ? "current" : "available")
    : slugCheck.state === "unavailable" ? (slugCheck.reason ?? "unavailable")
    : "";

  return (
    <ChapterShell
      title={t("chapters.about")}
      intro="Let's start with the basics. You can change any of this later — except your URL, which locks once you go live."
      onSubmit={submit}
      busy={busy}
    >
      <Field label="Organisation name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field
        label="Public URL"
        hint={slugLocked
          ? "Locked: this URL is in use by your live members. Contact support if you really must change it."
          : "Lowercase letters, digits and hyphens. 3–40 characters. Locks the moment you go live."}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-gray-500 whitespace-nowrap">{baseUrl}/</span>
          <input
            className={inputClass + " font-mono"}
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            disabled={slugLocked}
            placeholder="my-club"
            required
          />
        </div>
        {slug && (
          <p className={`mt-1 text-xs ${slugStatusColor}`}>
            {slugStatusLabel}
          </p>
        )}
      </Field>
      <Field label="Brand colour" hint="Used for the public site and dashboard accents.">
        <div className="flex items-center gap-3">
          <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-10 w-16 rounded border border-gray-300" />
          <input className={inputClass + " font-mono"} value={brandColor} onChange={(e) => setBrandColor(e.target.value)} />
        </div>
      </Field>
      <Field label="Logo URL" hint="Optional. Paste a hosted image URL for now — uploads come later.">
        <input className={inputClass} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
      </Field>
      <Field label="Language">
        <select className={inputClass} value={locale} onChange={(e) => setLocale(e.target.value)}>
          <option value="en">English</option>
        </select>
      </Field>
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-700 text-sm">
          {error}
        </div>
      )}
    </ChapterShell>
  );
}
