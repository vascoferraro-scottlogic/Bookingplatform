import {
  isGreenOpenOn,
  seasonWindowForYear,
  recurringWindowForYear,
  bookableYears,
  seasonLabel,
  type GreenSeasonInfo,
} from "../season";

// ── Helpers ──────────────────────────────────────────────────

function makeGreen(overrides: Partial<GreenSeasonInfo> = {}): GreenSeasonInfo {
  return {
    allWeather: false,
    seasonStartMMDD: "04-01",
    seasonEndMMDD: "09-30",
    seasons: [],
    ...overrides,
  };
}

// ── allWeather ───────────────────────────────────────────────

describe("allWeather green", () => {
  const g = makeGreen({ allWeather: true });

  it("is open in summer", () => expect(isGreenOpenOn(g, "2026-07-15")).toBe(true));
  it("is open in winter", () => expect(isGreenOpenOn(g, "2026-12-25")).toBe(true));
  it("is open on New Year's Day", () => expect(isGreenOpenOn(g, "2027-01-01")).toBe(true));
});

// ── Recurring MM-DD window ───────────────────────────────────

describe("recurring seasonal window (Apr–Sep)", () => {
  const g = makeGreen(); // 04-01 → 09-30

  it("is open on first day of season", () => expect(isGreenOpenOn(g, "2026-04-01")).toBe(true));
  it("is open on last day of season", () => expect(isGreenOpenOn(g, "2026-09-30")).toBe(true));
  it("is open mid-season", () => expect(isGreenOpenOn(g, "2026-06-15")).toBe(true));
  it("is closed one day before season", () => expect(isGreenOpenOn(g, "2026-03-31")).toBe(false));
  it("is closed one day after season", () => expect(isGreenOpenOn(g, "2026-10-01")).toBe(false));
  it("is closed in December", () => expect(isGreenOpenOn(g, "2026-12-15")).toBe(false));
  it("is closed on Feb 29 (leap year)", () => expect(isGreenOpenOn(g, "2028-02-29")).toBe(false));
});

// ── Wrap-around window (winter rink Nov–Feb) ─────────────────

describe("wrap-around window (Nov–Feb)", () => {
  const g = makeGreen({ seasonStartMMDD: "11-01", seasonEndMMDD: "02-28" });

  it("is open on Nov 1", () => expect(isGreenOpenOn(g, "2026-11-01")).toBe(true));
  it("is open on Dec 25", () => expect(isGreenOpenOn(g, "2026-12-25")).toBe(true));
  it("is open on Jan 15 (next year)", () => expect(isGreenOpenOn(g, "2027-01-15")).toBe(true));
  it("is open on Feb 28 (end date)", () => expect(isGreenOpenOn(g, "2027-02-28")).toBe(true));
  it("is closed on Mar 1", () => expect(isGreenOpenOn(g, "2027-03-01")).toBe(false));
  it("is closed in June", () => expect(isGreenOpenOn(g, "2026-06-15")).toBe(false));
  it("is closed in October", () => expect(isGreenOpenOn(g, "2026-10-31")).toBe(false));
});

// ── Per-year GreenSeason override ────────────────────────────

describe("per-year override", () => {
  const g = makeGreen({
    seasons: [
      { year: 2027, startDate: "2027-03-15", endDate: "2027-10-15" },
    ],
  });

  it("uses recurring window for 2026", () => {
    expect(isGreenOpenOn(g, "2026-07-15")).toBe(true);
    expect(isGreenOpenOn(g, "2026-10-05")).toBe(false);
  });

  it("uses override for 2027 — open on Mar 15", () => {
    expect(isGreenOpenOn(g, "2027-03-15")).toBe(true);
  });

  it("uses override for 2027 — open on Oct 10 (past normal Sep 30)", () => {
    expect(isGreenOpenOn(g, "2027-10-10")).toBe(true);
  });

  it("uses override for 2027 — closed on Mar 14 (before override start)", () => {
    expect(isGreenOpenOn(g, "2027-03-14")).toBe(false);
  });
});

// ── No season configured ────────────────────────────────────

describe("no season configured", () => {
  const g = makeGreen({
    seasonStartMMDD: null,
    seasonEndMMDD: null,
    seasons: [],
  });

  it("is always open", () => {
    expect(isGreenOpenOn(g, "2026-01-01")).toBe(true);
    expect(isGreenOpenOn(g, "2026-07-15")).toBe(true);
    expect(isGreenOpenOn(g, "2026-12-31")).toBe(true);
  });
});

// ── recurringWindowForYear ───────────────────────────────────

describe("recurringWindowForYear", () => {
  it("normal window", () => {
    expect(recurringWindowForYear("04-01", "09-30", 2026)).toEqual({
      start: "2026-04-01",
      end: "2026-09-30",
    });
  });

  it("wrap-around window spans into next year", () => {
    expect(recurringWindowForYear("11-01", "02-28", 2026)).toEqual({
      start: "2026-11-01",
      end: "2027-02-28",
    });
  });
});

// ── seasonWindowForYear ──────────────────────────────────────

describe("seasonWindowForYear", () => {
  it("returns override when present", () => {
    const g = makeGreen({
      seasons: [{ year: 2027, startDate: "2027-03-15", endDate: "2027-10-15" }],
    });
    expect(seasonWindowForYear(g, 2027)).toEqual({
      start: "2027-03-15",
      end: "2027-10-15",
    });
  });

  it("falls back to recurring MM-DD", () => {
    const g = makeGreen();
    expect(seasonWindowForYear(g, 2026)).toEqual({
      start: "2026-04-01",
      end: "2026-09-30",
    });
  });

  it("returns null when nothing configured", () => {
    const g = makeGreen({ seasonStartMMDD: null, seasonEndMMDD: null });
    expect(seasonWindowForYear(g, 2026)).toBeNull();
  });
});

// ── bookableYears ────────────────────────────────────────────

describe("bookableYears", () => {
  it("returns current + horizon years for allWeather", () => {
    const g = makeGreen({ allWeather: true });
    expect(bookableYears(g, "2026-05-03", 2)).toEqual([2026, 2027, 2028]);
  });

  it("returns current + horizon for recurring pattern", () => {
    const g = makeGreen();
    expect(bookableYears(g, "2026-05-03", 2)).toEqual([2026, 2027, 2028]);
  });

  it("includes year with override even without recurring pattern", () => {
    const g = makeGreen({
      seasonStartMMDD: null,
      seasonEndMMDD: null,
      seasons: [{ year: 2027, startDate: "2027-04-01", endDate: "2027-09-30" }],
    });
    // 2026 + 2028 have no season → not bookable-via-season,
    // but no season means "always open", so they appear via recurring=null too
    // Actually: no recurring + no override → null → always open → NOT in bookableYears
    // only 2027 has an override
    expect(bookableYears(g, "2026-05-03", 2)).toEqual([2027]);
  });
});

// ── seasonLabel ──────────────────────────────────────────────

describe("seasonLabel", () => {
  it("all-weather", () => {
    expect(seasonLabel(makeGreen({ allWeather: true }), 2026)).toBe(
      "All weather — open year-round",
    );
  });

  it("recurring window", () => {
    expect(seasonLabel(makeGreen(), 2026)).toBe("2026-04-01 – 2026-09-30");
  });

  it("no season", () => {
    expect(
      seasonLabel(
        makeGreen({ seasonStartMMDD: null, seasonEndMMDD: null }),
        2026,
      ),
    ).toBe("No season configured");
  });
});
