import { readFileSync, existsSync } from 'node:fs';
import { defineConfig } from '@prisma/config';

let databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl && existsSync('.env')) {
  const envContent = readFileSync('.env', 'utf-8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('DATABASE_URL=')) {
      databaseUrl = trimmed.slice('DATABASE_URL='.length).trim();
      break;
    }
  }
}

/**
 * Prisma 7 no longer accepts `url = env("DATABASE_URL")` inside schema.prisma.
 * The CLI reads the connection string from here, and the running application passes
 * a driver adapter to the PrismaClient constructor instead (see src/prisma).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --loader ts-node/esm prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
