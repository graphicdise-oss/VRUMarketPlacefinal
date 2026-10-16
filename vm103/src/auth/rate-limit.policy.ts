import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.module.js';
import { MS_PER_HOUR, MS_PER_MINUTE } from '../time/clock.js';

/**
 * The ceilings this system enforces, by name (I17 · L7).
 *
 * A name rather than the numbers themselves, because a route says which ceiling applies to it and
 * the numbers come from configuration — #28 requires that, and for a good reason: there is no CI
 * here and none of these has ever met real traffic, so the first values are guesses that somebody
 * will want to change at deploy time without a rebuild.
 */
export const RATE_LIMIT_NAMES = [
  'login',
  'loginPerIp',
  'register',
  'registerPerIp',
  'verificationLink',
  'resetLink',
  'passwordReset',
  'upload',
] as const;

export type RateLimitName = (typeof RATE_LIMIT_NAMES)[number];

/**
 * The longest window any rule below uses.
 *
 * Declared here, beside the rules, because it is a fact about them: anything that prunes counters
 * needs an age past which no rule could still be counting, and computing it per caller is how one
 * caller ends up passing its *own* window and deleting a longer rule's live counters. Raise it if
 * a rule is ever given a window longer than an hour — nothing else needs to change.
 */
export const LONGEST_RATE_LIMIT_WINDOW_MS = MS_PER_HOUR;

/** What a counter is kept per. */
export type RateLimitKeyKind =
  /**
   * The default, and what #28 asks for in as many words.
   *
   * Many people can sit behind one address at once — mobile carriers put an entire cell behind
   * CGNAT, and so do public wifi and a shared office router — so counting by IP alone would mean
   * one person holding down a button locks out everybody sharing that address with them. Adding
   * the address being attempted makes the counter about the account under attack rather than
   * about whoever happens to share a connection with the attacker.
   */
  | 'ip+email'
  /**
   * IP alone, used only where varying the address is free for an attacker and therefore makes an
   * `ip+email` counter meaningless on its own. Always a **looser** ceiling than its `ip+email`
   * twin, precisely because of the shared-router problem above.
   */
  | 'ip'
  /**
   * The signed-in account, whatever address it comes from (§100). For routes that only a signed-in
   * account can reach, where what is being limited is that account's own use — the address is the
   * wrong key there twice over: a campus behind one router is not one person, and one person is
   * not stopped by switching networks.
   */
  | 'account';

export interface RateLimitRule {
  readonly name: RateLimitName;
  readonly keyKind: RateLimitKeyKind;
  readonly max: number;
  readonly windowMs: number;
}

/**
 * Turns a rule's name into the numbers currently configured for it.
 *
 * A service rather than a constant object so the values come from `AppConfig`, which validated
 * them at boot. The alternative — reading `process.env` where the rule is used — is how a typo
 * becomes `NaN` and a ceiling of zero.
 */
@Injectable()
export class RateLimitPolicy {
  constructor(private readonly config: AppConfig) {}

