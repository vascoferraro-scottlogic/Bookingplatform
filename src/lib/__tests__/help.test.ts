import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { prisma } from "@/lib/prisma";

// help.ts honours HELP_CONTENT_ROOT when set, so tests can point it at a
// throwaway temp tree without disturbing process.cwd() (which Prisma uses
// to auto-load .env).

let workdir: string;
let tenantId: string;
let userId: string;

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

  const tenant = await prisma.tenant.create({
    data: { name: "Help Test Club", slug: "help-test-" + Date.now() },
  });
  tenantId = tenant.id;
  const user = await prisma.user.create({
    data: {
      email: `help-test-${Date.now()}@example.com`,
      passwordHash: "x",
      role: "TENANT_ADMIN",
      tenantId,
    },
  });
  userId = user.id;
});

afterAll(async () => {
  delete process.env.HELP_CONTENT_ROOT;
  await prisma.helpArticleOverride.deleteMany({ where: { tenantId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.tenant.delete({ where: { id: tenantId } });
  await fs.rm(workdir, { recursive: true, force: true });
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.helpArticleOverride.deleteMany({ where: { tenantId } });
});

// Lazily require help.ts inside tests so process.cwd() is already swapped.
function loadHelp() {
  jest.resetModules();
  return require("@/lib/help");
}

describe("listArticles — audience filtering", () => {
  test("tenant admins do NOT see platform-admin-only articles", async () => {
    const help = loadHelp();
    const list = await help.listArticles({ locale: "en", realRole: "TENANT_ADMIN" });
    const slugs = list.map((a: { slug: string }) => a.slug);
    expect(slugs).toContain("approve");
    expect(slugs).not.toContain("impersonation");
  });

  test("platform admins see platform-only articles", async () => {
    const help = loadHelp();
    const list = await help.listArticles({ locale: "en", realRole: "PLATFORM_ADMIN" });
    const slugs = list.map((a: { slug: string }) => a.slug);
    expect(slugs).toContain("approve");
    expect(slugs).toContain("impersonation");
  });
});

describe("getArticle — locale fallback", () => {
  test("returns localised body when present", async () => {
    const help = loadHelp();
    const a = await help.getArticle({ slug: "approve", locale: "cy", realRole: "TENANT_ADMIN" });
    expect(a).toBeTruthy();
    expect(a.title).toBe("Cymeradwyo archebion");
    expect(a.fallbackFromEnglish).toBe(false);
    expect(a.body.trim()).toBe("Corff CY.");
  });

  test("falls back to English when locale missing", async () => {
    const help = loadHelp();
    const a = await help.getArticle({ slug: "approve", locale: "fr", realRole: "TENANT_ADMIN" });
    expect(a).toBeTruthy();
    expect(a.title).toBe("Approve bookings");
    expect(a.fallbackFromEnglish).toBe(true);
  });

  test("returns null for unknown slug", async () => {
    const help = loadHelp();
    const a = await help.getArticle({ slug: "does-not-exist", locale: "en", realRole: "TENANT_ADMIN" });
    expect(a).toBeNull();
  });
});

describe("overrides", () => {
  test("override title replaces shipped title", async () => {
    await prisma.helpArticleOverride.create({
      data: {
        tenantId,
        slug: "approve",
        locale: "en",
        title: "Custom approval guide",
        body: "Custom body.",
        enabled: true,
        createdById: userId,
      },
    });
    const help = loadHelp();
    const a = await help.getArticle({ slug: "approve", locale: "en", tenantId, realRole: "TENANT_ADMIN" });
    expect(a.title).toBe("Custom approval guide");
    expect(a.body).toBe("Custom body.");
    expect(a.overridden).toBe(true);
  });

  test("disabled override hides the article from listings AND fetches", async () => {
    await prisma.helpArticleOverride.create({
      data: { tenantId, slug: "approve", locale: "en", enabled: false, createdById: userId },
    });
    const help = loadHelp();
    const list = await help.listArticles({ locale: "en", tenantId, realRole: "TENANT_ADMIN" });
    expect(list.find((a: { slug: string }) => a.slug === "approve")).toBeUndefined();
    const single = await help.getArticle({ slug: "approve", locale: "en", tenantId, realRole: "TENANT_ADMIN" });
    expect(single).toBeNull();
  });

  test("locale-specific override wins over English override", async () => {
    await prisma.helpArticleOverride.create({
      data: { tenantId, slug: "approve", locale: "en", title: "EN override", enabled: true, createdById: userId },
    });
    await prisma.helpArticleOverride.create({
      data: { tenantId, slug: "approve", locale: "cy", title: "CY override", enabled: true, createdById: userId },
    });
    const help = loadHelp();
    const a = await help.getArticle({ slug: "approve", locale: "cy", tenantId, realRole: "TENANT_ADMIN" });
    expect(a.title).toBe("CY override");
  });
});

describe("listArticles — query and category filters", () => {
  test("category filter narrows the result set", async () => {
    const help = loadHelp();
    const list = await help.listArticles({ locale: "en", realRole: "PLATFORM_ADMIN", category: "bookings" });
    const slugs = list.map((a: { slug: string }) => a.slug);
    expect(slugs).toContain("approve");
    expect(slugs).not.toContain("impersonation");
  });

  test("query matches across title, excerpt and tags", async () => {
    const help = loadHelp();
    const list = await help.listArticles({ locale: "en", realRole: "TENANT_ADMIN", query: "approval" });
    expect(list.some((a: { slug: string }) => a.slug === "approve")).toBe(true);
  });
});
