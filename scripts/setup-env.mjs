#!/usr/bin/env node
// One-time local dev bootstrap: creates .env from .env.example and fills in
// the three values a basic local run needs (DATABASE_URL, NEXTAUTH_URL,
// NEXTAUTH_SECRET). Safe to re-run — never overwrites an existing .env.

import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const envPath = ".env";
const examplePath = ".env.example";

if (existsSync(envPath)) {
  console.log(".env already exists — leaving it untouched.");
  process.exit(0);
}

if (!existsSync(examplePath)) {
  console.error(`${examplePath} not found — run this from the repo root.`);
  process.exit(1);
}

copyFileSync(examplePath, envPath);

let contents = readFileSync(envPath, "utf8");
const secret = randomBytes(32).toString("base64");

const setOrAppend = (text, key, value) => {
  const line = `${key}="${value}"`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(text) ? text.replace(pattern, line) : `${text}\n${line}\n`;
};

contents = setOrAppend(contents, "DATABASE_URL", "postgresql://booking:booking@localhost:5432/bookingplatform");
contents = setOrAppend(contents, "NEXTAUTH_URL", "http://localhost:3000");
contents = setOrAppend(contents, "NEXTAUTH_SECRET", secret);

writeFileSync(envPath, contents);

console.log("Created .env with local defaults (DATABASE_URL, NEXTAUTH_URL, NEXTAUTH_SECRET).");
console.log("Everything else in .env.example is optional for a basic local run.");
