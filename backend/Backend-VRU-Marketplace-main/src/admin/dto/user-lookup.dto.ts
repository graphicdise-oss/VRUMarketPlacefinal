import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

/**
 * §112: what a super admin needs about one account to appoint or ban it — and nothing past that.
 * No name, phone or address (those live on `Address`, and neither action needs them).
 */
export class UserLookupDto {
  @ApiProperty({ format: 'uuid', description: 'The id POST /admin/users/:userId/ban and POST /communities/:id/admins take.' })
  id!: string;

  @ApiProperty({ format: 'email' })
  email!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty()
  emailVerified!: boolean;

  @ApiProperty({ nullable: true, format: 'date-time' })
  bannedAt!: Date | null;

  @ApiProperty({ type: [String], description: 'Communities this account administers.' })
  adminCommunityIds!: string[];

  @ApiProperty({ description: 'Runs an open shop — such an account cannot be appointed an admin (N29).' })
  hasOpenShop!: boolean;

  static from(row: {
    id: string;
    email: string;
    role: UserRole;
    emailVerifiedAt: Date | null;
    bannedAt: Date | null;
    adminCommunityIds: string[];
    hasOpenShop: boolean;
  }): UserLookupDto {
    const dto = new UserLookupDto();
    dto.id = row.id;
    dto.email = row.email;
    dto.role = row.role;
    dto.emailVerified = row.emailVerifiedAt !== null;
    dto.bannedAt = row.bannedAt;
    dto.adminCommunityIds = row.adminCommunityIds;
    dto.hasOpenShop = row.hasOpenShop;

    return dto;
  }
}
