jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import type { Role } from "@prisma/client";
import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, request, readJson, routeParams } from "@/test-utils/http";

import { GET } from "@/app/api/maintenance/route";
import { PATCH as PATCH_VISIBILITY } from "@/app/api/maintenance/[id]/visibility/route";

const TENANT_ID = "tenant-1";
const OTHER_TENANT_ID = "tenant-2";
const ADMIN_ID = "vis-admin";
const MAINTAINER_ID = "vis-maintainer";
const MEMBER_ID = "vis-member";
const OTHER_MEMBER_ID = "vis-member-2";
const OTHER_MAINTAINER_ID = "vis-maintainer-2";

type Task = { id: string; tenantId: string; title: string; visibility: string; submittedById: string; assignedToId: string | null };
const task = (id: string, visibility: string, submittedById: string, tenantId = TENANT_ID, assignedToId: string | null = null): Task => ({
  id, tenantId, title: id, visibility, submittedById, assignedToId,
});

// Mix of tasks with different visibilities and submitters.
const ADMIN_TASK = task("admin-task", "MAINTENANCE_ONLY", ADMIN_ID); // agent triage
const MEMBER_SUBMITTED_TASK = task("member-task", "MEMBERS", MEMBER_ID);
const PUBLIC_TASK = task("public-task", "PUBLIC", ADMIN_ID);
const MAINTAINER_SELF_TASK = task("maintainer-task", "MAINTENANCE_ONLY", MAINTAINER_ID);
const OTHER_MEMBER_MEMBERS_TASK = task("other-member-task", "MEMBERS", OTHER_MEMBER_ID);
const OTHER_TENANT_TASK = task("other-tenant-task", "PUBLIC", "someone-else", OTHER_TENANT_ID);
// Assigned tasks: one to the maintainer under test, one to a colleague.
const ASSIGNED_TO_MAINTAINER_TASK = task("assigned-to-maintainer", "MEMBERS", MEMBER_ID, TENANT_ID, MAINTAINER_ID);
const ASSIGNED_TO_COLLEAGUE_TASK = task("assigned-to-colleague", "MAINTENANCE_ONLY", ADMIN_ID, TENANT_ID, OTHER_MAINTAINER_ID);
const ALL_TASKS = [
  ADMIN_TASK, MEMBER_SUBMITTED_TASK, PUBLIC_TASK, MAINTAINER_SELF_TASK, OTHER_MEMBER_MEMBERS_TASK, OTHER_TENANT_TASK,
  ASSIGNED_TO_MAINTAINER_TASK, ASSIGNED_TO_COLLEAGUE_TASK,
];

const signInAsRole = (role: Role, id: string, tenantId = TENANT_ID) => signInAs({ id, role, tenantId });

/**
 * Evaluates the subset of Prisma `where` syntax the list route builds
 * (field equality, `{ in: [...] }`, `OR`) so the visibility rules can be
 * checked against concrete tasks, not just as a clause shape.
 */
function matches(t: Record<string, unknown>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Record<string, any>[]).some((c) => matches(t, c));
    if (cond && typeof cond === "object" && "in" in cond) return cond.in.includes(t[key]);
    return t[key] === cond;
  });
}

async function listVisibleIds() {
  prismaMock.maintenanceTask.findMany.mockImplementation((async ({ where }: any) =>
    ALL_TASKS.filter((t) => matches(t, where))) as never);
  const { status, body } = await readJson(await GET(request(`/api/maintenance?tenantId=${TENANT_ID}`)));
  expect(status).toBe(200);
  return (body as Task[]).map((t) => t.id);
}

function listWhere() {
  return (prismaMock.maintenanceTask.findMany.mock.calls[0][0] as any).where;
}

