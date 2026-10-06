import { Unleash, InMemStorageProvider } from "unleash-client";
import type { FeatureInterface } from "unleash-client/lib/feature";
import { Operator } from "unleash-client/lib/strategy/strategy";

// Verifies the real unleash-client SDK evaluates locally from bootstrap data with
// no live Unleash server (the resilience guarantee). The client points at a dead
// address; bootstrapOverride means the bootstrap fixtures always win.

const FEATURES: FeatureInterface[] = [
  { name: "on-flag", enabled: true, strategies: [{ name: "default", parameters: {}, constraints: [] }] },
  { name: "off-flag", enabled: false, strategies: [{ name: "default", parameters: {}, constraints: [] }] },
  {
    name: "tenant-scoped",
    enabled: true,
    strategies: [
      {
        name: "default",
        parameters: {},
        constraints: [
          { contextName: "tenantId", operator: Operator.IN, inverted: false, values: ["t1"] },
        ],
      },
    ],
  },
  {
    name: "rollout-50",
    enabled: true,
    strategies: [
      {
        name: "flexibleRollout",
        parameters: { rollout: "50", stickiness: "userId", groupId: "rollout-50" },
        constraints: [],
      },
    ],
  },
];

let unleash: Unleash;

beforeAll(async () => {
  unleash = new Unleash({
    url: "http://127.0.0.1:65535/api", // deliberately unreachable
    appName: "test",
    bootstrap: { data: FEATURES },
    bootstrapOverride: true,
    storageProvider: new InMemStorageProvider(),
    disableMetrics: true,
    disableAutoStart: true,
    refreshInterval: 3_600_000,
  });
  unleash.on("error", () => {
    /* swallow the expected fetch failure against the dead address */
  });
  await unleash.start();
});

afterAll(() => {
  unleash.destroy();
});

test("evaluates an enabled flag from bootstrap without a server", () => {
  expect(unleash.isEnabled("on-flag")).toBe(true);
});

test("disabled flag and unknown flag both fail closed", () => {
  expect(unleash.isEnabled("off-flag")).toBe(false);
  expect(unleash.isEnabled("does-not-exist")).toBe(false);
});

test("tenantId IN constraint scopes a flag to specific tenants", () => {
  expect(unleash.isEnabled("tenant-scoped", { properties: { tenantId: "t1" } })).toBe(true);
  expect(unleash.isEnabled("tenant-scoped", { properties: { tenantId: "t2" } })).toBe(false);
});

test("flexibleRollout is sticky per userId and partitions the population", () => {
  // Deterministic: the same userId yields the same answer across calls.
  const a = unleash.isEnabled("rollout-50", { userId: "user-123" });
  const b = unleash.isEnabled("rollout-50", { userId: "user-123" });
  expect(a).toBe(b);

  // Over many ids the 50% rollout discriminates (not all-on / all-off) and lands
  // in a sane band.
  let on = 0;
  const N = 200;
  for (let i = 0; i < N; i++) {
    if (unleash.isEnabled("rollout-50", { userId: `user-${i}` })) on++;
  }
  expect(on).toBeGreaterThan(N * 0.25);
  expect(on).toBeLessThan(N * 0.75);
});
