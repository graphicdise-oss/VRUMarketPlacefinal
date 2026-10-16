-- #33's code review (2026-09-22): closes the "ในชุมชนไหน" gap N22 deferred to this ticket, and
-- fixes an indexing mismatch found in the same review — no query in src/ filters on created_at
-- or (target_type, target_id), while #33's own AC-required action filter had no index at all.
--
-- Written by hand rather than left as the raw `prisma migrate dev` diff: that diff also proposed
-- `DROP INDEX "product_name_trgm_idx"` even though this migration never touches it — the same
-- false positive DECISIONS.md §56 documents (the trigram index is raw SQL from #45's migration,
-- never declared in schema.prisma because Prisma has no GIN/trigram index type, so the diff tool
-- sees it as "undeclared" and offers to drop it on every unrelated schema change near it).
-- Dropping it here would silently delete N5's entire Thai-language search the moment someone ran
-- `prisma migrate dev` again, so that line is removed and only the audit_log changes below stay.

-- DropIndex
DROP INDEX "audit_log_actor_user_id_idx";

-- DropIndex
DROP INDEX "audit_log_created_at_idx";

-- DropIndex
DROP INDEX "audit_log_target_type_target_id_idx";

-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "community_id" UUID;

-- CreateIndex
CREATE INDEX "audit_log_action_id_idx" ON "audit_log"("action", "id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_id_idx" ON "audit_log"("actor_user_id", "id");
