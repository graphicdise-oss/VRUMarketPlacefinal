import type { Prisma } from '@prisma/client';
import { STOCK_CUT_STATUSES } from './order-status-sets.js';

/** Units of each variant that have been paid for and not since cancelled or refunded. */
export type SoldQuantity = ReadonlyMap<string, number>;

/** The narrowest client this needs — a transaction or the service itself. */
type OrderItemQuerier = Pick<Prisma.TransactionClient, 'orderItem'>;

/**
 * How many units of each variant have sold — the public "ขายแล้ว N ชิ้น" figure on a product.
 *
 * Counts `OrderItem.quantity` for orders at `PAID`, `SHIPPED` or `COMPLETED` (`STOCK_CUT_STATUSES`:
 * the same statuses at which real stock is cut, so "sold" and "stock taken off the shelf" cannot
 * disagree). An order still awaiting payment has not sold anything yet, and `CANCELLED`,
 * `REFUND_ORDERED` and `REFUNDED` orders have given the sale back. Computed live from the order's
 * own status like `reservedStockOf` — there is no counter column to drift.
 */
export async function soldQuantityOf(client: OrderItemQuerier, variantIds: readonly string[]): Promise<SoldQuantity> {
  if (variantIds.length === 0) {
    return new Map();
  }

  const rows = await client.orderItem.groupBy({
    by: ['variantId'],
    where: { variantId: { in: [...variantIds] }, order: { status: { in: [...STOCK_CUT_STATUSES] } } },
    _sum: { quantity: true },
  });

  return new Map(rows.map((row) => [row.variantId, row._sum.quantity ?? 0]));
}
