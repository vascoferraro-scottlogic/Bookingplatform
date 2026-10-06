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

import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";
import {
  AgentProposalAudience,
  AgentProposalStatus,
  AgentRunStatus,
  TaskCategory,
  TaskPriority,
} from "@prisma/client";
import { MAINTENANCE_TASK_CREATE_KIND } from "@/lib/agent/committers/maintenance-task-create";
import "@/lib/agent/committers/register-all";

let mockSessionReturn: any;
jest.mock("@/lib/api-utils", () => {
  const actual = jest.requireActual("@/lib/api-utils");
  return {
    ...actual,
    getSessionOrFail: jest.fn(() => Promise.resolve(mockSessionReturn)),
  };
});

import { GET as listGET } from "@/app/api/agent/proposals/route";
import { POST as approvePOST } from "@/app/api/agent/proposals/[id]/approve/route";
import { POST as rejectPOST } from "@/app/api/agent/proposals/[id]/reject/route";

let tenantId: string;
let otherTenantId: string;
let adminId: string;
let memberId: string;
let agentId: string;
let runId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Inbox Test Club", slug: "inbox-test-" + Date.now() },
  });
  tenantId = tenant.id;

  const other = await prisma.tenant.create({
    data: { name: "Other Inbox Club", slug: "inbox-other-" + Date.now() },
  });
  otherTenantId = other.id;

  const admin = await prisma.user.create({
    data: { email: `inbox-admin-${Date.now()}@test.com`, name: "InboxAdmin", passwordHash: "x", role: "TENANT_ADMIN", tenantId },
  });
  adminId = admin.id;

  const member = await prisma.user.create({
    data: { email: `inbox-mem-${Date.now()}@test.com`, name: "InboxMem", passwordHash: "x", role: "USER", tenantId },
  });
  memberId = member.id;

  const def = await prisma.agentDefinition.findUnique({ where: { slug: "detector" } });
  if (!def) throw new Error("Seeded detector AgentDefinition missing — run prisma seed");
  agentId = def.id;

  const run = await prisma.agentRun.create({
    data: { agentId, tenantId, status: AgentRunStatus.RUNNING },
  });
  runId = run.id;
});

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 200));
  await prisma.taskNote.deleteMany({ where: { task: { tenantId: { in: [tenantId, otherTenantId] } } } });
  await prisma.maintenanceTask.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.agentDecision.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.agentProposal.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.agentRun.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, memberId] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Wipe per-test proposals so list ordering / counts are deterministic.
  await prisma.taskNote.deleteMany({ where: { task: { tenantId: { in: [tenantId, otherTenantId] } } } });
  await prisma.maintenanceTask.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.agentDecision.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prisma.agentProposal.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
});

function adminSession(tid = tenantId) {
  return { session: { user: { id: adminId, email: "a@b.com", name: "Admin", role: "TENANT_ADMIN", tenantId: tid } } };
}
function memberSession() {
  return { session: { user: { id: memberId, email: "m@b.com", name: "M", role: "USER", tenantId } } };
}

async function seedProposal(opts: {
  tenantId?: string;
  status?: AgentProposalStatus;
  kind?: string;
  payload?: Record<string, unknown>;
} = {}) {
  return prisma.agentProposal.create({
    data: {
      agentId,
      runId,
      kind: opts.kind ?? MAINTENANCE_TASK_CREATE_KIND,
      payload: JSON.stringify(opts.payload ?? {
        title: "Sprinkler stuck on green 2",
        description: "x",
        category: TaskCategory.GROUNDS,
        priority: TaskPriority.MEDIUM,
        participantCount: 1,
      }),
      confidence: 0.8,
      reasoning: "test",
      audienceScope: AgentProposalAudience.TENANT,
      tenantId: opts.tenantId ?? tenantId,
      status: opts.status ?? AgentProposalStatus.PENDING,
    },
  });
}

