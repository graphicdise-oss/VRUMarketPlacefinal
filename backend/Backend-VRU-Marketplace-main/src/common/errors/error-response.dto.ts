import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ERROR_CODES } from './error-code.js';

/**
 * The error shape, for the generated OpenAPI document (M4).
 *
 * A class rather than an interface because `@nestjs/swagger` reads decorators off a class, and the
 * whole point of M4 is that the document is generated from the code rather than hand-written.
 * `ErrorBody` in error-payload.ts is the type the code actually constructs; this is its
 * description. They are checked against each other by `errorResponse()` below.
 */
export class ErrorResponseDto {
  @ApiProperty({
    enum: Object.keys(ERROR_CODES),
    description:
      'Stable identifier. Branch on this. The list grows as topics land; it never changes meaning.',
    example: 'VALIDATION_FAILED',
  })
  code!: string;

  @ApiProperty({
    description:
      'Thai, ready to display to the user. Reworded freely, so never branch on it and never parse it.',
    example: 'ข้อมูลที่ส่งมาไม่ถูกต้อง',
  })
  message!: string;

  @ApiPropertyOptional({
    description:
      'Present only when named inputs are at fault. Keys are dotted paths (items.0.quantity) so a form can look up the input it is rendering.',
    additionalProperties: { type: 'string' },
    example: { email: 'email must be an email' },
  })
  fieldErrors?: Record<string, string>;
}
