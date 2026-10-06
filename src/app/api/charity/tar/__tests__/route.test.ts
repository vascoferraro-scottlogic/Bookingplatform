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

import { GET, PATCH } from "@/app/api/charity/tar/route";

const stamp = Date.now();
const cleanup: { tenantIds: string[]; userIds: string[] } = { tenantIds: [], userIds: [] };

let tenantId: string;
let adminId: string;
let userId: string;
let yearId: string;

function adminSession(tid: string, uid: string) {
  return {
    session: {
      user: { id: uid, email: `charity-admin-${stamp}@test.com`, name: "Charity Admin", role: "TENANT_ADMIN", tenantId: tid, actingAs: null },
    },
  };
}

function userSession(tid: string, uid: string) {
  return {
    session: {
      user: { id: uid, email: `charity-user-${stamp}@test.com`, name: "Charity User", role: "USER", tenantId: tid, actingAs: null },
    },
  };
}

function getReq(yid: string) {
  return new NextRequest(`http://localhost/api/charity/tar?yearId=${yid}`);
}

function patchReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/charity/tar", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

beforeAll(async () => {
  const t = await prisma.tenant.create({ data: { name: `Charity Test ${stamp}`, slug: `charity-${stamp}`, active: true, country: "GB" } });
  tenantId = t.id;
  cleanup.tenantIds.push(t.id);

  await prisma.featureFlag.upsert({ where: { tenantId_key: { tenantId, key: "charity" } }, update: { enabled: true }, create: { tenantId, key: "charity", enabled: true } });

  await prisma.charitySettings.create({ data: { tenantId, regulator: "CC_EW", yearEndMonth: 3, yearEndDay: 31 } });

  const y = await prisma.charityFinancialYear.create({ data: { tenantId, startDate: "2025-04-01", endDate: "2026-03-31" } });
  yearId = y.id;

  const admin = await prisma.user.create({ data: { email: `charity-admin-${stamp}@test.com`, name: "Charity Admin", passwordHash: "x", role: "TENANT_ADMIN", tenantId } });
  adminId = admin.id;
  cleanup.userIds.push(adminId);

  const user = await prisma.user.create({ data: { email: `charity-user-${stamp}@test.com`, name: "Charity User", passwordHash: "x", role: "USER", tenantId } });
  userId = user.id;
  cleanup.userIds.push(userId);
});

afterAll(async () => {
  await prisma.charityTAR.deleteMany({ where: { tenantId } });
  await prisma.charityFinancialYear.deleteMany({ where: { tenantId } });
  await prisma.charitySettings.deleteMany({ where: { tenantId } });
  await prisma.featureFlag.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: cleanup.tenantIds } } });
  await prisma.$disconnect();
});

describe("/api/charity/tar", () => {
  beforeEach(() => {
    mockSessionReturn = adminSession(tenantId, adminId);
  });

  test("returns 403 for USER without permission", async () => {
    mockSessionReturn = userSession(tenantId, userId);
    const res = await GET(getReq(yearId));
    expect(res.status).toBe(403);
  });

  test("GET creates and returns a DRAFT TAR for TENANT_ADMIN", async () => {
    mockSessionReturn = adminSession(tenantId, adminId);
    const res = await GET(getReq(yearId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("tar");
    expect(body.tar.status).toBe("DRAFT");
    expect(body).toHaveProperty("sectionDefinitions");
    expect(body.regulator).toBe("CC_EW");
  });

  test("PATCH updates a section when DRAFT", async () => {
    mockSessionReturn = adminSession(tenantId, adminId);
    // Ensure TAR exists
    const getRes = await GET(getReq(yearId));
    expect(getRes.status).toBe(200);

    const patchRes = await PATCH(patchReq({ yearId, slug: "reference-admin", content: "Test content" }));
    expect(patchRes.status).toBe(200);
    const body = await patchRes.json();
    expect(body.sections).toHaveProperty("reference-admin");
    expect(body.sections["reference-admin"].content).toBe("Test content");
  });
});
