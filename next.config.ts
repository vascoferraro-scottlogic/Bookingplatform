import type { NextConfig } from "next";
import { execSync } from "child_process";
import createNextIntlPlugin from "next-intl/plugin";

const pkg = require("./package.json");

/**
 * Release identifier = "<version>-<git sha>". Used as the observability
 * `release` tag and the `X-App-Version` header. Docker builds have no `.git`,
 * so prefer the APP_VERSION build arg, fall back to `git rev-parse`, and never
 * let a missing git tree break the build.
 */
function resolveAppVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    const gitSha = execSync("git rev-parse --short HEAD").toString().trim();
    return `${pkg.version}-${gitSha}`;
  } catch {
    return `${pkg.version}-unknown`;
  }
}

const appVersion = resolveAppVersion();

const nextConfig: NextConfig = {
  // Self-contained server bundle for slim Docker images (blue/green colours).
  output: "standalone",
  reactStrictMode: true,
  // Inline the release at build time so server + client can read it at runtime.
  env: {
    APP_VERSION: appVersion,
  },
  headers: async () => [
    {
      source: "/:path*",
      headers: [{ key: "X-App-Version", value: appVersion }],
    },
  ],
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
export default withNextIntl(nextConfig);
