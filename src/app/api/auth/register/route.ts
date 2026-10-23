import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { isValidEmail, normalizeEmail, passwordRuleError } from "@/lib/auth-rules";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { password, name, tenantSlug } = body;

  if (!body.email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  // Emails are stored and compared in lower case (D-16).
  const email = normalizeEmail(String(body.email));
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }
  const ruleError = passwordRuleError(password);
  if (ruleError) return NextResponse.json({ error: ruleError }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email already registered" }, { status: 409 });
  }

  let tenantId: string | null = null;
  if (tenantSlug) {
    const tenant = await prisma.tenant.findFirst({ where: { slug: tenantSlug, active: true } });
    if (!tenant) {
      return NextResponse.json({ error: "Club not found" }, { status: 404 });
    }
    tenantId = tenant.id;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, name, passwordHash, tenantId, role: "USER" },
    select: { id: true, email: true, name: true, role: true, tenantId: true },
  });

  // Joining a club creates the Membership that permission groups and the
  // tenant switcher rely on.
  if (tenantId) {
    await prisma.membership.create({
      data: { userId: user.id, tenantId, role: "USER", kind: "MEMBER", status: "ACTIVE" },
    });
  }

  logAudit({ session: { user: { id: user.id, role: user.role, tenantId: user.tenantId } }, action: "auth.register", entity: "User", entityId: user.id, tenantId: user.tenantId });

  return NextResponse.json(user, { status: 201 });
}
