import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

export const DEFAULT_TRENDING_KEYWORDS = [
  'ข้าวหอมมะลิ',
  'ผ้าทอมือ',
  'สบู่สมุนไพร',
  'กระเป๋ากระจูด',
  'ชาเกสรบัวหลวง',
  'น้ำพริกเผา',
];

@Injectable()
export class SearchAnalyticsService implements OnModuleInit {
  private readonly logger = new Logger(SearchAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Safe idempotent initialization: creates the table and indexes if not already present.
   * Ensures non-blocking zero-downtime execution even before manual migration.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "search_keyword_log" (
            "id" UUID NOT NULL PRIMARY KEY,
            "query" VARCHAR(128) NOT NULL,
            "normalized_query" VARCHAR(128) NOT NULL,
            "result_count" INTEGER NOT NULL DEFAULT 0,
            "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS "search_keyword_log_normalized_query_created_at_idx" ON "search_keyword_log"("normalized_query", "created_at");
        CREATE INDEX IF NOT EXISTS "search_keyword_log_created_at_idx" ON "search_keyword_log"("created_at");
      `);
    } catch (err) {
      this.logger.debug(`Search keyword log table check: ${(err as Error).message}`);
    }
  }

  /**
   * Log an anonymous search query asynchronously.
   * Safe and non-blocking: never throws to the caller.
   */
  async recordSearch(query: string, resultCount: number): Promise<void> {
    const trimmed = query.trim().slice(0, 100);
    if (!trimmed || trimmed.length < 2) return;

    const normalized = trimmed.toLowerCase();

    try {
      await this.prisma.searchKeywordLog.create({
        data: {
          id: randomUUID(),
          query: trimmed,
          normalizedQuery: normalized,
          resultCount,
        },
      });
    } catch (err) {
      this.logger.debug(`Could not record search log: ${(err as Error).message}`);
    }
  }

  /**
   * Returns top search keywords from the last 30 days that yielded at least 1 product result.
   * Gracefully merges with DEFAULT_TRENDING_KEYWORDS if there are fewer than \`limit\` results.
   */
  async getTrendingKeywords(limit = 6): Promise<string[]> {
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const results = await this.prisma.searchKeywordLog.groupBy({
        by: ['normalizedQuery'],
        where: {
          createdAt: { gte: since },
          resultCount: { gt: 0 },
        },
        _count: {
          normalizedQuery: true,
        },
        orderBy: {
          _count: {
            normalizedQuery: 'desc',
          },
        },
        take: limit,
      });

      const dynamicKeywords = results.map((r) => r.normalizedQuery);
      return Array.from(new Set([...dynamicKeywords, ...DEFAULT_TRENDING_KEYWORDS])).slice(0, limit);
    } catch (err) {
      this.logger.warn(`Failed to fetch dynamic trending keywords, using fallback: ${(err as Error).message}`);
      return DEFAULT_TRENDING_KEYWORDS;
    }
  }
}

