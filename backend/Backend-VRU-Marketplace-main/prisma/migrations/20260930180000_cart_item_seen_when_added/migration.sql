-- §111: what the buyer saw when they last added a cart line or changed its quantity — the price
-- (so the cart can warn that it changed, K4) and the names (shown once the product stops being
-- orderable, when the live name may not have passed review).
ALTER TABLE "cart_item"
  ADD COLUMN "price_amount_minor_when_added" INTEGER,
  ADD COLUMN "product_name_when_added" VARCHAR(200),
  ADD COLUMN "variant_name_when_added" VARCHAR(100);

-- Lines already in a cart take today's values: nothing better was ever recorded, and a buyer is
-- warned about changes from here on.
UPDATE "cart_item" AS ci
SET "price_amount_minor_when_added" = v."price_amount_minor",
    "product_name_when_added" = p."name",
    "variant_name_when_added" = v."name"
FROM "product_variant" AS v
JOIN "product" AS p ON p."id" = v."product_id"
WHERE v."id" = ci."variant_id";

ALTER TABLE "cart_item"
  ALTER COLUMN "price_amount_minor_when_added" SET NOT NULL,
  ALTER COLUMN "product_name_when_added" SET NOT NULL,
  ALTER COLUMN "variant_name_when_added" SET NOT NULL;
