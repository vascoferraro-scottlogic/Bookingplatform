import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import { getTranslations } from "next-intl/server";
import { isFeatureEnabled } from "@/lib/features";

type Sess = {
  user: {
    id: string;
    role: string;
    tenantId?: string | null;
    actingAs?: { tenantId: string; role: string } | null;
  };
} | null;

export default async function SettingsPage() {
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
  const fedEnabled = await isFeatureEnabled(effectiveTenantId, "federation");

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-gray-600 text-sm">
        {t("intro")}
      </p>
      <ul className="divide-y rounded-xl border bg-white">
        <li>
          <Link
            href="/dashboard/settings/locality"
            className="flex items-center justify-between px-4 py-4 hover:bg-gray-50"
          >
            <div>
              <p className="font-medium text-gray-900">{t("locality.label")}</p>
              <p className="text-sm text-gray-500">
                {t("locality.description")}
              </p>
            </div>
            <span className="text-emerald-700 text-sm">{t("edit")}</span>
          </Link>
        </li>
        <li>
          <Link
            href="/dashboard/settings/location"
            className="flex items-center justify-between px-4 py-4 hover:bg-gray-50"
          >
            <div>
              <p className="font-medium text-gray-900">{t("location.label")}</p>
              <p className="text-sm text-gray-500">
                {t("location.description")}
              </p>
            </div>
            <span className="text-emerald-700 text-sm">{t("edit")}</span>
          </Link>
        </li>
        <li>
          <Link
            href="/dashboard/settings/groups"
            className="flex items-center justify-between px-4 py-4 hover:bg-gray-50"
          >
            <div>
              <p className="font-medium text-gray-900">Permission Groups</p>
              <p className="text-sm text-gray-500">
                Manage who can do what — assign members to groups with specific permissions.
              </p>
            </div>
            <span className="text-emerald-700 text-sm">{t("edit")}</span>
          </Link>
        </li>
        {fedEnabled && (
          <li>
            <Link
              href="/dashboard/federation"
              className="flex items-center justify-between px-4 py-4 hover:bg-gray-50"
            >
              <div>
                <p className="font-medium text-gray-900">{t("federation.label")}</p>
                <p className="text-sm text-gray-500">
                  {t("federation.description")}
                </p>
              </div>
              <span className="text-emerald-700 text-sm">{t("edit")}</span>
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
