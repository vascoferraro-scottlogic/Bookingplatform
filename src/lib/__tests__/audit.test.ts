jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { logAudit } from "@/lib/audit";

const TENANT_ID = "tenant-1";
const USER_ID = "auditor";

beforeEach(() => {
  prismaMock.auditEvent.create.mockResolvedValue({} as never);
});

/** The `data` logAudit passed to auditEvent.create (it is called synchronously). */
function writtenEvent() {
  expect(prismaMock.auditEvent.create).toHaveBeenCalledTimes(1);
  return (prismaMock.auditEvent.create.mock.calls[0][0] as any).data;
}

// ── logAudit ──────────────────────────────────────────────

describe("logAudit", () => {
  test("creates an audit event", () => {
    logAudit({
      session: { user: { id: USER_ID, role: "USER", tenantId: TENANT_ID } },
      action: "test.created",
      entity: "Test",
      entityId: "e1",
    });

    const event = writtenEvent();
    expect(event.action).toBe("test.created");
    expect(event.entity).toBe("Test");
    expect(event.entityId).toBe("e1");
    expect(event.actorId).toBe(USER_ID);
  });

  test("uses session tenantId by default", () => {
    logAudit({
      session: { user: { id: USER_ID, role: "USER", tenantId: TENANT_ID } },
      action: "test.sessionTenant",
      entity: "Test",
    });

    expect(writtenEvent().tenantId).toBe(TENANT_ID);
  });

  test("explicit tenantId overrides session tenantId", () => {
    // Use null as override to prove it takes explicit value over session
    logAudit({
      session: { user: { id: USER_ID, role: "USER", tenantId: TENANT_ID } },
      action: "test.overrideTenant",
      entity: "Test",
      tenantId: null,
    });

    expect(writtenEvent().tenantId).toBeNull();
  });

  test("defaults piiAccess to false", () => {
    logAudit({
      session: { user: { id: USER_ID, role: "USER", tenantId: TENANT_ID } },
      action: "test.piiDefault",
      entity: "Test",
    });

    expect(writtenEvent().piiAccess).toBe(false);
  });

  test("piiAccess can be set to true", () => {
    logAudit({
      session: { user: { id: USER_ID, role: "USER", tenantId: TENANT_ID } },
      action: "test.piiTrue",
      entity: "Test",
      piiAccess: true,
    });

    expect(writtenEvent().piiAccess).toBe(true);
  });

  test("serializes meta as JSON string", () => {
    logAudit({
      session: { user: { id: USER_ID, role: "USER", tenantId: TENANT_ID } },
      action: "test.withMeta",
      entity: "Test",
      meta: { foo: "bar", count: 42 },
    });

    expect(writtenEvent().meta).toBe(JSON.stringify({ foo: "bar", count: 42 }));
  });

  test("meta is null when not provided", () => {
    logAudit({
      session: { user: { id: USER_ID, role: "USER", tenantId: TENANT_ID } },
      action: "test.noMeta",
      entity: "Test",
    });

    expect(writtenEvent().meta).toBeNull();
  });

  test("records actorRole from session", () => {
    logAudit({
      session: { user: { id: USER_ID, role: "TENANT_ADMIN", tenantId: TENANT_ID } },
      action: "test.adminRole",
      entity: "Test",
    });

    expect(writtenEvent().actorRole).toBe("TENANT_ADMIN");
  });

  test("records the real actor plus the impersonation context when acting as a tenant", () => {
    logAudit({
      session: {
        user: {
          id: "platform-admin",
          role: "PLATFORM_ADMIN",
          tenantId: null,
          actingAs: { tenantId: TENANT_ID, role: "TENANT_ADMIN", impersonationId: "imp-1", startedAt: new Date().toISOString() },
        },
      },
      action: "test.impersonated",
      entity: "Test",
    });

    expect(writtenEvent()).toMatchObject({
      actorId: "platform-admin",
      actorRole: "PLATFORM_ADMIN",
      tenantId: TENANT_ID,
      actingAsTenantId: TENANT_ID,
      actingAsRole: "TENANT_ADMIN",
      impersonationId: "imp-1",
    });
  });

  test("never throws when the write fails", async () => {
    prismaMock.auditEvent.create.mockRejectedValue(new Error("db down") as never);

    expect(() =>
      logAudit({
        session: { user: { id: USER_ID, role: "USER", tenantId: TENANT_ID } },
        action: "test.failure",
        entity: "Test",
      }),
    ).not.toThrow();
    // Let the rejected promise settle; an unhandled rejection would fail the test.
    await new Promise(setImmediate);
  });
});
