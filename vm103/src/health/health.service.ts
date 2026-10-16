import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../time/clock.js';
import { HealthResponseDto } from './dto/health-response.dto.js';

/**
 * The example every other module copies.
 *
 * Note what is absent: this service never sees `req` or `res`, never knows an HTTP status
 * code exists, and returns a plain object. Turning that object into a response — including
 * choosing 200 or 503 — is the controller's job, and the controller is the only layer that
 * gets to care about HTTP.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async check(): Promise<HealthResponseDto> {
    const databaseUp = await this.prisma.isReachable();

    return {
      status: databaseUp ? 'ok' : 'degraded',
      database: databaseUp ? 'up' : 'down',
      uptimeSeconds: Math.floor(process.uptime()),
      // Through the Clock, not `new Date()`. That makes this the one value a test can move, and
      // it is how #17 proves the clock seam works through HTTP rather than by inspecting a
      // provider: advance the clock, ask health, watch checkedAt move.
      checkedAt: this.clock.now().toISOString(),
    };
  }
}
