import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

let mockSessionReturn: any;

jest.mock("@/lib/api-utils", () => {
  const actual = jest.requireActual("@/lib/api-utils");
  return {
    ...actual,
    getSessionOrFail: jest.fn(() => Promise.resolve(mockSessionReturn)),
  };
});

import { GET } from "@/app/api/insights/operations/route";

const stamp = Date.now();
const cleanup: { tenantIds: string[]; userIds: string[]; taskIds: string[]; eventIds: string[] } = {
  tenantIds: [],
  userIds: [],
  taskIds: [],
  eventIds: [],
};

let tenantId: string;
let adminId: string;

function adminSession(tid: string, uid: string) {
  return {
    session: {
      user: {
        id: uid,
        email: "ops-admin@test.com",
        name: "Ops Admin",
        role: "TENANT_ADMIN",
        tenantId: tid,
        actingAs: null,
      },
    },
  };
}

function getReq(params?: Record<string, string>) {
  const sp = new URLSearchParams(params);
  return new NextRequest(`http://localhost/api/insights/operations?${sp.toString()}`);
}

beforeAll(async () => {
  const t = await prisma.tenant.create({
    data: { name: `Ops Club ${stamp}`, slug: `ops-${stamp}`, status: "ACTIVE", active: true },
  });
  tenantId = t.id;
  cleanup.tenantIds.push(t.id);

  await prisma.featureFlag.upsert({
    where: { tenantId_key: { tenantId, key: "businessInsights" } },
    update: { enabled: true },
    create: { tenantId, key: "businessInsights", enabled: true },
  });

  const admin = await prisma.user.create({
    data: { email: `ops-admin-${stamp}@test.com`, name: "Ops Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId },
  });
  adminId = admin.id;
  cleanup.userIds.push(admin.id);

  // Tasks: 1 closed (GENERAL/HIGH), 1 open (RINK_SURFACE/MEDIUM), 1 closed (SAFETY/URGENT)
  const t1 = await prisma.maintenanceTask.create({
    data: {
      tenantId,
      title: "Fix door",
      description: "Broken latch",
      category: "GENERAL",
      priority: "HIGH",
      status: "CLOSED",
      submittedById: admin.id,
    },
  });
  cleanup.taskIds.push(t1.id);

  const t2 = await prisma.maintenanceTask.create({
    data: {
      tenantId,
      title: "Resurface rink 2",
      description: "Worn patches",
      category: "RINK_SURFACE",
      priority: "MEDIUM",
      status: "SUBMITTED",
      submittedById: admin.id,
    },
  });
  cleanup.taskIds.push(t2.id);

  const t3 = await prisma.maintenanceTask.create({
    data: {
      tenantId,
      title: "Loose railing",
      description: "Wobbly",
      category: "SAFETY",
      priority: "URGENT",
      status: "CLOSED",
      submittedById: admin.id,
    },
  });
  cleanup.taskIds.push(t3.id);

  // Events: 1 published future, 1 draft future, 1 published past
  const today = new Date();
  const future = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const past = new Date(today.getTime() - 3 * 86400000).toISOString().slice(0, 10);

  const e1 = await prisma.event.create({
    data: {
      tenantId,
      title: "Open Day",
      description: "Come try bowling",
      category: "OPEN_DAY",
      date: future,
      startTime: "10:00",
      status: "PUBLISHED",
      createdById: admin.id,
    },
  });
  cleanup.eventIds.push(e1.id);

  const e2 = await prisma.event.create({
    data: {
      tenantId,
      title: "League Night",
      description: "Weekly league",
      category: "LEAGUE",
      date: future,
      startTime: "18:00",
      status: "DRAFT",
      createdById: admin.id,
    },
  });
  cleanup.eventIds.push(e2.id);

  const e3 = await prisma.event.create({
    data: {
      tenantId,
      title: "Past Tournament",
      description: "Done",
      category: "TOURNAMENT",
      date: past,
      startTime: "09:00",
      status: "PUBLISHED",
      createdById: admin.id,
    },
  });
  cleanup.eventIds.push(e3.id);
});

afterAll(async () => {
  await prisma.maintenanceTask.deleteMany({ where: { id: { in: cleanup.taskIds } } });
  await prisma.event.deleteMany({ where: { id: { in: cleanup.eventIds } } });
  await prisma.featureFlag.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.user.updateMany({ where: { tenantId: { in: cleanup.tenantIds } }, data: { tenantId: null } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: cleanup.tenantIds } } });
  await prisma.$disconnect();
});

describe("/api/insights/operations", () => {
  beforeEach(() => {
    mockSessionReturn = adminSession(tenantId, adminId);
  });

  test("returns 401 when not authenticated", async () => {
    const { NextResponse: NR } = await import("next/server");
    mockSessionReturn = { error: NR.json({ error: "Unauthorized" }, { status: 401 }) };
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin user", async () => {
    mockSessionReturn = {
      session: {
        user: { id: adminId, email: "user@test.com", name: "User", role: "USER", tenantId, actingAs: null },
      },
    };
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });

  test("returns task stats", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.tasks.total).toBe(3);
    expect(body.tasks.closed).toBe(2);
    expect(body.tasks.completionRate).toBe(67); // 2/3
    expect(body.tasks.avgDaysToClose).toBeGreaterThanOrEqual(0);
  });

  test("returns tasks by category", async () => {
    const res = await GET(getReq());
    const body = await res.json();

    const categories = body.tasks.byCategory.map((c: any) => c.category);
    expect(categories).toContain("GENERAL");
    expect(categories).toContain("RINK_SURFACE");
    expect(categories).toContain("SAFETY");
  });

  test("returns tasks by priority", async () => {
    const res = await GET(getReq());
    const body = await res.json();

    const priorities = body.tasks.byPriority.map((p: any) => p.priority);
    expect(priorities).toContain("HIGH");
    expect(priorities).toContain("MEDIUM");
    expect(priorities).toContain("URGENT");
  });

  test("returns event stats", async () => {
    const res = await GET(getReq());
    const body = await res.json();

    expect(body.events.total).toBe(3);
    expect(body.events.published).toBe(2); // open day + past tournament
    expect(body.events.upcoming).toBeGreaterThanOrEqual(1); // at least open day
  });

  test("returns events by category", async () => {
    const res = await GET(getReq());
    const body = await res.json();

    const categories = body.events.byCategory.map((c: any) => c.category);
    expect(categories).toContain("OPEN_DAY");
    expect(categories).toContain("LEAGUE");
    expect(categories).toContain("TOURNAMENT");
  });

  test("cross-tenant isolation", async () => {
    const other = await prisma.tenant.create({
      data: { name: `Other Ops ${stamp}`, slug: `other-ops-${stamp}`, status: "ACTIVE", active: true },
    });
    cleanup.tenantIds.push(other.id);

    const otherAdmin = await prisma.user.create({
      data: { email: `other-ops-${stamp}@test.com`, name: "Other Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId: other.id },
    });
    cleanup.userIds.push(otherAdmin.id);

    await prisma.featureFlag.upsert({
      where: { tenantId_key: { tenantId: other.id, key: "businessInsights" } },
      update: { enabled: true },
      create: { tenantId: other.id, key: "businessInsights", enabled: true },
    });

    mockSessionReturn = adminSession(other.id, otherAdmin.id);
    const res = await GET(getReq());
    const body = await res.json();

    expect(body.tasks.total).toBe(0);
    expect(body.tasks.closed).toBe(0);
    expect(body.events.total).toBe(0);
  });
});
