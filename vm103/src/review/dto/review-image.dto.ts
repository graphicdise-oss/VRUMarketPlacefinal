import { ApiProperty } from '@nestjs/swagger';

/** Same minimal shape as `ProductImageDto` — the id is what `GET /reviews/:reviewId/images/:imageId` resolves. */
export class ReviewImageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  static from(row: { id: string; createdAt: Date }): ReviewImageDto {
    const dto = new ReviewImageDto();
    dto.id = row.id;
    dto.createdAt = row.createdAt;

    return dto;
  }
}
