import { Controller, Get, HttpStatus, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { HealthQueryDto } from './dto/health-query.dto.js';
import { HealthResponseDto } from './dto/health-response.dto.js';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  // Authentication became default-deny when #24 registered AuthGuard globally. A health check
  // that needs a session is not a health check: the monitor that polls it has no account, and it
  // has to keep answering when the database — and therefore every session lookup — is down.
  @Public()
  @ApiOperation({
    summary: 'Liveness and dependency check',
    description:
      'Answers 200 while the database is reachable and 503 when it is not. No authentication: this has to work when everything else is broken.',
  })
  @ApiResponse({ status: 200, description: 'Everything is up.', type: HealthResponseDto })
  @ApiResponse({
    status: 503,
    description: 'The application is running but a dependency is not.',
    type: HealthResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'A query parameter was supplied. This endpoint accepts none.',
    type: ErrorResponseDto,
  })
  async check(
    // Declared so the global pipe runs: health accepts no parameters, and HealthQueryDto plus
    // forbidNonWhitelisted is what turns that sentence into enforced behaviour.
    @Query() _query: HealthQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthResponseDto> {
    const result = await this.health.check();

    // Set the status code rather than throwing ServiceUnavailableException, because an
    // exception would be rewritten into the L4 error envelope by the global filter that
    // arrives with #16. A monitor polling this endpoint should get the same body shape at
    // 200 and at 503, not a health report one moment and an error object the next.
    //
    // `passthrough: true` keeps Nest in charge of serialising the return value; the
    // controller only chooses the code. This is also why the status decision lives here and
    // not in the service: HealthService does not know what an HTTP status is.
    res.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return result;
  }
}
