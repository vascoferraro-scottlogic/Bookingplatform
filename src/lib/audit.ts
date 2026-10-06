import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";
import type { ActingAsClaim } from "@/lib/roles";

interface AuditParams {
  session: {
    user: {
      id: string;
      role: Role;
      tenantId?: string | null;
      actingAs?: ActingAsClaim | null;
    };
  };
  action: string;
  entity: string;
  entityId?: string;
  piiAccess?: boolean;
  meta?: Record<string, unknown>;
  tenantId?: string | null;
}

/**
 * Log an audit event. Fire-and-forget — never throws.
 *
 * - `actorId` / `actorRole` always record the **real** authenticated user.
 *   Even when a platform admin is impersonating, the actor remains the
 *   platform admin, so traceability back to a real human is preserved.
 * - When the session has an `actingAs` claim, the impersonation columns
 *   (`actingAsTenantId`, `actingAsRole`, `impersonationId`) capture the
 *   assumed context. Audit UI should render these as
 *   "Jane Doe (PLATFORM_ADMIN acting as TENANT_ADMIN of Pollokshaws BC)".
 * - The `tenantId` of the row defaults to the impersonated tenant when
 *   impersonating, otherwise the user's own tenant. Callers may override.
 */
export function logAudit(params: AuditParams): void {
  const acting = params.session.user.actingAs ?? null;
  const defaultTenantId = acting?.tenantId ?? params.session.user.tenantId ?? null;
  const tenantId = params.tenantId !== undefined ? params.tenantId : defaultTenantId;

  prisma.auditEvent
    .create({
      data: {
        tenantId,
        actorId: params.session.user.id,
        actorRole: params.session.user.role,
        actingAsTenantId: acting?.tenantId ?? null,
        actingAsRole: acting?.role ?? null,
        impersonationId: acting?.impersonationId ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        piiAccess: params.piiAccess ?? false,
        meta: params.meta ? JSON.stringify(params.meta) : null,
      },
    })
    .catch(() => {
      // Audit failures must never break user flows
    });
}
