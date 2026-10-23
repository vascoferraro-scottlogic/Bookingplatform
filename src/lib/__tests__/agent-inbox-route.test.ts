/**
 * Tests for /api/agent/proposals (list / approve / reject).
 *
 * Behavioural contract:
 *  - GET lists pending proposals for the current tenant; admins +
 *    maintenance + platform-admin may view; regular USER is forbidden.
 *  - GET respects ?status= and ?kind= filters.
 *  - GET hydrates payloadParsed for client use.
 *  - POST .../approve invokes the registered committer, transitions
 *    PENDING → APPROVED, writes audit row.
 *  - POST .../reject transitions PENDING → REJECTED with reason.
 *  - Cross-tenant access blocked.
 *  - PENDING-only enforcement (cannot approve an already-approved row).
 */
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import {
  AgentProposalAudience,
  AgentProposalStatus,
  TaskCategory,
  TaskPriority,
} from "@prisma/client";
import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, request, routeParams } from "@/test-utils/http";
import { MAINTENANCE_TASK_CREATE_KIND } from "@/lib/agent/committers/maintenance-task-create";
import "@/lib/agent/committers/register-all";
import { GET as listGET } from "@/app/api/agent/proposals/route";
import { POST as approvePOST } from "@/app/api/agent/proposals/[id]/approve/route";
import { POST as rejectPOST } from "@/app/api/agent/proposals/[id]/reject/route";

const TENANT = "tenant-1";
const OTHER_TENANT = "tenant-2";
const ADMIN = "admin-1";
const MEMBER = "member-1";
// Stands in for the seeded "detector" AgentDefinition.
const DETECTOR = { id: "agent-detector", slug: "detector", name: "Detection Agent", systemUserId: "sys-detector" };

const asAdmin = (tenantId = TENANT) => signInAs({ id: ADMIN, role: "TENANT_ADMIN", tenantId });
const asMember = () => signInAs({ id: MEMBER, role: "USER", tenantId: TENANT });

function proposalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    agentId: DETECTOR.id,
    runId: "run-1",
    kind: MAINTENANCE_TASK_CREATE_KIND,
    payload: JSON.stringify({
      title: "Sprinkler stuck on green 2",
      description: "x",
      category: TaskCategory.GROUNDS,
      priority: TaskPriority.MEDIUM,
      participantCount: 1,
    }),
    confidence: 0.8,
    reasoning: "test",
    audienceScope: AgentProposalAudience.TENANT,
    tenantId: TENANT,
    userId: null,
    federationId: null,
    targetTenantId: null,
    status: AgentProposalStatus.PENDING,
    expiresAt: null,
    committedAt: null,
    committedById: null,
    committedEntityType: null,
    committedEntityId: null,
    committedPayloadDiff: null,
    rejectedAt: null,
    rejectedById: null,
    rejectReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** The proposal the routes load; agentProposal.update merges its data into it. */
function givenProposal(overrides: Record<string, unknown> = {}) {
  const row = proposalRow(overrides);
  prismaMock.agentProposal.findUnique.mockResolvedValue(row as never);
  prismaMock.agentProposal.update.mockImplementation((async ({ data }: any) => ({ ...row, ...data })) as never);
  return row;
}

beforeEach(() => {
  prismaMock.agentDefinition.findUnique.mockResolvedValue(DETECTOR as never);
  prismaMock.maintenanceTask.findMany.mockResolvedValue([]);
  prismaMock.maintenanceTask.create.mockImplementation((async ({ data }: any) => ({ id: "task-1", ...data })) as never);
});

const listWhere = () => (prismaMock.agentProposal.findMany.mock.calls[0][0] as any).where;

