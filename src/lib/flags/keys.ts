// Feature-flag key registry — the single, frozen taxonomy for #feature-management.
//
// Three categories, two storage owners:
//
//   1. TENANT_TOGGLABLE  → Postgres. Tenant admins flip these themselves via the
//      onboarding wizard / settings UI.
//   2. CAPABILITY_PRESET → Postgres. Per-tenant provisioning state written by the
//      onboarding vertical preset (bookings/agent/funding/charity) and by plan-tier
//      provisioning (liveStreaming/analytics). NOT platform rollout knobs — routing
//      their reads to Unleash while onboarding/billing still write Postgres would
//      silently drop a tenant's capability bundle (see DECISIONS.md 2026-06-20).
//   3. PLATFORM          → Unleash (post-cutover). Platform admins target these
//      (users, role cohorts, custom groups, % rollout, whole tenants) via the
//      Unleash UI.
//
// Postgres-owned = TENANT_TOGGLABLE ∪ CAPABILITY_PRESET. The router in
// `src/lib/features.ts` sends only PLATFORM keys to Unleash; everything else
// (including unknown/legacy keys) reads Postgres, which preserves current
// behaviour until the Phase 2 migration + cutover.
//
// This module is the shared contract the #billing thread consumes (its plan tiers
// write flag bundles) rather than redefining the classification (Q2 → A).

/** Flags a TENANT_ADMIN may toggle on their own tenant. Owned by Postgres. */
export const TENANT_TOGGLABLE_FLAGS = [
  "messaging",
  "events",
  "publicEvents",
  "publicAvailability",
] as const;

/**
 * Capability / preset flags. Owned by Postgres because they are WRITTEN there at
 * runtime by the onboarding vertical preset and plan-tier provisioning — they are
 * per-tenant state, not rollout knobs.
 */
export const CAPABILITY_PRESET_FLAGS = [
  "bookings",
  "agent",
  "funding",
  "charity",
  "liveStreaming",
  "analytics",
] as const;

/**
 * Platform rollout flags. Owned by Unleash after the Phase 2 cutover; platform
 * admins target them via the Unleash UI.
 *
 * `publicContent` and `weather` are classified here by elimination (no verified
 * Postgres writer) — re-confirm before the Phase 2 migration.
 */
export const PLATFORM_FLAGS = [
  "eventsShareExternal",
  "eventsShowExternal",
  "publicContent",
  "weather",
  "federation",
  "helpOverrides",
  "businessInsights",
  "noShowPrediction",
  "modelOps",
] as const;

export type TenantTogglableFlag = (typeof TENANT_TOGGLABLE_FLAGS)[number];
export type CapabilityPresetFlag = (typeof CAPABILITY_PRESET_FLAGS)[number];
export type PlatformFlag = (typeof PLATFORM_FLAGS)[number];

/** Every flag key with a known classification. */
export type FlagKey = TenantTogglableFlag | CapabilityPresetFlag | PlatformFlag;

/** Flags owned by Postgres (tenant-togglable + capability/preset). */
export const POSTGRES_OWNED_FLAGS = [
  ...TENANT_TOGGLABLE_FLAGS,
  ...CAPABILITY_PRESET_FLAGS,
] as const;

const PLATFORM_SET: ReadonlySet<string> = new Set(PLATFORM_FLAGS);
const TENANT_TOGGLABLE_SET: ReadonlySet<string> = new Set(TENANT_TOGGLABLE_FLAGS);
const CAPABILITY_PRESET_SET: ReadonlySet<string> = new Set(CAPABILITY_PRESET_FLAGS);

/** True for flags whose source of truth is Unleash (post-cutover). */
export function isPlatformFlag(key: string): boolean {
  return PLATFORM_SET.has(key);
}

/** True for the 4 flags a tenant admin may self-serve. */
export function isTenantTogglableFlag(key: string): boolean {
  return TENANT_TOGGLABLE_SET.has(key);
}

/** True for onboarding/plan-tier provisioning flags (per-tenant capability state). */
export function isCapabilityPresetFlag(key: string): boolean {
  return CAPABILITY_PRESET_SET.has(key);
}

/**
 * True for flags read from Postgres. Defaults to TRUE for unknown / legacy keys so
 * that any key not explicitly promoted to Unleash keeps reading Postgres — this is
 * the safety net that makes the router a no-op until a key is migrated.
 */
export function isPostgresOwnedFlag(key: string): boolean {
  return !PLATFORM_SET.has(key);
}
