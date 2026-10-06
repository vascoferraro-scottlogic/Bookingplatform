/**
 * Integration test for the per-response refine endpoint.
 *
 * POST /api/funding/applications/[id]/responses/[responseId]/refine
 *
 * Covers:
 *  - 404 when response does not exist
 *  - 400 when application is not in DRAFT status
 *  - 200 + content updated with AI_DRAFT source on success
 *  - LLM provider is mocked; no real calls are made
 */

import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

// ── session mock ────────────────────────────────────────────────────────────
let mockSessionReturn: any;
jest.mock("@/lib/api-utils", () => {
  const actual = jest.requireActual("@/lib/api-utils");
  return {
    ...actual,
    getSessionOrFail: jest.fn(() => Promise.resolve(mockSessionReturn)),
  };
});

// ── LLM provider mock ────────────────────────────────────────────────────────
jest.mock("@/lib/agent/providers", () => ({
  getProvider: () => ({
    name: "mock",
    call: jest.fn().mockResolvedValue({
      content: {
        draftText: "Mock refined answer for grant question.",
        confidence: 0.85,
        notes: "Used club member count and recent events.",
      },
      model: "mock-model",
      usage: {},
    }),
  }),
}));

import { POST } from "@/app/api/funding/applications/[id]/responses/[responseId]/refine/route";

const stamp = Date.now();
const cleanup: { tenantId?: string; userIds: string[] } = { userIds: [] };

let tenantId: string;
let adminId: string;
let opportunityId: string;
let applicationId: string;
let questionId: string;
let responseId: string;

function adminSession(tid: string, uid: string) {
  return {
    session: {
      user: {
        id: uid,
        email: `refine-admin-${stamp}@test.com`,
        name: "Refine Admin",
        role: "TENANT_ADMIN",
        tenantId: tid,
        actingAs: null,
      },
    },
  };
}

function refineReq(appId: string, respId: string, body?: object) {
  return new NextRequest(
    `http://localhost/api/funding/applications/${appId}/responses/${respId}/refine`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    },
  );
}

beforeAll(async () => {
  const t = await prisma.tenant.create({
    data: {
      name: `Refine Test ${stamp}`,
      slug: `refine-${stamp}`,
      active: true,
      country: "GB",
    },
  });
  tenantId = t.id;
  cleanup.tenantId = t.id;

  await prisma.featureFlag.upsert({
    where: { tenantId_key: { tenantId, key: "funding" } },
    update: { enabled: true },
    create: { tenantId, key: "funding", enabled: true },
  });

  const admin = await prisma.user.create({
    data: {
      email: `refine-admin-${stamp}@test.com`,
      name: "Refine Admin",
      passwordHash: "x",
      role: "TENANT_ADMIN",
      tenantId,
    },
  });
  adminId = admin.id;
  cleanup.userIds.push(adminId);

  // Seed a permission group so assertPermissionOrFail resolves via TENANT_ADMIN bypass.
  // (TENANT_ADMIN has implicit all-permissions — no explicit group needed.)

  const opp = await prisma.fundingOpportunity.create({
    data: {
      name: `Test Grant ${stamp}`,
      funder: "Test Funder",
      description: "A test opportunity",
      maxAmount: 10000,
      tenant: { connect: { id: tenantId } },
    },
  });
  opportunityId = opp.id;

  const q = await prisma.fundingQuestion.create({
    data: {
      opportunityId,
      label: "Describe your club",
      sortOrder: 0,
    },
  });
  questionId = q.id;

  const app = await prisma.fundingApplication.create({
    data: {
      tenantId,
      opportunityId,
      status: "DRAFT",
      createdById: adminId,
    },
  });
  applicationId = app.id;

  const resp = await prisma.fundingResponse.create({
    data: {
      applicationId,
      questionId,
      questionLabel: "Describe your club",
      content: "Initial draft text.",
      source: "MANUAL",
    },
  });
  responseId = resp.id;
});

afterAll(async () => {
  if (cleanup.tenantId) {
    await prisma.fundingResponse.deleteMany({ where: { application: { tenantId: cleanup.tenantId } } });
    await prisma.fundingApplication.deleteMany({ where: { tenantId: cleanup.tenantId } });
    await prisma.fundingQuestion.deleteMany({ where: { opportunity: { tenantId: cleanup.tenantId } } });
    await prisma.fundingOpportunity.deleteMany({ where: { tenantId: cleanup.tenantId } });
    await prisma.featureFlag.deleteMany({ where: { tenantId: cleanup.tenantId } });
    await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
    await prisma.tenant.delete({ where: { id: cleanup.tenantId } });
  }
  await prisma.$disconnect();
});

describe("POST /api/funding/applications/[id]/responses/[responseId]/refine", () => {
  beforeEach(() => {
    mockSessionReturn = adminSession(tenantId, adminId);
  });

  it("returns 404 when the responseId does not exist", async () => {
    const req = refineReq(applicationId, "nonexistent-response-id");
    const res = await POST(req, {
      params: Promise.resolve({ id: applicationId, responseId: "nonexistent-response-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when the response belongs to a different application", async () => {
    const otherApp = await prisma.fundingApplication.create({
      data: { tenantId, opportunityId, status: "DRAFT", createdById: adminId },
    });
    const req = refineReq(otherApp.id, responseId);
    const res = await POST(req, {
      params: Promise.resolve({ id: otherApp.id, responseId }),
    });
    expect(res.status).toBe(404);
    await prisma.fundingApplication.delete({ where: { id: otherApp.id } });
  });

  it("returns 400 when application is not DRAFT", async () => {
    // Temporarily mark as SUBMITTED.
    await prisma.fundingApplication.update({
      where: { id: applicationId },
      data: { status: "SUBMITTED" },
    });
    const req = refineReq(applicationId, responseId);
    const res = await POST(req, {
      params: Promise.resolve({ id: applicationId, responseId }),
    });
    expect(res.status).toBe(400);
    // Restore.
    await prisma.fundingApplication.update({
      where: { id: applicationId },
      data: { status: "DRAFT" },
    });
  });

  it("refines the answer and writes AI_DRAFT back", async () => {
    const req = refineReq(applicationId, responseId, { instruction: "make it shorter" });
    const res = await POST(req, {
      params: Promise.resolve({ id: applicationId, responseId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.response.content).toBe("Mock refined answer for grant question.");
    expect(body.response.source).toBe("AI_DRAFT");
    expect(body.confidence).toBe(0.85);
    expect(body.model).toBe("mock-model");

    // Verify persisted.
    const persisted = await prisma.fundingResponse.findUnique({
      where: { id: responseId },
    });
    expect(persisted?.content).toBe("Mock refined answer for grant question.");
    expect(persisted?.source).toBe("AI_DRAFT");
  });

  it("works without an instruction body", async () => {
    const req = new NextRequest(
      `http://localhost/api/funding/applications/${applicationId}/responses/${responseId}/refine`,
      { method: "POST" },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: applicationId, responseId }),
    });
    expect(res.status).toBe(200);
  });
});
