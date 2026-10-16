-- CreateEnum
CREATE TYPE "dispute_verdict" AS ENUM ('BUYER_WINS', 'SHOP_WINS');

-- AlterTable
ALTER TABLE "dispute" ADD COLUMN     "ruled_at" TIMESTAMPTZ(6),
ADD COLUMN     "ruled_by" UUID,
ADD COLUMN     "ruling_reason" TEXT,
ADD COLUMN     "verdict" "dispute_verdict";

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_ruled_by_fkey" FOREIGN KEY ("ruled_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
