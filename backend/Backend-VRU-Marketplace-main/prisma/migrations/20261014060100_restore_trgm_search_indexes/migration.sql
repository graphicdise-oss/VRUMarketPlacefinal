-- Restores the pg_trgm search indexes if they are missing.
--
-- `prisma db push` (and Prisma's diff engine generally) drops these four hand-written GIN
-- indexes because schema.prisma cannot express `gin_trgm_ops`. Any database that was ever
-- touched by `db push` is therefore missing them, which turns product / shop search
-- (ILIKE '%...%' and word_similarity) into a sequential scan.
--
-- IF NOT EXISTS makes this a no-op wherever the indexes are already present.
-- Do NOT run `prisma db push` against a database you care about — use migrations.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "product_name_trgm_idx" ON "product" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "product_description_trgm_idx" ON "product" USING GIN ("description" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "product_variant_name_trgm_idx" ON "product_variant" USING GIN ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "shop_name_trgm_idx" ON "shop" USING GIN ("name" gin_trgm_ops);
