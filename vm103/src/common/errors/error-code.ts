/**
 * Every error code this system can return, with the Thai message a user sees.
 *
 * L4 fixed the shape: a stable English `code` for the frontend to branch on, a Thai `message`
 * it can show without a translation table, and `fieldErrors` for forms. The reason the message
 * is Thai rather than an i18n key is that this marketplace has exactly one audience, and a key
 * means every new error needs a matching entry in another repository before anyone can read it.
 *
 * **The frontend branches on `code`, never on `message`.** Messages get reworded — by a tutor,
 * by the project owner, by whoever notices a typo — and a frontend matching on text breaks
 * silently when they do.
 *
 * This file currently lists only what topic 1 can actually produce, plus the generic codes that
 * any HTTP status can map onto. Later topics add their own domain codes here; the point of one
 * central list is that `docs/FRONTEND-NOTES.md` can describe a finite set and a reviewer can
 * see every error the system has in one screen.
 */

export const ERROR_CODES = {
  /** A DTO rejected the request. Always accompanied by `fieldErrors` where a field is known. */
  VALIDATION_FAILED: 'ข้อมูลที่ส่งมาไม่ถูกต้อง',

  /** No such route, or a resource that does not exist (or that the caller may not know exists). */
  NOT_FOUND: 'ไม่พบข้อมูลที่ต้องการ',

  /**
   * The HTTP method is not allowed on a path that does exist.
   *
   * Defined but not currently produced: Express treats `POST /api/v1/health` as an unmatched
   * route, so it reaches the not-found handler and comes back as NOT_FOUND. That is a consequence
   * we are content with — answering 405 would confirm which paths exist — and it is written down
   * in FRONTEND-NOTES.md so nobody loses an hour to it. The code stays because the day something
   * does answer 405, the mapping should already be here.
   */
  METHOD_NOT_ALLOWED: 'วิธีเรียกนี้ใช้กับที่อยู่นี้ไม่ได้',

  /** Not signed in, or the session is no longer valid. */
  UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบก่อน',

  /** Signed in, but not allowed to do this. */
  FORBIDDEN: 'คุณไม่มีสิทธิ์ทำรายการนี้',

  /**
   * The email and password did not match an account.
   *
   * One code for both "no such email" and "wrong password", and the same message for both (I16).
   * Telling them apart would let anyone check which addresses are registered here one request at a
   * time — and this is a marketplace where the members of a community can be identified from their
   * shops, so that list is worth having to someone.
   */
  INVALID_CREDENTIALS: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',

  /**
   * The account is banned (invariant 7).
   *
   * Separate from FORBIDDEN because the frontend's response is different in kind: there is no
   * action to retry and no permission to ask for, so it signs the person out locally and shows
   * what happened rather than leaving them to discover it one button at a time.
   */
  ACCOUNT_BANNED: 'บัญชีนี้ถูกระงับการใช้งาน',

  /**
   * Signed in, but the email address has not been confirmed yet (B0.1 · K4).
   *
   * Separate from FORBIDDEN and from UNAUTHENTICATED because the three send the person to three
   * different places: ask for permission, sign in, or go and read your email. This one has an
   * action attached — "resend the link" — and a frontend that cannot tell it apart offers the
   * wrong one.
   */
  EMAIL_NOT_VERIFIED: 'กรุณายืนยันอีเมลของคุณก่อนทำรายการนี้',

  /**
   * A verification link is unknown, expired, or already used.
   *
   * One code for all three, deliberately. The person does the same thing about each of them — ask
   * for a new link — and telling an unknown link apart from an expired one would let someone test
   * guessed links for existence.
   */
  VERIFICATION_LINK_INVALID: 'ลิงก์ยืนยันนี้ใช้ไม่ได้แล้ว กรุณาขอลิงก์ใหม่',

  /**
   * A password-reset link is unknown, expired, or already used (I16).
   *
   * Its own code rather than a reuse of VERIFICATION_LINK_INVALID, because the two send the person
   * to different screens: "ask for another verification link" and "start the forgot-password form
   * again" are different forms with different fields. Inside it is the same one-code-for-three
   * rule — an expired link and an invented one must not be distinguishable, or the endpoint
   * becomes a way to test guessed tokens.
   */
  RESET_LINK_INVALID: 'ลิงก์ตั้งรหัสผ่านใหม่นี้ใช้ไม่ได้แล้ว กรุณาขอลิงก์ใหม่',

  /**
   * A request that changes data arrived without a valid CSRF token (B3).
   *
   * Its own code for a practical reason: the frontend's correct response is to fetch a new token
   * from `GET /api/v1/auth/csrf` and retry once, which is not what it should do about a
   * FORBIDDEN. The most common cause is benign — the token is bound to the session, so signing in
   * or out invalidates the one the page was holding.
   */
  CSRF_FAILED: 'เซสชันของคุณหมดอายุหรือไม่ถูกต้อง กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง',

  /** The request conflicts with the current state — see the specific code where one exists. */
  CONFLICT: 'รายการนี้ขัดกับสถานะปัจจุบัน กรุณารีเฟรชแล้วลองใหม่',

  /**
   * A registration accepted a privacy policy version that is no longer the current one (#75 · §66)
   * — or, since §90, a terms of service version. One code for both: the one checkbox covers both
   * documents, so whichever went stale the page does the same thing.
   *
   * Separate from CONFLICT because the frontend's move is specific and it is not "retry": reload
   * so the person reads the wording that is live now, then ask again. Recording the acceptance
   * anyway would file a record saying they agreed to text they were never shown, which is the one
   * thing the stored acceptance exists to rule out.
   */
  POLICY_VERSION_OUTDATED:
    'นโยบายความเป็นส่วนตัวหรือข้อตกลงการใช้บริการมีการปรับปรุงแล้ว กรุณาโหลดหน้าใหม่และอ่านฉบับล่าสุดก่อนสมัคร',

  /**
   * §91: the request was decided on a screen that no longer shows what is there — a reviewer
   * approving a product or shop that was edited after they opened it, or a seller saving a variant
   * whose stock moved (a payment was confirmed) after the form loaded.
   *
   * Separate from CONFLICT because the frontend's move is specific: reload what the person is
   * looking at and let them decide again. Retrying the same request can never succeed — it carries
   * the same stale revision.
   */
  STALE_VIEW: 'ข้อมูลที่คุณเห็นอยู่เปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่แล้วตรวจอีกครั้ง',

  /** Upload or body beyond the limit. */
  PAYLOAD_TOO_LARGE: 'ไฟล์หรือข้อมูลที่ส่งมามีขนาดใหญ่เกินกำหนด',

  /** Rate limited. Topic 2 owns the real limits (I17 · L7). */
  RATE_LIMITED: 'คุณทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',

  /** A dependency is unavailable — the database, for instance. */
  SERVICE_UNAVAILABLE: 'ระบบไม่พร้อมให้บริการชั่วคราว กรุณาลองใหม่อีกครั้ง',

  /**
   * Anything unexpected. The message says nothing about what broke, on purpose: the details go
   * to the server log where an operator can read them, and CLAUDE.md forbids sending a stack
   * trace or a table name to a client.
   */
  INTERNAL_ERROR: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง',
} as const satisfies Record<string, string>;

export type ErrorCode = keyof typeof ERROR_CODES;

export function messageFor(code: ErrorCode): string {
  return ERROR_CODES[code];
}

/**
 * The code to use when all we know is an HTTP status.
 *
 * Nest throws plain HttpExceptions of its own — a 404 for an unmatched route, a 405, a 413 from
 * the body parser — and those must come out in the same envelope as everything else rather than
 * in Nest's default shape. Anything unmapped becomes INTERNAL_ERROR, which is the safe
 * direction: a vague message is better than leaking the framework's own wording.
 */
const CODE_BY_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

export function codeForStatus(status: number): ErrorCode {
  return CODE_BY_STATUS[status] ?? 'INTERNAL_ERROR';
}
