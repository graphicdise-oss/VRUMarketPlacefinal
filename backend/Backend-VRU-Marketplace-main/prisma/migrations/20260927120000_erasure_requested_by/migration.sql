-- §87: record who queued an erasure request, so an unban withdraws only the one an admin queued.
-- Written by hand (one column + a backfill). Every request queued before this migration is
-- treated as the account's own: an unban then leaves it alone, which is the old behaviour, rather
-- than guessing that some of them were an admin's and silently cancelling a person's own request.

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "erasure_requested_by" UUID;

-- Backfill
UPDATE "user" SET "erasure_requested_by" = "id" WHERE "erasure_requested_at" IS NOT NULL;
