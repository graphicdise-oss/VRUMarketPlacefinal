import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommunityRequest } from '@prisma/client';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Page } from '../../common/pagination/page.js';

export class CreateCommunityRequestDto {
  @ApiProperty({ example: 'ชุมชนผ้าทอบ้านนา' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'ศูนย์รวมสินค้าผ้าทอมือประจำหมู่บ้าน' })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiPropertyOptional({ example: 'อ.เมือง จ.เชียงใหม่' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;
}

export class RejectCommunityRequestDto {
  @ApiPropertyOptional({ example: 'ข้อมูลไม่ครบถ้วน' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class CommunityRequestDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id!: string;

  @ApiProperty({ example: 'ชุมชนผ้าทอบ้านนา' })
  name!: string;

  @ApiProperty({ example: 'ศูนย์รวมสินค้าผ้าทอมือประจำหมู่บ้าน' })
  description!: string;

  @ApiPropertyOptional({ example: 'อ.เมือง จ.เชียงใหม่' })
  location!: string | null;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  requesterId!: string;

  @ApiProperty({ example: 'PENDING' })
  status!: string;

  @ApiPropertyOptional({ example: 'ข้อมูลไม่ครบถ้วน' })
  reason!: string | null;

  @ApiProperty({ example: '2026-10-06T00:00:00.000Z' })
  createdAt!: Date;

  static from(row: CommunityRequest): CommunityRequestDto {
    const dto = new CommunityRequestDto();
    dto.id = row.id;
    dto.name = row.name;
    dto.description = row.description;
    dto.location = row.location;
    dto.requesterId = row.requesterId;
    dto.status = row.status;
    dto.reason = row.reason;
    dto.createdAt = row.createdAt;
    return dto;
  }
}

export class CommunityRequestPageDto implements Page<CommunityRequestDto> {
  @ApiProperty({ type: [CommunityRequestDto] })
  items!: CommunityRequestDto[];

  @ApiPropertyOptional({ description: 'Cursor to fetch the next page', nullable: true })
  nextCursor!: string | null;

  @ApiProperty({ description: 'Whether there are more items to fetch' })
  hasMore!: boolean;
}
