jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/permissions", () => ({
  ...jest.requireActual("@/lib/permissions"),
  assertPermissionOrFail: jest.fn(async () => null),
}));
jest.mock("@/lib/charity/feature-gate", () => ({
  ...jest.requireActual("@/lib/charity/feature-gate"),
  checkCharityGate: jest.fn(async (tenantId: string) => ({ ok: true, tenantId, country: "GB" })),
}));
// No real LLM: the detector test swaps in a fake provider after construction.
jest.mock("@/lib/agent/providers", () => ({ getProvider: () => ({ name: "stub", call: jest.fn() }) }));

import { ChannelType } from "@prisma/client";
import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, request, routeParams } from "@/test-utils/http";
import { logAudit } from "@/lib/audit";
import { getTARSections } from "@/lib/charity/tar-sections";
import { POST as CREATE_GROUP } from "@/app/api/groups/route";
import { PATCH as UPDATE_GROUP, DELETE as DELETE_GROUP } from "@/app/api/groups/[id]/route";
import { PATCH as PATCH_TAR } from "@/app/api/charity/tar/route";
import { DELETE as DELETE_ASSET } from "@/app/api/charity/asset-liabilities/[id]/route";
import { DetectionAgent } from "@/lib/agent/agents/detector";

const TENANT = "t1";
const GROUP = { id: "g-1", tenantId: TENANT, name: "Events Committee", description: null, isBuiltIn: false };

const auditActions = () => jest.mocked(logAudit).mock.calls.map((c) => c[0]);

beforeEach(() => {
  jest.mocked(logAudit).mockClear();
  signInAs({ id: "admin-1", role: "TENANT_ADMIN", tenantId: TENANT });
});

describe("FR-AUD-001 – permission groups are audited", () => {
  beforeEach(() => {
    prismaMock.permissionGroup.findUnique.mockResolvedValue(null);
    prismaMock.permissionGroup.findFirst.mockImplementation((async ({ where }: any) =>
      where.id === GROUP.id ? { ...GROUP, grants: [], members: [] } : null) as never);
    prismaMock.permissionGroup.create.mockImplementation((async ({ data }: any) => ({
      id: "g-new",
      isBuiltIn: false,
      ...data,
      _count: { grants: 0, members: 0 },
    })) as never);
    prismaMock.permissionGroup.update.mockImplementation((async ({ data }: any) => ({ ...GROUP, ...data })) as never);
    prismaMock.permissionGroup.delete.mockResolvedValue(GROUP as never);
  });

  test("[B-85] FR-AUD-001 – creating a group writes an audit event", async () => {
    const { status } = await readJson(await CREATE_GROUP(jsonRequest("POST", "/api/groups", { name: "Social Committee" })));

    expect(status).toBe(201);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: expect.stringMatching(/group.*creat/i) }),
    );
  });

  test("[B-85] FR-AUD-001 – updating a group writes an audit event", async () => {
    const { status } = await readJson(
      await UPDATE_GROUP(jsonRequest("PATCH", `/api/groups/${GROUP.id}`, { name: "Fixtures Committee" }), routeParams({ id: GROUP.id })),
    );

    expect(status).toBe(200);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: expect.stringMatching(/group.*(updat|renam|edit)/i), entityId: GROUP.id }),
    );
  });

  test("[B-85] FR-AUD-001 – deleting a group writes an audit event", async () => {
    const { status } = await readJson(
      await DELETE_GROUP(request(`/api/groups/${GROUP.id}`, { method: "DELETE" }), routeParams({ id: GROUP.id })),
    );

    expect(status).toBe(200);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: expect.stringMatching(/group.*(delet|remov)/i), entityId: GROUP.id }),
    );
  });
});

