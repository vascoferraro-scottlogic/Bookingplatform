jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/outbound", () => ({ sendEmail: jest.fn(), sendSocial: jest.fn() }));

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { readJson, request } from "@/test-utils/http";
import { dateFromToday, hoursFromNow } from "@/test-utils/dates";
import { logAudit } from "@/lib/audit";
import { sendEmail, sendSocial } from "@/lib/outbound";
import { GET, POST } from "@/app/api/onboarding/go-live/route";

const TENANT = "t1";
const REAL_SLUG = "lakeview-bowls";
const PLACEHOLDER_SLUG = "t-1a2b3c4d";
// NB: chapters 1-8 count as "all required" — 9 and 10 are not checked. This
// mirrors current route behaviour (known defect, corrected in a later stage).
const ALL_REQUIRED = JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]);

const getReadiness = async () => readJson(await GET(request("/api/onboarding/go-live")));
const goLive = async () => readJson(await POST(request("/api/onboarding/go-live", { method: "POST" })));

function givenTenant(overrides: Record<string, unknown> = {}) {
  prismaMock.tenant.findUnique.mockResolvedValue({
    id: TENANT,
    name: "GL Test Club",
    slug: REAL_SLUG,
    status: "ONBOARDING",
    goLiveAt: null,
    locality: null,
    ...overrides,
  } as never);
}

function givenProgress(opts: { completedChapters?: string; subscriptionAttestedAt?: Date | null }) {
  prismaMock.onboardingProgress.findUnique.mockResolvedValue({
    completedChapters: opts.completedChapters ?? "[]",
    subscriptionAttestedAt: opts.subscriptionAttestedAt ?? null,
    completedAt: null,
  } as never);
}

function queuedInvitation(id: string) {
  return { id, email: `${id}@test.com`, role: "USER", token: `tok-${id}`, expiresAt: dateFromToday(14) };
}

beforeEach(() => {
  jest.mocked(logAudit).mockClear();
  jest.mocked(sendEmail).mockClear();
  jest.mocked(sendSocial).mockClear();
  signInAs({ id: "admin-1", role: "TENANT_ADMIN", tenantId: TENANT, name: "GL Admin" });
  prismaMock.userInvitation.count.mockResolvedValue(0);
  prismaMock.userInvitation.findMany.mockResolvedValue([]);
});

describe("/api/onboarding/go-live", () => {
  describe("GET (readiness)", () => {
    test("reports placeholder-slug as a blocker", async () => {
      givenTenant({ slug: PLACEHOLDER_SLUG });
      givenProgress({ completedChapters: ALL_REQUIRED, subscriptionAttestedAt: hoursFromNow(-1) });

      const { status, body } = await getReadiness();

      expect(status).toBe(200);
      expect(body.ready).toBe(false);
      expect(body.blockers).toEqual([expect.stringMatching(/public URL/i)]);
    });

    test("reports missing chapters and missing subscription as blockers", async () => {
      givenTenant();
      givenProgress({ completedChapters: JSON.stringify([1, 2]), subscriptionAttestedAt: null });

      const { status, body } = await getReadiness();

      expect(status).toBe(200);
      expect(body.ready).toBe(false);
      expect(body.blockers).toEqual(
        expect.arrayContaining([expect.stringMatching(/chapter/i), expect.stringMatching(/subscription/i)]),
      );
    });

    test("reports ready when all prereqs met", async () => {
      givenTenant();
      givenProgress({ completedChapters: ALL_REQUIRED, subscriptionAttestedAt: hoursFromNow(-1) });

      const { body } = await getReadiness();

      expect(body.ready).toBe(true);
      expect(body.blockers).toEqual([]);
    });

    test("counts queued invitations for this tenant", async () => {
      givenTenant();
      givenProgress({ completedChapters: ALL_REQUIRED, subscriptionAttestedAt: hoursFromNow(-1) });
      prismaMock.userInvitation.count.mockResolvedValue(2);

      const { body } = await getReadiness();

      expect(body.queuedInvitationCount).toBe(2);
      expect(prismaMock.userInvitation.count).toHaveBeenCalledWith({ where: { tenantId: TENANT, status: "QUEUED" } });
    });
  });

  describe("POST (flip)", () => {
    test("blocks when prereqs unmet", async () => {
      givenTenant();
      givenProgress({ completedChapters: JSON.stringify([1]), subscriptionAttestedAt: null });

      const { status } = await goLive();

      expect(status).toBe(400);
      expect(prismaMock.tenant.update).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    test("blocks when slug is still a placeholder", async () => {
      givenTenant({ slug: PLACEHOLDER_SLUG });
      givenProgress({ completedChapters: ALL_REQUIRED, subscriptionAttestedAt: hoursFromNow(-1) });

      const { status, body } = await goLive();

      expect(status).toBe(400);
      expect(body.error).toMatch(/public URL/i);
      expect(prismaMock.tenant.update).not.toHaveBeenCalled();
    });

    test("flips status, releases QUEUED invitations, fires outbound, audits", async () => {
      givenTenant();
      givenProgress({ completedChapters: ALL_REQUIRED, subscriptionAttestedAt: hoursFromNow(-1) });
      prismaMock.userInvitation.findMany.mockResolvedValue([queuedInvitation("release")] as never);

      const { status, body } = await goLive();

      expect(status).toBe(200);
      expect(body).toEqual(expect.objectContaining({ ok: true, slug: REAL_SLUG, releasedInvitations: 1 }));

      expect(prismaMock.tenant.update).toHaveBeenCalledWith({
        where: { id: TENANT },
        data: { status: "ACTIVE", active: true, goLiveAt: expect.any(Date) },
      });
      expect(prismaMock.userInvitation.updateMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, status: "QUEUED" },
        data: { status: "PENDING" },
      });
      expect(prismaMock.onboardingProgress.update).toHaveBeenCalledWith({
        where: { tenantId: TENANT },
        data: { completedAt: expect.any(Date) },
      });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

      // Invitation email + tenant-joined social post.
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "release@test.com",
          template: "invitation",
          tenantId: TENANT,
          relatedEntityId: "release",
          data: expect.objectContaining({ acceptUrl: expect.stringContaining("/invite/tok-release") }),
        }),
      );
      expect(sendSocial).toHaveBeenCalledWith(
        expect.objectContaining({ template: "tenant-joined", tenantId: TENANT }),
      );
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "tenant.went_live",
          tenantId: TENANT,
          meta: { slug: REAL_SLUG, releasedInvitations: 1 },
        }),
      );
    });

    test("go-live still succeeds when an outbound send fails", async () => {
      givenTenant();
      givenProgress({ completedChapters: ALL_REQUIRED, subscriptionAttestedAt: hoursFromNow(-1) });
      prismaMock.userInvitation.findMany.mockResolvedValue([queuedInvitation("a")] as never);
      jest.mocked(sendEmail).mockRejectedValueOnce(new Error("smtp down"));

      const { status } = await goLive();

      expect(status).toBe(200);
      expect(prismaMock.tenant.update).toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "tenant.went_live" }));
    });

    test("rejects re-going-live (already live)", async () => {
      givenTenant({ status: "ACTIVE", goLiveAt: dateFromToday(-1) });

      const { status } = await goLive();

      expect(status).toBe(409);
      expect(prismaMock.tenant.update).not.toHaveBeenCalled();
    });
  });
});
