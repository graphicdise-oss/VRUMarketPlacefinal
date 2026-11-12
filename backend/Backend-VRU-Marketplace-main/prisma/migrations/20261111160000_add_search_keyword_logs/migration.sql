-- CreateTable
CREATE TABLE IF NOT EXISTS "search_keyword_log" (
    "id" UUID NOT NULL,
    "query" VARCHAR(128) NOT NULL,
    "normalized_query" VARCHAR(128) NOT NULL,
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_keyword_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "search_keyword_log_normalized_query_created_at_idx" ON "search_keyword_log"("normalized_query", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "search_keyword_log_created_at_idx" ON "search_keyword_log"("created_at");

