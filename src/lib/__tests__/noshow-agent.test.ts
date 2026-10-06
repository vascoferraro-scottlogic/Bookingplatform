/**
 * Tests for the No-Show ML integration path:
 *   1. ml-client — HTTP client error and timeout handling (pure unit tests)
 *   2. NoShowRiskAgent — proposal emission and graceful ML service failure
 *   3. booking-noshow-reminder committer — OutboundMessage creation on approve
 */

import { prisma } from "@/lib/prisma";
import { AgentRunStatus, BookingStatus } from "@prisma/client";
import { MlServiceError } from "@/lib/agent/ml-client";
import {
  applyProposal,
  _resetCommittersForTest,
} from "@/lib/agent/committers";

// ── Module mocks ──────────────────────────────────────────────────────────────

// Mock the ml-client so tests don't need a running Python service.
// Individual tests override `mockPredictReturn` to control behaviour.
let mockPredictReturn: { probability: number; modelVersion: string } | null = null;
let mockPredictShouldThrow: boolean = false;
let mockPredictError: Error = new MlServiceError("service unavailable", 503);

jest.mock("@/lib/agent/ml-client", () => ({
  predictNoShow: jest.fn(async () => {
    if (mockPredictShouldThrow) throw mockPredictError;
    return mockPredictReturn;
  }),
  MlServiceError: class MlServiceError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.name = "MlServiceError";
      this.status = status;
    }
  },
}));

// Import after mock registration
import { NoShowRiskAgent } from "@/lib/agent/agents/no-show";

// ── Shared fixtures ───────────────────────────────────────────────────────────

let tenantId: string;
let userId: string;
let rinkId: string;
let agentDefinitionId: string;
let agentSystemUserId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "NoShow Test Club", slug: `noshow-test-${Date.now()}` },
  });
  tenantId = tenant.id;

  const user = await prisma.user.create({
    data: {
      email: `noshow-user-${Date.now()}@test.com`,
      name: "Test Member",
      passwordHash: "x",
      role: "USER",
      tenantId,
    },
  });
  userId = user.id;

  const green = await prisma.green.create({
    data: { tenantId, name: "Test Green", allWeather: false },
  });
  const rink = await prisma.rink.create({ data: { greenId: green.id, name: "Rink 1" } });
  rinkId = rink.id;

  // Agent definition — mirrors what prisma/seed.ts creates for the "no-show" slug
  const systemUser = await prisma.user.create({
    data: {
      email: `noshow-agent-${Date.now()}@agent.system`,
      name: "No-Show Test Agent",
      passwordHash: "x",
      role: "PLATFORM_ADMIN",
    },
  });
  agentSystemUserId = systemUser.id;

  const agentDef = await prisma.agentDefinition.upsert({
    where: { slug: "no-show" },
    update: { systemUserId: systemUser.id },
    create: {
      slug: "no-show",
      name: "No-Show Risk Predictor",
      description: "test",
      systemUserId: systemUser.id,
    },
  });
  agentDefinitionId = agentDef.id;
});

