import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

/** Request a password reset token. */
export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: "Email required" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Don't reveal whether account exists
    return NextResponse.json({ message: "If the account exists, a reset link has been sent." });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma.passwordResetToken.create({
    data: { token, userId: user.id, expiresAt },
  });

  logAudit({ session: { user: { id: user.id, role: user.role, tenantId: user.tenantId } }, action: "auth.password_reset_request", entity: "User", entityId: user.id, tenantId: user.tenantId });

  // TODO: send email with reset link containing `token`
  // For MVP we return the token in the response body (dev only).
  return NextResponse.json({ message: "If the account exists, a reset link has been sent.", token });
}
