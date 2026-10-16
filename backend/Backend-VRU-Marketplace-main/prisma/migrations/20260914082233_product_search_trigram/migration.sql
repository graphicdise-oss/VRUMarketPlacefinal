-- #45 (N5): trigram search for Thai product names.
--
-- PostgreSQL has no Thai text-search configuration and `to_tsvector` tokenises on whitespace,
-- which Thai does not use — "เสื้อยืดสีขาวคอกลม" becomes a single token and a search for "เสื้อยืด"
-- never matches. pg_trgm compares at the 3-character level instead of the word level, so it works
-- on Thai without a dictionary or a word segmenter. It is a contrib extension that ships with the
-- official postgres image (confirmed against pg_available_extensions on this environment's
-- postgres:16-alpine) — not a new service.
--
-- gin_trgm_ops backs both `ILIKE '%...%'` (substring search) and the `<%` / `word_similarity`
-- operator (typo tolerance) used by ProductService.search(). See DECISIONS.md N5 for the
-- measurements this choice was based on and why `%` (`similarity`) is wrong here.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "product_name_trgm_idx" ON "product" USING GIN ("name" gin_trgm_ops);
