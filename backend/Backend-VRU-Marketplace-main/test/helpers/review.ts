import type { Agent, Response } from 'supertest';
import { CSRF_HEADER } from '../../src/auth/csrf.service.js';
import { API, csrfToken } from './auth.js';

/**
 * §91: approving or rejecting anything a reviewer looked at carries the `reviewRevision` they
 * looked at, so the decision can never land on wording they did not see. These read it the way a
 * reviewer's screen does — from the queue or the admin view — and then decide, over HTTP.
 */

interface Page<T> {
  items: T[];
}

/** The revision `GET /products/pending` shows this reviewer for one product. */
export async function productRevision(reviewer: Agent, productId: string): Promise<number> {
  const page = (await reviewer.get(`${API}/products/pending`).query({ limit: 50 })).body as Page<{ id: string; reviewRevision?: number }>;
  return shown(page.items?.find((item) => item.id === productId)?.reviewRevision, `product ${productId} in GET /products/pending`);
}

/** §109: the revision `GET /products/:id/admin` shows this reviewer — a live product is on no queue. */
export async function adminProductRevision(reviewer: Agent, productId: string): Promise<number> {
  return shown(((await reviewer.get(`${API}/products/${productId}/admin`)).body as { reviewRevision?: number }).reviewRevision, `product ${productId} in GET /products/:id/admin`);
}

/** The revision `GET /shops/:id/admin` shows this reviewer. */
export async function shopRevision(reviewer: Agent, shopId: string): Promise<number> {
  return shown(((await reviewer.get(`${API}/shops/${shopId}/admin`)).body as { reviewRevision?: number }).reviewRevision, `shop ${shopId} in GET /shops/:id/admin`);
}

/** The revision `GET /shops/pending-profile-changes` shows this reviewer for one shop. */
export async function profileChangeRevision(reviewer: Agent, shopId: string): Promise<number> {
  const page = (await reviewer.get(`${API}/shops/pending-profile-changes`).query({ limit: 50 })).body as Page<{ shopId: string; reviewRevision?: number }>;
  return shown(page.items?.find((item) => item.shopId === shopId)?.reviewRevision, `shop ${shopId} in GET /shops/pending-profile-changes`);
}

/**
 * Fails where the lookup failed. Sending no revision would be a 400 that an arrangement step
 * never checks, surfacing as a confusing failure much later; an item that is not on the screen
 * is the helper's caller's mistake, and says so here.
 */
function shown(revision: number | undefined, where: string): number {
  if (revision === undefined) {
    throw new Error(`No reviewRevision for ${where} — is it pending, and can this reviewer see it? Pass \`seen\` for an item off the queue.`);
  }
  return revision;
}

async function decide(reviewer: Agent, path: string, body: object): Promise<Response> {
  return reviewer.post(`${API}${path}`).set(CSRF_HEADER, await csrfToken(reviewer)).send(body);
}

/**
 * `seen` is for a test whose item is no longer on the reviewer's screen — already decided, deleted,
 * or never there — where the revision they last saw has to be passed in rather than looked up.
 */
export async function approveProduct(reviewer: Agent, productId: string, seen?: number): Promise<Response> {
  return decide(reviewer, `/products/${productId}/approve`, { reviewRevision: seen ?? (await productRevision(reviewer, productId)) });
}

export async function rejectProduct(reviewer: Agent, productId: string, body: { category: string; reason: string }, seen?: number): Promise<Response> {
  return decide(reviewer, `/products/${productId}/reject`, { ...body, reviewRevision: seen ?? (await productRevision(reviewer, productId)) });
}

export async function approveShopAs(reviewer: Agent, shopId: string, seen?: number): Promise<Response> {
  return decide(reviewer, `/shops/${shopId}/approve`, { reviewRevision: seen ?? (await shopRevision(reviewer, shopId)) });
}

export async function rejectShopAs(reviewer: Agent, shopId: string, reason: string, seen?: number): Promise<Response> {
  return decide(reviewer, `/shops/${shopId}/reject`, { reason, reviewRevision: seen ?? (await shopRevision(reviewer, shopId)) });
}

export async function approveProfileChange(reviewer: Agent, shopId: string, seen?: number): Promise<Response> {
  return decide(reviewer, `/shops/${shopId}/profile-change/approve`, { reviewRevision: seen ?? (await profileChangeRevision(reviewer, shopId)) });
}

export async function rejectProfileChange(reviewer: Agent, shopId: string, reason: string, seen?: number): Promise<Response> {
  return decide(reviewer, `/shops/${shopId}/profile-change/reject`, { reason, reviewRevision: seen ?? (await profileChangeRevision(reviewer, shopId)) });
}
