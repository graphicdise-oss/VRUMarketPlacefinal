-- §112: one community per name, ignoring letter case (names are trimmed before they are stored).
CREATE UNIQUE INDEX "community_name_lower_key" ON "community" (lower("name"));

-- §112: the audit log filters by subject — the row an entry is about, and its community.
CREATE INDEX "audit_log_target_id_id_idx" ON "audit_log"("target_id", "id");
CREATE INDEX "audit_log_community_id_id_idx" ON "audit_log"("community_id", "id");

-- §112: an erased account administers nothing. Erasure now removes these rows itself; this clears
-- the ones left by accounts erased before it did (none expected — production starts empty, §87).
DELETE FROM "community_admin" WHERE "user_id" IN (SELECT "id" FROM "user" WHERE "erased_at" IS NOT NULL);
