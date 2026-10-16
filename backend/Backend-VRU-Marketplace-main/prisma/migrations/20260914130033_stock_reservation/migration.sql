-- #50 (invariant 3): one reservation per OrderItem, no expiresAt/releasedAt column — see the
-- model's own schema comment for why.
--
-- NOTE: `prisma migrate dev --create-only` also proposed dropping `product_name_trgm_idx` (#45)
-- here, same as every migration since — schema.prisma cannot express a `gin_trgm_ops` GIN index
-- without the `postgresqlExtensions` preview feature, so Prisma reads the hand-written index as
-- drift on every `--create-only` diff. Removed by hand again; the index stays.

-- CreateTable
CREATE TABLE "stock_reservation" (
    "id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservation_order_item_id_key" ON "stock_reservation"("order_item_id");

-- CreateIndex
CREATE INDEX "stock_reservation_variant_id_idx" ON "stock_reservation"("variant_id");

-- AddForeignKey
ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservation" ADD CONSTRAINT "stock_reservation_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
