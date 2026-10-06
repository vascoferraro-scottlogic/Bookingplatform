import { prisma } from "@/lib/prisma";
import { isFeatureEnabled, setFeatureFlag, getTenantFlags } from "@/lib/features";

let tenantId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Flags Test Club", slug: "flags-test-" + Date.now() },
  });
  tenantId = tenant.id;
});

afterAll(async () => {
  await prisma.featureFlag.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

// ── isFeatureEnabled ──────────────────────────────────────

describe("isFeatureEnabled", () => {
  test("returns false for nonexistent flag", async () => {
    expect(await isFeatureEnabled(tenantId, "nonexistent")).toBe(false);
  });

  test("returns true for enabled flag", async () => {
    await prisma.featureFlag.create({ data: { tenantId, key: "testEnabled", enabled: true } });
    expect(await isFeatureEnabled(tenantId, "testEnabled")).toBe(true);
  });

  test("returns false for disabled flag", async () => {
    await prisma.featureFlag.create({ data: { tenantId, key: "testDisabled", enabled: false } });
    expect(await isFeatureEnabled(tenantId, "testDisabled")).toBe(false);
  });
});

// ── setFeatureFlag ────────────────────────────────────────

describe("setFeatureFlag", () => {
  test("creates a new flag", async () => {
    const flag = await setFeatureFlag(tenantId, "newFlag", true);
    expect(flag.key).toBe("newFlag");
    expect(flag.enabled).toBe(true);
  });

  test("upserts an existing flag (enable → disable)", async () => {
    await setFeatureFlag(tenantId, "toggleMe", true);
    const updated = await setFeatureFlag(tenantId, "toggleMe", false);
    expect(updated.enabled).toBe(false);
  });

  test("upsert is idempotent (set same value twice)", async () => {
    await setFeatureFlag(tenantId, "idempotent", true);
    const second = await setFeatureFlag(tenantId, "idempotent", true);
    expect(second.enabled).toBe(true);
  });
});

// ── getTenantFlags ────────────────────────────────────────

describe("getTenantFlags", () => {
  test("returns all flags for the tenant", async () => {
    const flags = await getTenantFlags(tenantId);
    expect(flags.length).toBeGreaterThanOrEqual(4); // testEnabled, testDisabled, newFlag, toggleMe, idempotent
    expect(flags.every((f) => f.tenantId === tenantId)).toBe(true);
  });

  test("returns empty array for tenant with no flags", async () => {
    const empty = await prisma.tenant.create({
      data: { name: "No Flags Club", slug: "no-flags-" + Date.now() },
    });
    const flags = await getTenantFlags(empty.id);
    expect(flags).toEqual([]);
    // cleanup
    await prisma.tenant.delete({ where: { id: empty.id } });
  });
});
