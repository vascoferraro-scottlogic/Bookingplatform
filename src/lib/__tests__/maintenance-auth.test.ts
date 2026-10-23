/**
 * Maintenance API — authorisation, lifecycle edits, assignment and input
 * validation (src/app/api/maintenance/route.ts, [id]/route.ts).
 *
 * Users, memberships and permission grants live in small in-memory tables
 * that the Prisma mock queries, so a fix may look the assignee up through
 * User or Membership and still be served the same facts.
 */
jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { Prisma, type Role } from "@prisma/client";
import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, routeParams } from "@/test-utils/http";
import { POST } from "@/app/api/maintenance/route";
import { PATCH } from "@/app/api/maintenance/[id]/route";

const TENANT = "tenant-1";
const OTHER_TENANT = "tenant-2";

type U = { id: string; role: Role; tenantId: string };
const ADMIN: U = { id: "admin-1", role: "TENANT_ADMIN", tenantId: TENANT };
const MAINT_1: U = { id: "maint-1", role: "MAINTENANCE", tenantId: TENANT };
const MAINT_2: U = { id: "maint-2", role: "MAINTENANCE", tenantId: TENANT };
const MEMBER: U = { id: "member-1", role: "USER", tenantId: TENANT };
const GRANTED_MEMBER: U = { id: "member-granted", role: "USER", tenantId: TENANT };
const FOREIGN_MAINT: U = { id: "foreign-maint", role: "MAINTENANCE", tenantId: OTHER_TENANT };
const USERS = [ADMIN, MAINT_1, MAINT_2, MEMBER, GRANTED_MEMBER, FOREIGN_MAINT];

const MEMBERSHIPS = USERS.map((u) => ({
  id: `ms-${u.id}`, userId: u.id, tenantId: u.tenantId, role: u.role, status: "ACTIVE", kind: "MEMBER",
}));
/** Explicit group grants: only GRANTED_MEMBER holds maintenance permissions via a group. */
const GRANTS: Record<string, string[]> = {
  [GRANTED_MEMBER.id]: ["maintenance_create", "maintenance_assign", "maintenance_close"],
};

const TASK_CATEGORIES = ["GENERAL", "RINK_SURFACE", "EQUIPMENT", "FACILITIES", "SAFETY", "GROUNDS", "OTHER", "PREVENTIVE"];
const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

// ── In-memory where evaluation ────────────────────────────

/** Evaluates the subset of Prisma `where` syntax used here against an in-memory row. */
function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "AND") return ([] as any[]).concat(cond).every((c) => matchesWhere(row, c));
    if (key === "OR") return (cond as any[]).some((c) => matchesWhere(row, c));
    if (key === "NOT") return !([] as any[]).concat(cond).some((c) => matchesWhere(row, c));
    if (row?.[key] === undefined && key.includes("_") && cond && typeof cond === "object") return matchesWhere(row, cond);
    return matchesValue(row?.[key], cond);
  });
}
const OPS = new Set(["equals", "in", "notIn", "not", "lt", "lte", "gt", "gte", "contains", "startsWith", "mode", "is", "isNot", "has"]);
function matchesValue(v: any, cond: any): boolean {
  if (cond === null) return v === null || v === undefined;
  if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
  if (typeof cond !== "object") return v === cond;
  if (Array.isArray(v)) {
    if ("some" in cond) return v.some((x) => matchesWhere(x, cond.some));
    if ("every" in cond) return v.every((x) => matchesWhere(x, cond.every));
    if ("none" in cond) return !v.some((x) => matchesWhere(x, cond.none));
  }
  const keys = Object.keys(cond);
  if (keys.length > 0 && keys.every((k) => OPS.has(k))) {
    return keys.every((op) => {
      const x = cond[op];
      switch (op) {
        case "equals": return matchesValue(v, x);
        case "in": return (x as any[]).includes(v);
        case "notIn": return !(x as any[]).includes(v);
        case "not": return !matchesValue(v, x);
        case "lt": return v != null && v < x;
        case "lte": return v != null && v <= x;
        case "gt": return v != null && v > x;
        case "gte": return v != null && v >= x;
        case "contains": return typeof v === "string" && v.includes(x);
        case "startsWith": return typeof v === "string" && v.startsWith(x);
        case "has": return Array.isArray(v) && v.includes(x);
        case "is": return x === null ? v == null : v != null && matchesWhere(v, x);
        case "isNot": return x === null ? v != null : v == null || !matchesWhere(v, x);
        default: return true;
      }
    });
  }
  if (v === null || v === undefined) return false;
  return matchesWhere(v, cond);
}

