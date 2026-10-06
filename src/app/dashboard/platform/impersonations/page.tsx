import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDateTime } from "@/lib/format";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ImpersonationHistoryPage() {
  const session = (await getServerSession(authOptions)) as
    | { user: { id: string; role: string } }
    | null;
  const locale = await getLocale();
  const t = await getTranslations("admin");

  if (!session?.user) redirect("/auth/login");
  if (session.user.role !== "PLATFORM_ADMIN") redirect("/dashboard");

  const rows = await prisma.impersonation.findMany({
    orderBy: { startedAt: "desc" },
    take: 200,
    include: {
      platformUser: { select: { id: true, name: true, email: true } },
      tenant: { select: { id: true, name: true, slug: true } },
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("platform.impersonations.title")}</h1>
      <p className="text-sm text-gray-600">
        {t("platform.impersonations.subtitle")}
      </p>

      <div className="overflow-x-auto rounded-xl bg-white shadow">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-3 border-b">{t("platform.impersonations.platformAdmin")}</th>
              <th className="p-3 border-b">{t("platform.impersonations.tenant")}</th>
              <th className="p-3 border-b">{t("platform.impersonations.assumedRole")}</th>
              <th className="p-3 border-b">{t("platform.impersonations.started")}</th>
              <th className="p-3 border-b">{t("platform.impersonations.ended")}</th>
              <th className="p-3 border-b">{t("platform.impersonations.reason")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-gray-500">
                  {t("platform.impersonations.noRecords")}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="p-3">
                  {r.platformUser.name ?? r.platformUser.email}
                  <div className="text-xs text-gray-500">{r.platformUser.email}</div>
                </td>
                <td className="p-3">
                  {r.tenant.name}
                  <div className="text-xs text-gray-500">/{r.tenant.slug}</div>
                </td>
                <td className="p-3">{r.assumedRole}</td>
                <td className="p-3">{formatDateTime(r.startedAt, locale)}</td>
                <td className="p-3">
                  {r.endedAt ? (
                    formatDateTime(r.endedAt, locale)
                  ) : (
                    <span className="rounded bg-amber-100 text-amber-800 px-2 py-0.5 text-xs">{t("platform.impersonations.active")}</span>
                  )}
                </td>
                <td className="p-3 text-gray-600">{r.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
