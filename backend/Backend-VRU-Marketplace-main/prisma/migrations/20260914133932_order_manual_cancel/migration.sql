-- CreateEnum
CREATE TYPE "order_cancelled_by" AS ENUM ('BUYER', 'SHOP');

-- #52: `prisma migrate dev --create-only` also proposed dropping `product_name_trgm_idx` (#45)
-- here, same as every migration since — schema.prisma cannot express a `gin_trgm_ops` GIN index
-- without the `postgresqlExtensions` preview feature, so Prisma reads the hand-written index as
-- drift on every `--create-only` diff. Removed by hand again; the index stays.

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "cancel_reason" TEXT,
ADD COLUMN     "cancelled_by" "order_cancelled_by";
