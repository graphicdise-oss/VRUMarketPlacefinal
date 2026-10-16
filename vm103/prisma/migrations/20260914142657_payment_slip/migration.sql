-- #54: `prisma migrate dev --create-only` also proposed dropping `product_name_trgm_idx` (#45)
-- here, same as every migration since — schema.prisma cannot express a `gin_trgm_ops` GIN index
-- without the `postgresqlExtensions` preview feature, so Prisma reads the hand-written index as
-- drift on every `--create-only` diff. Removed by hand again; the index stays.

-- CreateTable
CREATE TABLE "payment_slip" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "rejected_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "rejected_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_slip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_slip_order_id_idx" ON "payment_slip"("order_id");

-- AddForeignKey
ALTER TABLE "payment_slip" ADD CONSTRAINT "payment_slip_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_slip" ADD CONSTRAINT "payment_slip_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "uploaded_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_slip" ADD CONSTRAINT "payment_slip_rejected_by_user_id_fkey" FOREIGN KEY ("rejected_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
