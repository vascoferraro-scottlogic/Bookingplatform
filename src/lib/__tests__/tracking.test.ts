import { parseUserAgent, detectDeviceType, hashFingerprint } from "@/lib/tracking";

// ── parseUserAgent: Browser Detection ─────────────────────

describe("parseUserAgent", () => {
  const browserCases: [string, string, string | null][] = [
    // [UA string, expected browser, expected major version]
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91",
      "Edge",
      "120",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0",
      "Opera",
      "106",
    ],
    [
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
      "Samsung Internet",
      "23",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Chrome",
      "120",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; rv:121.0) Gecko/20100101 Firefox/121.0",
      "Firefox",
      "121",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
      "Safari",
      "17",
    ],
    [
      "Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; Trident/6.0)",
      "Internet Explorer",
      "10",
    ],
    [
      "Mozilla/5.0 (Windows NT 6.3; Trident/7.0; rv:11.0) like Gecko",
      "Internet Explorer",
      "11",
    ],
  ];

  test.each(browserCases)("detects %s as %s v%s", (ua, expectedBrowser, expectedVersion) => {
    const { browserFamily, browserVersion } = parseUserAgent(ua);
    expect(browserFamily).toBe(expectedBrowser);
    expect(browserVersion).toBe(expectedVersion);
  });

  test("returns Other for unknown browser", () => {
    const { browserFamily, browserVersion } = parseUserAgent("SomeRandomBot/1.0");
    expect(browserFamily).toBe("Other");
    expect(browserVersion).toBeNull();
  });

  test("Edge matches before Chrome (both present in UA)", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91";
    expect(parseUserAgent(ua).browserFamily).toBe("Edge");
  });

  test("Opera matches before Chrome (both present in UA)", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0";
    expect(parseUserAgent(ua).browserFamily).toBe("Opera");
  });

  test("Samsung Internet matches before Chrome (both present in UA)", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36";
    expect(parseUserAgent(ua).browserFamily).toBe("Samsung Internet");
  });

  // ── OS Detection ──────────────────────────────────────────

  const osCases: [string, string][] = [
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)", "iOS"],
    ["Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X)", "iOS"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "macOS"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8)", "Android"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Windows"],
    ["Mozilla/5.0 (X11; Linux x86_64)", "Linux"],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)", "ChromeOS"],
  ];

  test.each(osCases)("detects OS from %s as %s", (ua, expectedOS) => {
    expect(parseUserAgent(ua).osFamily).toBe(expectedOS);
  });

  test("returns Other for unknown OS", () => {
    expect(parseUserAgent("SomeRandomBot/1.0").osFamily).toBe("Other");
  });

  test("iOS matches before macOS for iPhone UA", () => {
    // iPhone UAs sometimes contain Mac OS X in the string
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)";
    expect(parseUserAgent(ua).osFamily).toBe("iOS");
  });
});

// ── detectDeviceType ──────────────────────────────────────

describe("detectDeviceType", () => {
  test("detects mobile from Mobi keyword", () => {
    expect(detectDeviceType("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36")).toBe("mobile");
  });

  test("detects mobile from iPhone", () => {
    expect(detectDeviceType("Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X)")).toBe("mobile");
  });

  test("detects tablet from iPad", () => {
    expect(detectDeviceType("Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X)")).toBe("tablet");
  });

  test("detects tablet from Android without Mobile", () => {
    expect(detectDeviceType("Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36")).toBe("tablet");
  });

  test("falls back to desktop for standard desktop UA", () => {
    expect(detectDeviceType("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")).toBe("desktop");
  });

  test("falls back to desktop for unknown UA", () => {
    expect(detectDeviceType("SomeBot/1.0")).toBe("desktop");
  });
});

// ── hashFingerprint ───────────────────────────────────────

describe("hashFingerprint", () => {
  test("returns a 16-character hex string", () => {
    const hash = hashFingerprint("ua", "127.0.0.1");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  test("is deterministic for same inputs on same day", () => {
    const a = hashFingerprint("ua", "127.0.0.1");
    const b = hashFingerprint("ua", "127.0.0.1");
    expect(a).toBe(b);
  });

  test("differs for different UA strings", () => {
    const a = hashFingerprint("Chrome/120", "127.0.0.1");
    const b = hashFingerprint("Firefox/121", "127.0.0.1");
    expect(a).not.toBe(b);
  });

  test("differs for different IPs", () => {
    const a = hashFingerprint("ua", "10.0.0.1");
    const b = hashFingerprint("ua", "10.0.0.2");
    expect(a).not.toBe(b);
  });

  test("changes when the day changes", () => {
    const realDate = Date;
    const day1Hash = hashFingerprint("ua", "127.0.0.1");

    // Move clock forward by 2 days
    const mockDate = new Date("2099-01-01T00:00:00Z");
    jest.spyOn(global, "Date").mockImplementation(() => mockDate as unknown as Date);
    const day2Hash = hashFingerprint("ua", "127.0.0.1");

    jest.restoreAllMocks();
    expect(day1Hash).not.toBe(day2Hash);
  });
});
