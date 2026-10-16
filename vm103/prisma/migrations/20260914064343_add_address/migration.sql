-- CreateTable
CREATE TABLE "address" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "recipient_name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(15) NOT NULL,
    "house_number" VARCHAR(50) NOT NULL,
    "village_number" VARCHAR(50),
    "alley" VARCHAR(100),
    "road" VARCHAR(100),
    "subdistrict_postal_code_id" UUID NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "address_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "address_user_id_idx" ON "address"("user_id");

-- CreateIndex
CREATE INDEX "address_subdistrict_postal_code_id_idx" ON "address"("subdistrict_postal_code_id");

-- AddForeignKey
ALTER TABLE "address" ADD CONSTRAINT "address_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "address" ADD CONSTRAINT "address_subdistrict_postal_code_id_fkey" FOREIGN KEY ("subdistrict_postal_code_id") REFERENCES "subdistrict_postal_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- #47: at most one *live* default address per person (spec 6/12: "มีที่อยู่หลักได้ทีละหนึ่งรายการ
-- ต่อคน — ตั้งอันใหม่แล้วอันเก่าหลุดสถานะเอง"). Prisma's schema DSL has no partial unique
-- constraint, so this is added by hand — same technique as shop_owner_id_open_key
-- (20260914022633_add_shop/migration.sql). Excluding deleted_at IS NOT NULL rows is what lets a
-- deleted default free its slot instead of permanently occupying it.
CREATE UNIQUE INDEX "address_user_id_default_key" ON "address"("user_id") WHERE "is_default" = true AND "deleted_at" IS NULL;
