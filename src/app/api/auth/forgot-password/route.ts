import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/outbound";
import { normalizeEmail } from "@/lib/auth-rules";

// Identical for known and unknown emails so accounts can't be enumerated (NFR-05).
const RESPONSE = { message: "If the account exists, a reset link has been sent." };

/** Request a password reset. The token is only ever sent by email. */
export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email || typeof email !== "string") return NextResponse.json({ error: "Email required" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user) {
    return NextResponse.json(RESPONSE);
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // A new token replaces any older ones for this user.
  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await tx.passwordResetToken.create({ data: { token, userId: user.id, expiresAt } });
  });

  logAudit({ session: { user: { id: user.id, role: user.role, tenantId: user.tenantId } }, action: "auth.password_reset_request", entity: "User", entityId: user.id, tenantId: user.tenantId });

  const resetUrl = `${process.env.NEXTAUTH_URL ?? ""}/auth/reset-password?token=${token}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your password",
    template: "password-reset",
    data: { name: user.name ?? user.email, resetUrl },
    tenantId: user.tenantId,
    relatedEntity: "User",
    relatedEntityId: user.id,
  });

  return NextResponse.json(RESPONSE);
}
