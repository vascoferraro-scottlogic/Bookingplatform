import { hasRole, requireRole, getEffectiveRole, isPlatformAdmin, isTenantRole } from "@/lib/roles";

describe("hasRole — orthogonal model", () => {
  test("PLATFORM_ADMIN does NOT inherit tenant-plane roles", () => {
    expect(hasRole("PLATFORM_ADMIN", "GUEST")).toBe(false);
    expect(hasRole("PLATFORM_ADMIN", "USER")).toBe(false);
    expect(hasRole("PLATFORM_ADMIN", "MAINTENANCE")).toBe(false);
    expect(hasRole("PLATFORM_ADMIN", "TENANT_ADMIN")).toBe(false);
  });

  test("PLATFORM_ADMIN matches itself", () => {
    expect(hasRole("PLATFORM_ADMIN", "PLATFORM_ADMIN")).toBe(true);
  });

  test("Tenant-plane users do NOT match PLATFORM_ADMIN", () => {
    expect(hasRole("TENANT_ADMIN", "PLATFORM_ADMIN")).toBe(false);
    expect(hasRole("MAINTENANCE", "PLATFORM_ADMIN")).toBe(false);
    expect(hasRole("USER", "PLATFORM_ADMIN")).toBe(false);
    expect(hasRole("GUEST", "PLATFORM_ADMIN")).toBe(false);
  });

  test("USER cannot access TENANT_ADMIN", () => {
    expect(hasRole("USER", "TENANT_ADMIN")).toBe(false);
  });

  test("TENANT_ADMIN can access USER role", () => {
    expect(hasRole("TENANT_ADMIN", "USER")).toBe(true);
  });

  test("GUEST is the lowest tenant role", () => {
    expect(hasRole("GUEST", "USER")).toBe(false);
    expect(hasRole("GUEST", "GUEST")).toBe(true);
  });

  test("MAINTENANCE is above USER below TENANT_ADMIN", () => {
    expect(hasRole("MAINTENANCE", "USER")).toBe(true);
    expect(hasRole("MAINTENANCE", "TENANT_ADMIN")).toBe(false);
  });
});

describe("requireRole", () => {
  test("throws when role is insufficient", () => {
    expect(() => requireRole("USER", "TENANT_ADMIN")).toThrow("Requires at least TENANT_ADMIN role");
  });

  test("throws when PLATFORM_ADMIN tries to satisfy a tenant gate", () => {
    expect(() => requireRole("PLATFORM_ADMIN", "TENANT_ADMIN")).toThrow();
  });

  test("does not throw when role matches", () => {
    expect(() => requireRole("TENANT_ADMIN", "TENANT_ADMIN")).not.toThrow();
    expect(() => requireRole("PLATFORM_ADMIN", "PLATFORM_ADMIN")).not.toThrow();
  });
});

describe("isPlatformAdmin / isTenantRole", () => {
  test("isPlatformAdmin true only for PLATFORM_ADMIN", () => {
    expect(isPlatformAdmin("PLATFORM_ADMIN")).toBe(true);
    expect(isPlatformAdmin("TENANT_ADMIN")).toBe(false);
    expect(isPlatformAdmin("USER")).toBe(false);
  });

  test("isTenantRole false for PLATFORM_ADMIN, true for tenant roles", () => {
    expect(isTenantRole("PLATFORM_ADMIN")).toBe(false);
    expect(isTenantRole("TENANT_ADMIN")).toBe(true);
    expect(isTenantRole("MAINTENANCE")).toBe(true);
    expect(isTenantRole("USER")).toBe(true);
    expect(isTenantRole("GUEST")).toBe(true);
  });
});

describe("getEffectiveRole", () => {
  test("tenant user: effective role and tenant match real values", () => {
    const eff = getEffectiveRole({ id: "u1", role: "TENANT_ADMIN", tenantId: "t1" });
    expect(eff.role).toBe("TENANT_ADMIN");
    expect(eff.tenantId).toBe("t1");
    expect(eff.isImpersonating).toBe(false);
    expect(eff.realRole).toBe("TENANT_ADMIN");
    expect(eff.realUserId).toBe("u1");
    expect(eff.impersonationId).toBeNull();
  });

  test("platform admin (no impersonation): no tenant context", () => {
    const eff = getEffectiveRole({ id: "p1", role: "PLATFORM_ADMIN", tenantId: null });
    expect(eff.role).toBe("PLATFORM_ADMIN");
    expect(eff.tenantId).toBeNull();
    expect(eff.isImpersonating).toBe(false);
  });

  test("platform admin while impersonating: assumes tenant role + tenant", () => {
    const eff = getEffectiveRole({
      id: "p1",
      role: "PLATFORM_ADMIN",
      tenantId: null,
      actingAs: {
        tenantId: "t-acted",
        role: "TENANT_ADMIN",
        impersonationId: "imp-1",
        startedAt: new Date().toISOString(),
      },
    });
    expect(eff.role).toBe("TENANT_ADMIN");
    expect(eff.tenantId).toBe("t-acted");
    expect(eff.isImpersonating).toBe(true);
    expect(eff.realRole).toBe("PLATFORM_ADMIN");
    expect(eff.realUserId).toBe("p1");
    expect(eff.impersonationId).toBe("imp-1");
  });
});
