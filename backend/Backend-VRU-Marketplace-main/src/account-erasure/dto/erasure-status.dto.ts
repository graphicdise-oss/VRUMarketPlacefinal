import { ApiProperty } from '@nestjs/swagger';
import type { ErasureBlockerReason } from '../account-erasure.service.js';
import { ERASURE_BLOCKER_REASONS, ErasureBlocker, ErasureStatusResult } from '../account-erasure.service.js';

/** One order still keeping a request from clearing (#71, H9) — enough for a client to explain why. */
export class ErasureBlockerDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ enum: ['BUYER', 'SELLER'], description: 'Which side of this order the caller is on.' })
  role!: 'BUYER' | 'SELLER';

  @ApiProperty({ description: 'The order’s own status right now.' })
  status!: string;

  @ApiProperty({
    enum: ERASURE_BLOCKER_REASONS,
    description:
      '§96: why this order holds the request up — the order has not finished; a dispute on it is still open (any status); or (seller only) it has finished but its buyer can still open a dispute until clearsAt.',
  })
  reason!: ErasureBlockerReason;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When this one order stops blocking on its own — H10’s 15 days after shipping, or the end of the dispute window for DISPUTE_WINDOW. Null means there is no fixed date yet — something still has to happen first.',
  })
  clearsAt!: string | null;

  static from(blocker: ErasureBlocker): ErasureBlockerDto {
    const dto = new ErasureBlockerDto();
    dto.orderId = blocker.orderId;
    dto.role = blocker.role;
    dto.status = blocker.status;
    dto.reason = blocker.reason;
    dto.clearsAt = blocker.clearsAt === null ? null : blocker.clearsAt.toISOString();

    return dto;
  }
}

/** `GET /auth/account/erasure-status` and the JSON body of a queued `POST /auth/account/erase` (#71). */
export class ErasureStatusDto {
  @ApiProperty({ enum: ['NONE', 'QUEUED', 'ERASED'] })
  status!: 'NONE' | 'QUEUED' | 'ERASED';

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'When this account first requested erasure. Null unless status is QUEUED.' })
  requestedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'When this account was actually erased. Null unless status is ERASED.' })
  erasedAt!: string | null;

  @ApiProperty({ type: [ErasureBlockerDto], description: 'Empty unless status is QUEUED.' })
  blockers!: ErasureBlockerDto[];

  @ApiProperty({
    description:
      '§84 (H9: บอกเหตุผล): true when a shop this account opened after queuing is what holds the request up — close it to let the request clear. Always false unless status is QUEUED.',
  })
  blockedByOpenShop!: boolean;

  static from(result: ErasureStatusResult): ErasureStatusDto {
    const dto = new ErasureStatusDto();
    dto.status = result.status;
    dto.requestedAt = result.status === 'QUEUED' ? result.requestedAt.toISOString() : null;
    dto.erasedAt = result.status === 'ERASED' ? result.erasedAt.toISOString() : null;
    dto.blockers = result.status === 'QUEUED' ? result.blockers.map((blocker) => ErasureBlockerDto.from(blocker)) : [];
    dto.blockedByOpenShop = result.status === 'QUEUED' && result.blockedByOpenShop;

    return dto;
  }

  /** `POST /auth/account/erase`'s own 202 body — the request-just-got-queued case only. */
  static queued(requestedAt: Date, blockers: ErasureBlocker[]): ErasureStatusDto {
    const dto = new ErasureStatusDto();
    dto.status = 'QUEUED';
    dto.requestedAt = requestedAt.toISOString();
    dto.erasedAt = null;
    dto.blockers = blockers.map((blocker) => ErasureBlockerDto.from(blocker));
    // A request is never queued while a shop is open (K15 refuses it outright instead).
    dto.blockedByOpenShop = false;

    return dto;
  }
}
