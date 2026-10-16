-- Catch-up migration: brings prisma/migrations in line with schema.prisma.
--
-- Why this exists: several features (articles, banners, favorites, shop follows, shop coupons +
-- order discount columns, chat block/report/hide, the rate-limit counter, community requests,
-- shop banner/province) were added to the development database with `prisma db push`, so no
-- migration ever created them. A server built only from `prisma migrate deploy` would be
-- missing those tables and columns and every endpoint touching them would fail.
--
-- Every statement is guarded (IF NOT EXISTS / duplicate_object), so this is a safe no-op on a
-- database that already has the object and an additive change on one that does not. Nothing is
-- dropped. The pg_trgm search indexes (product_*_trgm_idx, shop_name_trgm_idx) are hand-written
-- SQL that schema.prisma cannot express and are deliberately left alone.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "coupon_discount_type" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "chat_report_status" AS ENUM ('PENDING', 'INVESTIGATING', 'RESOLVED', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "chat_room_read" ADD COLUMN IF NOT EXISTS "cleared_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "coupon_code" VARCHAR(50),
ADD COLUMN IF NOT EXISTS "coupon_id" UUID,
ADD COLUMN IF NOT EXISTS "discount_amount_minor" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "shop" ADD COLUMN IF NOT EXISTS "banner_file_id" UUID,
ADD COLUMN IF NOT EXISTS "province" VARCHAR(100);

-- CreateTable
CREATE TABLE IF NOT EXISTS "article" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "image" VARCHAR(2000),
    "author_name" VARCHAR(255) NOT NULL,
    "excerpt" TEXT,
    "content" TEXT NOT NULL,
    "tags" JSONB DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "community_request" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "location" VARCHAR(255),
    "requester_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "community_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "banner" (
    "id" UUID NOT NULL,
    "title" VARCHAR(100),
    "subtitle" VARCHAR(200),
    "tag" VARCHAR(50),
    "image_url" VARCHAR(500) NOT NULL,
    "link_url" VARCHAR(500),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "banner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "favorite" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "shop_follow" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_follow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "shop_coupon" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "discount_type" "coupon_discount_type" NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "min_spend_amount_minor" INTEGER NOT NULL DEFAULT 0,
    "max_discount_amount_minor" INTEGER,
    "quota" INTEGER NOT NULL,
    "claimed_count" INTEGER NOT NULL DEFAULT 0,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "start_date" TIMESTAMPTZ(6) NOT NULL,
    "end_date" TIMESTAMPTZ(6) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shop_coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_coupon_claim" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "claimed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_used" BOOLEAN NOT NULL DEFAULT false,
    "used_at" TIMESTAMPTZ(6),
    "order_id" UUID,

    CONSTRAINT "user_coupon_claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "chat_block" (
    "id" UUID NOT NULL,
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "chat_report" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reported_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "message_id" UUID,
    "reason" VARCHAR(100) NOT NULL,
    "details" TEXT,
    "status" "chat_report_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "chat_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "chat_message_hidden" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "hidden_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_hidden_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "rate_limit_counter" (
    "key" VARCHAR(255) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "started_at_ms" BIGINT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rate_limit_counter_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "article_category_created_at_idx" ON "article"("category", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "community_request_status_created_at_idx" ON "community_request"("status", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "banner_is_active_display_order_idx" ON "banner"("is_active", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "favorite_user_id_product_id_key" ON "favorite"("user_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "shop_follow_user_id_shop_id_key" ON "shop_follow"("user_id", "shop_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "shop_coupon_shop_id_idx" ON "shop_coupon"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "shop_coupon_shop_id_code_key" ON "shop_coupon"("shop_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_coupon_claim_order_id_key" ON "user_coupon_claim"("order_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_coupon_claim_user_id_idx" ON "user_coupon_claim"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_coupon_claim_coupon_id_idx" ON "user_coupon_claim"("coupon_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_coupon_claim_user_id_coupon_id_key" ON "user_coupon_claim"("user_id", "coupon_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chat_block_blocked_id_idx" ON "chat_block"("blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "chat_block_blocker_id_blocked_id_key" ON "chat_block"("blocker_id", "blocked_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chat_report_reporter_id_idx" ON "chat_report"("reporter_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chat_report_reported_id_idx" ON "chat_report"("reported_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chat_report_room_id_idx" ON "chat_report"("room_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "chat_message_hidden_user_id_idx" ON "chat_message_hidden"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "chat_message_hidden_message_id_user_id_key" ON "chat_message_hidden"("message_id", "user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "rate_limit_counter_expires_at_idx" ON "rate_limit_counter"("expires_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "order_coupon_id_idx" ON "order"("coupon_id");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "shop" ADD CONSTRAINT "shop_banner_file_id_fkey" FOREIGN KEY ("banner_file_id") REFERENCES "uploaded_file"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "order" ADD CONSTRAINT "order_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "shop_coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "community_request" ADD CONSTRAINT "community_request_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "favorite" ADD CONSTRAINT "favorite_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "favorite" ADD CONSTRAINT "favorite_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "shop_follow" ADD CONSTRAINT "shop_follow_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "shop_follow" ADD CONSTRAINT "shop_follow_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "shop_coupon" ADD CONSTRAINT "shop_coupon_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "user_coupon_claim" ADD CONSTRAINT "user_coupon_claim_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "user_coupon_claim" ADD CONSTRAINT "user_coupon_claim_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "shop_coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "user_coupon_claim" ADD CONSTRAINT "user_coupon_claim_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "chat_block" ADD CONSTRAINT "chat_block_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "chat_block" ADD CONSTRAINT "chat_block_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "chat_report" ADD CONSTRAINT "chat_report_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "chat_report" ADD CONSTRAINT "chat_report_reported_id_fkey" FOREIGN KEY ("reported_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "chat_report" ADD CONSTRAINT "chat_report_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "chat_report" ADD CONSTRAINT "chat_report_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "chat_message_hidden" ADD CONSTRAINT "chat_message_hidden_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "chat_message_hidden" ADD CONSTRAINT "chat_message_hidden_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
