import { NextResponse } from "next/server";
import { getSessionOrFail, jsonError } from "@/lib/api-utils";
import { assertRoleOrFail, rejectIfImpersonating } from "@/lib/api-utils";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/model/health
 *
 * Returns the full Model Health summary for the dashboard:
 *  - Active model version + metrics
 *  - Version history (last 10)
 *  - Latest drift check
 *  - Feature definitions (enrolled / available / retired counts + list)
 *  - Sidecar liveness (via /health)
 */
export async function GET() {
  const { session, error } = await getSessionOrFail();
  if (error) return error;

  const roleErr = assertRoleOrFail(session, "PLATFORM_ADMIN");
  if (roleErr) return roleErr;
  const impErr = rejectIfImpersonating(session);
  if (impErr) return impErr;

  const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:8001";

  try {
  const [activeVersion, versionHistory, latestDriftCheck, features, sidecarHealth] =
    await Promise.allSettled([
      prisma.mlModelVersion.findFirst({ where: { status: "ACTIVE" } }),
      prisma.mlModelVersion.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      prisma.mlModelVersion
        .findFirst({ where: { status: "ACTIVE" } })
        .then((v) =>
          v
            ? prisma.mlDriftCheck.findFirst({
                where: { modelVersion: v.version },
                orderBy: { checkedAt: "desc" },
              })
            : null,
        ),
      prisma.mlFeatureDefinition.findMany({ orderBy: { createdAt: "asc" } }),
      fetch(`${ML_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) })
        .then((r) => r.json())
        .catch(() => ({ status: "unreachable", modelLoaded: false })),
    ]);

  return NextResponse.json({
    activeVersion: activeVersion.status === "fulfilled" ? activeVersion.value : null,
    versionHistory: versionHistory.status === "fulfilled" ? versionHistory.value : [],
    latestDriftCheck:
      latestDriftCheck.status === "fulfilled" ? latestDriftCheck.value : null,
    features: features.status === "fulfilled" ? features.value : [],
    sidecar: sidecarHealth.status === "fulfilled" ? sidecarHealth.value : { status: "unreachable" },
  });
  } catch (err) {
    console.error("[model/health] unhandled error:", err);
    return NextResponse.json({ error: "Internal server error", detail: String(err) }, { status: 500 });
  }
}
