-- §89: edit and unsend a chat message the way Messenger does. Additive only — every existing
-- message reads as never edited and never unsent, which is exactly what it was.

-- AlterTable
ALTER TABLE "chat_message" ADD COLUMN     "edited_at" TIMESTAMPTZ(6),
ADD COLUMN     "unsent_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "chat_message_version" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "written_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "chat_message_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_message_version_message_id_id_idx" ON "chat_message_version"("message_id", "id");

-- AddForeignKey
ALTER TABLE "chat_message_version" ADD CONSTRAINT "chat_message_version_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
