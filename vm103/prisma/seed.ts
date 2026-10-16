import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { newId } from '../src/common/id.js';

/**
 * The nine starting categories L2 settled on (docs/DECISIONS.md), seeded once and then owned by
 * super admins through the API — this list is the starting point, not a ceiling (#40).
 *
 * Not run through `npm test`, not run through the app: `prisma db seed` runs this file directly,
 * outside NestJS, so it connects with the same driver adapter `PrismaService` uses but without
 * Nest's DI or config validation — there is nothing here for either to do.
 */
const STARTING_CATEGORY_NAMES = [
  'อาหารสด/วัตถุดิบ',
  'อาหารแปรรูป/ขนม',
  'เครื่องดื่ม',
  'ผลิตผลการเกษตร',
  'งานฝีมือ/ของที่ระลึก',
  'เสื้อผ้า/เครื่องแต่งกาย',
  'สุขภาพและความงาม',
  'ของใช้ในบ้าน',
  'นวัตกรรม มรว.',
] as const;

/** #58 (F1/K9/L5): the starting couriers — a starting point, not a ceiling, same as categories. */
const STARTING_CARRIERS = [
  { name: 'ไปรษณีย์ไทย', isOther: false },
  { name: 'Kerry', isOther: false },
  { name: 'Flash', isOther: false },
  { name: 'J&T', isOther: false },
  { name: 'SPX', isOther: false },
  { name: 'อื่นๆ', isOther: true },
] as const;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL is required to run the seed.');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    // `new Date()` is fine here: CLAUDE.md's ban and the lint rule that enforces it are scoped to
    // `src/**` (Clock is the one source of "now" there). This script runs once, outside the app,
    // with no Clock to inject and nothing here that reasons about a deadline.
    const now = new Date();

    for (const name of STARTING_CATEGORY_NAMES) {
      // Upsert on the unique `name`, not a `create` guarded by a `count` check: idempotent means
      // safe to run a second time on a database that already has these rows, including one where
      // a super admin already renamed one — `update: {}` leaves an existing row untouched rather
      // than stamping the seed's spelling back over an intentional edit.
      await prisma.category.upsert({
        where: { name },
        update: {},
        create: { id: newId(), name, createdAt: now, updatedAt: now },
      });
    }

    console.log(`Seeded ${STARTING_CATEGORY_NAMES.length} categories (existing rows untouched).`);

    for (const carrier of STARTING_CARRIERS) {
      // Same upsert-on-name, leave-existing-untouched idempotency as categories above. `isOther`
      // is only ever written here — the API never accepts it (see `ShippingCarrierService`'s own
      // comment) — so `update: {}` also protects the one catch-all row from ever being duplicated
      // by re-running this script.
      await prisma.shippingCarrier.upsert({
        where: { name: carrier.name },
        update: {},
        create: { id: newId(), name: carrier.name, isOther: carrier.isOther, createdAt: now, updatedAt: now },
      });
    }

    console.log(`Seeded ${STARTING_CARRIERS.length} shipping carriers (existing rows untouched).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
