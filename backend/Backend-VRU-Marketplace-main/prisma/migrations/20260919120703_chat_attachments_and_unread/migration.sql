-- AlterTable
ALTER TABLE "chat_message" ADD COLUMN     "file_id" UUID;

-- CreateTable
CREATE TABLE "chat_room_read" (
    "id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "chat_room_read_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_read_room_id_user_id_key" ON "chat_room_read"("room_id", "user_id");

-- AddForeignKey
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "uploaded_file"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_read" ADD CONSTRAINT "chat_room_read_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "chat_room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_read" ADD CONSTRAINT "chat_room_read_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
