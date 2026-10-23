import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { resolveActiveContext, isTenantBlocked } from "@/lib/memberships";
import { normalizeEmail } from "@/lib/auth-rules";

// Impersonations lapse 8 hours after they start (D-15).
const IMPERSONATION_MAX_MS = 8 * 60 * 60 * 1000;

/**
 * Validate an actingAs claim against its open Impersonation row (FR-SEC-004/006).
 * The claim is rebuilt from the row, never trusted as sent. Returns null when
 * the row is missing, belongs to someone else, has ended or is older than 8h.
 */
async function validateActingAs(claim: any, userId: string) {
  const id = claim && typeof claim === "object" ? claim.impersonationId : null;
  if (typeof id !== "string" || !id) return null;
  const row = await prisma.impersonation.findUnique({ where: { id }, include: { tenant: true } });
  if (!row || row.platformUserId !== userId || row.endedAt) return null;
  if (Date.now() - new Date(row.startedAt).getTime() > IMPERSONATION_MAX_MS) return null;
  return {
    tenantId: row.tenantId,
    tenantName: row.tenant?.name ?? claim.tenantName,
    tenantSlug: row.tenant?.slug ?? claim.tenantSlug,
    role: row.assumedRole,
    impersonationId: row.id,
    startedAt: new Date(row.startedAt).toISOString(),
  };
}

// On Vercel, VERCEL_URL is auto-set (without protocol). Use as fallback for NEXTAUTH_URL.
if ((!process.env.NEXTAUTH_URL || process.env.NEXTAUTH_URL.includes("example.com")) && process.env.VERCEL_URL) {
  process.env.NEXTAUTH_URL = `https://${process.env.VERCEL_URL}`;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: normalizeEmail(credentials.email) },
          include: { tenant: true, memberships: { include: { tenant: true } } },
        });
        if (!user) return null;

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;

        // Block login when the user's tenant is in a disciplinary state.
        // ACTIVE and ONBOARDING are both fine — onboarding admins MUST be
        // able to sign in to drive the wizard. SUSPENDED and CHURNED are
        // platform-disciplinary states and lock members out. Platform admins
        // have no tenant so this gate is skipped for them.
        if (user.tenant && (user.tenant.status === "SUSPENDED" || user.tenant.status === "CHURNED")) {
          return null;
        }

        // D-08: a user whose memberships are all in suspended/churned tenants
        // has no club to sign in to (platform admins have no memberships).
        const memberships = user.memberships ?? [];
        if (
          memberships.length > 0 &&
          !memberships.some((m) => m.status === "ACTIVE" && !isTenantBlocked(m.tenant?.status))
        ) {
          return null;
        }

        // Block login for suspended users
        if (user.suspended) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = (user as any).role;
        token.tenantId = (user as any).tenantId;
        token.actingAs = null;
        // Multi-club support: resolve the active tenant context from
        // memberships at sign-in time. Falls back to User.tenantId when the
        // user has no memberships yet (e.g. platform admin).
        const ctx = await resolveActiveContext((user as any).id, (user as any).tenantId ?? null);
        if (ctx.tenantId) {
          token.tenantId = ctx.tenantId;
          token.role = ctx.role;
        }
        token.activeTenantId = ctx.tenantId;
        token.locale = ctx.locale;
      }
      // Tenant switcher: client calls session.update({ activeTenantId: "..." })
      // to switch which membership is the active one.
      const switching = trigger === "update" && session && typeof session === "object" && "activeTenantId" in session;
      // Refresh role/tenant from Membership on every call so role changes and
      // suspensions take effect on live sessions (FR-SEC-006, D-08).
      if (!user && !switching && token.sub && token.role !== "PLATFORM_ADMIN") {
        const ctx = await resolveActiveContext(token.sub as string, (token.activeTenantId ?? token.tenantId ?? null) as string | null);
        if (ctx.tenantId) {
          token.tenantId = ctx.tenantId;
          token.role = ctx.role;
          token.activeTenantId = ctx.tenantId;
          token.locale = ctx.locale;
        }
      }
      if (switching) {
        const requested = (session as any).activeTenantId as string | null;
        const ctx = await resolveActiveContext(token.sub as string, requested);
        if (ctx.tenantId) {
          token.tenantId = ctx.tenantId;
          token.role = ctx.role;
          token.activeTenantId = ctx.tenantId;
          token.locale = ctx.locale;
        }
      }
      // The actingAs claim is only ever accepted when it matches an open
      // Impersonation row for this admin, and is re-validated on every call
      // so it drops when ended or after 8 hours (FR-SEC-004/006, D-15).
      if (token.role !== "PLATFORM_ADMIN") {
        token.actingAs = null;
      } else {
        const prev = token.actingAs as { impersonationId?: string } | null;
        const requested =
          trigger === "update" && session && typeof session === "object" && "actingAs" in session
            ? (session as any).actingAs ?? null
            : prev ?? null;
        token.actingAs = requested ? await validateActingAs(requested, token.sub as string) : null;
        // When the claim is cleared, close the impersonation record as a
        // backstop — the DELETE route should have done this already, but
        // guard against races and browser crashes.
        if (prev?.impersonationId && !token.actingAs) {
          prisma.impersonation.updateMany({
            where: { id: prev.impersonationId, platformUserId: token.sub as string, endedAt: null },
            data: { endedAt: new Date() },
          }).catch(() => {}); // fire-and-forget
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.sub;
        (session.user as any).role = token.role;
        (session.user as any).tenantId = token.tenantId;
        (session.user as any).activeTenantId = token.activeTenantId ?? token.tenantId ?? null;
        (session.user as any).actingAs = token.role === "PLATFORM_ADMIN" ? (token.actingAs ?? null) : null;
        (session.user as any).locale = token.locale ?? "en";
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      const u = user as any;
      if (u?.id && u?.role) {
        logAudit({ session: { user: { id: u.id, role: u.role, tenantId: u.tenantId ?? null } }, action: "auth.login", entity: "User", entityId: u.id, tenantId: u.tenantId ?? null });
      }
      // Belt-and-brace: close any dangling impersonation records for this
      // user on login. Handles the case where a prior session expired or the
      // browser was closed while impersonating.
      if (u?.id && u?.role === "PLATFORM_ADMIN") {
        await prisma.impersonation.updateMany({
          where: { platformUserId: u.id, endedAt: null },
          data: { endedAt: new Date() },
        });
      }
    },
  },
  pages: {
    signIn: "/auth/login",
  },
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
};
