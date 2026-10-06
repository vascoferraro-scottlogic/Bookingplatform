import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateTime } from "@/lib/format";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function PlatformOverviewPage() {
  const session = (await getServerSession(authOptions)) as
    | { user: { id: string; role: string } }
    | null;
  const locale = await getLocale();
  const t = await getTranslations("admin");

  if (!session?.user) redirect("/auth/login");
  if (session.user.role !== "PLATFORM_ADMIN") redirect("/dashboard");

  const [tenantCount, activeTenants, openImpersonations, recentImpersonations] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { active: true } }),
    prisma.impersonation.count({ where: { endedAt: null } }),
    prisma.impersonation.findMany({
      orderBy: { startedAt: "desc" },
      take: 5,
      include: {
        platformUser: { select: { name: true, email: true } },
        tenant: { select: { name: true, slug: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("platform.overview.title")}</h1>
        <p className="text-sm text-gray-600">
          Manage tenants, payments and platform-wide concerns. To act on behalf of a club, start
          an impersonation from the <Link href="/dashboard" className="underline">main dashboard</Link>.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card label={t("platform.overview.tenants")} value={tenantCount} href="/dashboard/platform/tenants" />
        <Card label={t("platform.overview.activeTenants")} value={activeTenants} />
        <Card label={t("platform.overview.openImpersonations")} value={openImpersonations} href="/dashboard/platform/impersonations" />
      </div>

      <section className="rounded-xl bg-white p-6 shadow">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">{t("platform.overview.recentImpersonations")}</h2>
          <Link href="/dashboard/platform/impersonations" className="text-sm text-blue-600 hover:underline">
            {t("platform.overview.viewAll")}
          </Link>
        </div>
        {recentImpersonations.length === 0 ? (
          <p className="text-sm text-gray-500">{t("platform.overview.noImpersonations")}</p>
        ) : (
          <ul className="divide-y">
            {recentImpersonations.map((imp) => (
              <li key={imp.id} className="py-2 text-sm flex items-center justify-between">
                <span>
                  <strong>{imp.platformUser.name ?? imp.platformUser.email}</strong> →{" "}
                  {imp.tenant.name}
                </span>
                <span className="text-xs text-gray-500">
                  {imp.endedAt ? "ended" : "active"} · {formatDateTime(imp.startedAt, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Card({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <div className="rounded-xl bg-white p-6 shadow hover:shadow-md transition">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
