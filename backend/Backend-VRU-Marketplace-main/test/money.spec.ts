import {
  addMoney,
  baht,
  formatMinor,
  isSameMoney,
  money,
  multiplyMoney,
  subtractMoney,
  zero,
} from '../src/common/money.js';

/**
 * These are the only tests in the project that do not go through the app's edge, and that is a
 * deliberate, narrow exception rather than a third seam.
 *
 * M5 forbids tests that call a service or a repository, because such a test proves the service
 * works without proving that what a user does produces that behaviour. `money.ts` is neither:
 * it has no dependencies, touches no I/O, and holds no state — it is arithmetic. There is no
 * HTTP request in topic 1 that involves money at all (the first arrives with topic 7), so the
 * alternative is to ship the helper the whole project's money depends on with nothing checking
 * it, which is exactly the untested-helper trap N1 was written to avoid.
 *
 * If a later ticket wants to test a *service* like this, the answer is no.
 */
describe('money is integers of satang, never a float', () => {
  it('rejects a fractional satang instead of rounding it', () => {
    // Rounding here would keep a wrong number and hide the bug that produced it. The caller
    // divided something they should not have.
    expect(() => money(10.5)).toThrow(TypeError);
  });

  it('rejects fractional baht and says what to write instead', () => {
    expect(() => baht(199.5)).toThrow(/money\(19950\)/);
  });

  it('converts whole baht to satang', () => {
    expect(baht(199)).toEqual({ amountMinor: 19900, currency: 'THB' });
  });

  it('refuses negative amounts', () => {
    // A refund is a status on an order (I1 · I8), not a negative total. The platform never
    // holds the money, so there is nothing a negative amount could mean.
    expect(() => money(-1)).toThrow(RangeError);
  });

  it('refuses amounts past the safe integer range', () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });
});

describe('arithmetic that a float would get wrong', () => {
  it('adds amounts that are exactly the 0.1 + 0.2 case', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754. In satang it is 10 + 20 = 30, exactly.
    const total = addMoney(money(10), money(20));

    expect(total.amountMinor).toBe(30);
    expect(isSameMoney(total, money(30))).toBe(true);
  });

  it('keeps a long sum exact', () => {
    // Adding 0.01 to itself a hundred times drifts off 1.00 with floats. Here it cannot.
    const pennies = Array.from({ length: 100 }, () => money(1));

    expect(addMoney(...pennies)).toEqual(baht(1));
  });

  it('multiplies a line item without rounding', () => {
    expect(multiplyMoney(money(3333), 3).amountMinor).toBe(9999);
  });

  it('treats an empty sum as zero', () => {
    expect(addMoney()).toEqual(zero());
  });

  it('rejects a fractional quantity', () => {
    expect(() => multiplyMoney(baht(10), 1.5)).toThrow(RangeError);
  });

  it('refuses a subtraction that would go below zero', () => {
    // A total that went negative means two amounts were swapped. Failing the request is more
    // useful than a refund this platform cannot make.
    expect(() => subtractMoney(baht(10), baht(11))).toThrow(RangeError);
  });
});

describe('display formatting', () => {
  it('renders satang as baht with two decimal places', () => {
    expect(formatMinor(19950)).toBe('199.50');
  });

  it('pads a single trailing satang', () => {
    // 5 satang is .05, not .5 — the bug that turns 100.05 into 100.50.
    expect(formatMinor(10005)).toBe('100.05');
  });

  it('groups thousands', () => {
    expect(formatMinor(123456789)).toBe('1,234,567.89');
  });

  it('renders zero', () => {
    expect(formatMinor(0)).toBe('0.00');
  });

  it('refuses a negative amount rather than printing "-123.-45"', () => {
    // It takes a bare number, so a caller can hand it anything. Formatting the whole part and the
    // remainder independently produced "-123.-45" for -12345 and "0.-50" for -50 — a wrong price
    // that looks like a price. A malformed amount is a bug upstream, and an error beats an invoice
    // nobody can read.
    expect(() => formatMinor(-12345)).toThrow(RangeError);
    expect(() => formatMinor(-50)).toThrow(RangeError);
  });

  it('refuses a fractional amount rather than printing "0.1.5"', () => {
    expect(() => formatMinor(1.5)).toThrow(TypeError);
  });
});

describe('currency', () => {
  it('defaults to THB', () => {
    expect(money(1).currency).toBe('THB');
  });
});