/** User rows carry their memberships so relation filters (memberships: { some }) work. */
const userRows = () => USERS.map((u) => ({ ...u, name: u.id, email: `${u.id}@example.test`, suspended: false, memberships: MEMBERSHIPS.filter((m) => m.userId === u.id) }));
/** Membership rows carry their user so relation filters (user: { role }) work. */
const membershipRows = () => MEMBERSHIPS.map((m) => ({ ...m, user: USERS.find((u) => u.id === m.userId) }));

function prismaValidationError(message: string) {
  return new Prisma.PrismaClientValidationError(message, { clientVersion: "test" });
}

let tasks: Record<string, any>;
const taskRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, tenantId: TENANT, title: `Task ${id}`, description: "desc", category: "GENERAL", priority: "MEDIUM",
  status: "SUBMITTED", submittedById: MEMBER.id, assignedToId: null, visibility: "MEMBERS",
  createdAt: new Date(), updatedAt: new Date(), ...overrides,
});

beforeEach(() => {
  tasks = {
    submitted: taskRow("submitted"),
    assigned: taskRow("assigned", { status: "ASSIGNED", assignedToId: MAINT_1.id }),
    inProgress: taskRow("inProgress", { status: "IN_PROGRESS", assignedToId: MAINT_1.id }),
  };

  // Directory lookups.
  const findUser = (async (a: any = {}) => userRows().find((u) => matchesWhere(u, a.where)) ?? null) as never;
  prismaMock.user.findUnique.mockImplementation(findUser);
  prismaMock.user.findFirst.mockImplementation(findUser);
  prismaMock.user.findMany.mockImplementation((async (a: any = {}) => userRows().filter((u) => matchesWhere(u, a.where))) as never);
  const findMembership = (async (a: any = {}) => membershipRows().find((m) => matchesWhere(m, a.where)) ?? null) as never;
  prismaMock.membership.findUnique.mockImplementation(findMembership);
  prismaMock.membership.findFirst.mockImplementation(findMembership);
  prismaMock.membership.findMany.mockImplementation((async (a: any = {}) => membershipRows().filter((m) => matchesWhere(m, a.where))) as never);

  // Group permission grants.
  prismaMock.groupMember.findFirst.mockImplementation((async ({ where }: any) => {
    const userId = where?.membership?.userId;
    const permission = where?.group?.grants?.some?.permission;
    return GRANTS[userId]?.includes(permission) ? { id: `gm-${userId}` } : null;
  }) as never);
  prismaMock.permissionGrant.findMany.mockResolvedValue([] as never);

  // Tasks: Prisma rejects values outside the enums.
  prismaMock.maintenanceTask.findUnique.mockImplementation((async ({ where }: any) => tasks[where.id] ?? null) as never);
  prismaMock.maintenanceTask.findFirst.mockImplementation((async ({ where }: any) =>
    Object.values(tasks).find((t) => matchesWhere(t, where)) ?? null) as never);
  prismaMock.maintenanceTask.create.mockImplementation((async ({ data }: any) => {
    if (data.category && !TASK_CATEGORIES.includes(data.category)) throw prismaValidationError(`Invalid value for argument \`category\``);
    if (data.priority && !TASK_PRIORITIES.includes(data.priority)) throw prismaValidationError(`Invalid value for argument \`priority\``);
    return { id: "new-task", status: "SUBMITTED", ...data };
  }) as never);
  prismaMock.maintenanceTask.update.mockImplementation((async ({ where, data }: any) => {
    if (data.priority && !TASK_PRIORITIES.includes(data.priority)) throw prismaValidationError(`Invalid value for argument \`priority\``);
    if (data.category && !TASK_CATEGORIES.includes(data.category)) throw prismaValidationError(`Invalid value for argument \`category\``);
    const { notes: _notes, ...rest } = data;
    return { ...tasks[where.id], ...rest };
  }) as never);
  prismaMock.taskNote.create.mockImplementation((async ({ data }: any) => ({ id: "note-1", createdAt: new Date(), ...data })) as never);
  prismaMock.notification.create.mockImplementation((async ({ data }: any) => ({ id: "n-1", ...data })) as never);
  prismaMock.auditEvent.create.mockResolvedValue({} as never);
});

