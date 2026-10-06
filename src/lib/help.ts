import { promises as fs } from "fs";
import path from "path";
import matter from "gray-matter";
import { prisma } from "@/lib/prisma";

/**
 * Help Centre content loader.
 *
 * Articles ship as markdown files under `content/help/{locale}/{category}/{slug}.md`.
 * Frontmatter:
 *   title: string
 *   category: string             // human-friendly category id e.g. "bookings"
 *   audience: "tenant_admin" | "platform_admin" | "both"   (default: tenant_admin)
 *   tags: string[]
 *   order: number                (default: 100; lower wins)
 *   excerpt: string              (used in lists + search)
 *   updated: ISO date string     (display only)
 *
 * Content body may contain remark-directive callouts:
 *   :::platform-admin
 *   ...visible only when the viewer is a PLATFORM_ADMIN (typically impersonating)
 *   :::
 *   :::tenant-admin
 *   ...visible only to native tenant admins (i.e. NOT impersonating platform admins)
 *   :::
 *
 * Per-tenant overrides live in the `HelpArticleOverride` table. When `enabled=false`
 * for (tenantId, slug, locale), the article is hidden from that tenant. Otherwise
 * `title` and `body` from the override (when non-null) replace the shipped values.
 */

export type HelpAudience = "tenant_admin" | "platform_admin" | "both";

export interface HelpFrontmatter {
  title: string;
  category: string;
  audience: HelpAudience;
  tags: string[];
  order: number;
  excerpt: string;
  updated?: string;
}

export interface HelpArticle extends HelpFrontmatter {
  slug: string;
  locale: string;
  /** True when content was sourced from a per-tenant override row. */
  overridden: boolean;
  /** True when the requested locale was missing and English fallback was used. */
  fallbackFromEnglish: boolean;
  body: string;
}

export interface HelpArticleSummary {
  slug: string;
  title: string;
  category: string;
  audience: HelpAudience;
  tags: string[];
  order: number;
  excerpt: string;
  updated?: string;
  overridden: boolean;
  fallbackFromEnglish: boolean;
}

export interface ListOptions {
  /** Requested locale; falls back to "en" when a file is missing. */
  locale: string;
  /** Tenant id; when provided, overrides are merged in. */
  tenantId?: string | null;
  /** Used to filter `audience`. Pass the *real* role (impersonation-unaware). */
  realRole?: "TENANT_ADMIN" | "PLATFORM_ADMIN" | string;
  /** Optional category filter. */
  category?: string;
  /** Optional case-insensitive query against title / excerpt / tags. */
  query?: string;
}

const CONTENT_ROOT =
  process.env.HELP_CONTENT_ROOT ?? path.join(process.cwd(), "content", "help");
const FALLBACK_LOCALE = "en";

// ─── Filesystem helpers ──────────────────────────────────────

async function readDirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function parseFrontmatter(raw: string, slug: string, locale: string): { fm: HelpFrontmatter; body: string } {
  const parsed = matter(raw);
  const data = parsed.data as Partial<HelpFrontmatter>;
  if (!data.title) throw new Error(`Help article ${locale}/${slug} missing 'title'`);
  if (!data.category) throw new Error(`Help article ${locale}/${slug} missing 'category'`);
  const audience: HelpAudience =
    data.audience === "platform_admin" || data.audience === "both" ? data.audience : "tenant_admin";
  const fm: HelpFrontmatter = {
    title: data.title,
    category: data.category,
    audience,
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    order: typeof data.order === "number" ? data.order : 100,
    excerpt: typeof data.excerpt === "string" ? data.excerpt : "",
    updated: typeof data.updated === "string" ? data.updated : undefined,
  };
  return { fm, body: parsed.content };
}

// ─── Shipped article enumeration ─────────────────────────────

interface RawArticle {
  slug: string;
  locale: string;
  fallbackFromEnglish: boolean;
  fm: HelpFrontmatter;
  body: string;
}