describe("GET /api/maintenance — visibility filtering", () => {
  test("TENANT_ADMIN filters by tenant only and sees all five of its tasks", async () => {
    signInAsRole("TENANT_ADMIN", ADMIN_ID);
    const ids = await listVisibleIds();

    expect(listWhere()).toEqual({ tenantId: TENANT_ID });
    expect(ids).toEqual(expect.arrayContaining([
      ADMIN_TASK.id, MEMBER_SUBMITTED_TASK.id, PUBLIC_TASK.id,
      MAINTAINER_SELF_TASK.id, OTHER_MEMBER_MEMBERS_TASK.id,
    ]));
    expect(ids).not.toContain(OTHER_TENANT_TASK.id);
  });

  test("[B-63] D-11 / FR-MNT-003 – MAINTENANCE sees only the tasks assigned to them", async () => {
    signInAsRole("MAINTENANCE", MAINTAINER_ID);
    const ids = await listVisibleIds();

    expect(listWhere()).toMatchObject({ tenantId: TENANT_ID });
    expect(ids).toContain(ASSIGNED_TO_MAINTAINER_TASK.id);
    // Unassigned triage-queue tasks and colleagues' tasks are not theirs.
    expect(ids).not.toContain(ADMIN_TASK.id);
    expect(ids).not.toContain(ASSIGNED_TO_COLLEAGUE_TASK.id);
    expect(ids).not.toContain(MEMBER_SUBMITTED_TASK.id);
    expect(ids).not.toContain(OTHER_MEMBER_MEMBERS_TASK.id);
    expect(ids).not.toContain(PUBLIC_TASK.id);
    expect(ids).not.toContain(OTHER_TENANT_TASK.id);
  });

  test("[B-63] D-11 – USER keeps the visibility model: own + MEMBERS + PUBLIC but never MAINTENANCE_ONLY", async () => {
    signInAsRole("USER", MEMBER_ID);
    const ids = await listVisibleIds();

    expect(listWhere()).toEqual({
      tenantId: TENANT_ID,
      OR: [
        { submittedById: MEMBER_ID },
        { visibility: { in: ["MEMBERS", "PUBLIC"] } },
      ],
    });
    expect(ids).toEqual(expect.arrayContaining([
      MEMBER_SUBMITTED_TASK.id, OTHER_MEMBER_MEMBERS_TASK.id, PUBLIC_TASK.id,
    ]));
    expect(ids).not.toContain(ADMIN_TASK.id);
    expect(ids).not.toContain(MAINTAINER_SELF_TASK.id);
    expect(ids).not.toContain(ASSIGNED_TO_COLLEAGUE_TASK.id);
    expect(ids).not.toContain(OTHER_TENANT_TASK.id);
  });
});

describe("PATCH /api/maintenance/[id]/visibility", () => {
  const patch = (id: string, body: Record<string, unknown>) =>
    PATCH_VISIBILITY(jsonRequest("PATCH", `/api/maintenance/${id}/visibility`, body), routeParams({ id }));

  beforeEach(() => {
    prismaMock.maintenanceTask.findUnique.mockImplementation((async ({ where }: any) =>
      ALL_TASKS.find((t) => t.id === where.id) ?? null) as never);
    prismaMock.maintenanceTask.update.mockImplementation((async ({ where, data }: any) => ({
      ...ALL_TASKS.find((t) => t.id === where.id),
      ...data,
    })) as never);
    prismaMock.auditEvent.create.mockResolvedValue({} as never);
  });

  const visibilityAudits = () =>
    prismaMock.auditEvent.create.mock.calls
      .map(([a]) => (a as any).data)
      .filter((d) => d.action === "task.visibility_changed");

  test("MAINTENANCE can promote MAINTENANCE_ONLY → MEMBERS, audit row written", async () => {
    signInAsRole("MAINTENANCE", MAINTAINER_ID);
    const { status, body } = await readJson(await patch(ADMIN_TASK.id, { visibility: "MEMBERS" }));

    expect(status).toBe(200);
    expect(body.visibility).toBe("MEMBERS");
    expect(prismaMock.maintenanceTask.update).toHaveBeenCalledWith({
      where: { id: ADMIN_TASK.id },
      data: { visibility: "MEMBERS" },
    });

    const audits = visibilityAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0].entityId).toBe(ADMIN_TASK.id);
    expect(audits[0].tenantId).toBe(TENANT_ID);
    expect(JSON.parse(audits[0].meta)).toMatchObject({ from: "MAINTENANCE_ONLY", to: "MEMBERS" });
  });

  test("USER (member) is forbidden", async () => {
    signInAsRole("USER", MEMBER_ID);
    const res = await patch(ADMIN_TASK.id, { visibility: "PUBLIC" });
    expect(res.status).toBe(403);
    expect(prismaMock.maintenanceTask.update).not.toHaveBeenCalled();
  });

  test("rejects invalid visibility value", async () => {
    signInAsRole("MAINTENANCE", MAINTAINER_ID);
    const res = await patch(ADMIN_TASK.id, { visibility: "WORLD" });
    expect(res.status).toBe(400);
    expect(prismaMock.maintenanceTask.update).not.toHaveBeenCalled();
  });

  test("404 for unknown task", async () => {
    signInAsRole("MAINTENANCE", MAINTAINER_ID);
    const res = await patch("nonexistent-id-xyz", { visibility: "MEMBERS" });
    expect(res.status).toBe(404);
  });

  test("forbids cross-tenant access", async () => {
    signInAsRole("TENANT_ADMIN", "other-admin", OTHER_TENANT_ID);
    const res = await patch(ADMIN_TASK.id, { visibility: "PUBLIC" });
    expect(res.status).toBe(403);
    expect(prismaMock.maintenanceTask.update).not.toHaveBeenCalled();
  });

  test("no-op when visibility unchanged returns 200 and writes no audit row", async () => {
    signInAsRole("MAINTENANCE", MAINTAINER_ID);
    const res = await patch(MAINTAINER_SELF_TASK.id, { visibility: "MAINTENANCE_ONLY" });

    expect(res.status).toBe(200);
    expect(prismaMock.maintenanceTask.update).not.toHaveBeenCalled();
    expect(visibilityAudits()).toHaveLength(0);
  });
});
