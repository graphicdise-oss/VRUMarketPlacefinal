import { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service.js';

/**
 * Empties every application table between tests.
 *
 * Why this has to exist: tests that leave rows behind pass in the order they were written
 * and fail the moment someone adds a case above them. The acceptance criterion in #14 is
 * literally "shuffle the order and the results do not change", and this is what makes that
 * true.
 *
 * Why it is discovered from the catalogue rather than listed by hand: a hand-written list is
 * a list someone forgets to extend. Topic 7 adds six tables, and nobody should have to
 * remember to come back here. The query asks Postgres what exists right now.
 *
 * Why TRUNCATE and not DELETE: TRUNCATE ... CASCADE ignores foreign-key ordering, so this
 * does not need to know that orders reference shops. RESTART IDENTITY resets sequences,
 * which matters for any table that still has one.
 *
 * _prisma_migrations is excluded on purpose. Wiping it would make Prisma think the database
 * has never been migrated.
 *
 * #46's four area-reference tables (province/district/subdistrict/subdistrict_postal_code) are
 * excluded too, and for a related reason: they are not application data. Nothing in `src/` ever
 * writes to them — they arrive once, with the migration that created them (#46's own acceptance
 * criteria), and every later ticket only reads them (`Address`'s foreign keys, #47). Truncating
 * and having to re-seed ~8,500 rows before every one of this suite's few hundred tests would be
 * real time paid every run for state nothing in the whole test file ever changes.
 */
export async function truncateAllTables(prisma: PrismaService): Promise<void> {
  // TRUNCATE ... CASCADE on every application table is irreversible. Only ever do it to a
  // database that is named as disposable; if DATABASE_URL points anywhere else, stop loudly.
  const [current] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (current === undefined || !current.name.endsWith('_test')) {
    throw new Error(
      `Refusing to truncate database "${current?.name ?? 'unknown'}": the test suite may only ` +
        'run against a database whose name ends in "_test" (default: vru_marketplace_test).',
    );
  }

  const AREA_REFERENCE_TABLES = ['province', 'district', 'subdistrict', 'subdistrict_postal_code'];

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '\\_prisma\\_%'
      AND tablename NOT IN (${Prisma.join(AREA_REFERENCE_TABLES)})
  `;

  if (tables.length === 0) {
    // No application tables yet — true until #15 lands the first one. Not a failure.
    return;
  }

  // Identifiers cannot be bound as parameters, so they are quoted instead. The values come
  // from pg_tables, not from user input; there is nothing here a request could influence.
  const quoted = tables.map((table) => `"public"."${table.tablename}"`).join(', ');

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}
