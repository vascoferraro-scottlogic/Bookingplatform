import { prisma } from "@/lib/prisma";
import { getTARSections, allDataKeys } from "@/lib/charity/tar-sections";
import type { CharityRegulator } from "@prisma/client";

// ── tar-sections.ts unit tests ──────────────────────────────

describe("getTARSections", () => {
  const regulators: CharityRegulator[] = ["CC_EW", "OSCR", "CCNI"];

  test.each(regulators)("returns non-empty array for %s", (reg) => {
    const sections = getTARSections(reg);
    expect(sections.length).toBeGreaterThan(0);
  });

  test.each(regulators)("all sections have required fields for %s", (reg) => {
    for (const s of getTARSections(reg)) {
      expect(s.slug).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(s.guidance).toBeTruthy();
      expect(Array.isArray(s.dataKeys)).toBe(true);
      expect(typeof s.required).toBe("boolean");
    }
  });

  test.each(regulators)("slugs are unique within %s", (reg) => {
    const slugs = getTARSections(reg).map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("all three regulators share the same slugs (cross-regulator consistency)", () => {
    const ccEw = getTARSections("CC_EW").map((s) => s.slug).sort();
    const oscr = getTARSections("OSCR").map((s) => s.slug).sort();
    const ccni = getTARSections("CCNI").map((s) => s.slug).sort();
    expect(ccEw).toEqual(oscr);
    expect(ccEw).toEqual(ccni);
  });
});

describe("allDataKeys", () => {
  test("returns non-empty deduplicated list", () => {
    const keys = allDataKeys();
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("includes expected keys", () => {
    const keys = allDataKeys();
    expect(keys).toContain("events");
    expect(keys).toContain("financials");
    expect(keys).toContain("charitySettings");
    expect(keys).toContain("members");
  });
});

// ── CharityTAR model integration tests ──────────────────────

let tenantId: string;
let yearId: string;
let userId: string;

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { name: "TAR Test Club", slug: "tar-test-" + Date.now(), country: "GB" },
  });
  tenantId = tenant.id;

  const user = await prisma.user.create({
    data: {
      email: `tar-test-${Date.now()}@example.com`,
      name: "TAR Tester",
      passwordHash: "placeholder",
      tenantId,
    },
  });
  userId = user.id;

  await prisma.charitySettings.create({
    data: {
      tenantId,
      regulator: "CC_EW",
      yearEndMonth: 3,
      yearEndDay: 31,
    },
  });

  const year = await prisma.charityFinancialYear.create({
    data: {
      tenantId,
      startDate: "2025-04-01",
      endDate: "2026-03-31",
    },
  });
  yearId = year.id;
});

afterAll(async () => {
  await prisma.charityTAR.deleteMany({ where: { tenantId } });
  await prisma.charityFinancialYear.deleteMany({ where: { tenantId } });
  await prisma.charitySettings.deleteMany({ where: { tenantId } });
  await prisma.user.deleteMany({ where: { tenantId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("CharityTAR CRUD", () => {
  test("creates a DRAFT tar", async () => {
    const tar = await prisma.charityTAR.create({
      data: {
        tenantId,
        financialYearId: yearId,
        status: "DRAFT",
        sections: "{}",
      },
    });
    expect(tar.status).toBe("DRAFT");
    expect(tar.tenantId).toBe(tenantId);
    expect(tar.financialYearId).toBe(yearId);
    expect(JSON.parse(tar.sections)).toEqual({});
  });

  test("upserts without duplication (unique constraint)", async () => {
    const tar = await prisma.charityTAR.upsert({
      where: {
        tenantId_financialYearId: { tenantId, financialYearId: yearId },
      },
      create: {
        tenantId,
        financialYearId: yearId,
        status: "DRAFT",
        sections: "{}",
      },
      update: {},
    });
    // Should return the same row, not create a duplicate
    const count = await prisma.charityTAR.count({
      where: { tenantId, financialYearId: yearId },
    });
    expect(count).toBe(1);
    expect(tar.status).toBe("DRAFT");
  });

  test("updates sections JSON", async () => {
    const sections = {
      achievements: {
        content: "The club hosted 12 events.",
        source: "manual",
        lastEditedAt: new Date().toISOString(),
      },
    };
    const updated = await prisma.charityTAR.update({
      where: {
        tenantId_financialYearId: { tenantId, financialYearId: yearId },
      },
      data: { sections: JSON.stringify(sections) },
    });
    const parsed = JSON.parse(updated.sections);
    expect(parsed.achievements.content).toBe("The club hosted 12 events.");
    expect(parsed.achievements.source).toBe("manual");
  });

  test("finalises a TAR and locks the year", async () => {
    const now = new Date();
    const [tar] = await prisma.$transaction([
      prisma.charityTAR.update({
        where: {
          tenantId_financialYearId: { tenantId, financialYearId: yearId },
        },
        data: {
          status: "FINALISED",
          finalisedAt: now,
          finalisedById: userId,
        },
      }),
      prisma.charityFinancialYear.update({
        where: { id: yearId },
        data: { status: "LOCKED", lockedAt: now, lockedById: userId },
      }),
    ]);
    expect(tar.status).toBe("FINALISED");
    expect(tar.finalisedById).toBe(userId);

    const year = await prisma.charityFinancialYear.findUniqueOrThrow({
      where: { id: yearId },
    });
    expect(year.status).toBe("LOCKED");
  });

  test("rejects duplicate TAR per tenant+year", async () => {
    await expect(
      prisma.charityTAR.create({
        data: {
          tenantId,
          financialYearId: yearId,
          status: "DRAFT",
          sections: "{}",
        },
      }),
    ).rejects.toThrow();
  });

  test("unlocking a year reverts TAR to DRAFT", async () => {
    // Ensure TAR is FINALISED and year is LOCKED from earlier test
    const tar = await prisma.charityTAR.findUniqueOrThrow({
      where: { tenantId_financialYearId: { tenantId, financialYearId: yearId } },
    });
    expect(tar.status).toBe("FINALISED");

    // Simulate the unlock transaction (same logic as PATCH handler)
    await prisma.$transaction([
      prisma.charityFinancialYear.update({
        where: { id: yearId },
        data: { status: "OPEN", lockedAt: null, lockedById: null },
      }),
      prisma.charityTAR.updateMany({
        where: { tenantId, financialYearId: yearId, status: "FINALISED" },
        data: { status: "DRAFT", finalisedAt: null, finalisedById: null },
      }),
    ]);

    const reopened = await prisma.charityTAR.findUniqueOrThrow({
      where: { tenantId_financialYearId: { tenantId, financialYearId: yearId } },
    });
    expect(reopened.status).toBe("DRAFT");
    expect(reopened.finalisedAt).toBeNull();
    expect(reopened.finalisedById).toBeNull();

    const year = await prisma.charityFinancialYear.findUniqueOrThrow({
      where: { id: yearId },
    });
    expect(year.status).toBe("OPEN");
    expect(year.lockedAt).toBeNull();
  });
});
