-- §91: a revision counter a reviewer's decision must match, on the two things community admins
-- review. Existing rows start at 0, which is what every reviewer's screen will show for them after
-- this deploys — no backfill is needed.

-- AlterTable
ALTER TABLE "product" ADD COLUMN "review_revision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "shop" ADD COLUMN "review_revision" INTEGER NOT NULL DEFAULT 0;
