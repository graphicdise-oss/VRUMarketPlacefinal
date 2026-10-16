-- §85 (code review of topics 9–10). Hand-edited: Prisma's generated diff also carried a
-- `DROP INDEX "product_name_trgm_idx"` — the same phantom diff every migration since §56 has had
-- to remove (that index is created by raw SQL Prisma's schema cannot describe; dropping it would
-- silently kill N5's Thai search).

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "cancelled_at" TIMESTAMPTZ(6),
ADD COLUMN     "refund_confirm_window_started_at" TIMESTAMPTZ(6),
ADD COLUMN     "refund_penalty_waived_at" TIMESTAMPTZ(6),
ADD COLUMN     "shipping_carrier_name_at_shipment" VARCHAR(100);

-- Backfill: a cancelled order's last update was its cancellation (nothing writes a CANCELLED row
-- afterward), so `updated_at` is the best record of when that happened.
UPDATE "order" SET "cancelled_at" = "updated_at" WHERE "status" = 'CANCELLED';

-- Backfill: every order that already has a refund slip keeps exactly the H7 deadline it had under
-- the old rule (first slip + all frozen time so far) — a running clock is never shortened by this
-- migration, only computed the new way from here on.
UPDATE "order"
SET "refund_confirm_window_started_at" = "refund_slip_first_uploaded_at" + make_interval(secs => "frozen_duration_seconds")
WHERE "refund_slip_first_uploaded_at" IS NOT NULL;

-- Backfill: the name each already-shipped order's carrier has today is the best record there is of
-- what it was called when it shipped.
UPDATE "order" o
SET "shipping_carrier_name_at_shipment" = c."name"
FROM "shipping_carrier" c
WHERE o."shipping_carrier_id" = c."id";
