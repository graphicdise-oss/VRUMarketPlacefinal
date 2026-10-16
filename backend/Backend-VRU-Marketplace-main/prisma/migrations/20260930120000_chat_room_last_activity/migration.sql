-- §108: order each chat inbox by the room's latest message, newest first, instead of by when the
-- room was created. Added nullable, filled from what the rooms already hold (their newest message,
-- else their creation), then made required — existing rooms sort correctly from the first request.

ALTER TABLE "chat_room" ADD COLUMN "last_activity_at" TIMESTAMPTZ(6);
UPDATE "chat_room" AS r
SET "last_activity_at" = COALESCE((SELECT MAX(m."created_at") FROM "chat_message" m WHERE m."room_id" = r."id"), r."created_at");
ALTER TABLE "chat_room" ALTER COLUMN "last_activity_at" SET NOT NULL;

ALTER TABLE "shop_admin_chat_room" ADD COLUMN "last_activity_at" TIMESTAMPTZ(6);
UPDATE "shop_admin_chat_room" AS r
SET "last_activity_at" = COALESCE((SELECT MAX(m."created_at") FROM "shop_admin_chat_message" m WHERE m."room_id" = r."id"), r."created_at");
ALTER TABLE "shop_admin_chat_room" ALTER COLUMN "last_activity_at" SET NOT NULL;

-- CreateIndex
CREATE INDEX "chat_room_buyer_id_last_activity_at_id_idx" ON "chat_room"("buyer_id", "last_activity_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "chat_room_shop_owner_user_id_last_activity_at_id_idx" ON "chat_room"("shop_owner_user_id", "last_activity_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "shop_admin_chat_room_last_activity_at_id_idx" ON "shop_admin_chat_room"("last_activity_at" DESC, "id" DESC);
