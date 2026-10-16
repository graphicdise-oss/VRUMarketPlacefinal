-- §90: the terms of service acceptance is recorded in the same table as the privacy policy one,
-- told apart by which document the row names.

-- CreateEnum
CREATE TYPE "policy_document" AS ENUM ('PRIVACY_POLICY', 'TERMS_OF_SERVICE');

-- AlterTable
-- Every row written before §90 is a privacy policy acceptance: that was the only document the
-- sign-up form asked about. The default exists only to fill those rows in; it is dropped straight
-- after so that no future insert can leave the document unnamed.
ALTER TABLE "policy_acceptance" ADD COLUMN "document" "policy_document" NOT NULL DEFAULT 'PRIVACY_POLICY';
ALTER TABLE "policy_acceptance" ALTER COLUMN "document" DROP DEFAULT;
