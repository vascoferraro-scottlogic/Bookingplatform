import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { passwordRuleError } from "@/lib/auth-rules";

/** Reset password using a valid, single-use token. Accepts `password` (or the legacy `newPassword`). */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const token = body.token;
  const newPassword = body.password ?? body.newPassword;
  if (!token || !newPassword || typeof token !== "string") {
    return NextResponse.json({ error: "Token and new password required" }, { status: 400 });
  }
  const ruleError = passwordRuleError(newPassword);
  if (ruleError) return NextResponse.json({ error: ruleError }, { status: 400 });

  const record = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!record || record.expiresAt < new Date()) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  // Consume the token and change the password in one transaction. deleteMany
  // returns a count, so of two concurrent requests only one wins the token.
  const consumed = await prisma.$transaction(async (tx) => {
    const { count } = await tx.passwordResetToken.deleteMany({ where: { token, expiresAt: { gt: new Date() } } });
    if (count !== 1) return false;
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash, passwordChangedAt: new Date() } });
    // Any other outstanding tokens for this user are now void too.
    await tx.passwordResetToken.deleteMany({ where: { userId: record.userId } });
    return true;
  });
  if (!consumed) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
  }

  // Look up user for audit context
  const user = await prisma.user.findUnique({ where: { id: record.userId }, select: { id: true, role: true, tenantId: true } });
  if (user) {
    logAudit({ session: { user: { id: user.id, role: user.role, tenantId: user.tenantId } }, action: "auth.password_reset_complete", entity: "User", entityId: user.id, tenantId: user.tenantId });
  }

  return NextResponse.json({ message: "Password updated" });
}