const signIn = (u: U) => signInAs({ id: u.id, role: u.role, tenantId: u.tenantId });

/** Calls a handler, turning an uncaught throw into the 500 Next would send. */
async function call(fn: () => Promise<Response>) {
  try {
    return await readJson(await fn());
  } catch (e) {
    return { status: 500, body: { thrown: String(e) } as any };
  }
}

const submit = (body: Record<string, unknown>) =>
  call(() => POST(jsonRequest("POST", "/api/maintenance", body)));
const patch = (id: string, body: Record<string, unknown>) =>
  call(() => PATCH(jsonRequest("PATCH", `/api/maintenance/${id}`, body), routeParams({ id })));

const notificationsTo = (userId: string) =>
  prismaMock.notification.create.mock.calls.map(([a]) => (a as any).data).filter((d) => d.userId === userId);

/** A note recorded for `taskId`, either directly or nested in the task update. */
function notesFor(taskId: string): string[] {
  const direct = prismaMock.taskNote.create.mock.calls
    .map(([a]) => (a as any).data)
    .filter((d) => d.taskId === taskId || d.task?.connect?.id === taskId)
    .map((d) => String(d.text));
  const nested = prismaMock.maintenanceTask.update.mock.calls
    .map(([a]) => a as any)
    .filter((a) => a.where.id === taskId && a.data.notes?.create)
    .flatMap((a) => ([] as any[]).concat(a.data.notes.create))
    .map((n) => String(n.text));
  return [...direct, ...nested];
}

const validTask = { title: "Broken gate", description: "The side gate won't latch" };

// ── Dual gate ─────────────────────────────────────────────

describe("Maintenance API — dual gate (role OR permission)", () => {
  test("[B-18] FR-SEC-008 – a USER holding maintenance_create via a group can submit a task", async () => {
    signIn(GRANTED_MEMBER);

    const { status } = await submit(validTask);

    expect(status).toBe(201);
  });

  test("[B-18] FR-SEC-008 – a TENANT_ADMIN with no explicit grant can submit a task", async () => {
    signIn(ADMIN);

    const { status } = await submit(validTask);

    expect(status).toBe(201);
  });

  test("[B-18] FR-SEC-008 – a MAINTENANCE-role user with no explicit grant can submit a task (role suffices)", async () => {
    signIn(MAINT_1);

    const { status } = await submit(validTask);

    expect(status).toBe(201);
    expect(prismaMock.maintenanceTask.create).toHaveBeenCalled();
  });

  test("[B-18] FR-SEC-008 – a MAINTENANCE-role user with no explicit grant can close a task assigned to a colleague (role suffices)", async () => {
    signIn(MAINT_2);

    const { status } = await patch("inProgress", { status: "CLOSED" });

    expect(status).toBe(200);
    expect(prismaMock.maintenanceTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inProgress" }, data: expect.objectContaining({ status: "CLOSED" }) }),
    );
  });

  test("[B-18] FR-SEC-008 – a USER holding maintenance_close via a group can close a task assigned to someone else", async () => {
    signIn(GRANTED_MEMBER);

    const { status } = await patch("inProgress", { status: "CLOSED" });

    expect(status).toBe(200);
  });
});

// ── Lifecycle edits ───────────────────────────────────────