describe("GET /api/agent/proposals", () => {
  test("returns pending proposals for the tenant", async () => {
    await seedProposal();
    await seedProposal();
    mockSessionReturn = adminSession();
    const res = await listGET(new NextRequest(`http://localhost/api/agent/proposals?tenantId=${tenantId}`));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.proposals).toHaveLength(2);
    expect(data.proposals[0].payloadParsed).toMatchObject({ title: "Sprinkler stuck on green 2" });
  });

  test("excludes other tenants' proposals", async () => {
    await seedProposal();
    await seedProposal({ tenantId: otherTenantId });
    mockSessionReturn = adminSession();
    const res = await listGET(new NextRequest(`http://localhost/api/agent/proposals?tenantId=${tenantId}`));
    const data = await res.json();
    expect(data.proposals).toHaveLength(1);
  });

  test("?status=ALL includes non-pending proposals", async () => {
    await seedProposal();
    await seedProposal({ status: AgentProposalStatus.REJECTED });
    mockSessionReturn = adminSession();
    const pending = await listGET(new NextRequest(`http://localhost/api/agent/proposals?tenantId=${tenantId}`));
    expect((await pending.json()).proposals).toHaveLength(1);
    const all = await listGET(new NextRequest(`http://localhost/api/agent/proposals?tenantId=${tenantId}&status=ALL`));
    expect((await all.json()).proposals).toHaveLength(2);
  });

  test("USER role is forbidden", async () => {
    mockSessionReturn = memberSession();
    const res = await listGET(new NextRequest(`http://localhost/api/agent/proposals?tenantId=${tenantId}`));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/agent/proposals/[id]/approve", () => {
  function makeReq(body: unknown = {}): NextRequest {
    return new NextRequest("http://localhost/api/agent/proposals/x/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("approves: PENDING → APPROVED, creates task, writes audit", async () => {
    const p = await seedProposal();
    mockSessionReturn = adminSession();
    const res = await approvePOST(makeReq(), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.status).toBe(AgentProposalStatus.APPROVED);
    expect(updated.committedEntityType).toBe("MaintenanceTask");
    expect(updated.committedEntityId).toBeTruthy();

    const task = await prisma.maintenanceTask.findUniqueOrThrow({ where: { id: updated.committedEntityId } });
    expect(task.title).toBe("Sprinkler stuck on green 2");
    expect(task.visibility).toBe("MAINTENANCE_ONLY");

    await new Promise((r) => setTimeout(r, 200));
    const audits = await prisma.auditEvent.findMany({
      where: { entityId: p.id, action: "agent.proposal.approved" },
    });
    expect(audits).toHaveLength(1);
  });

  test("approves with edits", async () => {
    const p = await seedProposal();
    mockSessionReturn = adminSession();
    const res = await approvePOST(
      makeReq({ edits: { title: "Edited title", priority: "HIGH" } }),
      { params: Promise.resolve({ id: p.id }) },
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    const task = await prisma.maintenanceTask.findUniqueOrThrow({ where: { id: updated.committedEntityId } });
    expect(task.title).toBe("Edited title");
    expect(task.priority).toBe("HIGH");
    expect(updated.committedPayloadDiff).toContain("Edited title");
  });

  test("404 when proposal missing", async () => {
    mockSessionReturn = adminSession();
    const res = await approvePOST(makeReq(), { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  test("400 when proposal already APPROVED (PENDING-only enforcement)", async () => {
    const p = await seedProposal({ status: AgentProposalStatus.APPROVED });
    mockSessionReturn = adminSession();
    const res = await approvePOST(makeReq(), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(400);
  });

  test("403 when admin is on a different tenant", async () => {
    const p = await seedProposal({ tenantId: otherTenantId });
    mockSessionReturn = adminSession(); // admin is on tenantId, proposal is on otherTenantId
    const res = await approvePOST(makeReq(), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(403);
  });

  test("403 for USER role", async () => {
    const p = await seedProposal();
    mockSessionReturn = memberSession();
    const res = await approvePOST(makeReq(), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/agent/proposals/[id]/reject", () => {
  function makeReq(body: unknown = {}): NextRequest {
    return new NextRequest("http://localhost/api/agent/proposals/x/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("rejects with reason: PENDING → REJECTED, writes audit", async () => {
    const p = await seedProposal();
    mockSessionReturn = adminSession();
    const res = await rejectPOST(makeReq({ reason: "Was a joke" }), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.status).toBe(AgentProposalStatus.REJECTED);
    expect(updated.rejectReason).toBe("Was a joke");

    await new Promise((r) => setTimeout(r, 200));
    const audits = await prisma.auditEvent.findMany({
      where: { entityId: p.id, action: "agent.proposal.rejected" },
    });
    expect(audits).toHaveLength(1);

    // No task created
    const tasks = await prisma.maintenanceTask.findMany({ where: { tenantId } });
    expect(tasks).toHaveLength(0);
  });

  test("rejects without reason", async () => {
    const p = await seedProposal();
    mockSessionReturn = adminSession();
    const res = await rejectPOST(makeReq({}), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.rejectReason).toBeNull();
  });

  test("403 for USER role", async () => {
    const p = await seedProposal();
    mockSessionReturn = memberSession();
    const res = await rejectPOST(makeReq({ reason: "no" }), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(403);
  });
});
