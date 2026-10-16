-- #69: `prisma migrate dev`'s diff engine proposed `DROP INDEX "product_name_trgm_idx"` here —
-- that index is hand-written raw SQL from #45's own migration
-- (20260914082233_product_search_trigram), never expressed in schema.prisma's DSL (Prisma has no
-- GIN/trigram index type), so the diff sees it as "not declared" and wants it gone. Dropping it
-- would silently break N5's Thai product search on every environment that runs this migration.
-- Removed by hand; the index this ticket has nothing to do with stays exactly as #45 left it.

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "message" TEXT NOT NULL,
    "target_type" VARCHAR(32),
    "target_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_user_id_created_at_idx" ON "notification"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_user_id_read_at_idx" ON "notification"("user_id", "read_at");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
