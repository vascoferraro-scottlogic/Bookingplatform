import { Role } from "@prisma/client";
import type { ActingAsClaim } from "@/lib/roles";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: Role;
      tenantId: string | null;
      /** The currently-selected tenant for multi-club users. Mirrors `tenantId`. */
      activeTenantId?: string | null;
      /**
       * Set when a PLATFORM_ADMIN is currently impersonating a tenant.
       * Permission checks should consult `getEffectiveRole()` rather than
       * inspecting this directly.
       */
      actingAs?: ActingAsClaim | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: Role;
    tenantId: string | null;
    activeTenantId?: string | null;
    actingAs?: ActingAsClaim | null;
  }
}
