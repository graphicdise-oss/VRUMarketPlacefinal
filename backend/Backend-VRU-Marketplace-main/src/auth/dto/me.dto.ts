import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../authenticated-request.js';

/**
 * Who the caller is.
 *
 * This endpoint exists because of B3: both tokens are in httpOnly cookies, so the frontend cannot
 * read them and cannot tell from the browser alone whether it is signed in, let alone as whom. It
 * asks instead.
 *
 * What is **not** here is as deliberate as what is. No token of any kind, for the reason B3 gives.
 * No name or phone number, because those live on Address (topic 6) and a person may have several.
 * No `bannedAt`: a banned caller never reaches a handler — the guard answers ACCOUNT_BANNED — so a
 * field for it would always be null and would invite a frontend to check the wrong thing.
 */
export class MeDto {
  @ApiProperty({ format: 'uuid', description: 'Stable for the lifetime of the account.' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({
    enum: UserRole,
    description:
      'Platform role only. Community-admin rights are separate (topic 3) — see `adminCommunityIds`.',
  })
  role!: UserRole;

  @ApiProperty({
    description:
      'False until the address is confirmed. Browsing and searching work either way; ordering ' +
      'and opening a shop will require true (B0.1).',
  })
  emailVerified!: boolean;

  @ApiProperty({
    type: [String],
    description:
      '§112: the communities this account administers (empty for everyone else). A community admin ' +
      'has `role: USER`, so this is how the frontend knows to offer the admin screens. A super admin ' +
      'passes every community without a row — read `role` for that.',
  })
  adminCommunityIds!: string[];

  /**
   * Built here rather than by spreading `CurrentUser`, so that adding a field to the internal
   * type cannot quietly publish it. Every field in the response is written down once, in this
   * function.
   */
  static from(user: CurrentUser, adminCommunityIds: string[]): MeDto {
    const dto = new MeDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.role = user.role;
    dto.emailVerified = user.emailVerified;
    dto.adminCommunityIds = adminCommunityIds;

    return dto;
  }
}
