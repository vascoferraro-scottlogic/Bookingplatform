import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionOrFail, assertEffectiveRoleOrFail, jsonError } from "@/lib/api-utils";
import { resolveTenantId } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

const TOTAL_CHAPTERS = 10;
const CURRENT_SCHEMA_VERSION = 2; // bump when chapter set changes shape

function parseCompleted(json: string): number[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed.filter((n): n is number => typeof n === "number");
    return [];
  } catch {
    return [];
  }
}

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
 *  - markComplete: also add `chapter` to completedChapters
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
  if (markComplete && chapter !== undefined) completed.add(chapter);

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

  if (markComplete && chapter !== undefined) {
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
