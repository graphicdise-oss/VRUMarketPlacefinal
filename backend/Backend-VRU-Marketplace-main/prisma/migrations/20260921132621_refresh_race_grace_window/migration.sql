-- AlterTable
ALTER TABLE "session" ADD COLUMN     "previous_refresh_token_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "previous_refresh_token_hash" VARCHAR(64);

-- CreateIndex
CREATE INDEX "session_previous_refresh_token_hash_previous_refresh_token__idx" ON "session"("previous_refresh_token_hash", "previous_refresh_token_expires_at");
