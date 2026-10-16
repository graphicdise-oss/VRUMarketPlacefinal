import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { MAX_CATEGORY_NAME_LENGTH, MIN_CATEGORY_NAME_LENGTH } from '../category-policy.js';

export class CreateCategoryDto {
  @ApiProperty({
    minLength: MIN_CATEGORY_NAME_LENGTH,
    maxLength: MAX_CATEGORY_NAME_LENGTH,
    example: 'ของเล่นเด็ก',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(MIN_CATEGORY_NAME_LENGTH, MAX_CATEGORY_NAME_LENGTH)
  name!: string;
}
