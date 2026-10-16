-- AlterTable
ALTER TABLE "order" ADD COLUMN     "refund_account_type" "payment_channel_type",
ADD COLUMN     "refund_bank_account_name" VARCHAR(100),
ADD COLUMN     "refund_bank_account_number" VARCHAR(50),
ADD COLUMN     "refund_bank_name" VARCHAR(100),
ADD COLUMN     "refund_ordered_at" TIMESTAMPTZ(6),
ADD COLUMN     "refund_overdue_flagged_at" TIMESTAMPTZ(6),
ADD COLUMN     "refund_prompt_pay_id" VARCHAR(50),
ADD COLUMN     "refund_slip_first_uploaded_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "refund_slip" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refund_slip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refund_slip_order_id_idx" ON "refund_slip"("order_id");

-- AddForeignKey
ALTER TABLE "refund_slip" ADD CONSTRAINT "refund_slip_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_slip" ADD CONSTRAINT "refund_slip_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "uploaded_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
