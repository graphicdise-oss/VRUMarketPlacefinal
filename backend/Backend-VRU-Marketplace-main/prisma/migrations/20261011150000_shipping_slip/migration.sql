-- CreateTable
CREATE TABLE "shipping_slip" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shipping_slip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipping_slip_order_id_idx" ON "shipping_slip"("order_id");

-- AddForeignKey
ALTER TABLE "shipping_slip" ADD CONSTRAINT "shipping_slip_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_slip" ADD CONSTRAINT "shipping_slip_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "uploaded_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
