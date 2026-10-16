/**
 * §98: the account a request signed into, for the one kind of request `AuthGuard` has no session
 * for yet — the sign-in itself. Without it the row that matters most for traffic data ("this
 * account signed in from this address at this time") would name nobody.
 *
 * A WeakMap keyed by the request, like `attachSession`, for the same reasons given there.
 */
const accountsByRequest = new WeakMap<object, string>();

export function noteSignedInAccount(request: object, userId: string): void {
  accountsByRequest.set(request, userId);
}

export function readSignedInAccount(request: object): string | null {
  return accountsByRequest.get(request) ?? null;
}
