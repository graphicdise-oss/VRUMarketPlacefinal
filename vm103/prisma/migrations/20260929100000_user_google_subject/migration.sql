-- §101: the Google account (`sub`) connected to a user, so a connected account is recognised by
-- Google's id rather than by its address alone. Nullable, no backfill: an account created with
-- Google before this records its id the next time it signs in.

-- AlterTable
ALTER TABLE "user" ADD COLUMN "google_subject" VARCHAR(255);

-- CreateIndex
CREATE UNIQUE INDEX "user_google_subject_key" ON "user"("google_subject");
