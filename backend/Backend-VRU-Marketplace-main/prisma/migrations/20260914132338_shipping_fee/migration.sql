-- #51: `prisma migrate dev --create-only` also proposed dropping `product_name_trgm_idx` (#45)
-- here, same as every migration since — schema.prisma cannot express a `gin_trgm_ops` GIN index
-- without the `postgresqlExtensions` preview feature, so Prisma reads the hand-written index as
-- drift on every `--create-only` diff. Removed by hand again; the index stays.

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "payment_window_started_at" TIMESTAMPTZ(6),
ADD COLUMN     "shipping_amount_minor" INTEGER;

-- CreateTable
CREATE TABLE "shipping_fee_rejection" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shipping_fee_rejection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipping_fee_rejection_order_id_key" ON "shipping_fee_rejection"("order_id");

-- AddForeignKey
ALTER TABLE "shipping_fee_rejection" ADD CONSTRAINT "shipping_fee_rejection_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
