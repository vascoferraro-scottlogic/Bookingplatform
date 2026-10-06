"use client";

import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useTranslations } from "next-intl";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const registered = searchParams.get("registered");
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const t = useTranslations("auth.login");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await signIn("credentials", { redirect: false, email, password });
    if (res?.error) {
      setError(t("invalidCredentials"));
    } else {
      router.push(callbackUrl);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-xl bg-white p-8 shadow">
        <h1 className="text-2xl font-bold text-center">{t("title")}</h1>
        {registered && <p className="text-green-600 text-sm text-center">{t("registeredSuccess")}</p>}
        {error && <p className="text-red-600 text-sm text-center">{error}</p>}
        <input
          type="email"
          placeholder={t("emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border p-3"
          required
        />
        <input
          type="password"
          placeholder={t("passwordPlaceholder")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border p-3"
          required
        />
        <button type="submit" className="w-full rounded-lg bg-green-600 p-3 text-white font-medium hover:bg-green-700">
          {t("submit")}
        </button>
        <p className="text-center text-sm text-gray-500">
          <a href="/auth/register" className="text-green-600 hover:underline">{t("createAccount")}</a>
          {" · "}
          <a href="/auth/forgot-password" className="text-green-600 hover:underline">{t("forgotPassword")}</a>
        </p>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-gray-400">Loading...</p>
      </main>
    }>
      <LoginForm />
    </Suspense>
  );
}
