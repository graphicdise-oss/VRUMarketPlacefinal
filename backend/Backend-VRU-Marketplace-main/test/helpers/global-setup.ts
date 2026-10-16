import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Brings the test database up to the current schema, once, before any test file runs.
 *
 * Without this, a test that inserts a row fails with "relation does not exist" and the obvious
 * reading is that the code is broken rather than that the database is behind. Applying the
 * migrations — the same `prisma migrate deploy` the api container runs — removes the whole
 * class of confusion, and means a developer who has just pulled someone else's migration does
 * not have to remember anything.
 *
 * This is not a seam into the system: no application code is loaded here. It is the
 * equivalent of creating the database in the first place.
 */
import 'dotenv/config';

export default async function setup(): Promise<void> {
  const base = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/vru_marketplace';
  // A URL that already names a *_test database (e.g. CI's own) is kept as is; anything else is
  // pointed at vru_marketplace_test so the suite can never share a database with real data.
  const databaseUrl = /\/[^/?]+_test(\?|$)/.test(base)
    ? base
    : base.replace(/\/[^/?]+(\?|$)/, '/vru_marketplace_test$1');

  // Test workers inherit this process's environment. Without this line they would connect to
  // the DATABASE_URL that dotenv loaded from .env — the development database — and
  // truncateAllTables() would wipe it between cases.
  process.env.DATABASE_URL = databaseUrl;

  try {
    await run('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      shell: process.platform === 'win32',
    });
  } catch (error) {
    throw new Error(
      'Could not apply migrations to the test database.\n\n' +
        `DATABASE_URL: ${redactPassword(databaseUrl)}\n\n` +
        'The test suite needs a real, disposable PostgreSQL — not SQLite, because later topics ' +
        'rely on conditional updates with a row count and on pg_trgm. Create one and point ' +
        'DATABASE_URL at it.',
      { cause: error },
    );
  }
}

/** Even a failure message must not print a password (CLAUDE.md: log only what is public). */
function redactPassword(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return '(unparseable)';
  }
}
