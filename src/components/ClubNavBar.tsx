"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";

interface ClubNavBarProps {
  clubName: string;
  slug: string;
  brandColor: string;
  isAdmin: boolean;
}

export default function ClubNavBar({ clubName, slug, brandColor, isAdmin }: ClubNavBarProps) {
  const t = useTranslations("common.nav");
  return (
    <nav className="flex items-center justify-between px-6 py-3 text-white text-sm" style={{ backgroundColor: brandColor }}>
      <Link href={`/${slug}`} className="font-semibold hover:underline">{clubName}</Link>
      <div className="flex items-center gap-4">
        <Link href="/dashboard/bookings" className="hover:underline">{t("bookings")}</Link>
        <Link href="/dashboard/notifications" className="hover:underline">{t("notifications")}</Link>
        <Link href="/dashboard/maintenance" className="hover:underline">{t("maintenance")}</Link>
        {isAdmin && <Link href="/dashboard/content" className="hover:underline">{t("content")}</Link>}
        {isAdmin && <Link href="/dashboard/streaming" className="hover:underline">{t("streaming")}</Link>}
        {isAdmin && <Link href="/dashboard/admin" className="hover:underline">{t("admin")}</Link>}
        <button onClick={() => signOut({ callbackUrl: "/" })} className="hover:underline">
          {t("signOut")}
        </button>
      </div>
    </nav>
  );
}
