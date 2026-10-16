import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppConfig } from '../config/app-config.module.js';

/**
 * The single way into the database.
 *
 * CLAUDE.md: always query through Prisma, and use parameterised `$queryRaw` when raw SQL
 * is genuinely needed. Nothing else in the codebase should construct a PrismaClient or open
 * its own pg connection.
 *
 * Prisma 7 takes its connection through a driver adapter rather than a `url` in the schema,
 * so the connection string comes from validated configuration (see AppConfig) instead of
 * being read out of process.env here.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfig) {
    super({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Whether the database answers right now.
   *
   * Deliberately the cheapest possible round trip: it proves the connection and the
   * credentials, and nothing else. Health checks that run real queries end up reporting a
   * slow table as a dead service.
   *
   * Swallowing the error is the point — the caller only needs up or down, and the reason a
   * database refused us (host, credentials, pg_hba) is not something to hand to an
   * unauthenticated caller. It is logged here instead, where an operator can read it.
   */
  async isReachable(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error(
        'Database health probe failed',
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}
