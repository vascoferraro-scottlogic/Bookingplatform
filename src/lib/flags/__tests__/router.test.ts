jest.mock("@/lib/flags/unleash", () => ({
  getUnleash: jest.fn(),
  isUnleashConfigured: jest.fn(),
}));

jest.mock("@/lib/flags/context", () => ({
  buildContext: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    featureFlag: {
      findUnique: jest.fn(),
    },
  },
}));

import { isFeatureEnabled, flagIsOn, evaluatePlatformFlags } from "@/lib/features";
import type { AppSession } from "@/lib/api-utils";

const unleashMod = jest.requireMock("@/lib/flags/unleash");
const contextMod = jest.requireMock("@/lib/flags/context");
const prismaMock = jest.requireMock("@/lib/prisma").prisma;

function fakeClient(result: boolean) {
  return { isEnabled: jest.fn().mockReturnValue(result) };
}

function setPostgres(enabled: boolean | null) {
  prismaMock.featureFlag.findUnique.mockResolvedValue(
    enabled === null ? null : { enabled },
  );
}

const adminSession: AppSession = {
  user: { id: "u1", email: "u1@example.com", role: "TENANT_ADMIN", tenantId: "t1", actingAs: null },
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe("isFeatureEnabled router", () => {
  test("platform flag + Unleash configured → evaluated by Unleash with per-tenant stickiness", async () => {
    const client = fakeClient(true);
    unleashMod.getUnleash.mockReturnValue(client);

    const result = await isFeatureEnabled("t1", "federation");

    expect(result).toBe(true);
    expect(client.isEnabled).toHaveBeenCalledWith("federation", {
      userId: "tenant:t1",
      properties: { tenantId: "t1" },
    });
    expect(prismaMock.featureFlag.findUnique).not.toHaveBeenCalled();
  });

  test("platform flag + Unleash NOT configured → falls back to Postgres", async () => {
    unleashMod.getUnleash.mockReturnValue(null);
    setPostgres(true);

    const result = await isFeatureEnabled("t1", "federation");

    expect(result).toBe(true);
    expect(prismaMock.featureFlag.findUnique).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: "t1", key: "federation" } },
    });
  });

  test("tenant-togglable flag never touches Unleash, even when configured", async () => {
    const client = fakeClient(true);
    unleashMod.getUnleash.mockReturnValue(client);
    setPostgres(false);

    const result = await isFeatureEnabled("t1", "messaging");

    expect(result).toBe(false);
    expect(client.isEnabled).not.toHaveBeenCalled();
    expect(prismaMock.featureFlag.findUnique).toHaveBeenCalled();
  });

  test("unknown / legacy key reads Postgres", async () => {
    const client = fakeClient(true);
    unleashMod.getUnleash.mockReturnValue(client);
    setPostgres(true);

    const result = await isFeatureEnabled("t1", "some-legacy-flag");

    expect(result).toBe(true);
    expect(client.isEnabled).not.toHaveBeenCalled();
    expect(prismaMock.featureFlag.findUnique).toHaveBeenCalled();
  });

  test("missing Postgres row defaults to false", async () => {
    unleashMod.getUnleash.mockReturnValue(null);
    setPostgres(null);
    expect(await isFeatureEnabled("t1", "federation")).toBe(false);
  });
});

describe("flagIsOn", () => {
  test("platform flag + Unleash configured → targeted via buildContext", async () => {
    const client = fakeClient(true);
    unleashMod.getUnleash.mockReturnValue(client);
    contextMod.buildContext.mockResolvedValue({ userId: "u1", properties: { role: "TENANT_ADMIN" } });

    const result = await flagIsOn("noShowPrediction", adminSession);

    expect(result).toBe(true);
    expect(contextMod.buildContext).toHaveBeenCalledWith(adminSession, undefined);
    expect(client.isEnabled).toHaveBeenCalledWith("noShowPrediction", {
      userId: "u1",
      properties: { role: "TENANT_ADMIN" },
    });
  });

  test("platform flag + Unleash NOT configured → Postgres fallback on effective tenant", async () => {
    unleashMod.getUnleash.mockReturnValue(null);
    setPostgres(true);

    const result = await flagIsOn("noShowPrediction", adminSession);

    expect(result).toBe(true);
    expect(contextMod.buildContext).not.toHaveBeenCalled();
    expect(prismaMock.featureFlag.findUnique).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: "t1", key: "noShowPrediction" } },
    });
  });

  test("no session and no Unleash → false", async () => {
    unleashMod.getUnleash.mockReturnValue(null);
    expect(await flagIsOn("messaging", null)).toBe(false);
    expect(prismaMock.featureFlag.findUnique).not.toHaveBeenCalled();
  });
});

describe("evaluatePlatformFlags", () => {
  test("Unleash configured → builds context once, evaluates each platform key, ignores non-platform keys", async () => {
    const client = fakeClient(true);
    unleashMod.getUnleash.mockReturnValue(client);
    contextMod.buildContext.mockResolvedValue({ userId: "u1", properties: { role: "TENANT_ADMIN" } });

    const result = await evaluatePlatformFlags(adminSession, undefined, [
      "federation",
      "businessInsights",
      "messaging", // non-platform → dropped
    ]);

    expect(result).toEqual({ federation: true, businessInsights: true });
    expect(contextMod.buildContext).toHaveBeenCalledTimes(1);
    expect(client.isEnabled).toHaveBeenCalledTimes(2);
    expect(client.isEnabled).toHaveBeenCalledWith("federation", { userId: "u1", properties: { role: "TENANT_ADMIN" } });
    expect(client.isEnabled).toHaveBeenCalledWith("businessInsights", { userId: "u1", properties: { role: "TENANT_ADMIN" } });
  });

  test("Unleash NOT configured + session → Postgres fallback per platform key on effective tenant", async () => {
    unleashMod.getUnleash.mockReturnValue(null);
    setPostgres(true);

    const result = await evaluatePlatformFlags(adminSession, undefined, ["federation", "weather"]);

    expect(result).toEqual({ federation: true, weather: true });
    expect(contextMod.buildContext).not.toHaveBeenCalled();
    expect(prismaMock.featureFlag.findUnique).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: "t1", key: "federation" } },
    });
    expect(prismaMock.featureFlag.findUnique).toHaveBeenCalledWith({
      where: { tenantId_key: { tenantId: "t1", key: "weather" } },
    });
  });

  test("Unleash NOT configured + no session → all platform keys false, no Postgres reads", async () => {
    unleashMod.getUnleash.mockReturnValue(null);

    const result = await evaluatePlatformFlags(null, undefined, ["federation", "weather"]);

    expect(result).toEqual({ federation: false, weather: false });
    expect(prismaMock.featureFlag.findUnique).not.toHaveBeenCalled();
  });

  test("no platform keys → empty result, Unleash never consulted", async () => {
    const client = fakeClient(true);
    unleashMod.getUnleash.mockReturnValue(client);

    const result = await evaluatePlatformFlags(adminSession, undefined, ["messaging", "bookings"]);

    expect(result).toEqual({});
    expect(unleashMod.getUnleash).not.toHaveBeenCalled();
    expect(client.isEnabled).not.toHaveBeenCalled();
  });
});
