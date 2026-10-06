import { NextRequest, NextResponse } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertRoleOrFail, rejectIfImpersonating } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/admin/model/features/[key]
 *
 * Enroll or retire a feature. Body: { action: "enroll" | "retire" }
 *
 * ENROLLED → makes the feature active for the next training run.
 * RETIRED  → excludes the feature from future training runs.
 *
 * Changes take effect on the next retrain, not on the live model.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { session, error } = await getSessionOrFail();
  if (error) return error;
  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const { key } = await params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = body.action as string | undefined;

  if (action !== "enroll" && action !== "retire") {
    return jsonError('Body must contain action: "enroll" or "retire"', 400);
  }

  const existing = await prisma.mlFeatureDefinition.findUnique({ where: { key } });
  if (!existing) return jsonError(`Feature "${key}" not found`, 404);

  if (action === "enroll" && existing.status === "ENROLLED") {
    return jsonError(`Feature "${key}" is already enrolled`, 409);
  }
  if (action === "retire" && existing.status === "RETIRED") {
    return jsonError(`Feature "${key}" is already retired`, 409);
  }
  if (action === "retire" && existing.status === "AVAILABLE") {
    return jsonError(`Feature "${key}" is AVAILABLE (not yet enrolled) — nothing to retire`, 409);
  }

  const now = new Date();
  const updated = await prisma.mlFeatureDefinition.update({
    where: { key },
    data: {
      status: action === "enroll" ? "ENROLLED" : "RETIRED",
      enrolledAt: action === "enroll" ? now : existing.enrolledAt,
      retiredAt: action === "retire" ? now : null,
      updatedAt: now,
    },
  });

  logAudit({
    session,
    action: `ml.feature_${action}ed`,
    entity: "MlFeatureDefinition",
    entityId: key,
    meta: { key, previousStatus: existing.status, newStatus: updated.status },
  });

  return NextResponse.json(updated);
}
