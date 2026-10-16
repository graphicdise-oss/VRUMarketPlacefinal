import { OrderStatus, Prisma } from '@prisma/client';
import type { CommunityScope } from '../community/community-admin-scope.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DASHBOARD_TIME_ZONE, ThaiDateRange } from './thai-date-range.js';

/** Sent back to the buyer: no longer a sale, whenever it was confirmed. */
const REFUNDED_STATUSES: readonly OrderStatus[] = ['REFUND_ORDERED', 'REFUNDED'];

/** Every dashboard asks for its own slice: some communities, or one shop owner's orders. */
export type SalesScope = { readonly communities: CommunityScope } | { readonly shopOwnerId: string };

export interface DailySales {
  readonly date: string;
  readonly orderCount: number;
  readonly amountMinor: number;
}

export interface SalesSummary {
  readonly orderCount: number;
  readonly amountMinor: number;
  readonly daily: readonly DailySales[];
}

/**
 * §127 (owner's decision): the one sales query every dashboard uses. "ยอดขาย" is what shops have
 * **confirmed** receiving — invariant 2: the platform never sees the money, only the shop's own
 * "ได้รับแล้ว" (`sellerConfirmedAt`). An order later sent back to the buyer leaves the figure again;
 * a refund is always the whole order, so there is no partial amount to subtract. Counted on the day
 * the shop confirmed, in Thai time, shipping included — the total the buyer transferred.
 *
 * Grouped by the shop's community (a shop never moves community), each with a point for every day
 * of the range so a chart has no gaps; a shop owner's slice comes back under the communities their
 * shops were in. `combineSales` turns any set of them into one figure.
 */
export async function confirmedSales(
  prisma: Pick<PrismaService, '$queryRaw'>,
  scope: SalesScope,
  range: ThaiDateRange,
): Promise<Map<string, SalesSummary>> {
  const rows = await prisma.$queryRaw<{ community_id: string; day: string; order_count: number; amount: bigint }[]>`
    SELECT s.community_id,
           to_char((o.seller_confirmed_at AT TIME ZONE ${DASHBOARD_TIME_ZONE})::date, 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS order_count,
           COALESCE(SUM(o.total_amount_minor), 0)::bigint AS amount
    FROM "order" o
    JOIN shop s ON s.id = o.shop_id
    WHERE o.seller_confirmed_at >= ${range.start}
      AND o.seller_confirmed_at < ${range.endExclusive}
      AND o.status NOT IN (${Prisma.join(REFUNDED_STATUSES.map((status) => Prisma.sql`${status}::order_status`))})
      AND ${scopeCondition(scope)}
    GROUP BY 1, 2
  `;

  const byCommunity = new Map<string, Map<string, DailySales>>();
  for (const row of rows) {
    const days = byCommunity.get(row.community_id) ?? new Map<string, DailySales>();
    days.set(row.day, { date: row.day, orderCount: row.order_count, amountMinor: Number(row.amount) });
    byCommunity.set(row.community_id, days);
  }

  return new Map([...byCommunity].map(([communityId, days]) => [communityId, summarize(range, [days])]));
}

/** One summary out of several — a dashboard's total row, or a shop owner's single figure. */
export function combineSales(range: ThaiDateRange, summaries: Iterable<SalesSummary | undefined>): SalesSummary {
  return summarize(
    range,
    [...summaries].filter((summary): summary is SalesSummary => summary !== undefined).map((summary) => new Map(summary.daily.map((day) => [day.date, day]))),
  );
}

function summarize(range: ThaiDateRange, parts: readonly ReadonlyMap<string, DailySales>[]): SalesSummary {
  const daily = range.days.map((date) => {
    let orderCount = 0;
    let amountMinor = 0;
    for (const part of parts) {
      orderCount += part.get(date)?.orderCount ?? 0;
      amountMinor += part.get(date)?.amountMinor ?? 0;
    }
    return { date, orderCount, amountMinor };
  });

  return {
    orderCount: daily.reduce((sum, day) => sum + day.orderCount, 0),
    amountMinor: daily.reduce((sum, day) => sum + day.amountMinor, 0),
    daily,
  };
}

function scopeCondition(scope: SalesScope): Prisma.Sql {
  if ('shopOwnerId' in scope) {
    return Prisma.sql`s.owner_id = ${scope.shopOwnerId}::uuid`;
  }
  if (scope.communities === 'all') {
    return Prisma.sql`TRUE`;
  }
  if (scope.communities.length === 0) {
    return Prisma.sql`FALSE`;
  }

  return Prisma.sql`s.community_id IN (${Prisma.join(scope.communities.map((id) => Prisma.sql`${id}::uuid`))})`;
}
