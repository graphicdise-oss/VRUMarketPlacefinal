-- CreateTable
CREATE TABLE "shop" (
    "id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_owner_id_key" ON "shop"("owner_id");

-- CreateIndex
CREATE INDEX "shop_community_id_idx" ON "shop"("community_id");

-- AddForeignKey
ALTER TABLE "shop" ADD CONSTRAINT "shop_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop" ADD CONSTRAINT "shop_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
