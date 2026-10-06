import {
  TENANT_TOGGLABLE_FLAGS,
  CAPABILITY_PRESET_FLAGS,
  PLATFORM_FLAGS,
  POSTGRES_OWNED_FLAGS,
  isPlatformFlag,
  isTenantTogglableFlag,
  isCapabilityPresetFlag,
  isPostgresOwnedFlag,
} from "@/lib/flags/keys";

describe("flag taxonomy", () => {
  test("the three categories are pairwise disjoint", () => {
    const togglable = new Set<string>(TENANT_TOGGLABLE_FLAGS);
    const capability = new Set<string>(CAPABILITY_PRESET_FLAGS);
    const platform = new Set<string>(PLATFORM_FLAGS);

    for (const k of capability) expect(togglable.has(k)).toBe(false);
    for (const k of platform) {
      expect(togglable.has(k)).toBe(false);
      expect(capability.has(k)).toBe(false);
    }
  });

  test("Postgres-owned = tenant-togglable ∪ capability/preset, disjoint from platform", () => {
    expect(new Set(POSTGRES_OWNED_FLAGS)).toEqual(
      new Set<string>([...TENANT_TOGGLABLE_FLAGS, ...CAPABILITY_PRESET_FLAGS]),
    );
    for (const k of PLATFORM_FLAGS) {
      expect(POSTGRES_OWNED_FLAGS as readonly string[]).not.toContain(k);
    }
  });

  test("isPlatformFlag is true only for platform keys", () => {
    expect(isPlatformFlag("federation")).toBe(true);
    expect(isPlatformFlag("noShowPrediction")).toBe(true);
    expect(isPlatformFlag("messaging")).toBe(false);
    expect(isPlatformFlag("bookings")).toBe(false);
    expect(isPlatformFlag("unknown-key")).toBe(false);
  });

  test("capability/preset and tenant-togglable predicates", () => {
    expect(isTenantTogglableFlag("messaging")).toBe(true);
    expect(isTenantTogglableFlag("bookings")).toBe(false);
    expect(isCapabilityPresetFlag("bookings")).toBe(true);
    expect(isCapabilityPresetFlag("agent")).toBe(true);
    expect(isCapabilityPresetFlag("messaging")).toBe(false);
  });

  test("unknown / legacy keys are treated as Postgres-owned (safe default)", () => {
    expect(isPostgresOwnedFlag("totally-new-flag")).toBe(true);
    expect(isPostgresOwnedFlag("messaging")).toBe(true);
    expect(isPostgresOwnedFlag("bookings")).toBe(true);
    expect(isPostgresOwnedFlag("federation")).toBe(false);
  });

  test("representative known keys land in the expected category", () => {
    // Capability/preset (written to Postgres by onboarding / plan tiers).
    for (const k of ["bookings", "agent", "funding", "charity", "liveStreaming", "analytics"]) {
      expect(isCapabilityPresetFlag(k)).toBe(true);
      expect(isPlatformFlag(k)).toBe(false);
    }
    // Tenant-togglable (the 4).
    for (const k of ["messaging", "events", "publicEvents", "publicAvailability"]) {
      expect(isTenantTogglableFlag(k)).toBe(true);
    }
    // Platform (Unleash post-cutover).
    for (const k of ["federation", "businessInsights", "noShowPrediction", "modelOps"]) {
      expect(isPlatformFlag(k)).toBe(true);
    }
  });
});
