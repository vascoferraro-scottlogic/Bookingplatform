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
  // Corrected for B-16: this test used to assert that flagIsOn evaluates with a
  // per-user buildContext context, which is exactly the UI/API divergence.
  test("[B-16] NFR-09 – flagIsOn (UI path) evaluates a platform flag with the same context as isFeatureEnabled (API path)", async () => {
    const client = fakeClient(true);
    unleashMod.getUnleash.mockReturnValue(client);
    contextMod.buildContext.mockResolvedValue({ userId: "u1", properties: { role: "TENANT_ADMIN" } });

    const apiResult = await isFeatureEnabled("t1", "noShowPrediction");
    const uiResult = await flagIsOn("noShowPrediction", adminSession);

    expect(uiResult).toBe(apiResult);
    expect(client.isEnabled).toHaveBeenCalledTimes(2);
    const [[apiKey, apiContext], [uiKey, uiContext]] = client.isEnabled.mock.calls;
    expect(uiKey).toBe(apiKey);
    expect(uiContext).toEqual(apiContext);
  });

  test("[B-16] NFR-09 – UI and API paths agree when Unleash would give different answers per user vs per tenant", async () => {
    // A per-user rollout: on for userId "u1", off for anything else.
    const client = { isEnabled: jest.fn((_key: string, ctx: any) => ctx?.userId === "u1") };
    unleashMod.getUnleash.mockReturnValue(client);
    contextMod.buildContext.mockResolvedValue({ userId: "u1", properties: { role: "TENANT_ADMIN", tenantId: "t1" } });

    const apiResult = await isFeatureEnabled("t1", "federation");
    const uiResult = await flagIsOn("federation", adminSession);

    expect(uiResult).toBe(apiResult);
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
  // Corrected for B-16: previously asserted the per-user buildContext context
  // (the UI nav path), which diverges from the per-tenant API path.
  test("[B-16] NFR-09 – Unleash configured → evaluates each platform key with the same context as isFeatureEnabled, ignores non-platform keys", async () => {
    const client = fakeClient(true);
    unleashMod.getUnleash.mockReturnValue(client);
    contextMod.buildContext.mockResolvedValue({ userId: "u1", properties: { role: "TENANT_ADMIN" } });

    await isFeatureEnabled("t1", "federation");
    const apiContext = client.isEnabled.mock.calls[0][1];
    client.isEnabled.mockClear();

    const result = await evaluatePlatformFlags(adminSession, undefined, [
      "federation",
      "businessInsights",
      "messaging", // non-platform → dropped
    ]);

    expect(result).toEqual({ federation: true, businessInsights: true });
    expect(client.isEnabled).toHaveBeenCalledTimes(2);
    expect(client.isEnabled).toHaveBeenCalledWith("federation", apiContext);
    expect(client.isEnabled).toHaveBeenCalledWith("businessInsights", apiContext);
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
