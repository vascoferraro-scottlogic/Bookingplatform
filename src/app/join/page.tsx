"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";

const COUNTRIES = [
  "United Kingdom",
  "Ireland",
  "Australia",
  "New Zealand",
  "Canada",
  "South Africa",
  "United States",
  "Other",
];

export default function JoinPage() {
  const t = useTranslations("common");
  const [form, setForm] = useState({
    clubName: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    country: "",
    region: "",
    notes: "",
    terms: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.terms) {
      setError(t("join.termsRequired"));
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clubName: form.clubName,
        contactName: form.contactName,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone || undefined,
        country: form.country,
        region: form.region || undefined,
        notes: form.notes || undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Sorry, something went wrong. Please try again.");
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow p-8 text-center space-y-4">
          <div className="text-5xl">📬</div>
          <h1 className="text-2xl font-bold text-gray-800">{t("join.receivedTitle")}</h1>
          <p className="text-gray-600">
            {t("join.receivedMessage", { email: form.contactEmail })}
          </p>
          <Link
            href="/"
            className="inline-block px-5 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700"
          >
            {t("join.backToHomepageButton")}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
            {t("join.backToHomepage")}
          </Link>
          <h1 className="text-3xl font-bold text-gray-800 mt-2">
            {t("join.title")}
          </h1>
          <p className="text-gray-600 mt-2">
            {t("join.subtitle")}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow p-6 space-y-5"
        >
          <Field label={t("join.clubName")} required>
            <input
              type="text"
              value={form.clubName}
              onChange={(e) => update("clubName", e.target.value)}
              required
              className="w-full rounded-lg border p-3"
              placeholder={t("join.clubNamePlaceholder")}
            />
          </Field>

          <div className="grid sm:grid-cols-2 gap-5">
            <Field label={t("join.yourName")} required>
              <input
                type="text"
                value={form.contactName}
                onChange={(e) => update("contactName", e.target.value)}
                required
                className="w-full rounded-lg border p-3"
              />
            </Field>
            <Field label={t("join.email")} required>
              <input
                type="email"
                value={form.contactEmail}
                onChange={(e) => update("contactEmail", e.target.value)}
                required
                className="w-full rounded-lg border p-3"
              />
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            <Field label={t("join.phone")}>
              <input
                type="tel"
                value={form.contactPhone}
                onChange={(e) => update("contactPhone", e.target.value)}
                className="w-full rounded-lg border p-3"
              />
            </Field>
            <Field label={t("join.country")} required>
              <select
                value={form.country}
                onChange={(e) => update("country", e.target.value)}
                required
                className="w-full rounded-lg border p-3 bg-white"
              >
                <option value="">{t("join.countryPlaceholder")}</option>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label={t("join.region")}>
            <input
              type="text"
              value={form.region}
              onChange={(e) => update("region", e.target.value)}
              className="w-full rounded-lg border p-3"
              placeholder={t("join.regionPlaceholder")}
            />
          </Field>

<Field label={t("join.notes")}>
            <textarea
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
              rows={4}
              className="w-full rounded-lg border p-3"
              placeholder={t("join.notesPlaceholder")}
            />
          </Field>

          <label className="flex items-start gap-3 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.terms}
              onChange={(e) => update("terms", e.target.checked)}
              className="mt-1"
            />
            <span>
              {t("join.termsLabel")}
            </span>
          </label>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:bg-gray-400"
          >
            {submitting ? t("join.submitting") : t("join.submit")}
          </button>
        </form>
      </div>
    </main>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
