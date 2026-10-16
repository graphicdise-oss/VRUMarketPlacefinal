import 'dotenv/config';
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const tables = process.argv.slice(2);
for (const t of tables) {
  const r = await client.query(
    'select column_name, data_type from information_schema.columns where table_name=$1 order by ordinal_position',
    [t],
  );
  console.log(`\n# ${t}: ` + r.rows.map((c) => c.column_name).join(', '));
}
await client.end();