describe("FR-AUD-001 – charity edits are audited", () => {
  test("[B-85] FR-AUD-001 – saving a TAR section (PATCH /api/charity/tar) writes an audit event", async () => {
    const slug = getTARSections("CC_EW")[0].slug;
    prismaMock.charityTAR.findUnique.mockResolvedValue({
      id: "tar-1",
      tenantId: TENANT,
      financialYearId: "y1",
      status: "DRAFT",
      sections: "{}",
    } as never);
    prismaMock.charitySettings.findUnique.mockResolvedValue({ regulator: "CC_EW" } as never);
    prismaMock.charityTAR.update.mockImplementation((async ({ data }: any) => ({
      id: "tar-1",
      ...data,
      updatedAt: new Date(),
    })) as never);

    const { status } = await readJson(
      await PATCH_TAR(jsonRequest("PATCH", "/api/charity/tar", { yearId: "y1", slug, content: "Our year in review" })),
    );

    expect(status).toBe(200);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: expect.stringMatching(/tar/i) }),
    );
  });

  test("[B-85] FR-AUD-001 – deleting an asset/liability line writes an audit event", async () => {
    prismaMock.charityAssetLiability.findFirst.mockResolvedValue({
      id: "al-1",
      tenantId: TENANT,
      kind: "DEBTOR",
      name: "Gift Aid due",
      amount: 12000,
      financialYearId: "y1",
      financialYear: { status: "OPEN" },
    } as never);
    prismaMock.charityAssetLiability.delete.mockResolvedValue({ id: "al-1" } as never);

    const { status } = await readJson(
      await DELETE_ASSET(request("/api/charity/asset-liabilities/al-1", { method: "DELETE" }), routeParams({ id: "al-1" })),
    );

    expect(status).toBe(200);
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.stringMatching(/(asset|liabilit).*(delet|remov)/i),
        entityId: "al-1",
      }),
    );
  });
});

describe("FR-AUD-002 – PII sent to the LLM is flagged", () => {
  const DETECTOR = { id: "agent-detector", slug: "detector", name: "Detection Agent", systemUserId: "sys-detector" };

  beforeEach(() => {
    prismaMock.agentDefinition.findUnique.mockResolvedValue(DETECTOR as never);
    prismaMock.agentRun.create.mockImplementation((async ({ data }: any) => ({ id: "run-1", ...data })) as never);
    prismaMock.agentRun.update.mockImplementation((async ({ where, data }: any) => ({ id: where.id, ...data })) as never);
    prismaMock.agentConfig.findUnique.mockResolvedValue(null);
    prismaMock.agentMemory.findUnique.mockResolvedValue(null);
    prismaMock.tenant.findUnique.mockResolvedValue({ name: "Audit Test Club", latitude: null, longitude: null } as never);
    prismaMock.agentKnowledge.findMany.mockResolvedValue([]);
    prismaMock.message.findMany.mockResolvedValue([
      {
        id: "msg-1",
        tenantId: TENANT,
        channelId: "ch-1",
        userId: "member-1",
        body: "Rink 2 is flooded again",
        pinned: false,
        deletedAt: null,
        createdAt: new Date(Date.now() - 60_000),
        updatedAt: new Date(),
        user: { name: "Morag Member", email: "morag@example.test" },
        channel: { name: "general", type: ChannelType.PUBLIC },
      },
    ] as never);
  });

  test("[B-85] FR-AUD-002 – the detector's LLM call (member names + messages) is audited with piiAccess: true", async () => {
    const provider = { name: "fake", call: jest.fn(async () => ({ content: { complaints: [] }, model: "fake", usage: {} })) };
    const agent = new DetectionAgent();
    (agent as unknown as { provider: unknown }).provider = provider;

    await agent.runForTenant(TENANT);

    expect(provider.call).toHaveBeenCalled();
    // Via logAudit, or written straight to AuditEvent (the agent has no user session).
    const viaLogAudit = auditActions().some((a) => a.piiAccess === true);
    const viaPrisma = prismaMock.auditEvent.create.mock.calls.some((c: any) => c[0]?.data?.piiAccess === true);
    expect({ viaLogAudit, viaPrisma }).not.toEqual({ viaLogAudit: false, viaPrisma: false });
  });
});
