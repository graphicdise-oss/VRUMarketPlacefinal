import { AppException } from '../src/common/errors/app-exception.js';
import { ErrorBody } from '../src/common/errors/error-payload.js';
import { HealthService } from '../src/health/health.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupTestApp } from './helpers/test-app.js';

const getApp = setupTestApp();

/**
 * Every error leaving this system has one shape (L4). The value of that is entirely in there
 * being no exceptions to it, so these tests go looking for the exceptions: a route the router
 * never matched, a validation failure, a database error, and a domain exception.
 */
function expectErrorBody(body: unknown): ErrorBody {
  const error = body as ErrorBody;

  expect(typeof error.code).toBe('string');
  expect(typeof error.message).toBe('string');

  // Nest's default error shape is { statusCode, message, error }. If any of those appear, some
  // path is bypassing the filter and the frontend's single handler is already wrong.
  expect(error).not.toHaveProperty('statusCode');
  expect(error).not.toHaveProperty('error');
  expect(error).not.toHaveProperty('stack');

  return error;
}

describe('a route that does not exist', () => {
  it('returns the project error shape, not HTML and not Nest default', async () => {
    const { client } = getApp();

    const response = await client.get('/api/v1/definitely-not-a-route').expect(404);

    // This is the case a filter registered as a module provider would miss: no route matched, so
    // no module was ever involved.
    const error = expectErrorBody(response.body);
    expect(error.code).toBe('NOT_FOUND');
    expect(response.headers['content-type']).toMatch(/application\/json/);
  });

  it('does not echo the framework wording', async () => {
    const { client } = getApp();

    const response = await client.get('/api/v1/nope').expect(404);
    const error = expectErrorBody(response.body);

    // Express/Nest would say "Cannot GET /api/v1/nope" — English, and it reflects the path back
    // at the caller, which is how a 404 page becomes a reflected-content problem.
    expect(error.message).not.toMatch(/Cannot GET/i);
    expect(error.message).not.toContain('/api/v1/nope');
  });

  it('uses the same shape outside the /api/v1 prefix', async () => {
    const { client } = getApp();

    const response = await client.get('/').expect(404);
    expectErrorBody(response.body);
  });
});

describe('validation failures', () => {
  it('names the offending field in fieldErrors', async () => {
    const { client } = getApp();

    // Health declares an empty query DTO, so any parameter is non-whitelisted. This is the
    // validation surface #16 asked to use rather than inventing a throwaway endpoint.
    const response = await client.get('/api/v1/health?unexpected=1').expect(400);
    const error = expectErrorBody(response.body);

    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fieldErrors).toBeDefined();
    expect(Object.keys(error.fieldErrors ?? {})).toContain('unexpected');
  });

  it('rejects unknown fields rather than silently dropping them', async () => {
    const { client } = getApp();

    // Silently stripping is worse than failing: the caller gets a success for a request that did
    // something other than what they asked. A typo'd `quanity` would mean an order with one item.
    await client.get('/api/v1/health?quanity=2').expect(400);
  });

  it('reports every bad field at once, not just the first', async () => {
    const { client } = getApp();

    const response = await client.get('/api/v1/health?one=1&two=2').expect(400);
    const error = expectErrorBody(response.body);

    // Fixing a form one field per submission is miserable, which is the same reason env validation
    // lists every missing variable at once.
    expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual(['one', 'two']);
  });

  it('still answers normally with no query parameters', async () => {
    const { client } = getApp();

    await client.get('/api/v1/health').expect(200);
  });
});

describe('a database failure', () => {
  it('never reaches the client as Prisma wording', async () => {
    const { app, client } = getApp();

    // A genuine Prisma error, raised by asking the real database for a table that is not there.
    // Mocking a thrown object would test the filter against a fake; this tests it against the
    // thing Prisma actually throws.
    const prisma = app.get(PrismaService);
    const health = app.get(HealthService);

    vi.spyOn(health, 'check').mockImplementation(async () => {
      await prisma.$queryRawUnsafe('SELECT * FROM a_table_that_does_not_exist');
      throw new Error('unreachable');
    });

    const response = await client.get('/api/v1/health').expect(500);
    const error = expectErrorBody(response.body);

    expect(error.code).toBe('INTERNAL_ERROR');

    const serialised = JSON.stringify(response.body);
    // CLAUDE.md: an error tells the client what went wrong, never a stack trace or a table name.
    // Prisma's own messages carry all of it, and in this system the offending value in a
    // constraint error could be someone's phone number or bank account.
    expect(serialised).not.toMatch(/a_table_that_does_not_exist/);
    expect(serialised).not.toMatch(/prisma/i);
    expect(serialised).not.toMatch(/relation|column|constraint/i);
    expect(serialised).not.toMatch(/SELECT/);
    expect(serialised).not.toMatch(/at Object\.|\.ts:\d+/);
  });
});

describe('AppException, the exception services throw', () => {
  it('is not an HttpException, so a service never knows about status codes', () => {
    // Structural, but it is the property that lets topic 11 send these same errors over a
    // websocket where there is no status to set — and L4 forbids a second error format.
    const exception = new AppException('FORBIDDEN');

    expect(exception).toBeInstanceOf(Error);
    expect('getStatus' in exception).toBe(false);
  });

  it('comes out in the single shape, with the status derived at the edge', async () => {
    const { app, client } = getApp();

    const health = app.get(HealthService);
    vi.spyOn(health, 'check').mockRejectedValue(
      new AppException('FORBIDDEN', { fieldErrors: { shopId: 'ร้านนี้ไม่ได้อยู่ในชุมชนของคุณ' } }),
    );

    const response = await client.get('/api/v1/health').expect(403);
    const error = expectErrorBody(response.body);

    expect(error.code).toBe('FORBIDDEN');
    // Thai, displayable as-is: the frontend needs no translation table (L4).
    expect(error.message).toMatch(/[฀-๿]/);
    expect(error.fieldErrors).toEqual({ shopId: 'ร้านนี้ไม่ได้อยู่ในชุมชนของคุณ' });
  });

  it('omits fieldErrors entirely when there are none', async () => {
    const { app, client } = getApp();

    const health = app.get(HealthService);
    vi.spyOn(health, 'check').mockRejectedValue(new AppException('NOT_FOUND'));

    const response = await client.get('/api/v1/health').expect(404);

    // Absent rather than {}. An empty object is truthy, so a frontend checking
    // `if (error.fieldErrors)` would render an empty error list.
    expect(response.body).not.toHaveProperty('fieldErrors');
  });

  it('lets a caller override the message without changing the code', async () => {
    const { app, client } = getApp();

    const health = app.get(HealthService);
    vi.spyOn(health, 'check').mockRejectedValue(
      new AppException('CONFLICT', { message: 'ร้านนี้ใส่ค่าส่งไปแล้ว แก้ไม่ได้' }),
    );

    const response = await client.get('/api/v1/health').expect(409);
    const error = expectErrorBody(response.body);

    // The frontend's switch keeps working while the wording gets more specific — which is the
    // whole reason code and message are separate fields.
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe('ร้านนี้ใส่ค่าส่งไปแล้ว แก้ไม่ได้');
  });
});

describe('the error shape in the generated document (M4)', () => {
  it('is described by a schema rather than by prose', async () => {
    const { client } = getApp();

    const response = await client.get('/api/v1/docs-json').expect(200);
    const document = response.body as {
      components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> };
    };

    const schema = document.components?.schemas?.['ErrorResponseDto'];
    expect(schema).toBeDefined();
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'code',
      'fieldErrors',
      'message',
    ]);
  });
});
