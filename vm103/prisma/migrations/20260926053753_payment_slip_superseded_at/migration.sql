-- Code review of topic 8 (§82): mark the slips a rejection leaves behind. Rejecting one slip
-- ends that payment round, but the buyer's other re-uploads from the same round used to stay
-- "not rejected" forever, so the shop could reject one of them later to knock back a round it
-- had nothing to do with. See `PaymentSlip.supersededAt` in schema.prisma.
--
-- Hand-edited: `prisma migrate dev --create-only` also proposed dropping
-- "product_name_trgm_idx", the pg_trgm index #43 creates in raw SQL (Prisma's schema can't
-- express it, so it always looks like drift). That line is removed on purpose — dropping it
-- would silently turn Thai product search back into a sequential scan.

ALTER TABLE "payment_slip" ADD COLUMN "superseded_at" TIMESTAMPTZ(6);

-- Existing data: a never-rejected slip that was uploaded before one of its order's slips was
-- rejected belonged to the round that rejection ended — mark it with the first rejection that
-- came after it. Slips of the current (unrejected) round have no such later rejection and stay
-- null. Idempotent: only touches rows still null.
UPDATE "payment_slip" AS slip
SET superseded_at = (
  SELECT MIN(rejected.rejected_at)
  FROM "payment_slip" AS rejected
  WHERE rejected.order_id = slip.order_id
    AND rejected.rejected_at IS NOT NULL
    AND rejected.rejected_at > slip.created_at
)
WHERE slip.rejected_at IS NULL
  AND slip.superseded_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM "payment_slip" AS rejected
    WHERE rejected.order_id = slip.order_id
      AND rejected.rejected_at IS NOT NULL
      AND rejected.rejected_at > slip.created_at
  );
