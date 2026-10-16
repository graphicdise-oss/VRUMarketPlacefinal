import type { Agent, Response } from 'supertest';
import { CSRF_HEADER } from '../../src/auth/csrf.service.js';
import { API, csrfToken } from './auth.js';

interface ShownCartLine {
  id: string;
  quantity: number;
  priceAmountMinor: number;
  orderable: boolean;
}

/** The `items` of a checkout body (§111): every orderable line the cart shows right now, as shown. */
export async function shownCartLines(client: Agent): Promise<{ cartItemId: string; quantity: number; priceAmountMinor: number }[]> {
  const cart = await client.get(`${API}/cart`);
  const lines = (cart.body as { items?: ShownCartLine[] }).items ?? [];

  return lines
    .filter((line) => line.orderable)
    .map((line) => ({ cartItemId: line.id, quantity: line.quantity, priceAmountMinor: line.priceAmountMinor }));
}

/**
 * `POST /orders` the way the frontend places one (§111): read the cart, then send back exactly
 * the orderable lines it showed — their quantity and price — so the order can never be created at
 * a price the buyer did not see. Tests that are about checkout itself, not about reaching an order,
 * build the body by hand instead.
 */
export async function checkoutAsShown(client: Agent, addressId: string): Promise<Response> {
  const items = await shownCartLines(client);

  return client
    .post(`${API}/orders`)
    .set(CSRF_HEADER, await csrfToken(client))
    .send({ addressId, items });
}
