jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/outbound", () => ({ sendEmail: jest.fn() }));

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, request, routeParams } from "@/test-utils/http";
import { dateFromToday } from "@/test-utils/dates";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/outbound";
import { POST as invitePOST } from "@/app/api/onboarding/invite/route";
import { GET as acceptGET, POST as acceptPOST } from "@/app/api/invitations/[token]/route";

const invite = async (body: Record<string, unknown>) =>
  readJson(await invitePOST(jsonRequest("POST", "/api/onboarding/invite", body)));

function givenTenant(id: string, status: "ONBOARDING" | "ACTIVE") {
  signInAs({ id: `${id}-admin`, role: "TENANT_ADMIN", tenantId: id });
  prismaMock.tenant.findUnique.mockResolvedValue({ id, name: `Club ${id}`, slug: `club-${id}`, status } as never);
}

function queuedInvitation() {
  return {
    id: "inv-q",
    email: "queued-invitee@test.com",
    role: "USER",
    token: "tok-queued",
    status: "QUEUED",
    tenantId: "t-onb",
    expiresAt: dateFromToday(14),
    tenant: { id: "t-onb", name: "Club t-onb", slug: "club-t-onb", locality: null },
    invitedBy: { name: "Admin", email: "admin@test.com" },
  };
}

beforeEach(() => {
  jest.mocked(logAudit).mockClear();
  jest.mocked(sendEmail).mockClear();
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.user.create.mockImplementation((async ({ data }: any) => ({ id: "invitee-1", ...data })) as never);
  prismaMock.membership.findUnique.mockResolvedValue(null);
  prismaMock.userInvitation.findFirst.mockResolvedValue(null);
  prismaMock.userInvitation.create.mockImplementation((async ({ data }: any) => ({
    id: "inv-new",
    token: "tok-new",
    ...data,
  })) as never);
});

describe("invitations: QUEUED for onboarding tenants", () => {
  test("POST /api/onboarding/invite issues QUEUED for an ONBOARDING tenant and skips the email stub", async () => {
    givenTenant("t-onb", "ONBOARDING");

    const { status, body } = await invite({ email: "queued-invitee@test.com", role: "USER" });

    expect(status).toBe(201);
    expect(body.status).toBe("QUEUED");
    expect(prismaMock.tenant.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "t-onb" } }));
    expect(prismaMock.userInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: "queued-invitee@test.com", tenantId: "t-onb", status: "QUEUED" }),
    });
    // Queued = no invitation email yet.
    expect(sendEmail).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "onboarding.user.invited.queued", tenantId: "t-onb" }),
    );
  });

  test("POST /api/onboarding/invite issues PENDING for an ACTIVE tenant", async () => {
    givenTenant("t-live", "ACTIVE");

    const { status, body } = await invite({ email: "live-invitee@test.com", role: "USER" });

    expect(status).toBe(201);
    expect(body.status).toBe("PENDING");
    expect(prismaMock.userInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: "live-invitee@test.com", tenantId: "t-live", status: "PENDING" }),
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "live-invitee@test.com",
        template: "invitation",
        tenantId: "t-live",
        relatedEntityId: "inv-new",
      }),
    );
  });

  test("GET /api/invitations/[token] flags QUEUED invitations as stale", async () => {
    prismaMock.userInvitation.findUnique.mockResolvedValue(queuedInvitation() as never);

    const { status, body } = await readJson(
      await acceptGET(request("/api/invitations/tok-queued"), routeParams({ token: "tok-queued" })),
    );

    expect(status).toBe(200);
    expect(body.status).toBe("QUEUED");
    expect(body.stale).toBe(true);
    expect(prismaMock.userInvitation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: "tok-queued" } }),
    );
  });

  test("POST /api/invitations/[token] rejects acceptance of a QUEUED invitation with 409", async () => {
    prismaMock.userInvitation.findUnique.mockResolvedValue(queuedInvitation() as never);

    const { status, body } = await readJson(
      await acceptPOST(
        jsonRequest("POST", "/api/invitations/tok-queued", { password: "NewPass1234" }),
        routeParams({ token: "tok-queued" }),
      ),
    );

    expect(status).toBe(409);
    expect(body.error).toMatch(/queued/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.membership.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.userInvitation.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/invitations/[token] - password rule", () => {
  test("[B-13] FR-AUTH-001 – a too-short password is rejected with the shared rule message (400)", async () => {
    const { status, body } = await readJson(
      await acceptPOST(jsonRequest("POST", "/api/invitations/tok", { password: "short" }), routeParams({ token: "tok" })),
    );

    expect(status).toBe(400);
    expect(body.error).toBe("Password must be at least 8 characters");
    expect(prismaMock.userInvitation.findUnique).not.toHaveBeenCalled();
  });
});
