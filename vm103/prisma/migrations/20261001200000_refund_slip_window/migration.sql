-- §118: K11's 7 days to upload a refund slip count from the buyer's receiving account, not from
-- the refund order. Orders already waiting with an account keep the clock they had.
ALTER TABLE "order" ADD COLUMN "refund_slip_window_started_at" TIMESTAMPTZ(6);

UPDATE "order"
SET "refund_slip_window_started_at" = "refund_ordered_at"
WHERE "status" = 'REFUND_ORDERED' AND "refund_account_type" IS NOT NULL;
