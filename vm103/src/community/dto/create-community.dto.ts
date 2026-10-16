import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import {
  MAX_COMMUNITY_DESCRIPTION_LENGTH,
  MAX_COMMUNITY_NAME_LENGTH,
  MIN_COMMUNITY_DESCRIPTION_LENGTH,
  MIN_COMMUNITY_NAME_LENGTH,
} from '../community-policy.js';

export class CreateCommunityDto {
  @ApiProperty({
    minLength: MIN_COMMUNITY_NAME_LENGTH,
    maxLength: MAX_COMMUNITY_NAME_LENGTH,
    example: 'ชุมชนบางแสน',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_COMMUNITY_NAME_LENGTH, MAX_COMMUNITY_NAME_LENGTH)
  name!: string;

  @ApiProperty({
    minLength: MIN_COMMUNITY_DESCRIPTION_LENGTH,
    maxLength: MAX_COMMUNITY_DESCRIPTION_LENGTH,
    description: 'What a visitor sees on the community listing before choosing it as a filter.',
    example: 'ตลาดออนไลน์สำหรับร้านค้าและผู้ซื้อในเขตบางแสน',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_COMMUNITY_DESCRIPTION_LENGTH, MAX_COMMUNITY_DESCRIPTION_LENGTH)
  description!: string;
}
