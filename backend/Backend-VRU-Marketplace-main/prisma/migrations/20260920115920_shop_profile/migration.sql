-- #73 (N27): Shop gets a display name, an optional bio, and an optional storefront logo — the
-- gap N27 flagged back at #35 and confirmed again at #71. Written by hand, not left as the raw
-- `prisma migrate dev` diff: that diff proposed `DROP INDEX "product_name_trgm_idx"` even though
-- this migration never touches it — the same false positive DECISIONS.md §56 already documents
-- (the trigram index is raw SQL from #45's migration, never declared in schema.prisma because
-- Prisma has no GIN/trigram index type, so the diff tool sees it as "undeclared" and offers to
-- drop it on every unrelated schema change near it). Dropping it here would silently delete N5's
-- entire Thai-language search feature the moment someone runs `prisma migrate deploy`.
--
-- `name` is NOT NULL with no default. This is safe on an empty database (the only kind this
-- project promises migrations run cleanly against — see CLAUDE.md's "นิยามของเสร็จ") because
-- `prisma/seed.ts` seeds no `Shop` rows; it is NOT safe against a database that already has shop
-- rows in it (verified locally: `prisma migrate dev` refused to run this migration against a dev
-- database with one leftover test shop, which is exactly the guardrail working as intended).

-- AlterTable
ALTER TABLE "shop" ADD COLUMN     "description" TEXT,
ADD COLUMN     "logo_file_id" UUID,
ADD COLUMN     "name" VARCHAR(200) NOT NULL;

-- CreateIndex
CREATE INDEX "shop_logo_file_id_idx" ON "shop"("logo_file_id");

-- AddForeignKey
ALTER TABLE "shop" ADD CONSTRAINT "shop_logo_file_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "uploaded_file"("id") ON DELETE SET NULL ON UPDATE CASCADE;
