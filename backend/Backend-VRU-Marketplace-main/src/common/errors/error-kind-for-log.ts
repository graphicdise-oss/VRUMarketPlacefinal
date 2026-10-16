/**
 * What to log about an error from an outbound call (an email provider, Google): its class and, for
 * a network failure, the system code (`TimeoutError`, `TypeError/ECONNREFUSED`) — never its message.
 *
 * A message is free text from whichever layer failed: a proxy, a TLS stack, a provider SDK, a
 * rejected-recipient error that quotes the address. None of it is this code's to vouch for, and
 * the log must hold only what could be shown in public (CLAUDE.md). Both parts are checked against
 * a narrow shape, so an odd `name` or `code` falls back to a fixed word instead of leaking through.
 */
export function errorKindForLog(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'non-error value';
  }

  // Called from catch blocks and rejection handlers, so it must not throw itself: a `cause` getter
  // that throws, or a non-string `name`, would otherwise become an unhandled rejection.
  try {
    const name = typeof error.name === 'string' && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error';
    // Node's own errors and nodemailer's carry the code on the error (§107); fetch's, on its cause.
    const ownCode = (error as { code?: unknown }).code;
    const code = typeof ownCode === 'string' ? ownCode : (error.cause as { code?: unknown } | undefined)?.code;

    return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(code) ? `${name}/${code}` : name;
  } catch {
    return 'Error';
  }
}

/** At most this many stack frames — where it happened, not the whole call history. */
const MAX_LOGGED_FRAMES = 15;

/**
 * Engine errors whose message is built from the code itself ("Cannot read properties of undefined
 * (reading 'id')", "x is not defined") — worth keeping, and never made of a request's values.
 */
const MESSAGES_FROM_CODE = new Set(['TypeError', 'ReferenceError']);

/**
 * §121: what the server log may say about an unexpected failure — the error's kind
 * (`errorKindForLog`), a unique-constraint's field names, and its stack *frames*: where it
 * happened, enough to find the bug.
 *
 * Never the message, which is the top of `error.stack`. A `PrismaClientValidationError`'s message
 * prints the query it was handed, values and all — confirmed with a stray filter on `user`, whose
 * logged stack carried the email and phone number it was searching for — and the same is true of
 * any library that quotes its input. The two engine errors above are the exception: their wording
 * comes from code, not from data. A thrown non-Error is described by its type only; serialising it
 * would print whatever object someone threw.
 *
 * Every `.stack` in `src/` goes through here — the lint rule forbids reading it anywhere else.
 */
export function describeErrorForLog(thrown: unknown, depth = 0): string {
  if (!(thrown instanceof Error)) {
    return `non-error value (${typeof thrown})`;
  }

  try {
    let header = errorKindForLog(thrown);
    const target = (thrown as { meta?: { target?: unknown } }).meta?.target;
    if (Array.isArray(target) && target.every((field) => typeof field === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(field))) {
      header += ` on (${target.join(', ')})`;
    }
    if (MESSAGES_FROM_CODE.has(thrown.name) && typeof thrown.message === 'string') {
      header += `: ${thrown.message.slice(0, 200)}`;
    }

    // eslint-disable-next-line no-restricted-syntax -- the one place a stack is read (see above)
    const frames = (typeof thrown.stack === 'string' ? thrown.stack.split('\n') : [])
      .filter((line) => /^\s+at /.test(line))
      .slice(0, MAX_LOGGED_FRAMES);
    const cause = depth < 2 && thrown.cause !== undefined ? `\ncaused by: ${describeErrorForLog(thrown.cause, depth + 1)}` : '';

    return [header, ...frames].join('\n') + cause;
  } catch {
    return 'Error';
  }
}
