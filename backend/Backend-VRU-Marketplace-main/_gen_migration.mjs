// One-off generator: turns Prisma's raw diff into an IDEMPOTENT catch-up migration.
//  - drops the four pg_trgm "DropIndex" statements (those GIN indexes are hand-written SQL that
//    schema.prisma cannot express; Prisma would delete them and slow product/shop search)
//  - guards every statement so it is a safe no-op on a database that already has the object
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = readFileSync('_catchup.sql', 'utf8').replace(/\r\n/g, '\n');
const blocks = src.split(/\n\n(?=-- )/).map((b) => b.trim()).filter(Boolean);

const out = [];
let dropped = 0;
for (const b of blocks) {
  const [comment, ...rest] = b.split('\n');
  const sql = rest.join('\n').trim();
  if (comment === '-- DropIndex') { dropped++; continue; }

  let g = sql;
  if (comment === '-- CreateEnum') {
    g = `DO $$ BEGIN\n  ${sql}\nEXCEPTION WHEN duplicate_object THEN NULL;\nEND $$;`;
  } else if (comment === '-- CreateTable') {
    g = sql.replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ');
  } else if (comment === '-- AlterTable') {
    g = sql.replace(/ADD COLUMN\s+/g, 'ADD COLUMN IF NOT EXISTS ');
  } else if (comment === '-- CreateIndex') {
    g = sql.replace(/^CREATE (UNIQUE )?INDEX /, 'CREATE $1INDEX IF NOT EXISTS ');
  } else if (comment === '-- AddForeignKey') {
    g = `DO $$ BEGIN\n  ${sql}\nEXCEPTION WHEN duplicate_object THEN NULL;\nEND $$;`;
  } else {
    throw new Error(`Unexpected statement kind: ${comment}`);
  }
  out.push(`${comment}\n${g}`);
}

const header = `-- Catch-up migration: brings prisma/migrations in line with schema.prisma.
--
-- Why this exists: several features (articles, banners, favorites, shop follows, shop coupons +
-- order discount columns, chat block/report/hide, the rate-limit counter, community requests,
-- shop banner/province) were added to the development database with \`prisma db push\`, so no
-- migration ever created them. A server built only from \`prisma migrate deploy\` would be
-- missing those tables and columns and every endpoint touching them would fail.
--
-- Every statement is guarded (IF NOT EXISTS / duplicate_object), so this is a safe no-op on a
-- database that already has the object and an additive change on one that does not. Nothing is
-- dropped. The pg_trgm search indexes (product_*_trgm_idx, shop_name_trgm_idx) are hand-written
-- SQL that schema.prisma cannot express and are deliberately left alone.
`;

const dir = 'prisma/migrations/20261014060000_catch_up_schema_drift';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/migration.sql`, header + '\n' + out.join('\n\n') + '\n');
console.log(`wrote ${dir}/migration.sql  statements=${out.length}  dropIndexSkipped=${dropped}`);
