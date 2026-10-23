/**
 * Unit test for the per-response refine endpoint.
 *
 * POST /api/funding/applications/[id]/responses/[responseId]/refine
 *
 * Covers:
 *  - 404 when response does not exist (or is not in this application/tenant)
 *  - 400 when application is not in DRAFT status
 *  - 200 + content updated with AI_DRAFT source on success
 *  - LLM provider is mocked; no real calls are made
 */
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

// ── LLM provider mock ────────────────────────────────────────────────────────
const mockProviderCall = jest.fn();
jest.mock("@/lib/agent/providers", () => ({
  getProvider: () => ({ name: "mock", call: mockProviderCall }),
}));

// Club-context aggregation reads many tables; it is not under test here.
jest.mock("@/lib/funding/ai", () => ({
  ...jest.requireActual("@/lib/funding/ai"),
  aggregateTenantContext: jest.fn(),
}));

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, request, routeParams } from "@/test-utils/http";
import { aggregateTenantContext } from "@/lib/funding/ai";
import { POST } from "@/app/api/funding/applications/[id]/responses/[responseId]/refine/route";

const TENANT = "t1";
const APP = "app-1";
const RESPONSE = "resp-1";

const refine = async (appId: string, respId: string, body?: object) =>
  readJson(
    await POST(
      jsonRequest("POST", `/api/funding/applications/${appId}/responses/${respId}/refine`, body ?? {}),
      routeParams({ id: appId, responseId: respId }),
    ),
  );

function responseRow(applicationStatus = "DRAFT") {
  return {
    id: RESPONSE,
    applicationId: APP,
    questionId: "q-1",
    questionLabel: "Describe your club",
    content: "Initial draft text.",
    source: "MANUAL",
    application: {
      id: APP,
      tenantId: TENANT,
      status: applicationStatus,
      opportunity: { name: "Test Grant", funder: "Test Funder", description: "A test opportunity" },
    },
    question: { label: "Describe your club", helpText: null },
  };
}

beforeEach(() => {
  signInAs({ id: "admin-1", role: "TENANT_ADMIN", tenantId: TENANT });
  // funding feature flag on
  prismaMock.featureFlag.findUnique.mockResolvedValue({ enabled: true } as never);
  prismaMock.fundingResponse.findFirst.mockResolvedValue(null);
  prismaMock.fundingResponse.update.mockImplementation((async ({ where, data }: any) => ({
    ...responseRow(),
    id: where.id,
    ...data,
  })) as never);
  jest.mocked(aggregateTenantContext).mockResolvedValue({
    tenantName: "Refine Test Club",
    orgType: null,
    country: "GB",
    locality: null,
    charityNumber: null,
    totalMembers: 42,
    newMembersThisYear: null,
    recentEvents: [],
    financialSummary: null,
    recentMaintenance: [],
    otherApplications: [],
  });
  mockProviderCall.mockReset().mockResolvedValue({
    content: {
      draftText: "Mock refined answer for grant question.",
      confidence: 0.85,
      notes: "Used club member count and recent events.",
    },
    model: "mock-model",
    usage: {},
  });
});

describe("POST /api/funding/applications/[id]/responses/[responseId]/refine", () => {
  it("returns 404 when the responseId does not exist", async () => {
    const { status } = await refine(APP, "nonexistent-response-id");

    expect(status).toBe(404);
    expect(prismaMock.fundingResponse.update).not.toHaveBeenCalled();
  });

  it("looks the response up scoped to the application and tenant (404 for another application)", async () => {
    // findFirst returns null: the response does not belong to "other-app" in this tenant.
    const { status } = await refine("other-app", RESPONSE);

    expect(status).toBe(404);
    expect(prismaMock.fundingResponse.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RESPONSE, applicationId: "other-app", application: { tenantId: TENANT } },
      }),
    );
    expect(prismaMock.fundingResponse.update).not.toHaveBeenCalled();
  });

  it("returns 400 when application is not DRAFT", async () => {
    prismaMock.fundingResponse.findFirst.mockResolvedValue(responseRow("SUBMITTED") as never);

    const { status } = await refine(APP, RESPONSE);

    expect(status).toBe(400);
    expect(mockProviderCall).not.toHaveBeenCalled();
    expect(prismaMock.fundingResponse.update).not.toHaveBeenCalled();
  });

  it("returns 403 when the funding feature is disabled", async () => {
    prismaMock.featureFlag.findUnique.mockResolvedValue({ enabled: false } as never);

    const { status } = await refine(APP, RESPONSE);

    expect(status).toBe(403);
    expect(prismaMock.fundingResponse.findFirst).not.toHaveBeenCalled();
  });

  it("refines the answer and writes AI_DRAFT back", async () => {
    prismaMock.fundingResponse.findFirst.mockResolvedValue(responseRow() as never);

    const { status, body } = await refine(APP, RESPONSE, { instruction: "make it shorter" });

    expect(status).toBe(200);
    expect(body.response.content).toBe("Mock refined answer for grant question.");
    expect(body.response.source).toBe("AI_DRAFT");
    expect(body.confidence).toBe(0.85);
    expect(body.model).toBe("mock-model");

    expect(prismaMock.fundingResponse.update).toHaveBeenCalledWith({
      where: { id: RESPONSE },
      data: { content: "Mock refined answer for grant question.", source: "AI_DRAFT" },
    });
    expect(aggregateTenantContext).toHaveBeenCalledWith(TENANT);
    const prompt = mockProviderCall.mock.calls[0][0].userPrompt as string;
    expect(prompt).toContain("make it shorter");
    expect(prompt).toContain("Initial draft text.");
  });

  it("works without an instruction body", async () => {
    prismaMock.fundingResponse.findFirst.mockResolvedValue(responseRow() as never);

    const res = await POST(
      request(`/api/funding/applications/${APP}/responses/${RESPONSE}/refine`, { method: "POST" }),
      routeParams({ id: APP, responseId: RESPONSE }),
    );

    expect(res.status).toBe(200);
    expect(prismaMock.fundingResponse.update).toHaveBeenCalled();
    expect(mockProviderCall.mock.calls[0][0].userPrompt).not.toContain("User instruction");
  });
});
