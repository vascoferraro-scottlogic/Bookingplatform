import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating, jsonError } from "@/lib/api-utils";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/applications/[id]/invitation
 *
 * Returns the pending invitation(s) for the tenant linked to this
 * application, so a platform admin can copy the accept-link out-of-band
 * (since outbound is stubbed and nothing is actually delivered).
 *
 * Returns `{ invitations: [...] }` with the absolute accept URL included.
 * Returns 404 if the application has not been approved yet.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const { id } = await params;
  const app = await prisma.tenantApplication.findUnique({
    where: { id },
    select: { tenantId: true },
  });
  if (!app) return jsonError("Application not found", 404);
  if (!app.tenantId) return jsonError("Application has not been approved yet", 404);

  const invitations = await prisma.userInvitation.findMany({
    where: { tenantId: app.tenantId },
    orderBy: { createdAt: "desc" },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? "";
  return NextResponse.json({
    invitations: invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      status: inv.status,
      expiresAt: inv.expiresAt,
      acceptedAt: inv.acceptedAt,
      createdAt: inv.createdAt,
      acceptUrl: `${baseUrl}/invite/${inv.token}`,
    })),
  });
}
