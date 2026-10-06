import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/features";
import EventCard from "@/components/events/EventCard";
import { getTranslations } from "next-intl/server";

export default async function HomePage() {
  const t = await getTranslations("common");
  const session = await getServerSession(authOptions) as { user: { tenantId?: string | null; role?: string } } | null;
  const isAuthenticated = !!session?.user;

  // Fetch public clubs and global public events for the platform view.
  //
  // publicEvents + publicAvailability are TENANT_TOGGLABLE (#feature-management
  // category 1) → Postgres is authoritative, so they can be read/filtered directly.
  // publicContent is a PLATFORM flag (category 3) owned by Unleash post-cutover, so
  // it must be evaluated through the router rather than read from the now-advisory
  // FeatureFlag rows. We therefore fetch active tenants (with their Postgres public
  // flags) and SDK-eval publicContent per tenant in-memory.
  const today = new Date().toISOString().slice(0, 10);

  const activeTenants = await prisma.tenant.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      slug: true,
      brandColor: true,
      logoUrl: true,
      locality: true,
      featureFlags: {
        where: { key: { in: ["publicEvents", "publicAvailability"] }, enabled: true },
        select: { key: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const contentOn = await Promise.all(
    activeTenants.map((tnt) => isFeatureEnabled(tnt.id, "publicContent")),
  );

  // A club is listed if it has opted into any public surface: publicEvents /
  // publicAvailability (Postgres) or publicContent (Unleash).
  const publicClubs = activeTenants
    .filter((tnt, i) => tnt.featureFlags.length > 0 || contentOn[i])
    .map((tnt) => ({
      id: tnt.id,
      name: tnt.name,
      slug: tnt.slug,
      brandColor: tnt.brandColor,
      logoUrl: tnt.logoUrl,
      locality: tnt.locality,
    }));

  // Events surface from tenants with publicEvents on (tenant-togglable → Postgres).
  const publicTenantIds = activeTenants
    .filter((tnt) => tnt.featureFlags.some((f) => f.key === "publicEvents"))
    .map((tnt) => tnt.id);

  const publicEvents =
    publicTenantIds.length > 0
      ? await prisma.event.findMany({
          where: {
            tenantId: { in: publicTenantIds },
            status: "PUBLISHED",
            visibility: "PUBLIC",
            date: { gte: today },
            tenant: { active: true },
          },
          include: { tenant: { select: { name: true, slug: true, locality: true } } },
          orderBy: { date: "asc" },
          take: 6,
        })
      : [];

  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center p-8 py-16 bg-gradient-to-b from-green-50 to-white">
        <h1 className="text-4xl font-bold tracking-tight text-green-700">{t("home.title")}</h1>
        <p className="mt-4 text-lg text-gray-600">{t("home.subtitle")}</p>
        <div className="mt-8 flex gap-4">
          {isAuthenticated ? (
            <Link
              href="/dashboard"
              className="rounded-lg bg-green-600 px-6 py-3 text-white font-medium hover:bg-green-700"
            >
              {t("home.goToDashboard")}
            </Link>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="rounded-lg bg-green-600 px-6 py-3 text-white font-medium hover:bg-green-700"
              >
                {t("home.signIn")}
              </Link>
              <Link
                href="/auth/register"
                className="rounded-lg border border-green-600 px-6 py-3 text-green-700 font-medium hover:bg-green-50"
              >
                {t("home.register")}
              </Link>
              <Link
                href="/join"
                className="rounded-lg border border-green-600 px-6 py-3 text-green-700 font-medium hover:bg-green-50"
              >
                {t("home.addYourClub")}
              </Link>
            </>
          )}
        </div>
      </section>

      {/* Browse Clubs */}
      {publicClubs.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 py-12">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">{t("home.browseClubs")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {publicClubs.map((club) => (
              <Link
                key={club.id}
                href={`/${club.slug}`}
                className="flex items-center gap-4 rounded-lg border bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div
                  className="h-12 w-12 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold text-lg"
                  style={{ backgroundColor: club.brandColor }}
                >
                  {club.name.charAt(0)}
                </div>
                <span className="font-medium text-gray-800">{club.name}</span>
                {club.locality && <span className="text-xs text-gray-500 ml-1">{club.locality}</span>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Upcoming Public Events */}
      {publicEvents.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 py-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-800">{t("home.upcomingEvents")}</h2>
            <Link href="/events" className="text-green-600 hover:underline text-sm font-medium">
              {t("home.viewAll")}
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {publicEvents.map((ev) => (
              <Link key={ev.id} href={`/${ev.tenant.slug}`} className="block">
                <EventCard event={{ ...ev, tenantName: ev.tenant.name, tenantLocality: ev.tenant.locality }} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
