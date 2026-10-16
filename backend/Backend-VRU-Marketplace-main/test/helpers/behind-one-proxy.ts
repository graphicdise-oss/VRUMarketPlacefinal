/**
 * Imported first by a spec that needs the app booted behind one proxy (TRUST_PROXY_HOPS=1).
 *
 * A module of its own because ES imports are hoisted: an assignment in the spec body would run
 * after `test-app.ts` (and the configuration it loads) had already been imported. Each spec file
 * runs in its own process, so this never reaches the rest of the suite.
 */
process.env.TRUST_PROXY_HOPS = '1';
