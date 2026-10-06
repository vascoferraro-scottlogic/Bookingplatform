import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

let mockSessionReturn: any;

jest.mock("@/lib/api-utils", () => {
  const actual = jest.requireActual("@/lib/api-utils");
  return {
    ...actual,
    getSessionOrFail: jest.fn(() => Promise.resolve(mockSessionReturn)),
  };
});

import { POST as invitePOST } from "@/app/api/onboarding/invite/route";
import { GET as acceptGET, POST as acceptPOST } from "@/app/api/invitations/[token]/route";

let onboardingTenantId: string;
let activeTenantId: string;
let onboardingAdminId: string;
let activeAdminId: string;
const cleanup: { tenantIds: string[]; userIds: string[] } = { tenantIds: [], userIds: [] };

function adminSession(tenantId: string, userId: string) {
  return {
    session: {
      user: {
        id: userId,
        email: "queued-admin@test.com",
        name: "Queued Admin",
        role: "TENANT_ADMIN",
        tenantId,
        actingAs: null,
      },
    },
  };
}

function inviteReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/onboarding/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const stamp = Date.now();
  const ob = await prisma.tenant.create({
    data: { name: "Queued OB Club", slug: `q-ob-${stamp}`, status: "ONBOARDING", active: false },
  });
  onboardingTenantId = ob.id;
  cleanup.tenantIds.push(ob.id);

  const live = await prisma.tenant.create({
    data: { name: "Queued Live Club", slug: `q-live-${stamp}`, status: "ACTIVE", active: true, goLiveAt: new Date() },
  });
  activeTenantId = live.id;
  cleanup.tenantIds.push(live.id);

  const obAdmin = await prisma.user.create({
    data: { email: `q-ob-admin-${stamp}@test.com`, name: "OB Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId: onboardingTenantId },
  });
  onboardingAdminId = obAdmin.id;
  cleanup.userIds.push(obAdmin.id);

  const liveAdmin = await prisma.user.create({
    data: { email: `q-live-admin-${stamp}@test.com`, name: "Live Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId: activeTenantId },
  });
  activeAdminId = liveAdmin.id;
  cleanup.userIds.push(liveAdmin.id);
});

afterAll(async () => {
  // Clean any users invited during tests too.
  const inviteEmails = await prisma.userInvitation.findMany({
    where: { tenantId: { in: cleanup.tenantIds } },
    select: { email: true },
  });
  await prisma.userInvitation.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.outboundMessage.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.membership.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: cleanup.userIds } } });

  const allUserIds = [...cleanup.userIds];
  if (inviteEmails.length) {
    const invitedUsers = await prisma.user.findMany({
      where: { email: { in: inviteEmails.map((i) => i.email) } },
      select: { id: true },
    });
    allUserIds.push(...invitedUsers.map((u) => u.id));
  }
  await prisma.user.updateMany({ where: { id: { in: allUserIds } }, data: { tenantId: null } });
  await prisma.user.deleteMany({ where: { id: { in: allUserIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: cleanup.tenantIds } } });
  await prisma.$disconnect();
});

describe("invitations: QUEUED for onboarding tenants", () => {
  test("POST /api/onboarding/invite issues QUEUED for an ONBOARDING tenant and skips the email stub", async () => {
    mockSessionReturn = adminSession(onboardingTenantId, onboardingAdminId);
    const stamp = Date.now();
    const inviteeEmail = `queued-invitee-${stamp}@test.com`;

    const res = await invitePOST(inviteReq({ email: inviteeEmail, role: "USER" }));
    expect(res.status).toBeLessThan(300);

    const inv = await prisma.userInvitation.findFirst({
      where: { tenantId: onboardingTenantId, email: inviteeEmail },
    });
    expect(inv?.status).toBe("QUEUED");

    // No invitation-template outbound for this invite (queued = no email yet).
    const outbound = await prisma.outboundMessage.findMany({
      where: { tenantId: onboardingTenantId, relatedEntityId: inv!.id },
    });
    expect(outbound.length).toBe(0);
  });

  test("POST /api/onboarding/invite issues PENDING for an ACTIVE tenant", async () => {
    mockSessionReturn = adminSession(activeTenantId, activeAdminId);
    const stamp = Date.now();
    const inviteeEmail = `live-invitee-${stamp}@test.com`;

    const res = await invitePOST(inviteReq({ email: inviteeEmail, role: "USER" }));
    expect(res.status).toBeLessThan(300);

    const inv = await prisma.userInvitation.findFirst({
      where: { tenantId: activeTenantId, email: inviteeEmail },
    });
    expect(inv?.status).toBe("PENDING");
  });

  test("GET /api/invitations/[token] flags QUEUED invitations as stale", async () => {
    const inv = await prisma.userInvitation.findFirst({
      where: { tenantId: onboardingTenantId, status: "QUEUED" },
    });
    expect(inv).toBeTruthy();

    const res = await acceptGET(
      new NextRequest(`http://localhost/api/invitations/${inv!.token}`),
      { params: Promise.resolve({ token: inv!.token }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("QUEUED");
    expect(body.stale).toBe(true);
  });

  test("POST /api/invitations/[token] rejects acceptance of a QUEUED invitation with 409", async () => {
    const inv = await prisma.userInvitation.findFirst({
      where: { tenantId: onboardingTenantId, status: "QUEUED" },
    });
    expect(inv).toBeTruthy();

    const req = new NextRequest(`http://localhost/api/invitations/${inv!.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "NewPass1234" }),
    });
    const res = await acceptPOST(req, { params: Promise.resolve({ token: inv!.token }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/queued/i);
  });
});
