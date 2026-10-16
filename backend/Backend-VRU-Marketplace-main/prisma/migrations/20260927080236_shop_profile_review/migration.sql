-- §86: shop profile changes wait for a community admin. Hand-edited: Prisma's generated diff
-- also carried the usual phantom `DROP INDEX "product_name_trgm_idx"` (raw-SQL trigram index, N5)
-- — removed, as in every migration since §56. No backfill: nothing is pending on day one.

-- AlterTable
ALTER TABLE "shop" ADD COLUMN     "pending_description" TEXT,
ADD COLUMN     "pending_logo_file_id" UUID,
ADD COLUMN     "pending_name" VARCHAR(200),
ADD COLUMN     "profile_change_rejected_at" TIMESTAMPTZ(6),
ADD COLUMN     "profile_change_rejection_reason" TEXT,
ADD COLUMN     "profile_change_requested_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "shop_pending_logo_file_id_idx" ON "shop"("pending_logo_file_id");

-- CreateIndex
CREATE INDEX "shop_profile_change_requested_at_idx" ON "shop"("profile_change_requested_at");

-- AddForeignKey
ALTER TABLE "shop" ADD CONSTRAINT "shop_pending_logo_file_id_fkey" FOREIGN KEY ("pending_logo_file_id") REFERENCES "uploaded_file"("id") ON DELETE SET NULL ON UPDATE CASCADE;
