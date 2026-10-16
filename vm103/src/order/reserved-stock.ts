import { Prisma } from '@prisma/client';
import { RESERVING_STATUSES } from './order-status-sets.js';

/** Units of each variant held by orders still between checkout and the shop confirming payment. */
export type ReservedStock = ReadonlyMap<string, number>;

/** The narrowest client this needs — a transaction or the service itself. */
type RawQuerier = Pick<Prisma.TransactionClient, '$queryRaw'>;

/**
 * §117: how much of each variant is reserved right now — the one query both checkout's "is there
 * enough" (`StockReservationService.checkAndLock`) and every product view's stock figures read, so
 * the number a buyer is shown and the number checkout enforces cannot disagree.
 *
 * Computed live from each reservation's order status (#50 — no counter to drift). §117: driven from
 * the reserving orders rather than from the variant's reservations, so its cost follows how many
 * orders are open now, not how many a popular variant has ever had: every reservation is kept
 * forever (its order's history), and walking all of them on each checkout grew without bound.
 * `order_status_idx` is what lets the planner start there — which is also why the statuses are
 * cast to the enum here, never `status::text`: an index on the column is no use to a cast of it.
 */
export async function reservedStockOf(client: RawQuerier, variantIds: readonly string[]): Promise<ReservedStock> {
  if (variantIds.length === 0) {
    return new Map();
  }

  const rows = await client.$queryRaw<{ variant_id: string; total: bigint }[]>`
    SELECT sr.variant_id, SUM(sr.quantity)::bigint AS total
    FROM "order" o
    JOIN order_item oi ON oi.order_id = o.id
    JOIN stock_reservation sr ON sr.order_item_id = oi.id
    WHERE o.status IN (${Prisma.join(RESERVING_STATUSES.map((status) => Prisma.sql`${status}::order_status`))})
      AND sr.variant_id = ANY(${[...variantIds]}::uuid[])
    GROUP BY sr.variant_id
  `;

  return new Map(rows.map((row) => [row.variant_id, Number(row.total)]));
}

/** What a buyer can still order: physical stock less what open orders hold, never below zero. */
export function availableStock(variant: { id: string; stock: number }, reserved: ReservedStock): number {
  return Math.max(0, variant.stock - (reserved.get(variant.id) ?? 0));
}