  rule(name: RateLimitName): RateLimitRule {
    switch (name) {
      case 'login':
        // I17 exactly: ten attempts per quarter hour, per account per source. Counts successes
        // too — a guard runs before the handler and cannot know how it went, and ten sign-ins in
        // fifteen minutes from one place is not something a person does.
        return {
          name,
          keyKind: 'ip+email',
          max: this.config.rateLimitLoginPer15Min,
          windowMs: 15 * MS_PER_MINUTE,
        };

      case 'loginPerIp':
        // The second layer under 'login', for the same reason registration has one: an attacker
        // varying the address never meets the (IP + email) ceiling above, because every attempt
        // opens a fresh counter of its own. Credential stuffing — a list of stolen addresses and
        // one guessed password apiece — is exactly that shape, and it was passing through
        // unbounded.
        //
        // What this protects is cost, not any one account: a login attempt for an address with no
        // account still runs argon2id at 19 MiB and ~85ms (wasteVerificationTime — the same work a
        // real check costs, so the two answers cannot be told apart by timing), so an unthrottled
        // stream of them is a memory-heavy DoS on a server CLAUDE.md describes as short of memory.
        // 'passwordReset' below carries this exact per-IP ceiling for the same reason; login never
        // got its matching layer, which is what #24/#25's code review (DECISIONS.md §71) found.
        //
        // 60 an hour — the project owner's call on 2026-09-21, confirmed after this asymmetry was
        // flagged. Deliberately loose next to 'login''s ten per fifteen minutes: this one counts
        // everybody behind a shared address (CGNAT, public wifi) together, the same reasoning as
        // 'registerPerIp' below. An ordinary person signing in a few times an hour never
        // approaches it; a stuffing run reaches it in well under a minute.
        return {
          name,
          keyKind: 'ip',
          max: this.config.rateLimitLoginPerIpPerHour,
          windowMs: MS_PER_HOUR,
        };

      case 'register':
        // L7's five an hour, keyed the way #28 requires rather than by IP alone.
        return {
          name,
          keyKind: 'ip+email',
          max: this.config.rateLimitRegisterPerHour,
          windowMs: MS_PER_HOUR,
        };

      case 'registerPerIp':
        // Two layers, deliberately: #28 asks for "5 per hour per IP (L7)" and, in the same
        // breath, for counting by (IP + email) rather than IP alone. Keyed only by (IP + email),
        // registration is barely limited at all — the attacker picks a new address every time,
        // which costs them nothing. Keyed only by IP at L7's five an hour, one shared address —
        // a mobile carrier's CGNAT range, a café's wifi — could register five accounts *total*
        // for every person behind it, all day, which is a ceiling that punishes ordinary sign-ups
        // and does nothing to an attacker patient enough to rotate across a handful of addresses.
        //
        // So: both. The tight ceiling ('register', above) is per account-attempt; this looser one
        // caps how many accounts any single source can create in an hour. The number, 20, is the
        // project owner's call, confirmed after L7's literal "5" was flagged as unworkable for a
        // marketplace open to the public rather than a closed population — see N18.
        return {
          name,
          keyKind: 'ip',
          max: this.config.rateLimitRegisterPerIpPerHour,
          windowMs: MS_PER_HOUR,
        };

      // I17's three an hour, for each of the two "send me a link" endpoints. They share the
      // configured number and deliberately **not** the counter: asking for a password reset must
      // not spend the allowance for proving your address, or somebody who tried the wrong form
      // first would be left unable to do either. The rule's name is part of the counter's key,
      // which is what keeps them apart.
      //
      // This is the same number the per-account check inside those services applies, arriving
      // from the other direction: that one protects Brevo's shared daily quota for a known
      // account, this one stops an unknown address from being asked about at speed.
      case 'verificationLink':
      case 'resetLink':
        return {
          name,
          keyKind: 'ip+email',
          max: this.config.rateLimitEmailLinkPerHour,
          windowMs: MS_PER_HOUR,
        };

      case 'passwordReset':
        // Setting a new password with a link. There is no address in that request to key on, so
        // this is per IP and deliberately generous.
        //
        // The reason it is limited at all is not token guessing — the token is 256 bits of
        // randomness and guessing it is hopeless — but cost: every call hashes a password with
        // argon2id at 19 MiB and ~85ms, which is a very cheap request to make and an expensive
        // one to serve on a machine that is short of memory.
        return {
          name,
          keyKind: 'ip',
          max: this.config.rateLimitPasswordResetPerIpPerHour,
          windowMs: MS_PER_HOUR,
        };

      case 'upload':
        // §100: every upload route together, per account. An upload is the most expensive request
        // this system serves — up to 110MB on the wire and to disk, then decoding and re-encoding —
        // and one account sending many at once was how §99 took the API down. 60 an hour is the
        // project owner's call (2026-09-29): a person photographing their products or a dispute
        // never approaches it; a script sending uploads in a loop meets it in seconds.
        //
        // One upload is one request — a dispute's ten photos count once, a product's ten photos
        // (one request each) count ten.
        return {
          name,
          keyKind: 'account',
          max: this.config.rateLimitUploadPerHour,
          windowMs: MS_PER_HOUR,
        };
    }
  }
}
