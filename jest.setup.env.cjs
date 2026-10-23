// Unit tests run with a fixed, hermetic environment: .env is NOT loaded, so a
// developer's local configuration (database, Unleash, LLM keys, payment mode)
// can never change a test result or be touched by a test run.
//
// The live Unleash evaluation path is covered hermetically by
// src/lib/flags/__tests__ (bootstrap fixtures with no server, plus a mocked
// getUnleash in router.test.ts).
for (const key of Object.keys(process.env)) {
  if (/^(UNLEASH_|AGENT_|PAYMENT_|ML_|NEXT_PUBLIC_BETTER_STACK_)/.test(key)) {
    delete process.env[key];
  }
}

// Unit tests must not use a database. This URL points at a closed port so that
// anything bypassing the @/lib/prisma guard (see jest.setup.db-guard.ts) fails
// fast instead of reaching a real server.
process.env.DATABASE_URL =
  "postgresql://unit-tests-must-not-use-the-database@127.0.0.1:1/none";

process.env.NEXTAUTH_URL = "http://localhost:3000";
process.env.NEXTAUTH_SECRET = "unit-test-secret";
process.env.PAYMENT_PROVIDER = "stub";
process.env.PAYMENT_STUB_MODE = "immediate";
