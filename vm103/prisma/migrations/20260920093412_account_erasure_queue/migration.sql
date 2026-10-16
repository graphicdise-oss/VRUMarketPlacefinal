-- #71 (H9): the queue #70 left for later. Written by hand rather than via `prisma migrate dev` —
-- that command's diff engine proposes `DROP INDEX "product_name_trgm_idx"` on every schema change
-- (see DECISIONS.md §56), and this migration only needs the one column below.

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "erasure_requested_at" TIMESTAMPTZ(6);
