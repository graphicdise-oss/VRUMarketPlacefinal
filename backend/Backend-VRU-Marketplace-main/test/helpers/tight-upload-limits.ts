/**
 * Imported first by `upload-limits.spec.ts` (§100): the upload ceilings squeezed so a test can reach
 * them — one image processed at a time and no waiting for a turn, three uploads an hour per account.
 *
 * A module of its own because ES imports are hoisted: an assignment in the spec body would run after
 * `test-app.ts` (and the configuration it loads) had already been imported. Each spec file runs in
 * its own process, so this never reaches the rest of the suite.
 */
process.env.IMAGE_PROCESSING_CONCURRENCY = '1';
process.env.IMAGE_PROCESSING_QUEUE_TIMEOUT_MS = '0';
process.env.RATE_LIMIT_UPLOAD_PER_HOUR = '3';