describe("PATCH /api/maintenance/[id] — lifecycle", () => {
  test("[B-61] FR-MNT-001 – editing priority with the status unchanged returns 200", async () => {
    signIn(ADMIN);

    const { status, body } = await patch("assigned", { priority: "HIGH" });

    expect(status).toBe(200);
    expect(body.priority).toBe("HIGH");
    expect(body.status).toBe("ASSIGNED");
  });

  test("[B-61] FR-MNT-001 – sending the current status alongside an edit is not a transition error", async () => {
    signIn(ADMIN);

    const { status, body } = await patch("inProgress", { status: "IN_PROGRESS", title: "Gate latch broken" });

    expect(status).toBe(200);
    expect(body.title).toBe("Gate latch broken");
  });

  test("[B-61] FR-MNT-001 – reassigning an ASSIGNED task to another maintainer returns 200", async () => {
    signIn(ADMIN);

    const { status, body } = await patch("assigned", { assignedToId: MAINT_2.id });

    expect(status).toBe(200);
    expect(body.assignedToId).toBe(MAINT_2.id);
    expect(body.status).toBe("ASSIGNED");
  });

  test("[B-61] FR-MNT-001 – a status change records a timestamped note on the task", async () => {
    signIn(ADMIN);

    const { status } = await patch("inProgress", { status: "CLOSED" });

    expect(status).toBe(200);
    // TaskNote.createdAt supplies the timestamp; the note names the new status.
    expect(notesFor("inProgress")).toEqual(expect.arrayContaining([expect.stringMatching(/closed/i)]));
  });
});

// ── Assignment ────────────────────────────────────────────

describe("PATCH /api/maintenance/[id] — assignment", () => {
  test("[B-60] D-11 – assigning to a maintainer of the tenant succeeds and notifies them", async () => {
    signIn(ADMIN);

    const { status, body } = await patch("submitted", { assignedToId: MAINT_1.id });

    expect(status).toBe(200);
    expect(body.assignedToId).toBe(MAINT_1.id);
    expect(notificationsTo(MAINT_1.id)).toHaveLength(1);
  });

  test("[B-60] D-11 – Assign with no assignee returns 400", async () => {
    signIn(ADMIN);

    const { status } = await patch("submitted", { status: "ASSIGNED" });

    expect(status).toBe(400);
    expect(prismaMock.maintenanceTask.update).not.toHaveBeenCalled();
  });

  test("[B-60] D-11 – assigning to a member without a maintenance role returns 400", async () => {
    signIn(ADMIN);

    const { status } = await patch("submitted", { assignedToId: MEMBER.id });

    expect(status).toBe(400);
    expect(prismaMock.maintenanceTask.update).not.toHaveBeenCalled();
    expect(notificationsTo(MEMBER.id)).toHaveLength(0);
  });

  test("[B-64] FR-TEN-003 – assigning to a user of another tenant returns 400 and notifies no one", async () => {
    signIn(ADMIN);

    const { status } = await patch("submitted", { assignedToId: FOREIGN_MAINT.id });

    expect(status).toBe(400);
    expect(prismaMock.maintenanceTask.update).not.toHaveBeenCalled();
    expect(notificationsTo(FOREIGN_MAINT.id)).toHaveLength(0);
  });
});

// ── Input validation ──────────────────────────────────────

describe("Maintenance API — enum validation", () => {
  test("[B-64] FR-TEN-003 – POST with an invalid category returns 400, not 500", async () => {
    signIn(ADMIN);

    const { status } = await submit({ ...validTask, category: "PLUMBING" });

    expect(status).toBe(400);
  });

  test("[B-64] FR-TEN-003 – POST with an invalid priority returns 400, not 500", async () => {
    signIn(ADMIN);

    const { status } = await submit({ ...validTask, priority: "CRITICAL" });

    expect(status).toBe(400);
  });

  test("[B-64] FR-TEN-003 – PATCH with an invalid priority returns 400, not 500", async () => {
    signIn(ADMIN);

    const { status } = await patch("inProgress", { status: "CLOSED", priority: "CRITICAL" });

    expect(status).toBe(400);
  });
});
