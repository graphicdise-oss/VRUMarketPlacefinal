-- §109: a product photo is public only once an approval of its product has covered it.
ALTER TABLE "product_image" ADD COLUMN "approved_at" TIMESTAMPTZ(6);

-- Every photo already stored has been served publicly until now, so none of them is newly exposed
-- by counting it approved; from here on a new photo starts unreviewed.
UPDATE "product_image" SET "approved_at" = "created_at";
