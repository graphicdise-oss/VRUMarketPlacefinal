-- Code review of topic 7 (§81): a buyer rejecting the shipping fee (#51, E2b) cancelled the order
-- without filling in `cancelled_by` / `cancel_reason`, so the shop saw the same null-null a sweep
-- timeout leaves behind. The application now fills both in; this brings orders rejected before
-- that fix into line, copying the reason from the statistic row the rejection already wrote.
--
-- Data only — no schema change. Idempotent: only touches rows still missing `cancelled_by`.
UPDATE "order" AS o
SET cancelled_by = 'BUYER',
    cancel_reason = sfr.reason
FROM shipping_fee_rejection AS sfr
WHERE sfr.order_id = o.id
  AND o.status = 'CANCELLED'
  AND o.cancelled_by IS NULL;
