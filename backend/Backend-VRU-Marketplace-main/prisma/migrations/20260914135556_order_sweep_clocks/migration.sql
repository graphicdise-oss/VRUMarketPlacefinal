-- #53: `prisma migrate dev --create-only` also proposed dropping `product_name_trgm_idx` (#45)
-- here, same as every migration since — schema.prisma cannot express a `gin_trgm_ops` GIN index
-- without the `postgresqlExtensions` preview feature, so Prisma reads the hand-written index as
-- drift on every `--create-only` diff. Removed by hand again; the index stays.

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "payment_confirmation_warning_sent_at" TIMESTAMPTZ(6),
ADD COLUMN     "payment_confirmation_window_started_at" TIMESTAMPTZ(6),
ADD COLUMN     "payment_warning_sent_at" TIMESTAMPTZ(6),
ADD COLUMN     "shipping_quote_warning_sent_at" TIMESTAMPTZ(6);