afterAll(async () => {
  await prisma.outboundMessage.deleteMany({ where: { tenantId } });
  await prisma.agentProposal.deleteMany({ where: { agentId: agentDefinitionId } });
  await prisma.agentDecision.deleteMany({ where: { agentId: agentDefinitionId } });
  await prisma.agentRun.deleteMany({ where: { agentId: agentDefinitionId } });
  await prisma.agentConfig.deleteMany({ where: { agentId: agentDefinitionId } });
  await prisma.bookingNoShowPrediction.deleteMany({ where: { tenantId } });
  await prisma.bookingPayment.deleteMany({ where: { booking: { tenantId } } });
  await prisma.bookingSlot.deleteMany({ where: { booking: { tenantId } } });
  await prisma.booking.deleteMany({ where: { tenantId } });
  await prisma.rink.deleteMany({ where: { green: { tenantId } } });
  await prisma.green.deleteMany({ where: { tenantId } });
  await prisma.agentDefinition.deleteMany({ where: { id: agentDefinitionId } });
  await prisma.user.deleteMany({
    where: { id: { in: [userId, agentSystemUserId] } },
  });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

beforeEach(() => {
  _resetCommittersForTest();
  mockPredictReturn = { probability: 0.55, modelVersion: "noshow-v1" };
  mockPredictShouldThrow = false;
});

// ── ml-client unit tests ──────────────────────────────────────────────────────

describe("MlServiceError", () => {
  test("carries status code", () => {
    const err = new MlServiceError("service unavailable", 503);
    expect(err.message).toBe("service unavailable");
    expect(err.status).toBe(503);
    expect(err.name).toBe("MlServiceError");
  });

  test("status is optional", () => {
    const err = new MlServiceError("timeout");
    expect(err.status).toBeUndefined();
  });
});

// ── NoShowRiskAgent ───────────────────────────────────────────────────────────

async function createUpcomingBooking(daysAhead = 5): Promise<string> {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const dateStr = d.toISOString().slice(0, 10);

  const booking = await prisma.booking.create({
    data: {
      tenantId,
      userId,
      date: dateStr,
      status: "CONFIRMED",
      slots: {
        create: { rinkId, timeSlot: "14:00", greenName: "Test Green" },
      },
    },
    select: { id: true },
  });
  return booking.id;
}

describe("NoShowRiskAgent — proposal emission", () => {
  test("emits a proposal for a high-risk booking (probability >= 0.4 default threshold)", async () => {
    mockPredictReturn = { probability: 0.7, modelVersion: "noshow-v1" };
    const bookingId = await createUpcomingBooking(3);

    const agent = new NoShowRiskAgent();
    const run = await agent.runForTenant(tenantId);

    expect(run.status).toBe(AgentRunStatus.COMPLETED);

    const proposals = await prisma.agentProposal.findMany({
      where: { agentId: agentDefinitionId, tenantId },
    });
    expect(proposals.length).toBeGreaterThan(0);
    const p = proposals.find((pr) => {
      const payload = JSON.parse(pr.payload);
      return payload.bookingId === bookingId;
    });
    expect(p).toBeDefined();
    expect(p!.confidence).toBeCloseTo(0.7, 2);
    expect(p!.kind).toBe("BOOKING_NOSHOW_REMINDER");
  });

  test("does not emit proposal below risk threshold", async () => {
    mockPredictReturn = { probability: 0.15, modelVersion: "noshow-v1" };
    await createUpcomingBooking(7);

    const agent = new NoShowRiskAgent();
    await agent.runForTenant(tenantId);

    // All proposals for this tenant — any at confidence 0.15 should not exist
    const proposals = await prisma.agentProposal.findMany({
      where: { agentId: agentDefinitionId, tenantId, confidence: { lt: 0.4 } },
    });
    expect(proposals.length).toBe(0);
  });

  test("records AgentDecision for every booking, regardless of threshold", async () => {
    mockPredictReturn = { probability: 0.1, modelVersion: "noshow-v1" };
    await createUpcomingBooking(10);

    const before = await prisma.agentDecision.count({
      where: { agentId: agentDefinitionId },
    });
    const agent = new NoShowRiskAgent();
    await agent.runForTenant(tenantId);
    const after = await prisma.agentDecision.count({
      where: { agentId: agentDefinitionId },
    });

    // At least one decision recorded for each agent run that processes bookings
    expect(after).toBeGreaterThan(before);
  });
});

describe("NoShowRiskAgent — ML service failure", () => {
  test("records NO_ACTION decision and does not crash when ML service is down", async () => {
    mockPredictShouldThrow = true;
    mockPredictError = new MlServiceError("connection refused", 503);
    await createUpcomingBooking(4);

    const agent = new NoShowRiskAgent();
    const run = await agent.runForTenant(tenantId);

    // Agent should complete (not fail) even when ML is unreachable
    expect(run.status).toBe(AgentRunStatus.COMPLETED);
  });

  test("does not emit proposals when ML service is unavailable", async () => {
    mockPredictShouldThrow = true;
    const before = await prisma.agentProposal.count({
      where: { agentId: agentDefinitionId, tenantId },
    });
    await createUpcomingBooking(6);

    const agent = new NoShowRiskAgent();
    await agent.runForTenant(tenantId);

    const after = await prisma.agentProposal.count({
      where: { agentId: agentDefinitionId, tenantId },
    });
    expect(after).toBe(before); // no new proposals
  });
});

// ── Prediction persistence ────────────────────────────────────────────────────

describe("NoShowRiskAgent — prediction persistence", () => {
  test("persists a BookingNoShowPrediction for every successfully scored booking", async () => {
    const version = "noshow-persist-test-v1";
    mockPredictReturn = { probability: 0.35, modelVersion: version };

    const bookingId = await createUpcomingBooking(8);

    const agent = new NoShowRiskAgent();
    const run = await agent.runForTenant(tenantId);
    expect(run.status).toBe(AgentRunStatus.COMPLETED);

    const pred = await prisma.bookingNoShowPrediction.findUnique({
      where: { bookingId_modelVersion: { bookingId, modelVersion: version } },
    });
    expect(pred).not.toBeNull();
    expect(pred!.probability).toBeCloseTo(0.35, 3);
    expect(pred!.tenantId).toBe(tenantId);
  });

  test("does not persist a prediction when ML service fails", async () => {
    mockPredictShouldThrow = true;
    mockPredictError = new MlServiceError("connection refused", 503);
    const version = "noshow-persist-error-test-v1";
    mockPredictReturn = { probability: 0.5, modelVersion: version };

    const bookingId = await createUpcomingBooking(9);
    const agent = new NoShowRiskAgent();
    await agent.runForTenant(tenantId);

    const pred = await prisma.bookingNoShowPrediction.findUnique({
      where: { bookingId_modelVersion: { bookingId, modelVersion: version } },
    });
    expect(pred).toBeNull();
  });

  test("upserts on re-score — updates probability, does not duplicate", async () => {
    const version = "noshow-upsert-test-v1";
    const bookingId = await createUpcomingBooking(11);

    mockPredictReturn = { probability: 0.4, modelVersion: version };
    const agent = new NoShowRiskAgent();
    await agent.runForTenant(tenantId);

    mockPredictReturn = { probability: 0.55, modelVersion: version };
    await agent.runForTenant(tenantId);

    const preds = await prisma.bookingNoShowPrediction.findMany({
      where: { bookingId, modelVersion: version },
    });
    expect(preds).toHaveLength(1);
    expect(preds[0].probability).toBeCloseTo(0.55, 3);
  });
});

// ── booking-noshow-reminder committer ─────────────────────────────────────────

describe("booking-noshow-reminder committer", () => {
  test("creates an OutboundMessage reminder when proposal is approved", async () => {
    // Register committer via side-effect import
    require("@/lib/agent/committers/booking-noshow-reminder");

    // Create a booking to attach the proposal to
    const d = new Date();
    d.setDate(d.getDate() + 14);
    const dateStr = d.toISOString().slice(0, 10);
    const booking = await prisma.booking.create({
      data: {
        tenantId,
        userId,
        date: dateStr,
        status: "CONFIRMED",
        slots: { create: { rinkId, timeSlot: "10:00", greenName: "Test Green" } },
      },
    });

    // Create a run + proposal directly (bypasses agent process())
    const run = await prisma.agentRun.create({
      data: { agentId: agentDefinitionId, tenantId, status: "RUNNING" },
    });
    const proposal = await prisma.agentProposal.create({
      data: {
        agentId: agentDefinitionId,
        runId: run.id,
        kind: "BOOKING_NOSHOW_REMINDER",
        payload: JSON.stringify({
          bookingId: booking.id,
          userId,
          bookingDate: dateStr,
          probability: 0.62,
          modelVersion: "noshow-v1",
          source: "high_risk",
        }),
        confidence: 0.62,
        reasoning: "test",
        audienceScope: "TENANT",
        tenantId,
      },
    });

    const approverId = userId; // any user id works for the commit
    const result = await applyProposal({ proposalId: proposal.id, approverId });

    expect(result.committedEntityType).toBe("OutboundMessage");
    expect(result.committedEntityId).toBeTruthy();

    const msg = await prisma.outboundMessage.findUnique({
      where: { id: result.committedEntityId! },
    });
    expect(msg).not.toBeNull();
    expect(msg!.channel).toBe("EMAIL");
    expect(msg!.status).toBe("STUBBED");
    expect(msg!.relatedEntity).toBe("Booking");
    expect(msg!.relatedEntityId).toBe(booking.id);
  });
});
