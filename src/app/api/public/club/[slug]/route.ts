import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api-utils";

type Params = { params: Promise<{ slug: string }> };

/** GET — public tenant profile by slug. No auth required. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      active: true,
      brandColor: true,
      logoUrl: true,
      locale: true,
      seasonStart: true,
      seasonEnd: true,
      openingTime: true,
      closingTime: true,
    },
  });

  if (!tenant || !tenant.active) {
    return jsonError("Not found", 404);
  }

  return NextResponse.json(tenant);
}
