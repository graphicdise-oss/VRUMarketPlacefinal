/**
 * Health takes no input, and this says so in a way the framework enforces.
 *
 * The class is intentionally empty. With the global ValidationPipe's `whitelist` and
 * `forbidNonWhitelisted`, every query parameter is non-whitelisted, so `?anything=1` is rejected
 * with a field-level error rather than ignored. That makes this the endpoint the error-shape tests
 * use, which is what #16 asked for — no endpoint was invented for the tests to poke at.
 *
 * ⚠️ Operational consequence worth knowing: a monitor that appends a cache-buster
 * (`/api/v1/health?t=1736...`) gets a 400, which some monitoring tools will report as the service
 * being down. That is the honest cost of applying the same strictness here as everywhere else, and
 * the alternative — one endpoint quietly more permissive than the rest — is the kind of exception
 * that gets copied. Configure monitors to request the bare path.
 */
export class HealthQueryDto {}
