-- §98: when the person confirmed age 20+ (or a guardian's consent) at sign-up. Nullable, no
-- backfill: production starts from an empty database, and an older development account simply
-- has no confirmation on record.

-- AlterTable
ALTER TABLE "user" ADD COLUMN "age_confirmed_at" TIMESTAMPTZ(6);
