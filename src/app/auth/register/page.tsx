"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clubSlug = searchParams.get("club") ?? "";
  const [form, setForm] = useState({ email: "", password: "", name: "", tenantSlug: clubSlug });
  const [clubName, setClubName] = useState("");
  const [error, setError] = useState("");
  const t = useTranslations("auth.register");

  // Pre-fill club slug from query param and fetch club name
  useEffect(() => {
    if (clubSlug) {
      setForm((f) => ({ ...f, tenantSlug: clubSlug }));
      fetch(`/api/public/club/${encodeURIComponent(clubSlug)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d?.name) setClubName(d.name); })
        .catch(() => {});
    }
  }, [clubSlug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error);
    } else {
      router.push("/auth/login?registered=1");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-xl bg-white p-8 shadow">
        <h1 className="text-2xl font-bold text-center">
          {clubName ? t("joinClub", { clubName }) : t("title")}
        </h1>
        {error && <p className="text-red-600 text-sm text-center">{error}</p>}
        <input type="text" placeholder={t("namePlaceholder")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border p-3" />
        <input type="email" placeholder={t("emailPlaceholder")} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-lg border p-3" required />
        <input type="password" placeholder={t("passwordPlaceholder")} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full rounded-lg border p-3" required />
        <input type="text" placeholder={t("clubSlugPlaceholder")} value={form.tenantSlug} onChange={(e) => setForm({ ...form, tenantSlug: e.target.value })} className="w-full rounded-lg border p-3" />
        <button type="submit" className="w-full rounded-lg bg-green-600 p-3 text-white font-medium hover:bg-green-700">
          {t("submit")}
        </button>
        <p className="text-center text-sm text-gray-500">
          {t("haveAccount")} <a href="/auth/login" className="text-green-600 hover:underline">{t("signIn")}</a>
        </p>
      </form>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-gray-400">Loading...</p>
      </main>
    }>
      <RegisterForm />
    </Suspense>
  );
}
