-- §98: traffic data for พ.ร.บ.คอมพิวเตอร์ ม.26 — kept 90 days, then deleted by the sweep. A new
-- table with no rows to backfill: nothing was logged before this deploys.

-- CreateTable
CREATE TABLE "access_log" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "ip_address" VARCHAR(45) NOT NULL,
    "user_id" UUID,
    "channel" VARCHAR(16) NOT NULL,
    "action" VARCHAR(200) NOT NULL,
    "status_code" SMALLINT,

    CONSTRAINT "access_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_log_occurred_at_idx" ON "access_log"("occurred_at");

-- CreateIndex
CREATE INDEX "access_log_user_id_occurred_at_idx" ON "access_log"("user_id", "occurred_at");
