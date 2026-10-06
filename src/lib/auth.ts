import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { resolveActiveContext } from "@/lib/memberships";

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
          where: { email: credentials.email },
          include: { tenant: true },
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
      if (trigger === "update" && session && typeof session === "object" && "activeTenantId" in session) {
        const requested = (session as any).activeTenantId as string | null;
        const ctx = await resolveActiveContext(token.sub as string, requested);
        if (ctx.tenantId) {
          token.tenantId = ctx.tenantId;
          token.role = ctx.role;
          token.activeTenantId = ctx.tenantId;
          token.locale = ctx.locale;
        }
      }
      // Allow client/server to update the actingAs claim via session.update().
      // Only PLATFORM_ADMINs may carry an actingAs claim — defensively strip
      // it for any other role (cannot be used as a privilege escalation vector
      // because hasRole/getEffectiveRole only honour it when realRole is
      // PLATFORM_ADMIN, but we belt-and-brace here too).
      if (trigger === "update" && session && typeof session === "object" && "actingAs" in session) {
        if (token.role === "PLATFORM_ADMIN") {
          const prev = token.actingAs as { impersonationId?: string } | null;
          const next = (session as any).actingAs ?? null;
          token.actingAs = next;
          // When clearing actingAs, close the impersonation record as a
          // backstop — the DELETE route should have done this already, but
          // guard against races and browser crashes.
          if (prev?.impersonationId && !next) {
            prisma.impersonation.updateMany({
              where: { id: prev.impersonationId, platformUserId: token.sub as string, endedAt: null },
              data: { endedAt: new Date() },
            }).catch(() => {}); // fire-and-forget
          }
        } else {
          token.actingAs = null;
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
