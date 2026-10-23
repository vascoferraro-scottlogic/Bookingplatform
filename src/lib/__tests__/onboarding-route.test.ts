jest.mock("@/lib/prisma", () => require("@/test-utils/prisma-mock").prismaModule);
jest.mock("next-auth", () => require("@/test-utils/session").nextAuthModule);
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));

import { prismaMock } from "@/test-utils/prisma-mock";
import { signInAs, signOut } from "@/test-utils/session";
import { jsonRequest, readJson, request } from "@/test-utils/http";
import { logAudit } from "@/lib/audit";
import { GET, POST } from "@/app/api/onboarding/progress/route";

const TENANT = "t1";

const getProgress = async () => readJson(await GET(request("/api/onboarding/progress")));
const postProgress = async (body: Record<string, unknown>) =>
  readJson(await POST(jsonRequest("POST", "/api/onboarding/progress", body)));

function progressRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    tenantId: TENANT,
    currentChapter: 1,
    completedChapters: "[]",
    completedAt: null,
    lastAnswerAt: null,
    schemaVersion: 2,
    ...overrides,
  };
}

beforeEach(() => {
  jest.mocked(logAudit).mockClear();
  signInAs({ id: "admin-1", role: "TENANT_ADMIN", tenantId: TENANT });
  // create / update / upsert echo the row they were asked to write.
  prismaMock.onboardingProgress.create.mockImplementation((async ({ data }: any) => progressRow(data)) as never);
  prismaMock.onboardingProgress.update.mockImplementation((async ({ data }: any) => progressRow(data)) as never);
  prismaMock.onboardingProgress.upsert.mockImplementation((async ({ update }: any) => progressRow(update)) as never);
});

describe("/api/onboarding/progress", () => {
  test("GET creates a progress row on first call", async () => {
    prismaMock.onboardingProgress.findUnique.mockResolvedValue(null);

    const { status, body } = await getProgress();

    expect(status).toBe(200);
    expect(body.tenantId).toBe(TENANT);
    expect(body.currentChapter).toBe(1);
    expect(body.completedChapters).toEqual([]);
    expect(body.isComplete).toBe(false);
    expect(body.totalChapters).toBe(10);
    expect(prismaMock.onboardingProgress.findUnique).toHaveBeenCalledWith({ where: { tenantId: TENANT } });
    expect(prismaMock.onboardingProgress.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT, currentChapter: 1, completedChapters: "[]" },
    });
  });

  test("POST advances current chapter and marks complete", async () => {
    prismaMock.onboardingProgress.findUnique.mockResolvedValue(progressRow() as never);

    const { status, body } = await postProgress({ chapter: 1, markComplete: true });

    expect(status).toBe(200);
    expect(body.completedChapters).toEqual([1]);
    expect(body.currentChapter).toBe(1);
    expect(body.isComplete).toBe(false);
    expect(body.lastAnswerAt).toBeTruthy();
    expect(prismaMock.onboardingProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT },
        update: expect.objectContaining({ currentChapter: 1, completedChapters: "[1]" }),
      }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "onboarding.chapter.completed", tenantId: TENANT, meta: { chapter: 1 } }),
    );
  });

  test("POST does NOT auto-set completedAt when all chapters done (go-live is the explicit completion event)", async () => {
    prismaMock.onboardingProgress.findUnique.mockResolvedValue(
      progressRow({ currentChapter: 9, completedChapters: JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9]) }) as never,
    );

    const { status, body } = await postProgress({ chapter: 10, markComplete: true });

    expect(status).toBe(200);
    expect(body.completedChapters).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(body.isComplete).toBe(false);
    expect(body.completedAt).toBeNull();
    expect(prismaMock.onboardingProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ completedAt: null }) }),
    );
  });

  test.each([99, 0])("POST rejects out-of-range chapter %p with 400", async (chapter) => {
    const { status } = await postProgress({ chapter });

    expect(status).toBe(400);
    expect(prismaMock.onboardingProgress.upsert).not.toHaveBeenCalled();
  });

  test("rejects unauthenticated callers", async () => {
    signOut();

    const { status } = await getProgress();

    expect(status).toBe(401);
    expect(prismaMock.onboardingProgress.findUnique).not.toHaveBeenCalled();
  });

  test("rejects USER role", async () => {
    signInAs({ id: "x", role: "USER", tenantId: TENANT });

    const { status } = await postProgress({ chapter: 1 });

    expect(status).toBe(403);
    expect(prismaMock.onboardingProgress.upsert).not.toHaveBeenCalled();
  });

  test("GET migrates v1 progress: chapters >= 2 shift up by 1, schemaVersion bumped", async () => {
    // A tenant who started onboarding under the old 9-chapter shape.
    prismaMock.onboardingProgress.findUnique.mockResolvedValue(
      progressRow({ currentChapter: 4, completedChapters: JSON.stringify([1, 2, 3]), schemaVersion: 1 }) as never,
    );

    const { status, body } = await getProgress();

    expect(status).toBe(200);
    // 1 stays; 2,3 shift to 3,4; current 4 -> 5.
    expect(body.completedChapters).toEqual([1, 3, 4]);
    expect(body.currentChapter).toBe(5);
    expect(prismaMock.onboardingProgress.update).toHaveBeenCalledWith({
      where: { tenantId: TENANT },
      data: { schemaVersion: 2, currentChapter: 5, completedChapters: "[1,3,4]" },
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "onboarding.progress.migrated", meta: { from: 1, to: 2 } }),
    );
  });

  test("GET does not re-migrate a v2 row (migration is idempotent)", async () => {
    // The row as the migration above left it.
    prismaMock.onboardingProgress.findUnique.mockResolvedValue(
      progressRow({ currentChapter: 5, completedChapters: "[1,3,4]", schemaVersion: 2 }) as never,
    );

    const { status, body } = await getProgress();

    expect(status).toBe(200);
    expect(body.completedChapters).toEqual([1, 3, 4]);
    expect(body.currentChapter).toBe(5);
    expect(prismaMock.onboardingProgress.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
