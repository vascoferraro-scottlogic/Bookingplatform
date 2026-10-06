import { captureError, deploymentContext, logEvent } from "@/lib/observability";

/**
 * Next.js instrumentation hook. Runs once per server runtime at startup —
 * announces which blue/green colour + release this container is serving so the
 * identity shows up in `docker compose logs`.
 */
export function register() {
  const { color, release } = deploymentContext();
  logEvent("info", "app boot", { node: process.version, color, release });
}

/**
 * Centralised server-side error capture. Catches errors from route handlers,
 * server components, and middleware in one place, tagged with the deployment
 * context — this is where blue/green × release attribution lives.
 */
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routePath?: string; routeType?: string },
) {
  captureError(error, {
    route: request?.path,
    method: request?.method,
    route_path: context?.routePath,
    route_type: context?.routeType,
  });
}
