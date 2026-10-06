import { resolveTenantId } from "@/lib/tenant";
import { NextRequest } from "next/server";

function mockRequest(url = "http://localhost/api/test"): NextRequest {
  return new NextRequest(url);
}

interface SessionOverrides {
  id?: string;
  tenantId?: string | null;
  role?: string;
  actingAs?: { tenantId: string; role: string; impersonationId: string; startedAt: string } | null;
}

function mockSession(overrides: SessionOverrides = {}) {
  return {
    user: {
      id: overrides.id ?? "u1",
      tenantId: "tenantId" in overrides ? overrides.tenantId! : "tenant-1",
      role: (overrides.role ?? "USER") as any,
      actingAs: overrides.actingAs ?? null,
    },
  };
}

describe("resolveTenantId", () => {
  test("regular user with tenantId succeeds", () => {
    const result = resolveTenantId(mockSession({ tenantId: "t1" }), mockRequest());
    expect(result).toEqual({ tenantId: "t1", error: null });
  });

  test("regular user without tenantId returns 400", async () => {
    const result = resolveTenantId(mockSession({ tenantId: null }), mockRequest());
    expect(result.tenantId).toBeNull();
    expect(result.error).toBeTruthy();
    const body = await result.error!.json();
    expect(body.error).toBe("No tenant context");
  });

  test("platform admin without impersonation returns 403 PLATFORM_ADMIN_NO_CONTEXT", async () => {
    const result = resolveTenantId(
      mockSession({ tenantId: null, role: "PLATFORM_ADMIN" }),
      mockRequest(),
    );
    expect(result.tenantId).toBeNull();
    expect(result.error!.status).toBe(403);
    const body = await result.error!.json();
    expect(body.error).toBe("PLATFORM_ADMIN_NO_CONTEXT");
  });

  test("platform admin while impersonating uses impersonated tenantId", () => {
    const result = resolveTenantId(
      mockSession({
        tenantId: null,
        role: "PLATFORM_ADMIN",
        actingAs: {
          tenantId: "acted-on",
          role: "TENANT_ADMIN",
          impersonationId: "imp-1",
          startedAt: new Date().toISOString(),
        },
      }),
      mockRequest(),
    );
    expect(result).toEqual({ tenantId: "acted-on", error: null });
  });

  test("?tenantId= query param is IGNORED (no cross-tenant override)", () => {
    const req = mockRequest("http://localhost/api/test?tenantId=override-t");
    const result = resolveTenantId(
      mockSession({
        tenantId: null,
        role: "PLATFORM_ADMIN",
        actingAs: {
          tenantId: "acted-on",
          role: "TENANT_ADMIN",
          impersonationId: "imp-1",
          startedAt: new Date().toISOString(),
        },
      }),
      req,
    );
    expect(result.tenantId).toBe("acted-on");
  });

  test("tenant admin uses session tenantId, ignores query param", () => {
    const req = mockRequest("http://localhost/api/test?tenantId=override-t");
    const result = resolveTenantId(
      mockSession({ tenantId: "session-t", role: "TENANT_ADMIN" }),
      req,
    );
    expect(result).toEqual({ tenantId: "session-t", error: null });
  });

  test("maintenance user with tenantId succeeds", () => {
    const result = resolveTenantId(
      mockSession({ tenantId: "m-tenant", role: "MAINTENANCE" }),
      mockRequest(),
    );
    expect(result).toEqual({ tenantId: "m-tenant", error: null });
  });
});
