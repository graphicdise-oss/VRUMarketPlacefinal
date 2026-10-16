-- CreateEnum
CREATE TYPE "ShopApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- DropIndex
DROP INDEX "shop_owner_id_key";

-- AlterTable
ALTER TABLE "shop" ADD COLUMN     "approval_status" "ShopApprovalStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "closed_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "dispute_lost_count" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "shop_owner_id_idx" ON "shop"("owner_id");

-- CreateIndex
-- Hand-written: Prisma's schema DSL has no partial-unique-index syntax, so this cannot come from
-- `schema.prisma` alone. B2 ("1 คน = 1 ร้าน") plus H12 ("ปิดแล้วเปิดใหม่ได้") together mean the
-- constraint is "at most one row per owner_id *that is still open*", not "at most one row per
-- owner_id ever" — a plain UNIQUE would permanently lock out anyone who ever closed a shop.
CREATE UNIQUE INDEX "shop_owner_id_open_key" ON "shop"("owner_id") WHERE "closed_at" IS NULL;
