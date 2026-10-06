import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isFeatureEnabled } from "@/lib/features";
import { jsonError } from "@/lib/api-utils";

type Params = { params: Promise<{ slug: string }> };

/** GET — published content sections for a club. No auth required.
 *  Gated by `publicContent` feature flag. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, active: true },
  });

  if (!tenant || !tenant.active) {
    return jsonError("Not found", 404);
  }

  const flagOn = await isFeatureEnabled(tenant.id, "publicContent");
  if (!flagOn) return NextResponse.json([]);

  const sections = await prisma.contentSection.findMany({
    where: { tenantId: tenant.id, status: "PUBLISHED", enabled: true },
    orderBy: { order: "asc" },
    select: { id: true, type: true, title: true, content: true, order: true },
  });

  return NextResponse.json(sections);
}
