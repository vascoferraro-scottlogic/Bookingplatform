import { NextResponse } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertRoleOrFail, rejectIfImpersonating } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { promoteVersion, rejectVersion, getActiveVersion } from "@/lib/model/registry";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8001";
const ML_TRAIN_SECRET = process.env.ML_TRAIN_SECRET ?? "";

/**
 * POST /api/admin/model/retrain
 *
 * Triggers a training run on the ML sidecar, then applies the
 * champion/challenger promotion gate:
 *  - If no champion exists → auto-promote (bootstrap).
 *  - If challenger ROC-AUC >= champion ROC-AUC - tolerance → promote + reload.
 *  - Otherwise → reject candidate.
 *
 * Returns the new version's metrics and promotion outcome.
 */
export async function POST() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  // 1. Trigger training on the sidecar
  let trainResult: Record<string, unknown>;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (ML_TRAIN_SECRET) headers["Authorization"] = `Bearer ${ML_TRAIN_SECRET}`;
    const res = await fetch(`${ML_SERVICE_URL}/train`, { method: "POST", headers });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return jsonError(`ML sidecar training failed: ${detail}`, 502);
    }
    trainResult = (await res.json()) as Record<string, unknown>;
  } catch (e) {
    return jsonError(`ML sidecar unreachable: ${(e as Error).message}`, 502);
  }

  const candidateVersion = trainResult.modelVersion as string;
  if (!candidateVersion) {
    return jsonError("Sidecar did not return a modelVersion", 502);
  }

  // 2. Champion/challenger gate
  const ROC_AUC_TOLERANCE = 0.02; // allow up to 2pp degradation before rejecting
  const champion = await getActiveVersion();
  let promoted = false;
  let outcome: "bootstrap_promoted" | "promoted" | "rejected";

  if (!champion || trainResult.bootstrapPromoted) {
    // Already bootstrap-promoted by train.py
    outcome = "bootstrap_promoted";
    promoted = true;
  } else {
    const challengerAuc = typeof trainResult.rocAuc === "number" ? trainResult.rocAuc : 0;
    const championAuc = champion.rocAuc ?? 0;

    if (challengerAuc >= championAuc - ROC_AUC_TOLERANCE) {
      await promoteVersion(candidateVersion);
      promoted = true;
      outcome = "promoted";
    } else {
      await rejectVersion(
        candidateVersion,
        `ROC-AUC ${challengerAuc.toFixed(4)} < champion ${championAuc.toFixed(4)} - ${ROC_AUC_TOLERANCE}`,
      );
      outcome = "rejected";
    }
  }

  // 3. If promoted, tell the sidecar to reload the ACTIVE model
  if (promoted) {
    try {
      await fetch(`${ML_SERVICE_URL}/reload`, { method: "POST" });
    } catch {
      // Non-fatal — sidecar will pick it up on next restart
    }
  }

  logAudit({
    session,
    action: `ml.model_${outcome}`,
    entity: "MlModelVersion",
    entityId: candidateVersion,
    meta: { candidateVersion, outcome, rocAuc: trainResult.rocAuc, championVersion: champion?.version },
  });

  return NextResponse.json({
    version: candidateVersion,
    outcome,
    metrics: trainResult,
    champion: champion ? { version: champion.version, rocAuc: champion.rocAuc } : null,
  });
}
