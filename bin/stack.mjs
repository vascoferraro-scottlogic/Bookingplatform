#!/usr/bin/env node
// Cross-platform driver for the blue/green stack's compose lifecycle.
//
// Why this exists: the npm `stack:*` scripts used a Bash-only idiom
// (`APP_VERSION=$(git …) docker compose …`) that fails on Windows cmd and
// PowerShell. Each tester runs this lab on their own machine, and the team is
// Windows-heavy, so the entry point has to be shell-agnostic. Node is already
// a prerequisite, so we shell out from here instead.
//
//   node bin/stack.mjs build           # build images
//   node bin/stack.mjs up -d --build   # build + start detached
//   node bin/stack.mjs down            # stop (pgdata volume persists)
//   node bin/stack.mjs logs -f         # tail logs
//
// Pull path (prebuilt multi-arch images from GHCR, no local build):
//   node bin/stack.mjs pull --ghcr     # download the published images
//   node bin/stack.mjs up --ghcr -d    # start from them
// The --ghcr flag uses the standalone GHCR MVP compose file.
//
// Engine override: any Docker-compatible runtime works (Rancher Desktop,
// Podman, Colima, …). Default is `docker compose`; point it elsewhere with
//   COMPOSE_CMD="podman compose" npm run stack:up
import { spawnSync, execSync } from "node:child_process";

// --ghcr (anywhere in the args) selects the standalone GHCR services so they
// use published images instead of building. Strip it before forwarding.
const rawArgs = process.argv.slice(2);
const useGhcr = rawArgs.includes("--ghcr");
const args = rawArgs.filter((a) => a !== "--ghcr");
const sub = args[0];
if (!sub) {
  console.error(
    "Usage: node bin/stack.mjs [--ghcr] <build|up|down|logs|pull|…> [args…]",
  );
  process.exit(1);
}
const passthrough = args.slice(1);
const fileArgs = useGhcr ? ["-f", "docker-compose.ghcr.yml"] : [];

// Stamp /api/health with the short git SHA so testers can see which build a
// colour is serving. Off a git checkout we fall back to "dev"; compose also
// defaults APP_VERSION, so this is a nicety, not a hard dependency.
let appVersion = "dev";
try {
  appVersion =
    execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim() || "dev";
} catch {
  /* not a git checkout — fine, keep "dev" */
}

const [bin, ...baseArgs] = (process.env.COMPOSE_CMD || "docker compose")
  .split(" ")
  .filter(Boolean);

const res = spawnSync(bin, [...baseArgs, ...fileArgs, sub, ...passthrough], {
  stdio: "inherit",
  shell: true, // resolve `docker`/`podman` via PATH on Windows too
  env: { ...process.env, APP_VERSION: process.env.APP_VERSION || appVersion },
});

process.exit(res.status ?? 1);
