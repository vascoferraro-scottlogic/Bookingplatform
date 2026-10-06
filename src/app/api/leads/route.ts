import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/api-utils";
import { sendEmail } from "@/lib/outbound";

// In-memory rate limit: max 5 submissions per IP per 10 minutes.
// Public endpoint, so cheap throttling is enough for v1.
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 5;
const rateMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX;
}

function isEmail(s: unknown): s is string {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * POST /api/leads — public lead capture for clubs requesting to join.
 *
 * Body: `{ clubName, contactName, contactEmail, contactPhone?, country, region?, notes? }`
 *
 * Side effects:
 *  - Creates a `TenantApplication` row in PENDING status.
 *  - Stubs an acknowledgement email to the applicant.
 *  - Stubs a notification email to all platform admins.
 */
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many submissions" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }

  const clubName = typeof body.clubName === "string" ? body.clubName.trim() : "";
  const contactName =
    typeof body.contactName === "string" ? body.contactName.trim() : "";
  const contactEmail =
    typeof body.contactEmail === "string"
      ? body.contactEmail.trim().toLowerCase()
      : "";
  const country = typeof body.country === "string" ? body.country.trim() : "";
  const contactPhone =
    typeof body.contactPhone === "string" ? body.contactPhone.trim() : null;
  const region =
    typeof body.region === "string" && body.region.trim() ? body.region.trim() : null;
  const notes =
    typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  if (!clubName) return jsonError("clubName is required");
  if (!contactName) return jsonError("contactName is required");
  if (!isEmail(contactEmail)) return jsonError("Valid contactEmail is required");
  if (!country) return jsonError("country is required");

  const application = await prisma.tenantApplication.create({
    data: {
      clubName,
      contactName,
      contactEmail,
      contactPhone,
      country,
      region,
      notes,
    },
  });

  // Acknowledgement to applicant (fire-and-forget; surface inspector if it fails).
  await sendEmail({
    to: contactEmail,
    subject: `We've received your application for ${clubName}`,
    template: "lead-acknowledgement",
    data: { contactName, clubName },
    relatedEntity: "TenantApplication",
    relatedEntityId: application.id,
  });

  // Notify all platform admins.
  const baseUrl = process.env.NEXTAUTH_URL ?? "";
  const queueUrl = `${baseUrl}/dashboard/platform/applications/${application.id}`;
  const platformAdmins = await prisma.user.findMany({
    where: { isPlatformAdmin: true },
    select: { email: true },
  });
  for (const admin of platformAdmins) {
    await sendEmail({
      to: admin.email,
      subject: `New club application: ${clubName}`,
      template: "new-lead-platform",
      data: {
        clubName,
        contactName,
        contactEmail,
        country,
        regionSuffix: region ? ` / ${region}` : "",
        notes: notes ?? "(none)",
        queueUrl,
      },
      relatedEntity: "TenantApplication",
      relatedEntityId: application.id,
    });
  }

  return NextResponse.json(
    { id: application.id, status: application.status },
    { status: 201 },
  );
}
