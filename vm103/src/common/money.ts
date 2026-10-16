/**
 * Money, as an integer number of satang.
 *
 * Locked in CLAUDE.md and DECISIONS.md §9 (E4): every amount in this system is
 * `amount_minor` — an integer in the currency's minor unit — paired with a `currency`.
 * Changing that means migrating every historical amount, including the ones snapshotted onto
 * old orders that invariant 5 forbids touching.
 *
 * Why not a float, concretely: `0.1 + 0.2 !== 0.3` in IEEE-754, and a marketplace that adds
 * up prices in baht will eventually tell a shop it received 199.99999999 baht. Why not a
 * decimal library: it would be a dependency whose whole job is to let people write the
 * arithmetic we have already decided not to do.
 *
 * Everything here is integer arithmetic. The only place a decimal point appears is
 * `formatBaht`, which produces a string for display and is never read back as a number.
 *
 * No money table exists yet — the first arrives with topic 7 — but these helpers are ready
 * before then so that the ticket writing orders does not invent its own rounding.
 */

/** Only THB, by decision (E4). A union rather than a string so adding one is a deliberate act. */
export const CURRENCIES = ['THB'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Satang per baht. Every supported currency happens to have two decimal places. */
const MINOR_UNITS_PER_MAJOR = 100;

export interface Money {
  /** Satang. Always an integer, and never negative — see `money()`. */
  readonly amountMinor: number;
  readonly currency: Currency;
}

/**
 * Builds a Money, rejecting the values that cause silent corruption later.
 *
 * Throwing rather than rounding is deliberate: a fractional satang means the caller did
 * arithmetic we cannot see, and rounding it here would hide the bug while keeping the wrong
 * number. Negative amounts are rejected because nothing in this system charges a negative
 * price — a refund is a separate order status, not a negative total (I1 · I8).
 */
export function money(amountMinor: number, currency: Currency = 'THB'): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new TypeError(
      `Money must be a whole number of satang, received ${amountMinor}. ` +
        'Multiply baht by 100 with baht(), do not divide anything into this.',
    );
  }
  if (amountMinor < 0) {
    throw new RangeError(`Money cannot be negative, received ${amountMinor} satang.`);
  }
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`${amountMinor} satang is past the safe integer range.`);
  }

  return { amountMinor, currency };
}

/**
 * Money from a whole number of baht. `baht(199)` is 19900 satang.
 *
 * Takes only integers on purpose. `baht(199.5)` would be the moment a float entered the
 * system, and the caller who wanted 199.50 means `money(19950)`.
 */
export function baht(wholeBaht: number, currency: Currency = 'THB'): Money {
  if (!Number.isInteger(wholeBaht)) {
    throw new TypeError(
      `baht() takes whole baht, received ${wholeBaht}. For ${wholeBaht} baht use ` +
        `money(${Math.round(wholeBaht * MINOR_UNITS_PER_MAJOR)}).`,
    );
  }
  return money(wholeBaht * MINOR_UNITS_PER_MAJOR, currency);
}

export const zero = (currency: Currency = 'THB'): Money => money(0, currency);

/**
 * Adds amounts, refusing to mix currencies.
 *
 * Only THB exists today, so this check can never fire — which is exactly when it is cheap to
 * write. The day a second currency appears, this is the difference between a wrong total and
 * an error.
 */
export function addMoney(...amounts: readonly Money[]): Money {
  const [first, ...rest] = amounts;
  if (!first) {
    return zero();
  }

  let total = first.amountMinor;
  for (const next of rest) {
    assertSameCurrency(first, next);
    total += next.amountMinor;
  }

  return money(total, first.currency);
}

/**
 * Line total for a quantity. Integer multiplication, so no rounding happens at all.
 *
 * Quantity must be a non-negative integer: there is no half an item in this marketplace, and
 * `ProductVariant.stock` is whole units.
 */
export function multiplyMoney(amount: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError(`Quantity must be a whole number of items, received ${quantity}.`);
  }
  return money(amount.amountMinor * quantity, amount.currency);
}

/**
 * Subtracts, refusing to go below zero.
 *
 * The refusal is the point. A total that went negative means two amounts were mixed up, and
 * the useful outcome is a failed request rather than a refund the platform cannot make —
 * remember the platform never holds the money (invariant 2).
 */
export function subtractMoney(from: Money, amount: Money): Money {
  assertSameCurrency(from, amount);
  return money(from.amountMinor - amount.amountMinor, from.currency);
}

export function isSameMoney(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

/**
 * A display string like "1,234.50".
 *
 * For humans and for email bodies, never to be parsed back. The split uses integer division and
 * the remainder, so the decimal point is a piece of text rather than the result of a float
 * division.
 *
 * Returns digits only — no ฿ and no currency code — because where the symbol goes is a
 * presentation decision belonging to whoever renders it.
 *
 * Validates through `money()` rather than trusting the number. It takes a bare `number` for
 * convenience, which means a caller can hand it anything: formatting the parts independently
 * turned -12345 into "-123.-45" and 1.5 into "0.1.5" before this guard existed. A malformed
 * amount is a bug upstream, and a plausible-looking wrong price on an invoice is worse than an
 * error.
 */
export function formatMinor(amountMinor: number): string {
  const { amountMinor: validated } = money(amountMinor);

  const whole = Math.trunc(validated / MINOR_UNITS_PER_MAJOR);
  const fraction = validated % MINOR_UNITS_PER_MAJOR;

  return `${whole.toLocaleString('en-US')}.${fraction.toString().padStart(2, '0')}`;
}

export const formatMoney = (amount: Money): string => formatMinor(amount.amountMinor);

/**
 * Widened to `string` deliberately. `Currency` has one member today, so comparing two of them
 * narrows both sides to `never` and the compiler can see this check is unreachable. Keeping it
 * is cheap insurance for the day a second currency exists, and that day the check needs to
 * already be here rather than be remembered.
 */
function assertSameCurrency(a: Money, b: Money): void {
  const left: string = a.currency;
  const right: string = b.currency;

  if (left !== right) {
    throw new TypeError(`Cannot combine ${left} with ${right}.`);
  }
}
