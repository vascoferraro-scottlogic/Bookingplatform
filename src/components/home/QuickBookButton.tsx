"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function QuickBookButton() {
  const t = useTranslations("common");
  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm flex flex-col items-center justify-center text-center">
      <h3 className="font-semibold text-gray-800 mb-2">{t("quickBook.title")}</h3>
      <p className="text-sm text-gray-500 mb-4">{t("quickBook.subtitle")}</p>
      <Link
        href="/dashboard/bookings"
        className="rounded-lg bg-green-600 px-6 py-3 text-white font-medium hover:bg-green-700"
      >
        {t("quickBook.bookNow")}
      </Link>
    </div>
  );
}
