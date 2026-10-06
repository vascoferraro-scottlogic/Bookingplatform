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

import { POST as leadsPOST } from "@/app/api/leads/route";
import { POST as approvePOST } from "@/app/api/admin/applications/[id]/approve/route";
import { GET as inviteGET, POST as invitePOST } from "@/app/api/invitations/[token]/route";

let platformAdminId: string;
const cleanup: { tenantIds: string[]; userIds: string[]; appIds: string[] } = {
  tenantIds: [],
  userIds: [],
  appIds: [],
};

function platformSession() {
  return {
    session: {
      user: {
        id: platformAdminId,
        email: "lia-admin@test.com",
        name: "Lia Admin",
        role: "PLATFORM_ADMIN",
        tenantId: null,
        actingAs: null,
      },
    },
  };
}

function jsonReq(url: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "127.0.0.99", ...headers },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: {
      email: `lia-platform-${Date.now()}@test.com`,
      name: "Platform Admin",
      passwordHash: "x",
      role: "PLATFORM_ADMIN",
      isPlatformAdmin: true,
    },
  });
  platformAdminId = admin.id;
  cleanup.userIds.push(admin.id);
});

afterAll(async () => {
  // Clean up in reverse dependency order.
  if (cleanup.appIds.length) {
    await prisma.outboundMessage.deleteMany({ where: { relatedEntityId: { in: cleanup.appIds } } });
    await prisma.tenantApplication.deleteMany({ where: { id: { in: cleanup.appIds } } });
  }
  if (cleanup.tenantIds.length) {
    await prisma.outboundMessage.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
    await prisma.userInvitation.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
    await prisma.membership.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
    await prisma.featureFlag.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
    await prisma.onboardingProgress.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
    await prisma.auditEvent.deleteMany({ where: { tenantId: { in: cleanup.tenantIds } } });
  }
  if (cleanup.userIds.length) {
    await prisma.user.updateMany({ where: { tenantId: { in: cleanup.tenantIds } }, data: { tenantId: null } });
    await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  }
  if (cleanup.tenantIds.length) {
    await prisma.tenant.deleteMany({ where: { id: { in: cleanup.tenantIds } } });
  }
  await prisma.$disconnect();
});

describe("acquisition pipeline (lead → approve → invite → accept)", () => {
  test("end-to-end happy path", async () => {
    const stamp = Date.now();
    const contactEmail = `acq-lead-${stamp}@test.com`;
    const clubName = `Acq Test Club ${stamp}`;

    // 1. Submit lead (public, no session needed)
    const leadRes = await leadsPOST(
      jsonReq("http://localhost/api/leads", {
        clubName,
        contactName: "Wullie Test",
        contactEmail,
        country: "UK",
      })
    );
    expect(leadRes.status).toBe(201);
    const leadBody = await leadRes.json();
    cleanup.appIds.push(leadBody.id);

    const application = await prisma.tenantApplication.findUnique({ where: { id: leadBody.id } });
    expect(application?.status).toBe("PENDING");
    expect(application?.contactEmail).toBe(contactEmail);

    // Acknowledgement + admin notification(s) created
    const initialOutbound = await prisma.outboundMessage.findMany({
      where: { relatedEntityId: application!.id },
    });
    expect(initialOutbound.length).toBeGreaterThanOrEqual(1);
    const ack = initialOutbound.find((m) => m.toAddress === contactEmail);
    expect(ack).toBeTruthy();
    expect(ack?.subject).toContain(clubName);

    // 2. Approve as platform admin
    mockSessionReturn = platformSession();
    const approveRes = await approvePOST(
      jsonReq(`http://localhost/api/admin/applications/${application!.id}/approve`, {}),
      { params: Promise.resolve({ id: application!.id }) }
    );
    expect(approveRes.status).toBe(200);
    const approveBody = await approveRes.json();
    cleanup.tenantIds.push(approveBody.tenantId);

    const tenant = await prisma.tenant.findUnique({ where: { id: approveBody.tenantId } });
    expect(tenant?.status).toBe("ONBOARDING");
    expect(tenant?.active).toBe(false);
    // Approval generates a placeholder slug (`t-{8hex}`) — the real slug is
    // chosen by the club admin in the About chapter and locked at go-live.
    expect(tenant?.slug).toMatch(/^t-[0-9a-f]{8}$/);
    expect(tenant?.goLiveAt).toBeNull();

    // Membership pending; invitation pending
    const membership = await prisma.membership.findFirst({ where: { tenantId: tenant!.id } });
    expect(membership?.status).toBe("PENDING");
    expect(membership?.role).toBe("TENANT_ADMIN");
    cleanup.userIds.push(membership!.userId);

    const invitation = await prisma.userInvitation.findFirst({ where: { tenantId: tenant!.id } });
    expect(invitation?.status).toBe("PENDING");
    expect(invitation?.email).toBe(contactEmail);

    // 3. GET invitation status (public, no session)
    mockSessionReturn = { error: new Response(null, { status: 401 }) }; // any
    const invStatusRes = await inviteGET(
      new NextRequest(`http://localhost/api/invitations/${invitation!.token}`),
      { params: Promise.resolve({ token: invitation!.token }) }
    );
    expect(invStatusRes.status).toBe(200);
    const invStatus = await invStatusRes.json();
    expect(invStatus.status).toBe("PENDING");
    expect(invStatus.stale).toBe(false);
    expect(invStatus.tenant.name).toBe(clubName);

    // 4. Accept invitation
    const acceptRes = await invitePOST(
      jsonReq(`http://localhost/api/invitations/${invitation!.token}`, { password: "NewPass1234" }),
      { params: Promise.resolve({ token: invitation!.token }) }
    );
    expect(acceptRes.status).toBe(200);

    const refreshedInv = await prisma.userInvitation.findUnique({ where: { id: invitation!.id } });
    expect(refreshedInv?.status).toBe("ACCEPTED");
    expect(refreshedInv?.acceptedAt).toBeTruthy();

    const refreshedMembership = await prisma.membership.findUnique({ where: { id: membership!.id } });
    expect(refreshedMembership?.status).toBe("ACTIVE");

    const refreshedUser = await prisma.user.findUnique({ where: { id: membership!.userId } });
    expect(refreshedUser?.passwordHash).toBeTruthy();
    expect(refreshedUser?.passwordHash).not.toBe("");

    // Final outbound list should include welcome message
    const allOutbound = await prisma.outboundMessage.findMany({
      where: { OR: [{ relatedEntityId: application!.id }, { tenantId: tenant!.id }] },
      orderBy: { createdAt: "asc" },
    });
    expect(allOutbound.length).toBeGreaterThanOrEqual(4);
  });

  test("rejects duplicate approval", async () => {
    const stamp = Date.now() + 1;
    const application = await prisma.tenantApplication.create({
      data: {
        clubName: `Dup Test ${stamp}`,
        contactName: "Dup",
        contactEmail: `dup-${stamp}@test.com`,
        country: "UK",
        status: "APPROVED",
      },
    });
    cleanup.appIds.push(application.id);

    mockSessionReturn = platformSession();
    const res = await approvePOST(
      jsonReq(`http://localhost/api/admin/applications/${application.id}/approve`, {}),
      { params: Promise.resolve({ id: application.id }) }
    );
    expect(res.status).toBe(409);
  });

  test("invitation status returns NOT_FOUND for unknown token", async () => {
    const res = await inviteGET(
      new NextRequest("http://localhost/api/invitations/no-such-token"),
      { params: Promise.resolve({ token: "no-such-token" }) }
    );
    expect(res.status).toBe(404);
  });
});
