#!/usr/bin/env node
/**
 * Runs Python with .env loaded, so the ML scripts see DATABASE_URL etc.
 * Picks `python` on Windows (where `python3` is the Microsoft Store stub) and
 * `python3` elsewhere; override with PYTHON=<path>.
 *
 * Usage: node scripts/run-python.mjs <python args...>
 *   e.g. node scripts/run-python.mjs -m uvicorn serve:app --app-dir ml --port 8001 --reload
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";

const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const result = spawnSync(python, process.argv.slice(2), { stdio: "inherit", env: process.env });

if (result.error) {
  console.error(`Could not run "${python}": ${result.error.message}`);
  console.error("Install Python 3 (python.org, not the Microsoft Store stub) and make sure it is on PATH, or set PYTHON.");
  process.exit(1);
}
process.exit(result.status ?? 1);
