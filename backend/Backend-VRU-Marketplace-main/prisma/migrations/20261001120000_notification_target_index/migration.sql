-- §113: markReadForEveryone (§108) clears one target's unread notices across every recipient,
-- with no user_id to start from — this index keeps it from reading the whole table.
CREATE INDEX "notification_target_id_idx" ON "notification"("target_id");
