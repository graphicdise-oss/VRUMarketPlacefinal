-- AlterTable
ALTER TABLE "order" ADD COLUMN     "carrier_name_other" VARCHAR(100),
ADD COLUMN     "shipped_at" TIMESTAMPTZ(6),
ADD COLUMN     "shipping_carrier_id" UUID,
ADD COLUMN     "tracking_number" VARCHAR(100);

-- CreateTable
CREATE TABLE "shipping_carrier" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_other" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shipping_carrier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_number_change" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "previous_tracking_number" VARCHAR(100) NOT NULL,
    "new_tracking_number" VARCHAR(100) NOT NULL,
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tracking_number_change_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipping_carrier_name_key" ON "shipping_carrier"("name");

-- CreateIndex
-- Hand-written: Prisma's schema DSL has no partial-unique-index syntax (same technique
-- "shop_owner_id_open_key" already uses). L5/K9 need exactly one "อื่นๆ" catch-all row to ever
-- exist — the application never sets is_other at all (only the seed does), but this is what
-- keeps that true even against a direct database edit.
CREATE UNIQUE INDEX "shipping_carrier_one_other_key" ON "shipping_carrier"("is_other") WHERE "is_other";

-- CreateIndex
CREATE INDEX "tracking_number_change_order_id_idx" ON "tracking_number_change"("order_id");

-- CreateIndex
CREATE INDEX "order_shipping_carrier_id_idx" ON "order"("shipping_carrier_id");

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_shipping_carrier_id_fkey" FOREIGN KEY ("shipping_carrier_id") REFERENCES "shipping_carrier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_number_change" ADD CONSTRAINT "tracking_number_change_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_number_change" ADD CONSTRAINT "tracking_number_change_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
