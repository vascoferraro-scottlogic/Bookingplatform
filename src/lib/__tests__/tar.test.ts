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

