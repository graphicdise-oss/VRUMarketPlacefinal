import { ApiProperty } from '@nestjs/swagger';

export const HEALTH_STATUSES = ['ok', 'degraded'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const DEPENDENCY_STATES = ['up', 'down'] as const;
export type DependencyState = (typeof DEPENDENCY_STATES)[number];

/**
 * What `GET /api/v1/health` answers.
 *
 * The shape is the same whether the answer is 200 or 503, so a monitor can read one field
 * in both cases. It is deliberately NOT the error envelope of L4: that envelope describes a
 * request that went wrong, while an unreachable database is this endpoint's correct answer.
 *
 * Nothing here is a secret. A health endpoint is usually the most exposed route a service
 * has, so it reports that the database is down and not which host refused us or why.
 */
export class HealthResponseDto {
  @ApiProperty({
    enum: HEALTH_STATUSES,
    description:
      'ok when every dependency is up. degraded when the application is running but something it needs is not.',
  })
  status!: HealthStatus;

  @ApiProperty({
    enum: DEPENDENCY_STATES,
    description:
      'Whether PostgreSQL answered a trivial query. This is what separates "the app is dead" (no response at all) from "the database is dead" (this says down).',
  })
  database!: DependencyState;

  @ApiProperty({
    description: 'Seconds since this process started, so a restart loop is visible.',
    example: 42,
  })
  uptimeSeconds!: number;

  @ApiProperty({
    description: 'Server time in UTC (ISO 8601). Every timestamp in this API is UTC.',
    example: '2026-09-13T06:00:00.000Z',
  })
  checkedAt!: string;
}
