// Keep the Jest suite independent of any local Unleash configuration.
//
// Once Unleash is configured locally (UNLEASH_URL + UNLEASH_API_TOKEN in .env,
// see #feature-management), the flag router would send PLATFORM flags to the live
// Unleash server. Unit/integration tests must not depend on an external service,
// so we clear these here: the general suite then always exercises the Postgres
// fallback path (which is also what CI sees — CI has no Unleash).
//
// The live Unleash evaluation path is covered hermetically by
// src/lib/flags/__tests__ (bootstrap fixtures with no server, plus a mocked
// getUnleash in router.test.ts), so nothing is lost by clearing these globally.
delete process.env.UNLEASH_URL;
delete process.env.UNLEASH_API_TOKEN;
delete process.env.UNLEASH_ADMIN_TOKEN;
