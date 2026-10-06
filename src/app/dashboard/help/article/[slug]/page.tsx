"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import { useTrack } from "@/components/TrackingProvider";
import HelpMarkdown from "@/components/help/HelpMarkdown";

interface Article {
  slug: string;
  title: string;
  category: string;
  audience: string;
  body: string;
  excerpt: string;
  tags: string[];
  updated?: string;
  overridden: boolean;
  fallbackFromEnglish: boolean;
}

export default function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { data: session } = useSession();
  const realRole = (session?.user as { role?: string } | undefined)?.role;
  const [article, setArticle] = useState<Article | null>(null);
  const [notFound, setNotFound] = useState(false);
  const { trackFeature } = useTrack();
  const t = useTranslations("help");
  const locale = useLocale();

  useEffect(() => {
    fetch(`/api/help/${encodeURIComponent(slug)}?locale=${locale}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d: Article | null) => {
        if (d) {
          setArticle(d);
          trackFeature("help.article.view", "help-article");
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, locale]);

  if (notFound) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-500">{t("article.notFound")}</p>
        <Link href="/dashboard/help" className="text-green-700 hover:underline text-sm">{t("article.backToHelp")}</Link>
      </div>
    );
  }
  if (!article) return <p className="text-sm text-gray-500">{t("article.loading")}</p>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="text-xs text-gray-500 flex items-center gap-2">
        <Link href="/dashboard/help" className="hover:underline">{t("index.title")}</Link>
        <span>/</span>
        <span className="capitalize">{article.category.replace(/-/g, " ")}</span>
        {article.overridden && (
          <span className="ml-2 rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 uppercase tracking-wide">
            {t("article.customised")}
          </span>
        )}
        {article.fallbackFromEnglish && (
          <span className="ml-2 rounded bg-gray-100 text-gray-600 px-1.5 py-0.5 uppercase tracking-wide">
            {t("article.translationPending")}
          </span>
        )}
      </div>
      <h1 className="text-2xl font-bold">{article.title}</h1>
      <HelpMarkdown source={article.body} realRole={realRole} />
      {article.updated && (
        <p className="text-xs text-gray-400 mt-6">{t("article.lastUpdated", { date: article.updated })}</p>
      )}
    </div>
  );
}
