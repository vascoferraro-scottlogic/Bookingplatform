import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/features";
import HeroSection from "@/components/content/HeroSection";
import AboutSection from "@/components/content/AboutSection";
import PhotoSection from "@/components/content/PhotoSection";
import MapSection from "@/components/content/MapSection";
import ContactSection from "@/components/content/ContactSection";
import EventCard from "@/components/events/EventCard";
import ClubNavBar from "@/components/ClubNavBar";
import UpcomingBookings from "@/components/home/UpcomingBookings";
import NotificationPreview from "@/components/home/NotificationPreview";
import QuickBookButton from "@/components/home/QuickBookButton";
import { getTranslations } from "next-intl/server";

const SECTION_COMPONENTS: Record<string, React.ComponentType<{ title: string; content: string }>> = {
  HERO: HeroSection,
  ABOUT: AboutSection,
  PHOTO: PhotoSection,
  MAP: MapSection,
  CONTACT: ContactSection,
};

type Params = { params: Promise<{ slug: string }> };

export default async function PublicClubPage({ params }: Params) {
  const { slug } = await params;
  const t = await getTranslations("common");

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: {
      id: true, name: true, slug: true, active: true, status: true,
      brandColor: true, logoUrl: true, locale: true, locality: true,
      openingTime: true, closingTime: true,
    },
  });

  if (!tenant) notFound();

  // ONBOARDING tenants get a friendly "coming soon" page rather than a 404 —
  // this happens if someone shares the URL before go-live (or stumbles on
  // the placeholder slug).
  if (!tenant.active) {
    if (tenant.status === "ONBOARDING") {
      return (
        <main className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
          <div className="max-w-md w-full bg-white rounded-2xl shadow p-8 text-center space-y-3">
            <div className="text-5xl">🛠️</div>
            <h1 className="text-2xl font-bold" style={{ color: tenant.brandColor }}>{tenant.name}</h1>
            <p className="text-gray-600">
              {t("club.comingSoon", { name: tenant.name })}
            </p>
          </div>
        </main>
      );
    }
    notFound();
  }

  // Check if the visitor is an authenticated member
  const session = (await getServerSession(authOptions)) as
    | { user: { role?: string; tenantId?: string | null; actingAs?: { role?: string; tenantId?: string } | null } }
    | null;
  const isAuthenticated = !!session?.user;
  const role = (session?.user as any)?.role;
  const acting = (session?.user as any)?.actingAs ?? null;
  // Effective admin gating: a platform admin only counts as admin while
  // impersonating a TENANT_ADMIN of THIS tenant.
  const effectiveRole = acting && acting.tenantId === tenant.id ? acting.role : role;
  const isAdmin = effectiveRole === "TENANT_ADMIN";

  // Fetch content sections — authenticated members always see them, guests need publicContent flag
  let sections: { id: string; type: string; title: string; content: string }[] = [];
  const showContent = isAuthenticated || await isFeatureEnabled(tenant.id, "publicContent");
  if (showContent) {
    sections = await prisma.contentSection.findMany({
      where: { tenantId: tenant.id, status: "PUBLISHED", enabled: true },
      orderBy: { order: "asc" },
      select: { id: true, type: true, title: true, content: true },
    });
  }

  // Fetch events — authenticated members see all published, guests see public only
  let events: { id: string; title: string; description: string; category: string; format: string | null; playerCount: string | null; date: string; startTime: string; endTime: string | null; location: string | null; capacity: number | null; entryFee: number | null; currency: string; imageUrl: string | null; visibility: string }[] = [];
  if (isAuthenticated) {
    const memberEventsOn = await isFeatureEnabled(tenant.id, "events");
    if (memberEventsOn) {
      const today = new Date().toISOString().slice(0, 10);
      events = await prisma.event.findMany({
        where: { tenantId: tenant.id, status: "PUBLISHED", date: { gte: today } },
        orderBy: { date: "asc" },
        take: 10,
        select: {
          id: true, title: true, description: true, category: true, format: true,
          playerCount: true, date: true, startTime: true, endTime: true, location: true,
          capacity: true, entryFee: true, currency: true, imageUrl: true, visibility: true,
        },
      });
    }
  } else {
    const eventsOn = await isFeatureEnabled(tenant.id, "publicEvents");
    if (eventsOn) {
      const today = new Date().toISOString().slice(0, 10);
      events = await prisma.event.findMany({
        where: {
          tenantId: tenant.id,
          status: "PUBLISHED",
          visibility: "PUBLIC",
          date: { gte: today },
        },
        orderBy: { date: "asc" },
        take: 10,
        select: {
          id: true, title: true, description: true, category: true, format: true,
          playerCount: true, date: true, startTime: true, endTime: true, location: true,
          capacity: true, entryFee: true, currency: true, imageUrl: true, visibility: true,
        },
      });
    }
  }

  // Check if availability is public
  const availabilityOn = await isFeatureEnabled(tenant.id, "publicAvailability");
  // Check if bookings capability is enabled for this org
  const bookingsOn = await isFeatureEnabled(tenant.id, "bookings");

  return (
    <main className="min-h-screen">
      {/* Auth nav bar for members */}
      {isAuthenticated && (
        <ClubNavBar clubName={tenant.name} slug={tenant.slug} brandColor={tenant.brandColor} isAdmin={isAdmin} />
      )}

      {/* Branded header */}
      <header className="px-6 py-8 text-center" style={{ backgroundColor: tenant.brandColor }}>
        {tenant.logoUrl && (
          <img src={tenant.logoUrl} alt={tenant.name} className="mx-auto h-16 mb-4" />
        )}
        <h1 className="text-3xl font-bold text-white">{tenant.name}</h1>
        {tenant.locality && <p className="text-white/80 text-sm mt-1">{tenant.locality}</p>}
      </header>

      {/* CMS content sections */}
      {sections.map((s) => {
        const Component = SECTION_COMPONENTS[s.type];
        return Component ? <Component key={s.id} title={s.title} content={s.content} /> : null;
      })}

      {/* Member widgets — bookings, notifications, quick book */}
      {isAuthenticated && bookingsOn && (
        <section className="max-w-6xl mx-auto px-4 py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <UpcomingBookings />
            <NotificationPreview />
            <QuickBookButton />
          </div>
        </section>
      )}
      {isAuthenticated && !bookingsOn && (
        <section className="max-w-6xl mx-auto px-4 py-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <NotificationPreview />
          </div>
        </section>
      )}

      {/* Public events */}
      {events.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 py-12">
          <h2 className="text-2xl font-bold text-gray-800 mb-6">{t("club.upcomingEvents")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {events.map((ev) => (
              <EventCard key={ev.id} event={ev} />
            ))}
          </div>
        </section>
      )}

      {/* Availability link */}
      {availabilityOn && (
        <section className="max-w-6xl mx-auto px-4 py-8 text-center">
          <Link
            href={`/${slug}/availability`}
            className="inline-block rounded-lg bg-green-600 px-6 py-3 text-white font-medium hover:bg-green-700"
          >
            {t("club.checkAvailability")}
          </Link>
        </section>
      )}

      {/* Join CTA — only for unauthenticated visitors */}
      {!isAuthenticated && (
        <section className="py-12 px-4 text-center bg-gray-50">
        <h2 className="text-2xl font-bold text-gray-800 mb-3">{t("club.joinTitle", { name: tenant.name })}</h2>
        <p className="text-gray-600 mb-6">{t("club.joinSubtitle")}</p>
        <div className="flex justify-center gap-4">
          <Link
            href={`/auth/register?club=${encodeURIComponent(slug)}`}
            className="rounded-lg bg-green-600 px-6 py-3 text-white font-medium hover:bg-green-700"
          >
            {t("home.register")}
          </Link>
          <Link
            href={`/auth/login?callbackUrl=${encodeURIComponent("/" + slug)}`}
            className="rounded-lg border border-green-600 px-6 py-3 text-green-700 font-medium hover:bg-green-50"
          >
            {t("home.signIn")}
          </Link>
        </div>
      </section>
      )}
    </main>
  );
}
