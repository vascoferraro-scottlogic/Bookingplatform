import type { NextRequest } from "next/server";

/**
 * Best-effort client address for rate-limit keys. Proxy headers are client-
 * controlled unless a trusted proxy overwrites them, so they are ignored
 * unless TRUSTED_PROXY_HEADERS=1 is set (off by default). Without them the
 * address is unknown and callers share one bucket, which fails safe.
 */
export function getClientIp(req: NextRequest): string {
  if (process.env.TRUSTED_PROXY_HEADERS === "1") {
    return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
  }
  return "unknown";
}
