import { ApiProperty } from '@nestjs/swagger';
import { EmailField } from '../../auth/dto/email-field.decorator.js';

/** §125: who to make a super admin — by the address of an account that has signed up and verified it. */
export class AppointSuperAdminDto {
  @EmailField()
  email!: string;
}

export class SuperAdminAppointmentDto {
  @ApiProperty({
    enum: ['PROMOTED'],
    description:
      'The existing, verified account is a super admin from its next request, and has an in-app notice. ' +
      'An address with no account is refused (409) — the person signs up and verifies first (§125).',
  })
  outcome!: 'PROMOTED';

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Communities this account was an admin of — those rows are folded into the new role. Super admins are not paged ' +
      'for each community\'s queue (§102), so a community whose only admin this was now pages nobody: appoint another.',
  })
  foldedCommunityIds!: string[];
}
