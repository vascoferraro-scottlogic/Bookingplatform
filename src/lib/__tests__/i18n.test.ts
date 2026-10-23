import fs from "fs";
import path from "path";

// request.ts wraps its loader in next-intl's getRequestConfig and reads the
// locale cookie; unwrap the loader and choose Welsh.
jest.mock("next-intl/server", () => ({ getRequestConfig: (fn: unknown) => fn }));
jest.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "locale" ? { value: "cy" } : undefined) }),
}));
// cy/common.json with one key removed (nav.bookings), so the fallback is
// exercised whether or not the real cy files are complete.
jest.mock("../../../content/messages/ui/cy/common.json", () => {
  const actual = jest.requireActual("../../../content/messages/ui/cy/common.json");
  const copy = JSON.parse(JSON.stringify(actual));
  delete copy.nav.bookings;
  return { __esModule: true, default: copy, ...copy };
});

const UI_DIR = path.join(__dirname, "../../../content/messages/ui");

/** Dot-paths of every leaf string in a message tree. */
function leafKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? leafKeys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

const readJsonFile = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const enNamespaces = fs.readdirSync(path.join(UI_DIR, "en")).filter((f) => f.endsWith(".json"));

describe("UI message catalogues (content/messages/ui)", () => {
  test.each(enNamespaces)("[B-89] FR-I18N-004 – every key in en/%s exists in cy (key parity)", (file) => {
    const cyFile = path.join(UI_DIR, "cy", file);
    expect({ file: `cy/${file}`, exists: fs.existsSync(cyFile) }).toEqual({ file: `cy/${file}`, exists: true });

    const cyKeys = new Set(leafKeys(readJsonFile(cyFile)));
    const missing = leafKeys(readJsonFile(path.join(UI_DIR, "en", file))).filter((k) => !cyKeys.has(k));

    // The failure message lists the missing keys.
    expect({ file: `cy/${file}`, missing }).toEqual({ file: `cy/${file}`, missing: [] });
  });
});

describe("message loading (src/i18n/request.ts)", () => {
  type Loaded = {
    locale: string;
    messages: Record<string, Record<string, unknown>>;
    getMessageFallback?: (info: { namespace?: string; key: string; error?: unknown }) => string;
  };

  async function loadCy(): Promise<Loaded> {
    const loader = (await import("@/i18n/request")).default as unknown as () => Promise<Loaded>;
    return loader();
  }

  /** What the user would see for namespace.key: the message, else the fallback handler's output. */
  function resolve(cfg: Loaded, namespace: string, key: string): string | undefined {
    const value = key.split(".").reduce<unknown>(
      (node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
      cfg.messages[namespace],
    );
    if (typeof value === "string") return value;
    return cfg.getMessageFallback?.({ namespace, key, error: new Error("MISSING_MESSAGE") });
  }

  test("[B-89] FR-I18N-002 – a key translated in cy is served in Welsh (guard)", async () => {
    const cfg = await loadCy();

    expect(cfg.locale).toBe("cy");
    expect(resolve(cfg, "common", "nav.notifications")).toBe(
      readJsonFile(path.join(UI_DIR, "cy", "common.json")).nav.notifications,
    );
  });

  test("[B-89] FR-I18N-002 – a key missing from cy falls back to the en string, not the raw key", async () => {
    const en = readJsonFile(path.join(UI_DIR, "en", "common.json"));
    const cfg = await loadCy();

    expect(resolve(cfg, "common", "nav.bookings")).toBe(en.nav.bookings);
  });
});
