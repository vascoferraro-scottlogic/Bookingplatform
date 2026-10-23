#!/usr/bin/env node
/**
 * i18n coverage check (cross-platform replacement for check-i18n-coverage.sh).
 *
 *  1. Key parity: every locale under content/messages/ui must have the same
 *     message keys as `en` in every namespace file. Missing keys are errors
 *     (they render as raw keys / fall back to en); extra keys are warnings.
 *  2. Wiring: every .tsx under src/app and src/components must use
 *     useTranslations/getTranslations, unless allowlisted as having no UI text.
 *
 * Exits 1 on any error.   Usage: node scripts/check-i18n-coverage.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const MESSAGES_DIR = "content/messages/ui";
const REFERENCE = "en";

// Structural files with no translatable UI strings.
const ALLOWLIST = new Set([
  "src/app/layout.tsx",
  "src/app/providers.tsx",
  "src/app/dashboard/layout.tsx",
  "src/components/TrackingProvider.tsx",
  "src/components/content/AboutSection.tsx",
  "src/components/content/HeroSection.tsx",
  "src/components/content/MapSection.tsx",
  "src/components/content/PhotoSection.tsx",
]);

function flatten(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) keys.push(...flatten(v, key));
    else keys.push(key);
  }
  return keys;
}

function readKeys(file) {
  return new Set(flatten(JSON.parse(readFileSync(file, "utf8"))));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let errors = 0;

// 1. Key parity
const locales = readdirSync(MESSAGES_DIR).filter((d) => statSync(join(MESSAGES_DIR, d)).isDirectory());
const namespaces = readdirSync(join(MESSAGES_DIR, REFERENCE)).filter((f) => f.endsWith(".json"));
for (const locale of locales.filter((l) => l !== REFERENCE)) {
  for (const ns of namespaces) {
    const refKeys = readKeys(join(MESSAGES_DIR, REFERENCE, ns));
    const file = join(MESSAGES_DIR, locale, ns);
    if (!existsSync(file)) {
      console.error(`ERROR ${locale}/${ns}: file missing (${refKeys.size} keys)`);
      errors += refKeys.size;
      continue;
    }
    const keys = readKeys(file);
    const missing = [...refKeys].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !refKeys.has(k));
    if (missing.length) {
      errors += missing.length;
      console.error(`ERROR ${locale}/${ns}: ${missing.length} key(s) missing\n  ${missing.join("\n  ")}`);
    }
    if (extra.length) console.warn(`warn  ${locale}/${ns}: ${extra.length} key(s) not in ${REFERENCE}\n  ${extra.join("\n  ")}`);
  }
}

// 2. Wiring
const norm = (p) => relative(".", p).split("\\").join("/");
const tsx = [...walk("src/app"), ...walk("src/components")]
  .map(norm)
  .filter((f) => f.endsWith(".tsx") && !/__tests__|\.test\./.test(f));
const unwired = tsx.filter((f) => !ALLOWLIST.has(f) && !/useTranslations|getTranslations/.test(readFileSync(f, "utf8")));
if (unwired.length) {
  errors += unwired.length;
  console.error(
    `ERROR TSX files without i18n wiring:\n  ${unwired.join("\n  ")}\n` +
      "Wire them with useTranslations/getTranslations, or add them to the allowlist in\n" +
      "scripts/check-i18n-coverage.mjs if the file has no user-visible text.",
  );
}

if (errors) {
  console.error(`\ni18n check failed: ${errors} problem(s).`);
  process.exit(1);
}
console.log("i18n check passed: locale key sets match and all TSX files are wired or allowlisted.");
