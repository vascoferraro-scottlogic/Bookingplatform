#!/usr/bin/env node
// Flip the live blue/green colour behind Caddy with a graceful, zero-downtime
// reload — the "promote a deploy" action testers practise in the infra lab.
//
// Rewritten from Bash to Node so it runs on Windows, macOS and Linux with no
// Git Bash/WSL needed (the team is Windows-heavy and each tester drives this
// themselves).
//
//   node bin/swap.mjs        # toggle to the other colour
//   node bin/swap.mjs blue   # force blue live
//   node bin/swap.mjs green  # force green live
//
// Engine override (Podman/Rancher/etc.): COMPOSE_CMD="podman compose".
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const snippet = join(root, "caddy", "live-upstream.caddy");

function currentColour() {
  try {
    return readFileSync(snippet, "utf8").includes("app-green") ? "green" : "blue";
  } catch {
    return "blue";
  }
}

let target = process.argv[2];
if (!target) {
  target = currentColour() === "blue" ? "green" : "blue";
}
if (target !== "blue" && target !== "green") {
  console.error("Usage: node bin/swap.mjs [blue|green]");
  process.exit(1);
}

// Rewrite the imported upstream snippet (bind-mounted :ro into Caddy), then
// hot-reload so in-flight requests/SSE streams drain gracefully.
writeFileSync(snippet, `reverse_proxy app-${target}:3000 {\n\tflush_interval -1\n}\n`);

console.log(`Reloading Caddy → live colour: ${target}`);
const [bin, ...baseArgs] = (process.env.COMPOSE_CMD || "docker compose")
  .split(" ")
  .filter(Boolean);

const res = spawnSync(
  bin,
  [
    ...baseArgs,
    "exec",
    "-T",
    "caddy",
    "caddy",
    "reload",
    "--config",
    "/etc/caddy/Caddyfile",
    "--adapter",
    "caddyfile",
  ],
  { stdio: "inherit", shell: true },
);

if (res.status !== 0) {
  process.exit(res.status ?? 1);
}
console.log(`Live colour is now: ${target}`);
