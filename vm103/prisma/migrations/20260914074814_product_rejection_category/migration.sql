-- CreateEnum
CREATE TYPE "product_rejection_category" AS ENUM ('NEEDS_FIX', 'PROHIBITED');

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "rejection_category" "product_rejection_category",
ADD COLUMN     "rejection_reason" TEXT;
