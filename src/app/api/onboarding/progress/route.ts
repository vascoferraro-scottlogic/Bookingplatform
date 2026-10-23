import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { TOTAL_CHAPTERS, parseCompleted, chapterDataComplete } from "@/lib/onboarding/chapters";

const CURRENT_SCHEMA_VERSION = 2; // bump when chapter set changes shape

/**
 * One-shot, idempotent migration of in-progress users from a previous chapter
 * numbering. Driven by `OnboardingProgress.schemaVersion` so it runs at most
 * once per row. See decisions log 2026-05-04 (chapter renumber strategy).
 *
 * v1 → v2: inserted "organisation" at slot 2; everything ≥ 2 shifts up by 1.
 * `currentChapter` advances too so the user lands back where they were
 * conceptually (not back at chapter 2 to redo what they thought was chapter 2).
 */
function migrateProgress(
  schemaVersion: number,
  currentChapter: number,
  completedChapters: number[],
): { schemaVersion: number; currentChapter: number; completedChapters: number[] } {
  let v = schemaVersion;
  let cur = currentChapter;
  let done = completedChapters.slice();

  if (v < 2) {
    cur = cur >= 2 ? cur + 1 : cur;
    done = done.map((c) => (c >= 2 ? c + 1 : c));
    v = 2;
  }

  return { schemaVersion: v, currentChapter: cur, completedChapters: done };
}

/** Get the current tenant's onboarding progress (creates a row if missing). */
export async function GET(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  let progress = await prisma.onboardingProgress.findUnique({ where: { tenantId } });
  if (!progress) {
    // A live tenant has finished the wizard: don't create a progress row for
    // it (that would send admin logins back into the wizard).
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true, goLiveAt: true },
    });
    if (tenant && (tenant.status === "ACTIVE" || tenant.goLiveAt)) {
      return NextResponse.json({
        tenantId,
        currentChapter: TOTAL_CHAPTERS,
        completedChapters: Array.from({ length: TOTAL_CHAPTERS }, (_, i) => i + 1),
        completedAt: tenant.goLiveAt,
        lastAnswerAt: null,
        totalChapters: TOTAL_CHAPTERS,
        isComplete: true,
      });
    }
    progress = await prisma.onboardingProgress.create({
      data: { tenantId, currentChapter: 1, completedChapters: "[]" },
    });
  }

  // If this row was created under an older chapter numbering, shift it
  // forward in place. Idempotent — schemaVersion guards re-runs.
  if (progress.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const migrated = migrateProgress(
      progress.schemaVersion,
      progress.currentChapter,
      parseCompleted(progress.completedChapters),
    );
    progress = await prisma.onboardingProgress.update({
      where: { tenantId },
      data: {
        schemaVersion: migrated.schemaVersion,
        currentChapter: migrated.currentChapter,
        completedChapters: JSON.stringify(migrated.completedChapters),
      },
    });
    logAudit({
      session,
      action: "onboarding.progress.migrated",
      entity: "OnboardingProgress",
      entityId: progress.id,
      tenantId,
      meta: { from: CURRENT_SCHEMA_VERSION - 1, to: CURRENT_SCHEMA_VERSION },
    });
  }

  return NextResponse.json({
    tenantId: progress.tenantId,
    currentChapter: progress.currentChapter,
    completedChapters: parseCompleted(progress.completedChapters),
    completedAt: progress.completedAt,
    lastAnswerAt: progress.lastAnswerAt,
    totalChapters: TOTAL_CHAPTERS,
    isComplete: !!progress.completedAt,
  });
}

/**
 * Mark a chapter completed and/or set the current chapter.
 * Body: { chapter?: number; markComplete?: boolean }
 *  - chapter: which chapter the user is on / just completed
 *  - markComplete: request that `chapter` be added to completedChapters; it is
 *    only recorded when the chapter's data is present (derived server-side)
 * If completedChapters then includes all 1..TOTAL_CHAPTERS, sets completedAt.
 */
export async function POST(req: NextRequest) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertEffectiveRoleOrFail(session, "TENANT_ADMIN");
  if (roleErr) return roleErr;

  const { tenantId, error: tErr } = resolveTenantId(session, req);
  if (tErr) return tErr;

  let body: { chapter?: number; markComplete?: boolean };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const { chapter, markComplete } = body;
  if (chapter !== undefined && (typeof chapter !== "number" || chapter < 1 || chapter > TOTAL_CHAPTERS)) {
    return jsonError(`chapter must be between 1 and ${TOTAL_CHAPTERS}`);
  }

  const existing = await prisma.onboardingProgress.findUnique({ where: { tenantId } });
  const completed = new Set(existing ? parseCompleted(existing.completedChapters) : []);
  // Completion is derived server-side: the chapter's data must actually exist.
  let chapterCompleted = false;
  if (markComplete && chapter !== undefined) {
    chapterCompleted = await chapterDataComplete(tenantId, chapter, {
      completed,
      subscriptionAttestedAt: existing?.subscriptionAttestedAt ?? null,
    });
    if (chapterCompleted) completed.add(chapter);
  }

  const next = chapter !== undefined ? chapter : (existing?.currentChapter ?? 1);

  // NB: completedAt is no longer auto-set when all chapters done. Going live
  // is the explicit completion event, handled by `/api/onboarding/go-live`.
  const data = {
    currentChapter: next,
    completedChapters: JSON.stringify(Array.from(completed).sort((a, b) => a - b)),
    completedAt: existing?.completedAt ?? null,
    lastAnswerAt: new Date(),
  };

  const progress = await prisma.onboardingProgress.upsert({
    where: { tenantId },
    create: { tenantId, ...data },
    update: data,
  });

  if (chapterCompleted) {
    logAudit({ session, action: "onboarding.chapter.completed", entity: "OnboardingProgress", entityId: progress.id, tenantId, meta: { chapter } });
  }

  return NextResponse.json({
    tenantId: progress.tenantId,
    currentChapter: progress.currentChapter,
    completedChapters: parseCompleted(progress.completedChapters),
    completedAt: progress.completedAt,
    lastAnswerAt: progress.lastAnswerAt,
    totalChapters: TOTAL_CHAPTERS,
    isComplete: !!progress.completedAt,
  });
}
