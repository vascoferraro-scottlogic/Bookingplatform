jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);

import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { prismaMock } from "@/test-utils/prisma-mock";

// help.ts reads HELP_CONTENT_ROOT once at import time, so the shipped articles
// live in a throwaway temp tree and help.ts is required only after the env var
// is set. Per-tenant overrides come from prisma.helpArticleOverride (mocked).

type HelpModule = typeof import("@/lib/help");
let help: HelpModule;
let workdir: string;

const TENANT_ID = "tenant-1";

async function writeArticle(rel: string, body: string) {
  const fp = path.join(workdir, rel);
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, body, "utf8");
}

beforeAll(async () => {
  workdir = await fs.mkdtemp(path.join(os.tmpdir(), "help-test-"));
  process.env.HELP_CONTENT_ROOT = workdir;

  await writeArticle(
    "en/bookings/approve.md",
    `---\ntitle: Approve bookings\ncategory: bookings\naudience: tenant_admin\ntags: [approval]\norder: 10\nexcerpt: How to approve.\n---\nBody EN.`,
  );
  await writeArticle(
    "en/users-roles/impersonation.md",
    `---\ntitle: Impersonation\ncategory: users-roles\naudience: platform_admin\norder: 20\nexcerpt: Platform admin only.\n---\nBody.`,
  );
  await writeArticle(
    "cy/bookings/approve.md",
    `---\ntitle: Cymeradwyo archebion\ncategory: bookings\naudience: tenant_admin\norder: 10\nexcerpt: Sut i gymeradwyo.\n---\nCorff CY.`,
  );

  // [B-21] fixtures: an article whose search term appears only in the body,
  // and two files outside the en/cy locale trees that path traversal could reach.
  await writeArticle(
    "en/grounds/mowing.md",
    `---\ntitle: Green care\ncategory: grounds\naudience: tenant_admin\ntags: [greens]\norder: 30\nexcerpt: Looking after the green.\n---\nRun the scarifier twice a season.`,
  );
  await writeArticle(
    "outside.md",
    `---\ntitle: Leaked outside file\ncategory: bookings\naudience: tenant_admin\n---\nSecret.`,
  );
  await writeArticle(
    "private/bookings/approve.md",
    `---\ntitle: Leaked private locale\ncategory: bookings\naudience: tenant_admin\n---\nSecret.`,
  );

  help = require("@/lib/help");
});

afterAll(async () => {
  delete process.env.HELP_CONTENT_ROOT;
  await fs.rm(workdir, { recursive: true, force: true });
});

function givenOverrides(rows: Array<{ slug: string; locale: string; enabled: boolean; title?: string | null; body?: string | null }>) {
  prismaMock.helpArticleOverride.findMany.mockResolvedValue(
    rows.map((r) => ({ title: null, body: null, ...r })) as never,
  );
}

describe("listArticles — audience filtering", () => {
  test("tenant admins do NOT see platform-admin-only articles", async () => {
    const list = await help.listArticles({ locale: "en", realRole: "TENANT_ADMIN" });
    const slugs = list.map((a) => a.slug);
    expect(slugs).toContain("approve");
    expect(slugs).not.toContain("impersonation");
  });

  test("platform admins see platform-only articles", async () => {
    const list = await help.listArticles({ locale: "en", realRole: "PLATFORM_ADMIN" });
    const slugs = list.map((a) => a.slug);
    expect(slugs).toContain("approve");
    expect(slugs).toContain("impersonation");
  });

  test("without a tenant, overrides are not looked up", async () => {
    await help.listArticles({ locale: "en", realRole: "TENANT_ADMIN" });
    expect(prismaMock.helpArticleOverride.findMany).not.toHaveBeenCalled();
  });
});

describe("getArticle — locale fallback", () => {
  test("returns localised body when present", async () => {
    const a = await help.getArticle({ slug: "approve", locale: "cy", realRole: "TENANT_ADMIN" });
    expect(a).toBeTruthy();
    expect(a!.title).toBe("Cymeradwyo archebion");
    expect(a!.fallbackFromEnglish).toBe(false);
    expect(a!.body.trim()).toBe("Corff CY.");
  });

  test("falls back to English when locale missing", async () => {
    const a = await help.getArticle({ slug: "approve", locale: "fr", realRole: "TENANT_ADMIN" });
    expect(a).toBeTruthy();
    expect(a!.title).toBe("Approve bookings");
    expect(a!.fallbackFromEnglish).toBe(true);
  });

  test("returns null for unknown slug", async () => {
    const a = await help.getArticle({ slug: "does-not-exist", locale: "en", realRole: "TENANT_ADMIN" });
    expect(a).toBeNull();
  });
});

