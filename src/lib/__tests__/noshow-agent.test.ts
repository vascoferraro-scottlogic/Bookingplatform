/**
 * Tests for the No-Show ML integration path:
 *   1. ml-client — MlServiceError shape (pure unit tests)
 *   2. NoShowRiskAgent — proposal emission and graceful ML service failure
 *   3. booking-noshow-reminder committer — OutboundMessage creation on approve
 */
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
// No real LLM (the no-show agent does not call one, but BaseAgent resolves it).
jest.mock("@/lib/agent/providers", () => ({ getProvider: () => ({ name: "stub", call: jest.fn() }) }));
// Mock the ml-client so tests don't need a running Python service. The real
// MlServiceError is kept so the error-shape tests exercise production code.
jest.mock("@/lib/agent/ml-client", () => ({
  predictNoShow: jest.fn(),
  MlServiceError: jest.requireActual("@/lib/agent/ml-client").MlServiceError,
}));

import { AgentAction, AgentProposalAudience, AgentProposalStatus, AgentRunStatus } from "@prisma/client";
import { prismaMock } from "@/test-utils/prisma-mock";
import { isoDateFromToday } from "@/test-utils/dates";
import { MlServiceError, predictNoShow } from "@/lib/agent/ml-client";
import { applyProposal } from "@/lib/agent/committers";
// Registers the BOOKING_NOSHOW_REMINDER committer.
import "@/lib/agent/committers/booking-noshow-reminder";
import { NoShowRiskAgent } from "@/lib/agent/agents/no-show";

const predictMock = jest.mocked(predictNoShow);

// ── Shared fixtures ───────────────────────────────────────────────────────────

const tenantId = "tenant-1";
const userId = "user-1";
// Stands in for the seeded "no-show" AgentDefinition.
const NO_SHOW = { id: "agent-noshow", slug: "no-show", name: "No-Show Risk Predictor", systemUserId: "sys-noshow" };

let bookingSeq = 0;
let bookings: Array<Record<string, unknown>> = [];

/** Queue an upcoming CONFIRMED booking for booking.findMany; returns its id. */
function createUpcomingBooking(daysAhead = 5): string {
  const id = `booking-${++bookingSeq}`;
  bookings.push({
    id,
    tenantId,
    userId,
    date: isoDateFromToday(daysAhead),
    status: "CONFIRMED",
    createdAt: new Date(),
    user: { createdAt: new Date(Date.now() - 365 * 24 * 3_600_000) },
    slots: [{ timeSlot: "14:00", rink: { green: { allWeather: false } } }],
  });
  return id;
}

beforeEach(() => {
  bookings = [];
  predictMock.mockReset();
  predictMock.mockResolvedValue({ probability: 0.55, modelVersion: "noshow-v1" });

  prismaMock.agentDefinition.findUnique.mockResolvedValue(NO_SHOW as never);
  prismaMock.agentRun.create.mockImplementation((async ({ data }: any) => ({ id: "run-1", ...data })) as never);
  prismaMock.agentRun.update.mockImplementation((async ({ where, data }: any) => ({ id: where.id, ...data })) as never);
  prismaMock.agentConfig.findUnique.mockResolvedValue(null);
  prismaMock.booking.findMany.mockImplementation((async () => bookings) as never);
  (prismaMock.booking.groupBy as jest.Mock).mockResolvedValue([]);
  prismaMock.agentProposal.create.mockImplementation((async ({ data }: any) => ({ id: "proposal-1", ...data })) as never);
  prismaMock.agentDecision.create.mockImplementation((async ({ data }: any) => ({ id: "decision-1", ...data })) as never);
});

const proposals = () => prismaMock.agentProposal.create.mock.calls.map((c) => (c[0] as any).data);
const decisions = () => prismaMock.agentDecision.create.mock.calls.map((c) => (c[0] as any).data);

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

describe("NoShowRiskAgent — proposal emission", () => {
  test("emits a proposal for a high-risk booking (probability >= 0.4 default threshold)", async () => {
    predictMock.mockResolvedValue({ probability: 0.7, modelVersion: "noshow-v1" });
    const bookingId = createUpcomingBooking(3);

    const run = await new NoShowRiskAgent().runForTenant(tenantId);

    expect(run.status).toBe(AgentRunStatus.COMPLETED);
    // Only this tenant's upcoming confirmed/reserved bookings are scored.
    expect(prismaMock.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          status: { in: ["CONFIRMED", "RESERVED"] },
          date: expect.objectContaining({ gte: isoDateFromToday(0) }),
        }),
      }),
    );

    const emitted = proposals();
    expect(emitted).toHaveLength(1);
    const p = emitted[0];
    expect(JSON.parse(p.payload)).toMatchObject({ bookingId, userId, probability: 0.7, source: "high_risk" });
    expect(p.agentId).toBe(NO_SHOW.id);
    expect(p.tenantId).toBe(tenantId);
    expect(p.confidence).toBeCloseTo(0.7, 2);
    expect(p.kind).toBe("BOOKING_NOSHOW_REMINDER");
  });

  test("does not emit proposal below risk threshold", async () => {
    predictMock.mockResolvedValue({ probability: 0.15, modelVersion: "noshow-v1" });
    createUpcomingBooking(7);

    await new NoShowRiskAgent().runForTenant(tenantId);

    expect(prismaMock.agentProposal.create).not.toHaveBeenCalled();
  });

  test("records AgentDecision for every booking, regardless of threshold", async () => {
    predictMock.mockResolvedValue({ probability: 0.1, modelVersion: "noshow-v1" });
    const bookingId = createUpcomingBooking(10);

    await new NoShowRiskAgent().runForTenant(tenantId);

    expect(decisions()).toEqual([
      expect.objectContaining({
        agentId: NO_SHOW.id,
        tenantId,
        action: AgentAction.NO_ACTION,
        confidence: 0.1,
        sourceMessageId: bookingId,
      }),
    ]);
  });
});

