import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

let tenantId: string;
let userId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "Audit Test Club", slug: "audit-test-" + Date.now() },
  });
  tenantId = tenant.id;

  const user = await prisma.user.create({
    data: { email: `audit-${Date.now()}@test.com`, name: "Auditor", passwordHash: "x", role: "USER", tenantId },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { actorId: userId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

// Helper: logAudit is fire-and-forget, so we need a small wait then query the DB
async function waitForAudit(action: string) {
  await new Promise((r) => setTimeout(r, 100));
  return prisma.auditEvent.findFirst({
    where: { action, actorId: userId },
    orderBy: { timestamp: "desc" },
  });
}

// ── logAudit ──────────────────────────────────────────────

describe("logAudit", () => {
  test("creates an audit event in the DB", async () => {
    logAudit({
      session: { user: { id: userId, role: "USER", tenantId } },
      action: "test.created",
      entity: "Test",
      entityId: "e1",
    });

    const event = await waitForAudit("test.created");
    expect(event).not.toBeNull();
    expect(event!.action).toBe("test.created");
    expect(event!.entity).toBe("Test");
    expect(event!.entityId).toBe("e1");
    expect(event!.actorId).toBe(userId);
  });

  test("uses session tenantId by default", async () => {
    logAudit({
      session: { user: { id: userId, role: "USER", tenantId } },
      action: "test.sessionTenant",
      entity: "Test",
    });

    const event = await waitForAudit("test.sessionTenant");
    expect(event!.tenantId).toBe(tenantId);
  });

  test("explicit tenantId overrides session tenantId", async () => {
    // Use null as override to prove it takes explicit value over session
    logAudit({
      session: { user: { id: userId, role: "USER", tenantId } },
      action: "test.overrideTenant",
      entity: "Test",
      tenantId: null,
    });

    const event = await waitForAudit("test.overrideTenant");
    expect(event!.tenantId).toBeNull();
  });

  test("defaults piiAccess to false", async () => {
    logAudit({
      session: { user: { id: userId, role: "USER", tenantId } },
      action: "test.piiDefault",
      entity: "Test",
    });

    const event = await waitForAudit("test.piiDefault");
    expect(event!.piiAccess).toBe(false);
  });

  test("piiAccess can be set to true", async () => {
    logAudit({
      session: { user: { id: userId, role: "USER", tenantId } },
      action: "test.piiTrue",
      entity: "Test",
      piiAccess: true,
    });

    const event = await waitForAudit("test.piiTrue");
    expect(event!.piiAccess).toBe(true);
  });

  test("serializes meta as JSON string", async () => {
    logAudit({
      session: { user: { id: userId, role: "USER", tenantId } },
      action: "test.withMeta",
      entity: "Test",
      meta: { foo: "bar", count: 42 },
    });

    const event = await waitForAudit("test.withMeta");
    expect(event!.meta).toBe(JSON.stringify({ foo: "bar", count: 42 }));
  });

  test("meta is null when not provided", async () => {
    logAudit({
      session: { user: { id: userId, role: "USER", tenantId } },
      action: "test.noMeta",
      entity: "Test",
    });

    const event = await waitForAudit("test.noMeta");
    expect(event!.meta).toBeNull();
  });

  test("records actorRole from session", async () => {
    logAudit({
      session: { user: { id: userId, role: "TENANT_ADMIN", tenantId } },
      action: "test.adminRole",
      entity: "Test",
    });

    const event = await waitForAudit("test.adminRole");
    expect(event!.actorRole).toBe("TENANT_ADMIN");
  });
});
