-- #75 (§66): one row per person per privacy policy acceptance — a table rather than two columns
-- on `user`, because an acceptance that the next acceptance overwrites cannot answer the question
-- the checkbox exists to answer ("which wording did this person agree to, and when").
--
-- Written by hand rather than left as the raw `prisma migrate dev` diff: that diff proposed
-- `DROP INDEX "product_name_trgm_idx"` even though this migration never touches it — the same
-- false positive DECISIONS.md §56 already documents (the trigram index is raw SQL from #45's
-- migration, never declared in schema.prisma because Prisma has no GIN/trigram index type, so the
-- diff tool sees it as "undeclared" and offers to drop it on every unrelated schema change near
-- it). Dropping it here would silently delete N5's entire Thai-language search the moment someone
-- runs `prisma migrate deploy`.
--
-- ON DELETE RESTRICT, matching every other reference to `user` in this schema: PDPA erasure
-- anonymises the row rather than deleting it (invariant 5's own exception), so a cascade would
-- only ever fire on a `DELETE` that must not happen in the first place.

-- CreateTable
CREATE TABLE "policy_acceptance" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "policy_version" VARCHAR(32) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "policy_acceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "policy_acceptance_user_id_idx" ON "policy_acceptance"("user_id");

-- AddForeignKey
ALTER TABLE "policy_acceptance" ADD CONSTRAINT "policy_acceptance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
