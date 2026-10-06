import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/features";
import PublicAvailabilityClient from "./client";
import { getTranslations } from "next-intl/server";

type Params = { params: Promise<{ slug: string }> };

export default async function PublicAvailabilityPage({ params }: Params) {
  const { slug } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
      select: { id: true, name: true, slug: true, active: true, brandColor: true, locality: true },
  });

  if (!tenant || !tenant.active) notFound();

  const flagOn = await isFeatureEnabled(tenant.id, "publicAvailability");
  if (!flagOn) notFound();

  const t = await getTranslations("common");

  return (
    <main className="min-h-screen">
      <header className="px-6 py-6 text-center" style={{ backgroundColor: tenant.brandColor }}>
        <Link href={`/${slug}`} className="text-white/80 hover:text-white text-sm">
          {t("club.backToClub", { name: tenant.name })}
        </Link>
        <h1 className="text-2xl font-bold text-white mt-2">{t("club.availabilityTitle", { name: tenant.name })}</h1>          {tenant.locality && <p className="text-white/80 text-sm mt-1">{tenant.locality}</p>}      </header>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <PublicAvailabilityClient slug={slug} />
      </div>
    </main>
  );
}
