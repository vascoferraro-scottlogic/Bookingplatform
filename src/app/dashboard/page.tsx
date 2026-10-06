import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import TenantPicker from "@/components/platform/TenantPicker";

export default async function DashboardPage() {
  const session = (await getServerSession(authOptions)) as
    | {
        user: {
          id: string;
          name?: string | null;
          email: string;
          role: string;
          tenantId?: string | null;
          actingAs?: { tenantId: string; tenantSlug: string; impersonationId: string } | null;
        };
      }
    | null;

  if (!session?.user) redirect("/auth/login");

  // Members of a tenant — straight to their club homepage, unless they're a
  // TENANT_ADMIN of an incomplete tenant (then off to the onboarding wizard).
  if (session.user.tenantId) {
    if (session.user.role === "TENANT_ADMIN" || session.user.role === "PLATFORM_ADMIN") {
      const progress = await prisma.onboardingProgress.findUnique({
        where: { tenantId: session.user.tenantId },
        select: { completedAt: true },
      });
      if (progress && !progress.completedAt) {
        redirect("/onboarding");
      }
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.user.tenantId },
      select: { slug: true },
    });
    if (tenant) redirect("/" + tenant.slug);
  }

  // Platform admin: only auto-redirect to the club homepage if the session's
  // impersonation claim is still backed by an OPEN row in the DB. A stale JWT
  // (e.g. user closed the tab without clicking "Exit") would otherwise yank
  // them into a tenant they didn't just pick — show the picker instead.
  let staleImpersonation = false;
  if (session.user.role === "PLATFORM_ADMIN" && session.user.actingAs) {
    const row = await prisma.impersonation.findUnique({
      where: { id: session.user.actingAs.impersonationId },
      select: { endedAt: true, platformUserId: true },
    });
    const isOpen = !!row && row.endedAt === null && row.platformUserId === session.user.id;
    if (isOpen) {
      redirect("/" + session.user.actingAs.tenantSlug);
    }
    staleImpersonation = true;
  }

  // Platform admin (no tenant, not impersonating) — show the impersonation picker.
  const tenants = await prisma.tenant.findMany({
    where: { status: { in: ["ACTIVE", "ONBOARDING"] } },
    select: { id: true, name: true, slug: true, brandColor: true, status: true },
    orderBy: { name: "asc" },
  });

  const t = await getTranslations("common");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("platformDashboard.title")}</h1>
        <p className="mt-2 text-gray-600">
          {t("platformDashboard.welcome", { name: session.user.name ?? session.user.email })}
        </p>
        {staleImpersonation && (
          <p className="mt-2 rounded bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            {t("impersonation.staleSession")}
          </p>
        )}
      </div>
      <TenantPicker tenants={tenants} clearStaleClaim={staleImpersonation} />
    </div>
  );
}