async function loadShippedSlugs(): Promise<string[]> {
  // Slugs are derived from English (the canonical set). A locale folder may be
  // missing files; those fall back to English. A locale folder may NOT introduce
  // slugs that don't exist in English.
  const enRoot = path.join(CONTENT_ROOT, FALLBACK_LOCALE);
  const categories = await readDirSafe(enRoot);
  const slugs: string[] = [];
  for (const cat of categories) {
    const catDir = path.join(enRoot, cat);
    const stat = await fs.stat(catDir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const files = await readDirSafe(catDir);
    for (const f of files) {
      if (f.endsWith(".md")) slugs.push(f.replace(/\.md$/, ""));
    }
  }
  return slugs;
}

async function loadShippedArticle(slug: string, locale: string): Promise<RawArticle | null> {
  // Find the file by scanning category folders. A small directory tree means
  // this is fast enough to do on demand without extra indexing.
  const tryLocale = async (loc: string): Promise<{ filePath: string } | null> => {
    const root = path.join(CONTENT_ROOT, loc);
    const categories = await readDirSafe(root);
    for (const cat of categories) {
      const fp = path.join(root, cat, `${slug}.md`);
      if (await fileExists(fp)) return { filePath: fp };
    }
    return null;
  };

  const primary = await tryLocale(locale);
  if (primary) {
    const raw = await fs.readFile(primary.filePath, "utf8");
    const { fm, body } = parseFrontmatter(raw, slug, locale);
    return { slug, locale, fallbackFromEnglish: false, fm, body };
  }
  if (locale !== FALLBACK_LOCALE) {
    const fb = await tryLocale(FALLBACK_LOCALE);
    if (fb) {
      const raw = await fs.readFile(fb.filePath, "utf8");
      const { fm, body } = parseFrontmatter(raw, slug, FALLBACK_LOCALE);
      return { slug, locale, fallbackFromEnglish: true, fm, body };
    }
  }
  return null;
}

// ─── Override merging ────────────────────────────────────────

interface OverrideRow {
  slug: string;
  locale: string;
  enabled: boolean;
  title: string | null;
  body: string | null;
}

async function loadOverrides(tenantId: string, locale: string): Promise<Map<string, OverrideRow>> {
  // Look up the requested locale AND English; the requested locale wins when
  // both rows exist for the same slug.
  const rows = await prisma.helpArticleOverride.findMany({
    where: {
      tenantId,
      locale: { in: locale === FALLBACK_LOCALE ? [FALLBACK_LOCALE] : [locale, FALLBACK_LOCALE] },
    },
    select: { slug: true, locale: true, enabled: true, title: true, body: true },
  });
  const map = new Map<string, OverrideRow>();
  // Seed with English first so requested locale overwrites.
  for (const r of rows.filter((r) => r.locale === FALLBACK_LOCALE)) map.set(r.slug, r);
  for (const r of rows.filter((r) => r.locale !== FALLBACK_LOCALE)) map.set(r.slug, r);
  return map;
}

function mergeOverride(article: RawArticle, override: OverrideRow | undefined): RawArticle | null {
  if (!override) return article;
  if (!override.enabled) return null; // tenant has hidden this article
  const fm = { ...article.fm };
  if (override.title) fm.title = override.title;
  return {
    ...article,
    fm,
    body: override.body ?? article.body,
  };
}

// ─── Audience filtering ──────────────────────────────────────

function audienceMatches(audience: HelpAudience, realRole: string | undefined): boolean {
  if (audience === "both") return true;
  if (audience === "platform_admin") {
    // Only surface "platform_admin" articles when the viewer is actually a
    // PLATFORM_ADMIN. Their session may or may not be impersonating.
    return realRole === "PLATFORM_ADMIN";
  }
  // "tenant_admin" articles are visible to TENANT_ADMINs and to PLATFORM_ADMINs
  // (who may be acting on behalf of a tenant).
  return realRole === "TENANT_ADMIN" || realRole === "PLATFORM_ADMIN";
}

// ─── Public API ──────────────────────────────────────────────

function toSummary(a: RawArticle, overridden: boolean): HelpArticleSummary {
  return {
    slug: a.slug,
    title: a.fm.title,
    category: a.fm.category,
    audience: a.fm.audience,
    tags: a.fm.tags,
    order: a.fm.order,
    excerpt: a.fm.excerpt,
    updated: a.fm.updated,
    overridden,
    fallbackFromEnglish: a.fallbackFromEnglish,
  };
}

function matchesQuery(a: RawArticle, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    a.fm.title.toLowerCase().includes(q) ||
    a.fm.excerpt.toLowerCase().includes(q) ||
    a.fm.tags.some((t) => t.toLowerCase().includes(q))
  );
}

export async function listArticles(opts: ListOptions): Promise<HelpArticleSummary[]> {
  const slugs = await loadShippedSlugs();
  const overrides = opts.tenantId ? await loadOverrides(opts.tenantId, opts.locale) : new Map();
  const out: HelpArticleSummary[] = [];
  for (const slug of slugs) {
    const shipped = await loadShippedArticle(slug, opts.locale);
    if (!shipped) continue;
    const merged = mergeOverride(shipped, overrides.get(slug));
    if (!merged) continue; // hidden by override
    if (!audienceMatches(merged.fm.audience, opts.realRole)) continue;
    if (opts.category && merged.fm.category !== opts.category) continue;
    if (opts.query && !matchesQuery(merged, opts.query)) continue;
    out.push(toSummary(merged, overrides.has(slug)));
  }
  out.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return out;
}

export interface GetOptions {
  slug: string;
  locale: string;
  tenantId?: string | null;
  realRole?: string;
}

export async function getArticle(opts: GetOptions): Promise<HelpArticle | null> {
  const shipped = await loadShippedArticle(opts.slug, opts.locale);
  if (!shipped) return null;
  let overridden = false;
  let merged: RawArticle | null = shipped;
  if (opts.tenantId) {
    const overrides = await loadOverrides(opts.tenantId, opts.locale);
    const o = overrides.get(opts.slug);
    if (o) {
      overridden = true;
      merged = mergeOverride(shipped, o);
    }
  }
  if (!merged) return null;
  if (!audienceMatches(merged.fm.audience, opts.realRole)) return null;
  return {
    slug: merged.slug,
    locale: opts.locale,
    overridden,
    fallbackFromEnglish: merged.fallbackFromEnglish,
    body: merged.body,
    ...merged.fm,
  };
}

/** Return the canonical English titles for every shipped slug. Used by the
 *  override editor to list "shipped articles" regardless of what's been
 *  customised so far. */
export async function listShippedSlugIndex(): Promise<{ slug: string; title: string; category: string }[]> {
  const slugs = await loadShippedSlugs();
  const out: { slug: string; title: string; category: string }[] = [];
  for (const slug of slugs) {
    const a = await loadShippedArticle(slug, FALLBACK_LOCALE);
    if (a) out.push({ slug, title: a.fm.title, category: a.fm.category });
  }
  out.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  return out;
}
