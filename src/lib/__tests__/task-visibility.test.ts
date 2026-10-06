import { prisma } from "@/lib/prisma";
import { TaskVisibility } from "@prisma/client";

// Locks the v2 visibility-default contract:
//  - Tasks created without explicitly setting `visibility` default to MAINTENANCE_ONLY
//    (the safe default for agent-derived tasks).
//  - Human-submitted tasks via POST /api/maintenance set MEMBERS explicitly
//    (covered by routes/integration tests; this file just covers the model default).
//  - Existing tasks predating the migration were backfilled to MEMBERS — verified
//    on real data in the migration; not covered here as it's a one-time data fix.
// See decisions log 2026-05-03 (member-message-derived tasks).

let tenantId: string;
let submitterId: string;
const taskIds: string[] = [];

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Visibility Test Club", slug: "vis-test-" + Date.now() },
  });
  tenantId = tenant.id;

  const submitter = await prisma.user.create({
    data: {
      email: `vis-sub-${Date.now()}@test.com`,
      name: "Submitter",
      passwordHash: "x",
      role: "USER",
      tenantId,
    },
  });
  submitterId = submitter.id;
});

afterAll(async () => {
  await prisma.maintenanceTask.deleteMany({ where: { id: { in: taskIds } } });
  await prisma.user.deleteMany({ where: { id: submitterId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("MaintenanceTask.visibility", () => {
  test("defaults to MAINTENANCE_ONLY when not specified (agent-derived path)", async () => {
    const task = await prisma.maintenanceTask.create({
      data: {
        tenantId,
        title: "agent-derived task",
        description: "from a message",
        submittedById: submitterId,
        // no visibility set
      },
    });
    taskIds.push(task.id);
    expect(task.visibility).toBe(TaskVisibility.MAINTENANCE_ONLY);
  });

  test("respects explicit MEMBERS when set (human-submitted path)", async () => {
    const task = await prisma.maintenanceTask.create({
      data: {
        tenantId,
        title: "human-submitted task",
        description: "from the form",
        submittedById: submitterId,
        visibility: TaskVisibility.MEMBERS,
      },
    });
    taskIds.push(task.id);
    expect(task.visibility).toBe(TaskVisibility.MEMBERS);
  });

  test("supports PUBLIC for course-closed-style announcements", async () => {
    const task = await prisma.maintenanceTask.create({
      data: {
        tenantId,
        title: "course closed",
        description: "frozen greens",
        submittedById: submitterId,
        visibility: TaskVisibility.PUBLIC,
      },
    });
    taskIds.push(task.id);
    expect(task.visibility).toBe(TaskVisibility.PUBLIC);
  });
});
