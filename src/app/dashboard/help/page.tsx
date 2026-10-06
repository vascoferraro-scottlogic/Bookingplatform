"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { useTrack } from "@/components/TrackingProvider";

interface ArticleSummary {
  slug: string;
  title: string;
  category: string;
  tags: string[];
  excerpt: string;
  audience: string;
  overridden: boolean;
  fallbackFromEnglish: boolean;
}

export default function HelpIndexPage() {
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [query, setQuery] = useState("");
  const { trackAction } = useTrack();
  const t = useTranslations("help");
  const locale = useLocale();

  useEffect(() => {
    fetch(`/api/help?locale=${locale}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setArticles(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [locale]);

  const categories = useMemo(() => {
    const map = new Map<string, ArticleSummary[]>();
    for (const a of articles) {
      if (!map.has(a.category)) map.set(a.category, []);
      map.get(a.category)!.push(a);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [articles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return articles.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.excerpt.toLowerCase().includes(q) ||
        a.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [articles, query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("index.title")}</h1>
        <p className="text-sm text-gray-600">{t("index.subtitle")}</p>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => {
          const v = e.target.value;
          setQuery(v);
          if (v.length >= 3) trackAction("help.search", "help-search");
        }}
        placeholder={t("index.searchPlaceholder")}
        className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
      />

      {query.trim() ? (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">{t("index.searchResultsTitle", { count: filtered.length })}</h2>
          {filtered.length === 0 ? (
            <p className="text-sm text-gray-500">{t("index.noResults", { query })}</p>
          ) : (
            filtered.map((a) => <ArticleCard key={a.slug} a={a} />)
          )}
        </div>
      ) : (
        categories.map(([cat, items]) => (
          <div key={cat} className="space-y-2">
            <h2 className="text-lg font-semibold capitalize">{cat.replace(/-/g, " ")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map((a) => (
                <ArticleCard key={a.slug} a={a} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function ArticleCard({ a }: { a: ArticleSummary }) {
  const t = useTranslations("help");
  return (
    <Link
      href={`/dashboard/help/article/${a.slug}`}
      className="block rounded-xl border border-gray-200 bg-white p-4 hover:border-green-400 hover:shadow-sm"
    >
      <div className="flex items-center gap-2">
        <h3 className="font-semibold">{a.title}</h3>
        {a.overridden && (
          <span className="text-[10px] uppercase tracking-wide rounded bg-amber-100 text-amber-800 px-1.5 py-0.5">
            {t("manage.customised")}
          </span>
        )}
        {a.fallbackFromEnglish && (
          <span className="text-[10px] uppercase tracking-wide rounded bg-gray-100 text-gray-600 px-1.5 py-0.5">
            {t("article.translationPending")}
          </span>
        )}
        {a.audience === "platform_admin" && (
          <span className="text-[10px] uppercase tracking-wide rounded bg-orange-100 text-orange-700 px-1.5 py-0.5">
            {t("article.platformAdmin")}
          </span>
        )}
      </div>
      {a.excerpt && <p className="text-sm text-gray-600 mt-1">{a.excerpt}</p>}
    </Link>
  );
}
