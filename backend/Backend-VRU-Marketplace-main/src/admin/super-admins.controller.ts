import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../auth/authenticated-request.js';
import { CSRF_HEADER } from '../auth/csrf.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequiresSuperAdmin } from '../auth/decorators/requires-super-admin.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { AppointSuperAdminDto, SuperAdminAppointmentDto } from './dto/appoint-super-admin.dto.js';
import { SuperAdminGrantService } from './super-admin-grant.service.js';

/**
 * §125: super admins appointing super admins. There is no route to remove one — the owner's
 * decision: that stays a change in the database, so no single account can take the others away.
 */
@ApiTags('admin')
@ApiCookieAuth('access_token')
@RequiresSuperAdmin()
@Controller('admin/super-admins')
export class SuperAdminsController {
  constructor(private readonly grants: SuperAdminGrantService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Appoint a super admin',
    description:
      'A verified account is promoted at once and told in-app (no email); any community-admin rights it held are folded in ' +
      '(its CommunityAdmin rows removed, listed in foldedCommunityIds). An address with no account is refused: the person ' +
      'signs up and verifies first. Recorded in audit_log as SUPER_ADMIN_APPOINTED. There is no way to remove a super admin here (§125).',
  })
  @ApiResponse({ status: 200, type: SuperAdminAppointmentDto })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'Not an email.' })
  @ApiResponse({ status: 403, type: ErrorResponseDto, description: 'Not a super admin — or stopped being one while the request ran.' })
  @ApiResponse({
    status: 409,
    type: ErrorResponseDto,
    description: 'No account has this address, already a super admin, banned, email not verified, still runs an open shop (N29), or changed meanwhile.',
  })
  @ApiHeader({ name: CSRF_HEADER, required: true })
  async appoint(@CurrentUser() actor: CurrentUserType, @Body() dto: AppointSuperAdminDto): Promise<SuperAdminAppointmentDto> {
    return this.grants.appoint(actor.id, dto.email);
  }
}
