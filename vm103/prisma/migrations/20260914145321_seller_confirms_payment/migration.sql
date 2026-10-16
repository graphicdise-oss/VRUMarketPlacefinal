-- AlterTable
ALTER TABLE "order" ADD COLUMN     "seller_confirmed_at" TIMESTAMPTZ(6),
ADD COLUMN     "seller_confirmed_by" UUID;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_seller_confirmed_by_fkey" FOREIGN KEY ("seller_confirmed_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
