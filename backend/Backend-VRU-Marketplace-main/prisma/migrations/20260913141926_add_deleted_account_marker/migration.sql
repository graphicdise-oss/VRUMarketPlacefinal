-- CreateTable
CREATE TABLE "deleted_account_marker" (
    "id" UUID NOT NULL,
    "email_hmac" VARCHAR(64) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6) NOT NULL,
    "was_banned" BOOLEAN NOT NULL,
    "dispute_lost_count" INTEGER NOT NULL,

    CONSTRAINT "deleted_account_marker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deleted_account_marker_email_hmac_key" ON "deleted_account_marker"("email_hmac");
