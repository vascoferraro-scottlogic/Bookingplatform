import { NextResponse } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertRoleOrFail, rejectIfImpersonating } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8001";

/**
 * POST /api/admin/model/drift-check
 *
 * Triggers a windowed drift check on the ML sidecar.
 * The sidecar computes ROC-AUC / ECE / positive-rate over recent
 * labelled predictions and writes an MlDriftCheck row.
 */
export async function POST() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  let result: Record<string, unknown>;
  try {
    const res = await fetch(`${ML_SERVICE_URL}/drift`, { method: "POST" });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (res.status === 422) {
        // Sidecar returns 422 when there aren't enough labelled samples
        return jsonError(detail || "Not enough labelled predictions for drift check", 422);
      }
      return jsonError(`Drift check failed: ${detail}`, 502);
    }
    result = (await res.json()) as Record<string, unknown>;
  } catch (e) {
    return jsonError(`ML sidecar unreachable: ${(e as Error).message}`, 502);
  }

  logAudit({
    session,
    action: "ml.drift_check",
    entity: "MlDriftCheck",
    meta: { modelVersion: result.modelVersion, status: result.status, sampleCount: result.sampleCount },
  });

  return NextResponse.json(result);
}

/**
 * GET /api/admin/model/drift-check
 *
 * Returns recent drift checks for the active model version.
 */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const { prisma } = await import("@/lib/prisma");

  const active = await prisma.mlModelVersion.findFirst({ where: { status: "ACTIVE" } });
  if (!active) return NextResponse.json({ checks: [], activeVersion: null });

  const checks = await prisma.mlDriftCheck.findMany({
    where: { modelVersion: active.version },
    orderBy: { checkedAt: "desc" },
    take: 20,
  });

  return NextResponse.json({ activeVersion: active.version, checks });
}