describe("overrides", () => {
  // Overrides apply only while the helpOverrides flag is on (FR-HLP-002).
  beforeEach(() => {
    prismaMock.featureFlag.findUnique.mockResolvedValue({ enabled: true } as never);
    prismaMock.featureFlag.findMany.mockResolvedValue([{ key: "helpOverrides", enabled: true }] as never);
  });

  test("override title replaces shipped title", async () => {
    givenOverrides([{ slug: "approve", locale: "en", title: "Custom approval guide", body: "Custom body.", enabled: true }]);

    const a = await help.getArticle({ slug: "approve", locale: "en", tenantId: TENANT_ID, realRole: "TENANT_ADMIN" });

    expect(a!.title).toBe("Custom approval guide");
    expect(a!.body).toBe("Custom body.");
    expect(a!.overridden).toBe(true);
    expect(prismaMock.helpArticleOverride.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, locale: { in: ["en"] } },
      select: { slug: true, locale: true, enabled: true, title: true, body: true },
    });
  });

  test("disabled override hides the article from listings AND fetches", async () => {
    givenOverrides([{ slug: "approve", locale: "en", enabled: false }]);

    const list = await help.listArticles({ locale: "en", tenantId: TENANT_ID, realRole: "TENANT_ADMIN" });
    expect(list.find((a) => a.slug === "approve")).toBeUndefined();
    const single = await help.getArticle({ slug: "approve", locale: "en", tenantId: TENANT_ID, realRole: "TENANT_ADMIN" });
    expect(single).toBeNull();
  });

  test("locale-specific override wins over English override", async () => {
    // Rows deliberately returned CY-first to prove the merge, not the query order, decides.
    givenOverrides([
      { slug: "approve", locale: "cy", title: "CY override", enabled: true },
      { slug: "approve", locale: "en", title: "EN override", enabled: true },
    ]);

    const a = await help.getArticle({ slug: "approve", locale: "cy", tenantId: TENANT_ID, realRole: "TENANT_ADMIN" });

    expect(a!.title).toBe("CY override");
    expect(prismaMock.helpArticleOverride.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT_ID, locale: { in: ["cy", "en"] } } }),
    );
  });
});

describe("listArticles — query and category filters", () => {
  test("category filter narrows the result set", async () => {
    const list = await help.listArticles({ locale: "en", realRole: "PLATFORM_ADMIN", category: "bookings" });
    const slugs = list.map((a) => a.slug);
    expect(slugs).toContain("approve");
    expect(slugs).not.toContain("impersonation");
  });

  test("query matches across title, excerpt and tags", async () => {
    const list = await help.listArticles({ locale: "en", realRole: "TENANT_ADMIN", query: "approval" });
    expect(list.some((a) => a.slug === "approve")).toBe(true);
  });
});

describe("[B-21] help content — path safety, full-text search, flag-gated overrides", () => {
  test("[B-21] FR-HLP-001 – a slug containing '../' is not found", async () => {
    const a = await help.getArticle({ slug: "../../outside", locale: "en", realRole: "TENANT_ADMIN" });
    expect(a).toBeNull();
  });

  test("[B-21] FR-HLP-001 – a locale containing '../' is not found", async () => {
    const a = await help.getArticle({
      slug: "approve",
      locale: `../${path.basename(workdir)}/private`,
      realRole: "TENANT_ADMIN",
    });
    // Must not serve the file from outside the locale tree.
    expect(a?.title).not.toBe("Leaked private locale");
    expect(a).toBeNull();
  });

  test("[B-21] FR-HLP-001 – search matches body text, not only title / excerpt / tags", async () => {
    const list = await help.listArticles({ locale: "en", realRole: "TENANT_ADMIN", query: "scarifier" });
    expect(list.map((a) => a.slug)).toContain("mowing");
  });

  describe("overrides with the helpOverrides flag OFF", () => {
    const { signInAs } = require("@/test-utils/session") as typeof import("@/test-utils/session");
    const { request, readJson, routeParams } = require("@/test-utils/http") as typeof import("@/test-utils/http");

    beforeEach(() => {
      // Every flag reads Postgres in tests (Unleash unconfigured); helpOverrides is off.
      prismaMock.featureFlag.findUnique.mockImplementation((async ({ where }: any) =>
        ({ tenantId: where.tenantId_key.tenantId, key: where.tenantId_key.key, enabled: where.tenantId_key.key !== "helpOverrides" })) as never);
      prismaMock.featureFlag.findMany.mockResolvedValue([{ key: "helpOverrides", enabled: false }] as never);
      signInAs({ id: "admin-1", role: "TENANT_ADMIN", tenantId: TENANT_ID });
    });

    test("[B-21] FR-HLP-002 – GET /api/help/[slug] ignores a tenant's override when the flag is off", async () => {
      givenOverrides([{ slug: "approve", locale: "en", title: "Custom approval guide", body: "Custom body.", enabled: true }]);
      const { GET } = require("@/app/api/help/[slug]/route");

      const { status, body } = await readJson(await GET(request("/api/help/approve?locale=en"), routeParams({ slug: "approve" })));

      expect(status).toBe(200);
      expect(body.title).toBe("Approve bookings");
      expect(body.overridden).toBe(false);
    });

    test("[B-21] FR-HLP-002 – GET /api/help does not hide articles via a disabled override when the flag is off", async () => {
      givenOverrides([{ slug: "approve", locale: "en", enabled: false }]);
      const { GET } = require("@/app/api/help/route");

      const { status, body } = await readJson(await GET(request("/api/help?locale=en")));

      expect(status).toBe(200);
      expect(body.map((a: any) => a.slug)).toContain("approve");
    });
  });
});
