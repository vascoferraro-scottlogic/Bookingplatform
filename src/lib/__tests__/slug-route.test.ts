jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { jsonRequest, readJson, request } from "@/test-utils/http";
import { dateFromToday } from "@/test-utils/dates";
import { logAudit } from "@/lib/audit";
import { GET, PATCH } from "@/app/api/onboarding/slug/route";

const TENANT = "t1";
const OTHER_TENANT_SLUG = "slug-other";

type TenantRow = { id: string; slug: string; status: string; goLiveAt: Date | null };

/** Tenants the route can look up, by id or by slug. */
function givenTenants(rows: TenantRow[]) {
  prismaMock.tenant.findUnique.mockImplementation((async ({ where }: any) => {
    const row = rows.find((r) => (where.id ? r.id === where.id : r.slug === where.slug));
    return row ?? null;
  }) as never);
}

const onboardingTenant: TenantRow = { id: TENANT, slug: "t-1a2b3c4d", status: "ONBOARDING", goLiveAt: null };
const otherTenant: TenantRow = { id: "t-other", slug: OTHER_TENANT_SLUG, status: "ACTIVE", goLiveAt: null };
const liveTenant: TenantRow = { id: "t-live", slug: "slug-live", status: "ACTIVE", goLiveAt: dateFromToday(-1) };

const check = async (candidate: string) =>
  readJson(await GET(request(`/api/onboarding/slug?candidate=${encodeURIComponent(candidate)}`)));
const setSlug = async (slug: string) => readJson(await PATCH(jsonRequest("PATCH", "/api/onboarding/slug", { slug })));

beforeEach(() => {
  jest.mocked(logAudit).mockClear();
  signInAs({ id: "admin-1", role: "TENANT_ADMIN", tenantId: TENANT });
  givenTenants([onboardingTenant, otherTenant, liveTenant]);
  prismaMock.tenant.update.mockImplementation((async ({ data }: any) => ({ slug: data.slug })) as never);
});

describe("/api/onboarding/slug", () => {
  describe("GET (availability check)", () => {
    test("reports available for a fresh valid slug", async () => {
      const { status, body } = await check("my-fresh-club");

      expect(status).toBe(200);
      expect(body.available).toBe(true);
      expect(body.slug).toBe("my-fresh-club");
      expect(prismaMock.tenant.findUnique).toHaveBeenCalledWith({ where: { slug: "my-fresh-club" }, select: { id: true } });
    });

    test("reports unavailable for a reserved slug", async () => {
      const { body } = await check("dashboard");

      expect(body.available).toBe(false);
      expect(body.reason).toMatch(/reserved/i);
    });

    test("reports unavailable for a taken slug", async () => {
      const { body } = await check(OTHER_TENANT_SLUG);

      expect(body.available).toBe(false);
      expect(body.reason).toMatch(/taken/i);
    });

    test("reports available for the caller's own current slug", async () => {
      givenTenants([{ ...onboardingTenant, slug: "my-own-club" }]);

      const { body } = await check("my-own-club");

      expect(body.available).toBe(true);
    });

    test.each(["-leading", "ab", "bad slug"])("rejects invalid format %p", async (candidate) => {
      const { body } = await check(candidate);

      expect(body.available).toBe(false);
      expect(prismaMock.tenant.findUnique).not.toHaveBeenCalled();
    });

    test("rejects consecutive hyphens", async () => {
      const { body } = await check("foo--bar");

      expect(body.available).toBe(false);
      expect(body.reason).toMatch(/hyphen/i);
    });
  });

  describe("PATCH (set slug)", () => {
    test("sets a valid slug on an onboarding tenant", async () => {
      const { status, body } = await setSlug("chosen-club");

      expect(status).toBe(200);
      expect(body.slug).toBe("chosen-club");
      expect(prismaMock.tenant.update).toHaveBeenCalledWith({
        where: { id: TENANT },
        data: { slug: "chosen-club" },
        select: { slug: true },
      });
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "onboarding.slug.updated",
          tenantId: TENANT,
          meta: { previousSlug: onboardingTenant.slug, newSlug: "chosen-club" },
        }),
      );
    });

    test("rejects a reserved slug", async () => {
      const { status } = await setSlug("api");

      expect(status).toBe(400);
      expect(prismaMock.tenant.update).not.toHaveBeenCalled();
    });

    test("rejects a slug already taken by another tenant", async () => {
      const { status } = await setSlug(OTHER_TENANT_SLUG);

      expect(status).toBe(409);
      expect(prismaMock.tenant.update).not.toHaveBeenCalled();
    });

    test("rejects invalid format", async () => {
      const { status } = await setSlug("BAD!");

      expect(status).toBe(400);
      expect(prismaMock.tenant.update).not.toHaveBeenCalled();
    });

    test("is locked once tenant has gone live", async () => {
      signInAs({ id: "live-admin", role: "TENANT_ADMIN", tenantId: liveTenant.id });

      const { status, body } = await setSlug("attempted-club");

      expect(status).toBe(409);
      expect(body.error).toMatch(/locked/i);
      expect(prismaMock.tenant.update).not.toHaveBeenCalled();
    });
  });
});
