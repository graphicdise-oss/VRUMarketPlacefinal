-- §106: the admin↔shop chat — one room per shop, shared by the admins of its community.
-- CreateTable
CREATE TABLE "shop_admin_chat_room" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shop_admin_chat_room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_admin_chat_message" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "sender_side" VARCHAR(10) NOT NULL,
    "file_id" UUID,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "edited_at" TIMESTAMPTZ(6),
    "unsent_at" TIMESTAMPTZ(6),

    CONSTRAINT "shop_admin_chat_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_admin_chat_message_version" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "written_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shop_admin_chat_message_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_admin_chat_read" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "side" VARCHAR(10) NOT NULL,
    "last_read_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shop_admin_chat_read_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_admin_chat_pending_attachment" (
    "file_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "uploader_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shop_admin_chat_pending_attachment_pkey" PRIMARY KEY ("file_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_admin_chat_room_shop_id_key" ON "shop_admin_chat_room"("shop_id");

-- CreateIndex
CREATE INDEX "shop_admin_chat_message_room_id_id_idx" ON "shop_admin_chat_message"("room_id", "id");

-- CreateIndex
CREATE INDEX "shop_admin_chat_message_sender_id_idx" ON "shop_admin_chat_message"("sender_id");

-- CreateIndex
CREATE INDEX "shop_admin_chat_message_version_message_id_id_idx" ON "shop_admin_chat_message_version"("message_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_admin_chat_read_room_id_side_key" ON "shop_admin_chat_read"("room_id", "side");

-- CreateIndex
CREATE INDEX "shop_admin_chat_pending_attachment_room_id_uploader_id_idx" ON "shop_admin_chat_pending_attachment"("room_id", "uploader_id");

-- CreateIndex
CREATE INDEX "shop_admin_chat_pending_attachment_created_at_idx" ON "shop_admin_chat_pending_attachment"("created_at");

-- AddForeignKey
ALTER TABLE "shop_admin_chat_room" ADD CONSTRAINT "shop_admin_chat_room_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_admin_chat_message" ADD CONSTRAINT "shop_admin_chat_message_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "shop_admin_chat_room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_admin_chat_message" ADD CONSTRAINT "shop_admin_chat_message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_admin_chat_message" ADD CONSTRAINT "shop_admin_chat_message_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "uploaded_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_admin_chat_message_version" ADD CONSTRAINT "shop_admin_chat_message_version_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "shop_admin_chat_message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_admin_chat_read" ADD CONSTRAINT "shop_admin_chat_read_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "shop_admin_chat_room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_admin_chat_pending_attachment" ADD CONSTRAINT "shop_admin_chat_pending_attachment_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "uploaded_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_admin_chat_pending_attachment" ADD CONSTRAINT "shop_admin_chat_pending_attachment_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "shop_admin_chat_room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_admin_chat_pending_attachment" ADD CONSTRAINT "shop_admin_chat_pending_attachment_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Only the two sides exist; a typo in code must fail here rather than become a third side nobody reads.
ALTER TABLE "shop_admin_chat_message" ADD CONSTRAINT "shop_admin_chat_message_sender_side_check" CHECK ("sender_side" IN ('SHOP', 'ADMIN'));
ALTER TABLE "shop_admin_chat_read" ADD CONSTRAINT "shop_admin_chat_read_side_check" CHECK ("side" IN ('SHOP', 'ADMIN'));
