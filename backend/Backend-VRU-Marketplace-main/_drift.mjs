// Read-only: compares the schema built from prisma/migrations (vru_marketplace_test, freshly
// migrated) with the live development database. Any difference means the dev DB was changed
// with `prisma db push` and a server running `prisma migrate deploy` would NOT get the change.
import 'dotenv/config';
import pg from 'pg';

const devUrl = process.env.DATABASE_URL;
const testUrl = devUrl.replace(/\/[^/?]+(\?|$)/, '/vru_marketplace_test$1');

async function cols(url) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const r = await c.query(
    `select table_name||'.'||column_name||' '||data_type||' '||is_nullable as k
       from information_schema.columns
      where table_schema='public' and table_name not like '\\_prisma\\_%'`,
  );
  const e = await c.query(
    `select t.typname||':'||e.enumlabel as k from pg_type t join pg_enum e on e.enumtypid=t.oid`,
  );
  await c.end();
  return new Set([...r.rows.map((x) => x.k), ...e.rows.map((x) => 'ENUM ' + x.k)]);
}

const dev = await cols(devUrl);
const mig = await cols(testUrl);
const onlyDev = [...dev].filter((k) => !mig.has(k));
const onlyMig = [...mig].filter((k) => !dev.has(k));
console.log(`dev objects: ${dev.size}, migrations-built objects: ${mig.size}`);
console.log(`In DEV DB but NOT produced by migrations (${onlyDev.length}):`);
onlyDev.slice(0, 60).forEach((k) => console.log('  + ' + k));
console.log(`In migrations but missing from DEV DB (${onlyMig.length}):`);
onlyMig.slice(0, 60).forEach((k) => console.log('  - ' + k));
