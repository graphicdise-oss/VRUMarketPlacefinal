-- CreateTable
CREATE TABLE "community_admin" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "community_id" UUID NOT NULL,
    "assigned_by" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "community_admin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "community_admin_community_id_idx" ON "community_admin"("community_id");

-- CreateIndex
CREATE UNIQUE INDEX "community_admin_user_id_community_id_key" ON "community_admin"("user_id", "community_id");

-- AddForeignKey
ALTER TABLE "community_admin" ADD CONSTRAINT "community_admin_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_admin" ADD CONSTRAINT "community_admin_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "community"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
