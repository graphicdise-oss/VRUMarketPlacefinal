import { HealthResponseDto } from '../src/health/dto/health-response.dto.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { newClient, setupTestApp } from './helpers/test-app.js';

const getApp = setupTestApp();

describe('GET /api/v1/health', () => {
  it('answers 200 while the database is reachable', async () => {
    const { client } = getApp();

    const response = await client.get('/api/v1/health').expect(200);
    const body = response.body as HealthResponseDto;

    expect(body.status).toBe('ok');
    expect(body.database).toBe('up');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(new Date(body.checkedAt).toISOString()).toBe(body.checkedAt);
  });

  it('reports 503 and database: down when the database does not answer', async () => {
    const { app, client } = getApp();

    // The only way to prove the unhealthy branch through seam 1 is to make the probe fail.
    // Stopping the real Postgres from inside a test would break every other test sharing it,
    // so the failure is injected at the one method that talks to the database.
    const prisma = app.get(PrismaService);
    vi.spyOn(prisma, 'isReachable').mockResolvedValue(false);

    const response = await client.get('/api/v1/health').expect(503);
    const body = response.body as HealthResponseDto;

    expect(body.status).toBe('degraded');
    expect(body.database).toBe('down');
    // Same shape at 503 as at 200 — a monitor reads one field either way, and this is not
    // the L4 error envelope.
    expect(body).toHaveProperty('uptimeSeconds');
    expect(body).toHaveProperty('checkedAt');
  });

  it('says nothing about why the database is unreachable', async () => {
    const { app, client } = getApp();

    // A health endpoint is usually the most exposed route a service has. CLAUDE.md: errors
    // tell the client what went wrong, never a stack trace or the name of a table — and a
    // connection string would be worse than either.
    const prisma = app.get(PrismaService);
    vi.spyOn(prisma, 'isReachable').mockResolvedValue(false);

    const response = await client.get('/api/v1/health').expect(503);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toMatch(/postgres(ql)?:\/\//i);
    expect(serialised).not.toMatch(/password/i);
    expect(serialised).not.toMatch(/stack|at Object\./i);
  });

  it('is reachable without logging in', async () => {
    // A health check that needs credentials is useless during the outage it exists to
    // report. A client with an empty cookie jar must still get an answer.
    const response = await newClient(getApp()).get('/api/v1/health').expect(200);

    expect((response.body as HealthResponseDto).status).toBe('ok');
  });
});

describe('the /api/v1 prefix (M1)', () => {
  it('serves health only under the prefix', async () => {
    const { client } = getApp();

    await client.get('/api/v1/health').expect(200);
    // Not just cosmetic: a route that answers on both paths means the prefix is advisory,
    // and something will eventually be published without it.
    await client.get('/health').expect(404);
  });

  it('has no versioning mechanism behind the prefix', async () => {
    const { client } = getApp();

    // v1 is a string in a path. Nothing has agreed to serve two versions of anything, so
    // /api/v2/ must not quietly resolve to the same controllers.
    await client.get('/api/v2/health').expect(404);
  });
});

describe('the OpenAPI document (M4)', () => {
  it('is generated from the DTOs and describes the health route', async () => {
    const { client } = getApp();

    const response = await client.get('/api/v1/docs-json').expect(200);
    const document = response.body as {
      paths: Record<string, unknown>;
      components?: { schemas?: Record<string, unknown> };
    };

    // The path appears without the global prefix doubled up, and the response schema came
    // from HealthResponseDto rather than from anything hand-written.
    expect(Object.keys(document.paths)).toContain('/api/v1/health');
    expect(document.components?.schemas).toHaveProperty('HealthResponseDto');
  });
});