describe("NoShowRiskAgent — ML service failure", () => {
  test("records NO_ACTION decision and does not crash when ML service is down", async () => {
    predictMock.mockRejectedValue(new MlServiceError("connection refused", 503));
    const bookingId = createUpcomingBooking(4);

    const run = await new NoShowRiskAgent().runForTenant(tenantId);

    // Agent should complete (not fail) even when ML is unreachable
    expect(run.status).toBe(AgentRunStatus.COMPLETED);
    expect(decisions()).toEqual([
      expect.objectContaining({
        action: AgentAction.NO_ACTION,
        confidence: 0,
        sourceMessageId: bookingId,
        reasoning: expect.stringContaining("connection refused (503)"),
      }),
    ]);
  });

  test("does not emit proposals when ML service is unavailable", async () => {
    predictMock.mockRejectedValue(new MlServiceError("service unavailable", 503));
    createUpcomingBooking(6);

    await new NoShowRiskAgent().runForTenant(tenantId);

    expect(prismaMock.agentProposal.create).not.toHaveBeenCalled();
  });
});

// ── Prediction persistence ────────────────────────────────────────────────────

describe("NoShowRiskAgent — prediction persistence", () => {
  test("persists a BookingNoShowPrediction for every successfully scored booking", async () => {
    const version = "noshow-persist-test-v1";
    predictMock.mockResolvedValue({ probability: 0.35, modelVersion: version });
    const bookingId = createUpcomingBooking(8);

    const run = await new NoShowRiskAgent().runForTenant(tenantId);

    expect(run.status).toBe(AgentRunStatus.COMPLETED);
    expect(prismaMock.bookingNoShowPrediction.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.bookingNoShowPrediction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId_modelVersion: { bookingId, modelVersion: version } },
        create: { bookingId, tenantId, modelVersion: version, probability: 0.35 },
      }),
    );
  });

  test("does not persist a prediction when ML service fails", async () => {
    predictMock.mockRejectedValue(new MlServiceError("connection refused", 503));
    createUpcomingBooking(9);

    await new NoShowRiskAgent().runForTenant(tenantId);

    expect(prismaMock.bookingNoShowPrediction.upsert).not.toHaveBeenCalled();
  });

  test("upserts on re-score — updates probability, does not duplicate", async () => {
    const version = "noshow-upsert-test-v1";
    const bookingId = createUpcomingBooking(11);
    const agent = new NoShowRiskAgent();

    predictMock.mockResolvedValue({ probability: 0.4, modelVersion: version });
    await agent.runForTenant(tenantId);
    predictMock.mockResolvedValue({ probability: 0.55, modelVersion: version });
    await agent.runForTenant(tenantId);

    // Both runs upsert on the same (bookingId, modelVersion) key; none inserts.
    const calls = prismaMock.bookingNoShowPrediction.upsert.mock.calls.map((c) => c[0] as any);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.where).toEqual({ bookingId_modelVersion: { bookingId, modelVersion: version } });
    }
    expect(calls[1].update).toEqual(expect.objectContaining({ probability: 0.55 }));
    expect(prismaMock.bookingNoShowPrediction.create).not.toHaveBeenCalled();
  });
});

// ── booking-noshow-reminder committer ─────────────────────────────────────────

describe("booking-noshow-reminder committer", () => {
  test("creates an OutboundMessage reminder when proposal is approved", async () => {
    const bookingDate = isoDateFromToday(14);
    const bookingId = "booking-reminder";
    const proposal = {
      id: "proposal-reminder",
      agentId: NO_SHOW.id,
      runId: "run-1",
      kind: "BOOKING_NOSHOW_REMINDER",
      payload: JSON.stringify({
        bookingId,
        userId,
        bookingDate,
        probability: 0.62,
        modelVersion: "noshow-v1",
        source: "high_risk",
      }),
      confidence: 0.62,
      reasoning: "test",
      audienceScope: AgentProposalAudience.TENANT,
      tenantId,
      targetTenantId: null,
      status: AgentProposalStatus.PENDING,
    };
    prismaMock.agentProposal.findUnique.mockResolvedValue(proposal as never);
    prismaMock.agentProposal.update.mockImplementation((async ({ data }: any) => ({ ...proposal, ...data })) as never);
    prismaMock.booking.findUnique.mockResolvedValue({
      id: bookingId,
      tenantId,
      userId,
      date: bookingDate,
      user: { email: "member@example.test", name: "Test Member" },
    } as never);
    prismaMock.outboundMessage.create.mockImplementation((async ({ data }: any) => ({ id: "outbound-1", ...data })) as never);

    const approverId = userId; // any user id works for the commit
    const result = await applyProposal({ proposalId: proposal.id, approverId });

    expect(result.committedEntityType).toBe("OutboundMessage");
    expect(result.committedEntityId).toBe("outbound-1");
    expect(prismaMock.booking.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: bookingId } }));

    const msg = (prismaMock.outboundMessage.create.mock.calls[0][0] as any).data;
    expect(msg.channel).toBe("EMAIL");
    expect(msg.status).toBe("STUBBED");
    expect(msg.toAddress).toBe("member@example.test");
    expect(msg.tenantId).toBe(tenantId);
    expect(msg.relatedEntity).toBe("Booking");
    expect(msg.relatedEntityId).toBe(bookingId);
  });
});
