jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs } from "@/test-utils/session";
import { readJson, request } from "@/test-utils/http";
import { GET } from "@/app/api/audit/route";

const getAudit = async (query: string) => readJson(await GET(request(`/api/audit${query}`)));

beforeEach(() => {
  signInAs({ id: "admin-1", role: "TENANT_ADMIN", tenantId: "t1" });
  prismaMock.auditEvent.findMany.mockResolvedValue([]);
  prismaMock.auditEvent.count.mockResolvedValue(0);
  prismaMock.tenant.findMany.mockResolvedValue([]);
});

describe("GET /api/audit — query validation", () => {
  test("[B-87] FR-AUD-004 – a valid page and date range are accepted", async () => {
    const { status, body } = await getAudit("?page=2&from=2026-01-01&to=2026-02-01");

    expect(status).toBe(200);
    expect(body.page).toBe(2);
  });

  test.each([
    ["page=abc", "?page=abc"],
    ["from=bad-date", "?from=bad-date"],
    ["to=not-a-date", "?to=not-a-date"],
  ])("[B-87] FR-AUD-004 – %s → 400 (not 500) and no query is run", async (_label, query) => {
    const { status } = await getAudit(query);

    expect(status).toBe(400);
    expect(prismaMock.auditEvent.findMany).not.toHaveBeenCalled();
  });
});
