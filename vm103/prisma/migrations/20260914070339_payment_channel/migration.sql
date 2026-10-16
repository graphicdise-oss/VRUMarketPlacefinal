-- CreateEnum
CREATE TYPE "payment_channel_type" AS ENUM ('BANK_TRANSFER', 'PROMPTPAY');

-- CreateTable
CREATE TABLE "payment_channel" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "type" "payment_channel_type" NOT NULL,
    "bank_name" VARCHAR(100),
    "bank_account_number" VARCHAR(50),
    "bank_account_name" VARCHAR(100),
    "prompt_pay_id" VARCHAR(50),
    "qr_image_file_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploaded_file" (
    "id" UUID NOT NULL,
    "content_type" VARCHAR(50) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "uploaded_file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_channel_shop_id_idx" ON "payment_channel"("shop_id");

-- CreateIndex
CREATE INDEX "payment_channel_qr_image_file_id_idx" ON "payment_channel"("qr_image_file_id");

-- AddForeignKey
ALTER TABLE "payment_channel" ADD CONSTRAINT "payment_channel_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_channel" ADD CONSTRAINT "payment_channel_qr_image_file_id_fkey" FOREIGN KEY ("qr_image_file_id") REFERENCES "uploaded_file"("id") ON DELETE SET NULL ON UPDATE CASCADE;
