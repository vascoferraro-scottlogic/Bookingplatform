import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

/** Reset password using a valid token. */
export async function POST(req: NextRequest) {
  const { token, newPassword } = await req.json();
  if (!token || !newPassword) {
    return NextResponse.json({ error: "Token and new password required" }, { status: 400 });
  }

  const record = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!record || record.expiresAt < new Date()) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: record.userId }, data: { passwordHash } });

  // Invalidate token
  await prisma.passwordResetToken.delete({ where: { id: record.id } });

  // Look up user for audit context
  const user = await prisma.user.findUnique({ where: { id: record.userId }, select: { id: true, role: true, tenantId: true } });
  if (user) {
    logAudit({ session: { user: { id: user.id, role: user.role, tenantId: user.tenantId } }, action: "auth.password_reset_complete", entity: "User", entityId: user.id, tenantId: user.tenantId });
  }

  return NextResponse.json({ message: "Password updated" });
}
