/**
 * Tests for maintenance PATCH authorization rules.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/api-utils", () => ({
  getSessionOrFail: jest.fn(),
  getEffective: jest.fn(),
  jsonError: jest.fn((m: string, s = 400) => ({ error: m, status: s })),
}));

jest.mock("@/lib/permissions", () => ({
  assertPermissionOrFail: jest.fn(),
  hasPermission: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    maintenanceTask: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/lib/notifications", () => ({ createNotification: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));

const { PATCH } = require("@/app/api/maintenance/[id]/route");

const apiUtils = jest.requireMock("@/lib/api-utils");
const perms = jest.requireMock("@/lib/permissions");
const prismaMock = jest.requireMock("@/lib/prisma");

beforeEach(() => {
  jest.resetAllMocks();
});

test("SUBMITTED -> ASSIGNED requires maintenance_assign and updates task when allowed", async () => {
  const task = { id: "task1", status: "SUBMITTED", tenantId: "t1", assignedToId: null, title: "Fix light", priority: "MEDIUM" };
  prismaMock.prisma.maintenanceTask.findUnique.mockResolvedValue(task);
  prismaMock.prisma.maintenanceTask.update.mockResolvedValue({ ...task, assignedToId: "maint1", status: "ASSIGNED" });

  apiUtils.getSessionOrFail.mockResolvedValue({ session: { user: { id: "user1", role: "USER", tenantId: "t1" } } });
  apiUtils.getEffective.mockReturnValue({ role: "USER", tenantId: "t1", isImpersonating: false, realUserId: "user1", realRole: "USER", impersonationId: null });

  perms.assertPermissionOrFail.mockResolvedValue(null);

  const req = { json: async () => ({ assignedToId: "maint1" }) } as unknown as NextRequest;
  const res = await PATCH(req, { params: Promise.resolve({ id: "task1" }) });

  expect(prismaMock.prisma.maintenanceTask.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "task1" }, data: expect.objectContaining({ assignedToId: "maint1", status: "ASSIGNED" }) }));
});

test("assigned user can start work (IN_PROGRESS) without extra permissions", async () => {
  const task = { id: "task2", status: "ASSIGNED", tenantId: "t1", assignedToId: "assignee1", title: "Fix door", priority: "HIGH" };
  prismaMock.prisma.maintenanceTask.findUnique.mockResolvedValue(task);
  prismaMock.prisma.maintenanceTask.update.mockResolvedValue({ ...task, status: "IN_PROGRESS" });

  apiUtils.getSessionOrFail.mockResolvedValue({ session: { user: { id: "assignee1", role: "USER", tenantId: "t1" } } });
  apiUtils.getEffective.mockReturnValue({ role: "USER", tenantId: "t1", isImpersonating: false, realUserId: "assignee1", realRole: "USER", impersonationId: null });

  perms.hasPermission.mockResolvedValue(false);

  const req = { json: async () => ({ status: "IN_PROGRESS" }) } as unknown as NextRequest;
  await PATCH(req, { params: Promise.resolve({ id: "task2" }) });

  expect(prismaMock.prisma.maintenanceTask.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "task2" }, data: expect.objectContaining({ status: "IN_PROGRESS" }) }));
});

test("non-assigned user cannot start work without maintenance_assign", async () => {
  const task = { id: "task3", status: "ASSIGNED", tenantId: "t1", assignedToId: "otherUser", title: "Fix gate", priority: "LOW" };
  prismaMock.prisma.maintenanceTask.findUnique.mockResolvedValue(task);
  prismaMock.prisma.maintenanceTask.update.mockResolvedValue({ ...task, status: "IN_PROGRESS" });

  apiUtils.getSessionOrFail.mockResolvedValue({ session: { user: { id: "userX", role: "USER", tenantId: "t1" } } });
  apiUtils.getEffective.mockReturnValue({ role: "USER", tenantId: "t1", isImpersonating: false, realUserId: "userX", realRole: "USER", impersonationId: null });

  perms.hasPermission.mockResolvedValue(false);

  const req = { json: async () => ({ status: "IN_PROGRESS" }) } as unknown as NextRequest;
  const res = await PATCH(req, { params: Promise.resolve({ id: "task3" }) });

  // Should not update
  expect(prismaMock.prisma.maintenanceTask.update).not.toHaveBeenCalled();
  // Server should have invoked the jsonError path for Forbidden
  expect(apiUtils.jsonError).toHaveBeenCalledWith("Forbidden", 403);
});
