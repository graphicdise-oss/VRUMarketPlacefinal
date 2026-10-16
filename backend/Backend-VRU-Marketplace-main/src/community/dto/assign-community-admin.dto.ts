import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignCommunityAdminDto {
  @ApiProperty({ format: 'uuid', description: 'The user to make an admin of this community.' })
  @IsUUID()
  userId!: string;
}
