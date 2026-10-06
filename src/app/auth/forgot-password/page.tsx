"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth.forgotPassword");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setSent(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-xl bg-white p-8 shadow">
        <h1 className="text-2xl font-bold text-center">{t("title")}</h1>
        {sent ? (
          <p className="text-green-700 text-center">{t("sentMessage")}</p>
        ) : (
          <>
            <input type="email" placeholder={t("emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border p-3" required />
            <button type="submit" className="w-full rounded-lg bg-green-600 p-3 text-white font-medium hover:bg-green-700">{t("submit")}</button>
          </>
        )}
      </form>
    </main>
  );
}
