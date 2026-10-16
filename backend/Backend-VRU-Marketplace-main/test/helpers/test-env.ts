/**
 * Runs before every test file.
 *
 * One job: make sure the environment a test boots into is complete and obviously fake.
 * Emptying the database between cases is the other half of test isolation and belongs to
 * `setupTestApp()` in test-app.ts, which is the part that has an app to reset.
 */

// Placeholder values for everything the app validates at boot. Tests need a complete
// environment, but none of these are secrets and none of them reach a real service —
// BREVO_API_KEY in particular is never used because the tests bind a fake EmailSender (#19).
//
// DATABASE_URL is the exception: it must point at a real, disposable Postgres. Seam 1
// requires the real database, because later topics depend on behaviour SQLite does not have
// (conditional updates with a row count, pg_trgm). Override it from the environment to run
// the suite somewhere else.
const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL:
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/vru_marketplace_test',
  SUPER_ADMIN_EMAIL: 'superadmin@example.test',
  ACCOUNT_MARKER_PEPPER: 'test-pepper-not-a-real-secret-0000000000',
  ACCESS_TOKEN_SECRET: 'test-access-secret-not-a-real-secret-0000',
  REFRESH_TOKEN_SECRET: 'test-refresh-secret-not-a-real-secret-000',
  CSRF_SECRET: 'test-csrf-secret-not-a-real-secret-000000',
  VERIFICATION_TOKEN_SECRET: 'test-verification-secret-not-a-real-0000',
  UPLOAD_DIR: '/tmp/vru-marketplace-test-uploads',
  // §100: where an upload waits on disk while its request lasts — outside UPLOAD_DIR, which holds
  // only files that were validated and re-encoded.
  UPLOAD_TMP_DIR: '/tmp/vru-marketplace-test-upload-scratch',
  // Small on purpose: a test proving "too large is rejected" should not need to build a real
  // 10MB buffer just to cross the production ceiling.
  MAX_IMAGE_UPLOAD_BYTES: '1048576',
  BREVO_API_KEY: 'test-brevo-key-never-sent-anywhere',
  MAIL_FROM_ADDRESS: 'noreply@example.test',
  MAIL_FROM_NAME: 'VRU Marketplace (test)',
  FRONTEND_BASE_URL: 'http://localhost:5173',
  // Never used: the suite binds a fake GoogleIdentity, so nothing is ever sent to Google. They
  // are here because the app validates them at boot and would refuse to start without them.
  GOOGLE_CLIENT_ID: 'test-google-client-id.apps.googleusercontent.test',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret-never-sent-anywhere',
  GOOGLE_REDIRECT_URI: 'http://localhost:3001/api/v1/auth/google/callback',
  // No proxy in front of the suite, so `request.ip` is the socket address and every test client
  // shares it. That is the honest arrangement for testing a per-IP limit: two clients in one test
  // really are one source.
  TRUST_PROXY_HOPS: '0',
  // The one limit the suite raises above its production default (3).
  //
  // Two ceilings sit on the "send me a link" endpoints: this one, per (IP + email), and a
  // per-account count of rows inside the services. In production they are both 3 and that is
  // deliberate. In the suite every client shares one address, so leaving them equal would mean
  // the outer one always fires first and the inner one could be deleted without a single test
  // noticing. Five lets each be observed doing its own job.
  RATE_LIMIT_EMAIL_LINK_PER_HOUR: '5',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  // Anything already set in the real environment wins, so CI can point the suite at its own
  // database without editing this file.
  process.env[key] ??= value;
}

process.env.NODE_ENV = 'test';
