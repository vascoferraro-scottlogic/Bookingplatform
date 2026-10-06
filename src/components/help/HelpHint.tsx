"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useTrack } from "@/components/TrackingProvider";

/**
 * Inline help icon that deep-links to a specific help article.
 * Place next to a feature heading or label to give admins context.
 *
 * Example:
 *   <h1>Bookings <HelpHint slug="approve-bookings" /></h1>
 *
 * We do NOT auto-resolve category from slug here to keep the API tiny.
 * The help article page resolves the category from the article metadata.
 */
interface Props {
  slug: string;
  label?: string;
}

export default function HelpHint({ slug, label }: Props) {
  const { trackAction } = useTrack();
  const t = useTranslations("help");
  const resolvedLabel = label ?? t("hint.label");
  return (
    <Link
      href={`/dashboard/help/article/${slug}`}
      onClick={() => trackAction("help.hint.click", "help-hint", slug)}
      className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-green-700 text-xs font-bold hover:bg-green-200"
      title={resolvedLabel}
      aria-label={`${resolvedLabel}: ${slug}`}
    >
      ?
    </Link>
  );
}
