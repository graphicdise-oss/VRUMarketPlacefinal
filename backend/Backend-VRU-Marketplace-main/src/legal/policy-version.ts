import type { Prisma } from '@prisma/client';
import { newId } from '../common/id.js';

/**
 * The privacy policy version this build serves (#75 · §66).
 *
 * A date rather than a number, because the question anyone asks of a stored acceptance is "what
 * did the policy say then", and a date is what you take to `git log docs/privacy-policy-draft.md`
 * to find out. `v3` tells you nothing without a table mapping it back to a date.
 *
 * ⚠️ **Bump this in the same commit that changes the policy text, never separately.** A version
 * that lags behind the text means every acceptance recorded in between names wording the person
 * was not shown — which is precisely the failure this whole mechanism exists to prevent.
 *
 * ⚠️ Bumping it does **not** re-ask existing accounts. Nothing in the system re-prompts, and
 * nothing refuses a request from someone whose newest acceptance is an old version. If a future
 * policy change needs re-acceptance, that is a feature to build then — see §66, which decided the
 * checkbox and deliberately left re-acceptance out of scope.
 */
export const CURRENT_PRIVACY_POLICY_VERSION = '2026-09-30';

/**
 * The terms of service version this build serves (§90).
 *
 * The date of `docs/terms-of-service-draft.md` the owner chose as the first version, for the same
 * reason the privacy policy is versioned by date: it is what you take to `git log` to find out what
 * the terms said on the day somebody accepted them.
 *
 * ⚠️ The same two warnings as `CURRENT_PRIVACY_POLICY_VERSION` apply. Bump it in the commit that
 * changes the terms text, never separately — and bumping it does not re-ask existing accounts.
 * The owner decided (§90) to record acceptance at sign-up only for now; re-acceptance is a ticket
 * for the first time the terms change after launch.
 */
export const CURRENT_TERMS_OF_SERVICE_VERSION = '2026-09-29';

/**
 * Matches `PolicyAcceptance.policyVersion`'s `@db.VarChar(32)`.
 *
 * The DTO enforces it so an over-long value is a 400 with a field error, not a database error
 * surfacing as a 500 — and so the column can never be the thing that rejects a request.
 */
export const MAX_POLICY_VERSION_LENGTH = 32;

/**
 * §90: the rows one ticked sign-up checkbox writes — one per document, same instant. Shared by
 * both doors (`AuthService.register`, `GoogleAuthService`), so a third document behind the same
 * box is one edit here rather than two that can drift apart.
 */
export function signupAcceptances(
  privacyPolicyVersion: string,
  termsOfServiceVersion: string,
  acceptedAt: Date,
): Prisma.PolicyAcceptanceCreateWithoutUserInput[] {
  return [
    { id: newId(), document: 'PRIVACY_POLICY', policyVersion: privacyPolicyVersion, acceptedAt },
    { id: newId(), document: 'TERMS_OF_SERVICE', policyVersion: termsOfServiceVersion, acceptedAt },
  ];
}
