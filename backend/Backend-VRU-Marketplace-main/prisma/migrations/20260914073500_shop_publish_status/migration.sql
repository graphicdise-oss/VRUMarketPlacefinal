-- CreateEnum
CREATE TYPE "shop_publish_status" AS ENUM ('PUBLISHED', 'UNPUBLISHED');

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "shop_publish_status" "shop_publish_status" NOT NULL DEFAULT 'PUBLISHED';
