-- CreateEnum
CREATE TYPE "freeze_reason" AS ENUM ('SELLER_BANNED', 'SHOP_SUSPENDED', 'BUYER_BANNED', 'PRODUCT_PROHIBITED');

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "shipping_quote_window_started_at" TIMESTAMPTZ(6);

-- #61: backfill every existing row so clock 1's own sweep tasks (order-sweep.tasks.ts) can read
-- this column instead of created_at without treating pre-migration rows as already expired.
UPDATE "order" SET "shipping_quote_window_started_at" = "created_at" WHERE "shipping_quote_window_started_at" IS NULL;

-- CreateTable
CREATE TABLE "order_freeze_reason" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "reason" "freeze_reason" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_freeze_reason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_freeze_reason_order_id_idx" ON "order_freeze_reason"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_freeze_reason_order_id_reason_key" ON "order_freeze_reason"("order_id", "reason");

-- AddForeignKey
ALTER TABLE "order_freeze_reason" ADD CONSTRAINT "order_freeze_reason_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
