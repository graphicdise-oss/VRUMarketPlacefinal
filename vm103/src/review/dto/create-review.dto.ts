import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { MAX_RATING, MAX_REVIEW_TEXT_LENGTH, MIN_RATING } from '../review-policy.js';

/**
 * K10: rating is mandatory, text is not. Reused for both writing a review
 * (`ReviewService.create`) and editing one (`ReviewService.update`) — the two actions replace the
 * exact same two fields, so a second, identical class would exist only to have a different name.
 */
export class CreateReviewDto {
  @ApiProperty({ minimum: MIN_RATING, maximum: MAX_RATING })
  @IsInt()
  @Min(MIN_RATING)
  @Max(MAX_RATING)
  rating!: number;

  @ApiPropertyOptional({ maxLength: MAX_REVIEW_TEXT_LENGTH })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(0, MAX_REVIEW_TEXT_LENGTH)
  text?: string;
}
