import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertRoleOrFail, rejectIfImpersonating, jsonError } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";

/** List all tenants (platform admin). */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  try {
    const tenants = await prisma.tenant.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { users: true, greens: true } } },
    });
    return NextResponse.json(tenants);
  } catch {
    return jsonError("Failed to fetch tenants", 500);
  }
}

/** Create a new tenant with initial admin user and greens. */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const { name, slug, brandColor, logoUrl, locale, adminEmail, adminPassword, greens, latitude, longitude } = body;

  if (!name || !slug || !adminEmail || !adminPassword) {
    return jsonError("name, slug, adminEmail, adminPassword are required");
  }

  try {
    const existing = await prisma.tenant.findUnique({ where: { slug } });
    if (existing) return jsonError("Slug already taken", 409);

    const passwordHash = await bcrypt.hash(adminPassword, 12);

    const tenant = await prisma.tenant.create({
      data: {
        name,
        slug,
        brandColor: brandColor ?? "#16a34a",
        logoUrl,
        locale: locale ?? "en",
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        users: {
          create: {
            email: adminEmail,
            name: `${name} Admin`,
            passwordHash,
            role: "TENANT_ADMIN",
          },
        },
        greens: greens?.length
          ? {
              create: (greens as { name: string; rinks: { name: string }[] }[]).map((g) => ({
                name: g.name,
                rinks: { create: g.rinks?.map((r) => ({ name: r.name })) ?? [] },
              })),
            }
          : undefined,
      },
      include: { users: { select: { id: true, email: true, role: true } }, greens: { include: { rinks: true } } },
    });

    logAudit({ session, action: "admin.tenant.created", entity: "Tenant", entityId: tenant.id, tenantId: tenant.id, meta: { name, slug } });

    return NextResponse.json(tenant, { status: 201 });
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err) {
      const prismaErr = err as { code: string; meta?: { target?: string[] } };
      if (prismaErr.code === "P2002") {
        const fields = prismaErr.meta?.target ?? [];
        if (fields.includes("email")) return jsonError("A user with that email already exists", 409);
        if (fields.includes("slug")) return jsonError("Slug already taken", 409);
        return jsonError("A unique constraint was violated", 409);
      }
    }
    return jsonError("Failed to create tenant", 500);
  }
}
