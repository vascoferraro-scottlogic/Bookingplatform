"use client";

import { useTranslations } from "next-intl";

type ContactContent = {
  email?: string;
  phone?: string;
  address?: string;
  formEnabled?: boolean;
};

export default function ContactSection({ title, content }: { title: string; content: string }) {
  const t = useTranslations("common");
  let data: ContactContent = {};
  try { data = JSON.parse(content); } catch {}

  return (
    <section className="py-16 px-6 bg-gray-50">
      <h2 className="text-3xl font-bold text-green-700 mb-6 text-center">{title}</h2>
      <div className="max-w-xl mx-auto space-y-3 text-gray-700">
        {data.address && (
          <div className="flex gap-2">
            <span className="font-medium">{t("contact.address")}</span>
            <span>{data.address}</span>
          </div>
        )}
        {data.email && (
          <div className="flex gap-2">
            <span className="font-medium">{t("contact.email")}</span>
            <a href={`mailto:${data.email}`} className="text-green-600 hover:underline">{data.email}</a>
          </div>
        )}
        {data.phone && (
          <div className="flex gap-2">
            <span className="font-medium">{t("contact.phone")}</span>
            <a href={`tel:${data.phone}`} className="text-green-600 hover:underline">{data.phone}</a>
          </div>
        )}
      </div>
    </section>
  );
}
