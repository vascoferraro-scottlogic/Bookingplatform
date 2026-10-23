jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { readJson, request } from "@/test-utils/http";
import { hoursFromNow } from "@/test-utils/dates";
import { logAudit } from "@/lib/audit";
import { GET, POST } from "@/app/api/onboarding/subscription/route";

const TENANT = "t1";

const getSubscription = async () => readJson(await GET(request("/api/onboarding/subscription")));
const attest = async () => readJson(await POST(request("/api/onboarding/subscription", { method: "POST" })));

beforeEach(() => {
  jest.mocked(logAudit).mockClear();
  signInAs({ id: "admin-1", role: "TENANT_ADMIN", tenantId: TENANT });
  prismaMock.onboardingProgress.create.mockImplementation((async ({ data }: any) => ({
    id: "p1",
    subscriptionAttestedAt: data.subscriptionAttestedAt,
  })) as never);
});

describe("/api/onboarding/subscription", () => {
  test("GET reports not-attested initially", async () => {
    prismaMock.onboardingProgress.findUnique.mockResolvedValue(null);

    const { status, body } = await getSubscription();

    expect(status).toBe(200);
    expect(body.attested).toBe(false);
    expect(body.attestedAt).toBeNull();
    expect(prismaMock.onboardingProgress.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT } }),
    );
  });

  test("POST sets the timestamp and audits", async () => {
    prismaMock.onboardingProgress.findUnique.mockResolvedValue(null);
    prismaMock.platformPlan.findFirst.mockResolvedValue({ id: "plan-basic" } as never);
    prismaMock.tenantBillingProfile.findUnique.mockResolvedValue(null);

    const { status, body } = await attest();

    expect(status).toBe(200);
    expect(body.attested).toBe(true);
    expect(body.attestedAt).toBeTruthy();
    expect(prismaMock.onboardingProgress.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tenantId: TENANT, subscriptionAttestedAt: expect.any(Date) } }),
    );
    expect(prismaMock.tenantBillingProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: TENANT, planId: "plan-basic", billingStatus: "TRIAL" }),
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "onboarding.subscription.attested",
        entityId: "p1",
        tenantId: TENANT,
        meta: { planId: "plan-basic" },
      }),
    );
  });

  test("POST is idempotent (re-attesting is a no-op)", async () => {
    const firstTimestamp = hoursFromNow(-2);
    prismaMock.onboardingProgress.findUnique.mockResolvedValue({
      id: "p1",
      subscriptionAttestedAt: firstTimestamp,
    } as never);

    const { status, body } = await attest();

    expect(status).toBe(200);
    expect(body.attested).toBe(true);
    expect(body.unchanged).toBe(true);
    expect(body.attestedAt).toBe(firstTimestamp.toISOString());
    expect(prismaMock.onboardingProgress.create).not.toHaveBeenCalled();
    expect(prismaMock.onboardingProgress.update).not.toHaveBeenCalled();
    expect(prismaMock.tenantBillingProfile.create).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  test("GET reports attested once set", async () => {
    const attestedAt = hoursFromNow(-1);
    prismaMock.onboardingProgress.findUnique.mockResolvedValue({ subscriptionAttestedAt: attestedAt } as never);
    prismaMock.tenantBillingProfile.findUnique.mockResolvedValue({ planId: "plan-basic" } as never);

    const { body } = await getSubscription();

    expect(body.attested).toBe(true);
    expect(body.attestedAt).toBe(attestedAt.toISOString());
    expect(body.planId).toBe("plan-basic");
  });
});
