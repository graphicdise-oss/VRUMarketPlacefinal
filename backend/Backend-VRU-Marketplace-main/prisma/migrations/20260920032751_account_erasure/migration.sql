-- #69/#70: `prisma migrate dev`'s diff engine proposes `DROP INDEX "product_name_trgm_idx"` on
-- every schema change from here on — that index is hand-written raw SQL (20260914082233), never
-- expressed in schema.prisma's DSL, so the diff always sees it as "not declared" and wants it
-- gone. Removed by hand again, same as #69's own migration; see DECISIONS.md §56 for the standing
-- warning to check this on every future migration.

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "erased_at" TIMESTAMPTZ(6);
