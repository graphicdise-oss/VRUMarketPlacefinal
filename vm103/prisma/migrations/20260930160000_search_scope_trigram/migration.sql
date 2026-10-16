-- §110: search reaches a product's option names, its shop's name and its description, as well as its
-- own name. Each field gets the same kind of index product_name_trgm_idx gave the name (#45 · N5):
-- gin_trgm_ops backs both `ILIKE '%...%'` and `<%` (word_similarity), so no branch of the search's
-- UNION scans its table. The description is only ever matched with ILIKE (see ProductService.search).
--
-- Like product_name_trgm_idx, schema.prisma cannot express these without the postgresqlExtensions
-- preview feature, so `prisma migrate diff` will propose dropping them too — see docs/HANDOFF.md.
CREATE INDEX "product_variant_name_trgm_idx" ON "product_variant" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "shop_name_trgm_idx" ON "shop" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "product_description_trgm_idx" ON "product" USING GIN ("description" gin_trgm_ops);
