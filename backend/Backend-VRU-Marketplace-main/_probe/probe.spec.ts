import { it } from 'vitest';

it('prints which database the test worker would connect to', () => {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://x/none');
  console.log(`PROBE_DB_NAME=${url.pathname.slice(1)} PORT=${url.port}`);
});