describe("GET /api/agent/proposals", () => {
  test("returns pending proposals for the tenant", async () => {
    prismaMock.agentProposal.findMany.mockResolvedValue([proposalRow({ id: "p1" }), proposalRow({ id: "p2" })] as never);
    asAdmin();

    const { status, body } = await readJson(await listGET(request(`/api/agent/proposals?tenantId=${TENANT}`)));

    expect(status).toBe(200);
    expect(body.proposals).toHaveLength(2);
    expect(body.proposals[0].payloadParsed).toMatchObject({ title: "Sprinkler stuck on green 2" });
    expect(listWhere()).toEqual({ tenantId: TENANT, status: AgentProposalStatus.PENDING });
  });

  test("scopes the query to the session tenant, ignoring a ?tenantId for another tenant", async () => {
    prismaMock.agentProposal.findMany.mockResolvedValue([]);
    asAdmin();

    const res = await listGET(request(`/api/agent/proposals?tenantId=${OTHER_TENANT}`));

    expect(res.status).toBe(200);
    expect(listWhere().tenantId).toBe(TENANT);
  });

  test("?status=ALL includes non-pending proposals", async () => {
    prismaMock.agentProposal.findMany.mockResolvedValue([]);
    asAdmin();

    await listGET(request(`/api/agent/proposals?tenantId=${TENANT}`));
    await listGET(request(`/api/agent/proposals?tenantId=${TENANT}&status=ALL`));

    const [pending, all] = prismaMock.agentProposal.findMany.mock.calls.map((c) => (c[0] as any).where);
    expect(pending).toEqual({ tenantId: TENANT, status: AgentProposalStatus.PENDING });
    expect(all).toEqual({ tenantId: TENANT });
  });

  test("?kind= filters by proposal kind", async () => {
    prismaMock.agentProposal.findMany.mockResolvedValue([]);
    asAdmin();

    await listGET(request(`/api/agent/proposals?kind=${MAINTENANCE_TASK_CREATE_KIND}`));

    expect(listWhere()).toEqual({ tenantId: TENANT, status: AgentProposalStatus.PENDING, kind: MAINTENANCE_TASK_CREATE_KIND });
  });

  test("USER role is forbidden", async () => {
    asMember();

    const res = await listGET(request(`/api/agent/proposals?tenantId=${TENANT}`));

    expect(res.status).toBe(403);
    expect(prismaMock.agentProposal.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/agent/proposals/[id]/approve", () => {
  const approve = (id: string, body: unknown = {}) =>
    approvePOST(jsonRequest("POST", `/api/agent/proposals/${id}/approve`, body), routeParams({ id }));

  test("approves: PENDING → APPROVED, creates task, writes audit", async () => {
    givenProposal();
    asAdmin();

    const { status, body } = await readJson(await approve("p1"));

    expect(status).toBe(200);
    expect(body.status).toBe(AgentProposalStatus.APPROVED);
    expect(body.committedEntityType).toBe("MaintenanceTask");
    expect(body.committedEntityId).toBe("task-1");

    const taskData = (prismaMock.maintenanceTask.create.mock.calls[0][0] as any).data;
    expect(taskData).toMatchObject({ tenantId: TENANT, title: "Sprinkler stuck on green 2" });
    // Visibility omitted so the schema default (MAINTENANCE_ONLY) applies.
    expect(taskData).not.toHaveProperty("visibility");

    expect(prismaMock.agentProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({ status: AgentProposalStatus.APPROVED, committedById: ADMIN }),
      }),
    );
    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "agent.proposal.approved", entityId: "p1", tenantId: TENANT }),
    });
  });

  test("approves with edits", async () => {
    givenProposal();
    asAdmin();

    const { status, body } = await readJson(await approve("p1", { edits: { title: "Edited title", priority: "HIGH" } }));

    expect(status).toBe(200);
    expect(prismaMock.maintenanceTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: "Edited title", priority: "HIGH" }),
    });
    expect(body.committedPayloadDiff).toContain("Edited title");
  });

  test("404 when proposal missing", async () => {
    prismaMock.agentProposal.findUnique.mockResolvedValue(null);
    asAdmin();

    const res = await approve("nonexistent");

    expect(res.status).toBe(404);
  });

  test("400 when proposal already APPROVED (PENDING-only enforcement)", async () => {
    givenProposal({ status: AgentProposalStatus.APPROVED });
    asAdmin();

    const res = await approve("p1");

    expect(res.status).toBe(400);
    expect(prismaMock.maintenanceTask.create).not.toHaveBeenCalled();
    expect(prismaMock.agentProposal.update).not.toHaveBeenCalled();
  });

  test("403 when admin is on a different tenant", async () => {
    givenProposal({ tenantId: OTHER_TENANT });
    asAdmin(); // admin is on TENANT, proposal is on OTHER_TENANT

    const res = await approve("p1");

    expect(res.status).toBe(403);
    expect(prismaMock.maintenanceTask.create).not.toHaveBeenCalled();
    expect(prismaMock.agentProposal.update).not.toHaveBeenCalled();
  });

  test("403 for USER role", async () => {
    givenProposal();
    asMember();

    const res = await approve("p1");

    expect(res.status).toBe(403);
    expect(prismaMock.agentProposal.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/agent/proposals/[id]/reject", () => {
  const reject = (id: string, body: unknown = {}) =>
    rejectPOST(jsonRequest("POST", `/api/agent/proposals/${id}/reject`, body), routeParams({ id }));

  test("rejects with reason: PENDING → REJECTED, writes audit", async () => {
    givenProposal();
    asAdmin();

    const { status, body } = await readJson(await reject("p1", { reason: "Was a joke" }));

    expect(status).toBe(200);
    expect(body.status).toBe(AgentProposalStatus.REJECTED);
    expect(body.rejectReason).toBe("Was a joke");
    expect(prismaMock.agentProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1" }, data: expect.objectContaining({ rejectedById: ADMIN }) }),
    );
    expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "agent.proposal.rejected", entityId: "p1", tenantId: TENANT }),
    });

    // No task created
    expect(prismaMock.maintenanceTask.create).not.toHaveBeenCalled();
  });

  test("rejects without reason", async () => {
    givenProposal();
    asAdmin();

    const { status, body } = await readJson(await reject("p1", {}));

    expect(status).toBe(200);
    expect(body.rejectReason).toBeNull();
  });

  test("403 for USER role", async () => {
    givenProposal();
    asMember();

    const res = await reject("p1", { reason: "no" });

    expect(res.status).toBe(403);
    expect(prismaMock.agentProposal.update).not.toHaveBeenCalled();
  });
});
