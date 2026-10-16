-- #49: OrderStatus (spec 5/12's own AC names the path — see that enum's schema comment for why
-- CANCELLED_AFTER_PAYMENT is deliberately not a value here).
--
-- NOTE: `prisma migrate dev --create-only` also proposed dropping `product_name_trgm_idx` (#45)
-- here, same as the `cart` migration before it — schema.prisma cannot express a `gin_trgm_ops`
-- GIN index without the `postgresqlExtensions` preview feature, so Prisma reads the hand-written
-- index as drift on every future `--create-only` diff. Removed by hand again; the index stays.

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('AWAITING_SHIPPING_QUOTE', 'AWAITING_PAYMENT', 'PAYMENT_SUBMITTED', 'PAID', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUND_ORDERED', 'REFUNDED');

-- CreateTable
CREATE TABLE "order" (
    "id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'AWAITING_SHIPPING_QUOTE',
    "frozen_at" TIMESTAMPTZ(6),
    "total_amount_minor" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'THB',
    "recipient_name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "house_number" VARCHAR(50) NOT NULL,
    "village_number" VARCHAR(50),
    "alley" VARCHAR(100),
    "road" VARCHAR(100),
    "subdistrict_name" VARCHAR(100) NOT NULL,
    "district_name" VARCHAR(100) NOT NULL,
    "province_name" VARCHAR(100) NOT NULL,
    "postal_code" VARCHAR(5) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "product_name_at_purchase" VARCHAR(200) NOT NULL,
    "variant_name_at_purchase" VARCHAR(100) NOT NULL,
    "price_at_purchase" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'THB',
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "order_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_buyer_id_idx" ON "order"("buyer_id");

-- CreateIndex
CREATE INDEX "order_shop_id_idx" ON "order"("shop_id");

-- CreateIndex
CREATE INDEX "order_item_order_id_idx" ON "order_item"("order_id");

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
