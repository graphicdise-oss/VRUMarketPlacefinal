import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { normaliseEmail } from './email-address.js';

/**
 * Reads the markers left behind by PDPA erasure (K16).
 *
 * It answers two narrow questions about the account(s) that used to own an address. Was one of
 * them banned? If so, registering again is how somebody walks away from a ban and comes back
 * clean, and K16 says no. And how many disputes did they lose (§97)? K16 lets that one number
 * reach the admin reviewing a shop application — `ShopService` asks, nobody else.
 *
 * **This service only reads.** Topic 12 writes a marker as the last step of erasing an account.
 * Splitting it that way is why #29 can close the evasion route before the erasure flow exists —
 * the alternative is a check that gets added "later", and a missing check here is invisible: the
 * person registers successfully and nothing looks wrong.
 */
@Injectable()
export class AccountMarkerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Whether this address belonged to an account that was banned before it was erased.
   *
   * Looks up an HMAC rather than the address, because the address is not stored — see the model
   * comment for why, and for the warning about the pepper that keys this.
   */
  async wasBanned(email: string): Promise<boolean> {
    const marker = await this.prisma.deletedAccountMarker.findUnique({
      where: { emailHmac: this.hash(email) },
      select: { wasBanned: true },
    });

    return marker?.wasBanned ?? false;
  }

  /**
   * §124 review: whether any account at this address was erased (PDPA) — banned or not. For the one
   * caller that creates an account on someone's behalf rather than waiting for them to sign up
   * (`SuperAdminBootstrapTask`): the person who asked to be erased is not contacted again.
   */
  async wasErased(email: string): Promise<boolean> {
    const marker = await this.prisma.deletedAccountMarker.findUnique({
      where: { emailHmac: this.hash(email) },
      select: { emailHmac: true },
    });

    return marker !== null;
  }

  /**
   * §97 (K16): how many disputes the erased account(s) that used to own each address lost — shown
   * to the admin reviewing a shop application, and nowhere else. Keyed by the address as given;
   * `0` when there is no marker, so the answer alone never says whether an erased account existed
   * (K16: the old account and the new one are not to be tied together beyond this one number).
   * One query for the whole batch, for the pending-applications queue.
   */
  async priorDisputeLosses(emails: readonly string[]): Promise<Map<string, number>> {
    const hashes = new Map(emails.map((email) => [email, this.hash(email)]));
    const markers = await this.prisma.deletedAccountMarker.findMany({
      where: { emailHmac: { in: [...new Set(hashes.values())] } },
      select: { emailHmac: true, disputeLostCount: true },
    });
    const byHash = new Map(markers.map((marker) => [marker.emailHmac, marker.disputeLostCount]));

    return new Map([...hashes].map(([email, hash]) => [email, byHash.get(hash) ?? 0]));
  }

  /**
   * The digest for an address, for the writer in topic 12 as well as the reader here.
   *
   * ⚠️ The pepper comes from `ACCOUNT_MARKER_PEPPER` in `.env` and **can never be rotated**: these
   * digests cannot be recomputed, because the addresses that produced them were erased on purpose.
   * Change it and every marker silently stops matching, which means everybody who was ever banned
   * can register again — and nothing fails loudly enough for anyone to notice.
   *
   * Normalised the same way an address is before it reaches the `user` table, or the marker
   * written for Foo@example.com would not match a registration for foo@example.com.
   */
  hash(email: string): string {
    return createHmac('sha256', this.config.accountMarkerPepper)
      .update(normaliseEmail(email))
      .digest('hex');
  }
}
