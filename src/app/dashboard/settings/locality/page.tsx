import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import LocalityEditor from "@/components/settings/LocalityEditor";

type Sess = {
  user: {
    id: string;
    role: string;
    tenantId?: string | null;
    actingAs?: { tenantId: string; role: string } | null;
  };
} | null;

export default async function SettingsLocalityPage() {
  const session = (await getServerSession(authOptions)) as Sess;
  if (!session?.user) redirect("/auth/login");

  const acting = session.user.actingAs;
  const effectiveRole = acting?.role ?? session.user.role;
  const effectiveTenantId = acting?.tenantId ?? session.user.tenantId ?? null;

  if (effectiveRole !== "TENANT_ADMIN" && effectiveRole !== "PLATFORM_ADMIN") {
    redirect("/dashboard");
  }
  if (!effectiveTenantId) redirect("/dashboard");

  const t = await getTranslations("settings");

  return (
    <div className="space-y-4 max-w-2xl">
      <nav className="text-sm text-gray-500">
        <Link href="/dashboard/settings" className="hover:text-gray-700">
          {t("locality.breadcrumb")}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-700">{t("locality.title")}</span>
      </nav>
      <h1 className="text-2xl font-bold">{t("locality.title")}</h1>
      <p className="text-gray-600 text-sm">
        {t("locality.intro")}
      </p>
      <LocalityEditor tenantId={effectiveTenantId} />
    </div>
  );
}
