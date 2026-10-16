import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';
import { newId } from '../src/common/id.js';

const run = promisify(execFile);

/**
 * Proves the migrations apply to a database that has never seen them, and that the first
 * table sets the column conventions the other eleven topics copy.
 *
 * Why a throwaway database rather than the test database: CLAUDE.md is explicit that
 * "migration รันผ่านบน DB เปล่า ไม่ใช่แค่บนเครื่องที่มีตารางเดิมอยู่แล้ว". A migration that only
 * ever runs against a database where the previous version already applied cleanly can depend
 * on state nobody notices — a type that happens to exist, a column order. The day someone
 * clones the repo and runs `docker compose up`, that dependency is a failed first boot.
 *
 * Why it shells out to the Prisma CLI: that is literally what runs in production. The compose file
 * has a one-shot `migrate` service that runs `prisma migrate deploy` before the api starts, so this
 * exercises the same command rather than a reimplementation of it.
 */
describe('migrations on an empty database', () => {
  // Unique per run so a crashed earlier run cannot collide with this one.
  const scratchDatabase = `vru_migrate_probe_${newId().replaceAll('-', '').slice(0, 16)}`;

  let adminUrl: string;
  let scratchUrl: string;

  beforeAll(async () => {
    const configured = process.env.DATABASE_URL;
    if (!configured) {
      throw new Error('DATABASE_URL is not set; test/helpers/test-env.ts should have set it.');
    }

    // Same server and credentials as the test database, but pointed at the maintenance
    // database so that CREATE DATABASE is legal.
    const parsed = new URL(configured);
    const admin = new URL(parsed.toString());
    admin.pathname = '/postgres';
    adminUrl = admin.toString();

    const scratch = new URL(parsed.toString());
    scratch.pathname = `/${scratchDatabase}`;
    scratchUrl = scratch.toString();

    // Creating the database and applying the migrations happens here rather than in the first
    // test, so the two tests below do not depend on running in the order they are written —
    // which is the very property #14 asked the suite to have.
    await onAdmin(async (client) => {
      try {
        await client.query(`CREATE DATABASE "${scratchDatabase}"`);
      } catch (error) {
        throw new Error(
          'Could not create a throwaway database for the migration test. The role in ' +
            'DATABASE_URL needs CREATEDB for this check to run.',
          { cause: error },
        );
      }
    });

    await run('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: scratchUrl },
    });
  });

  async function onAdmin<T>(work: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: adminUrl });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  }

  afterAll(async () => {
    await onAdmin(async (client) => {
      // Identifier, so it cannot be a bound parameter. The name is built from a UUID above,
      // never from anything a request could influence.
      await client.query(`DROP DATABASE IF EXISTS "${scratchDatabase}"`);
    });
  });

  it('applies from nothing and leaves the conventions CLAUDE.md locks in', async () => {
    const scratch = new Client({ connectionString: scratchUrl });
    await scratch.connect();

    try {
      const { rows: columns } = await scratch.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'audit_log'
          ORDER BY column_name`,
      );

      const byName = new Map(columns.map((column) => [column.column_name, column]));

      // The table exists at all, which is the headline claim of this test.
      expect(columns.length).toBeGreaterThan(0);

      // snake_case in the database (M2). The Prisma model spells these actorUserId and
      // createdAt; if @map were dropped, these lookups would fail and a column name would be
      // one step from leaking into a JSON response.
      expect(byName.has('actor_user_id')).toBe(true);
      expect(byName.has('target_type')).toBe(true);
      expect(byName.has('created_at')).toBe(true);
      expect(byName.has('actorUserId')).toBe(false);

      // Time is TIMESTAMPTZ. A plain `timestamp` drops the offset, and then a deadline written
      // by a server in Bangkok means something different when read anywhere else — which is
      // the three clocks quietly miscounting.
      expect(byName.get('created_at')?.data_type).toBe('timestamp with time zone');

      // Ids are real uuid columns, not text. Text would accept 'banana'.
      expect(byName.get('id')?.data_type).toBe('uuid');
      expect(byName.get('actor_user_id')?.data_type).toBe('uuid');
      expect(byName.get('target_id')?.data_type).toBe('uuid');

      // Nullability carries meaning here: a null actor is the system itself, a null reason is
      // an action that needed none.
      expect(byName.get('id')?.is_nullable).toBe('NO');
      expect(byName.get('action')?.is_nullable).toBe('NO');
      expect(byName.get('actor_user_id')?.is_nullable).toBe('YES');
      expect(byName.get('reason')?.is_nullable).toBe('YES');

      // No foreign key to a user table. Topic 2 creates User; this must not start depending on
      // it, and once it exists the evidence still must not be tied to the account's lifetime.
      const { rows: foreignKeys } = await scratch.query<{ constraint_name: string }>(
        `SELECT constraint_name
           FROM information_schema.table_constraints
          WHERE table_schema = 'public'
            AND table_name = 'audit_log'
            AND constraint_type = 'FOREIGN KEY'`,
      );
      expect(foreignKeys).toEqual([]);
    } finally {
      await scratch.end();
    }
  });

  it('is idempotent, so a redeploy does not fail on an already-migrated database', async () => {
    // The `migrate` service runs on every `docker compose up`. If a second run were an error, every
    // redeploy would stop before the api started.
    const result = await run('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: scratchUrl },
    });

    expect(result.stdout).toContain('No pending migrations');
  });
});

describe('UUIDv7 ids', () => {
  it('sort in the order they were created', () => {
    // This is the property cursor pagination (#18) depends on: paging by id alone is
    // chronological, so there is no second sort key and no tie to break.
    const ids = Array.from({ length: 50 }, () => newId());

    expect([...ids].sort()).toEqual(ids);
  });

  it('does not repeat within the same millisecond', () => {
    const ids = Array.from({ length: 1000 }, () => newId());

    expect(new Set(ids).size).toBe(ids.length);
  });
});
