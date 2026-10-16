import { AppException } from '../common/errors/app-exception.js';
import { MS_PER_DAY, MS_PER_HOUR } from '../time/clock.js';

/**
 * §127: the dashboards count by the Thai calendar day. Thailand has kept UTC+7 with no daylight
 * saving since 1920, so a fixed offset is exact — no time-zone database needed, and the SQL side
 * (`AT TIME ZONE 'Asia/Bangkok'`) agrees with it.
 */
export const DASHBOARD_TIME_ZONE = 'Asia/Bangkok';
const THAI_OFFSET_MS = 7 * MS_PER_HOUR;

/** When neither end is given: the last 30 days, today included. */
export const DEFAULT_RANGE_DAYS = 30;
/** A year and a day, so "this day last year" to today still fits. */
export const MAX_RANGE_DAYS = 366;

/** The shape `from`/`to` must have — checked at the edge (the query DTO) and again here. */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_DATE_MESSAGE = 'วันที่ต้องอยู่ในรูปแบบ ปปปป-ดด-วว เช่น 2026-10-05';

/** The two optional ends a dashboard is asked for, as the caller typed them. */
export interface ThaiDateQuery {
  readonly from?: string;
  readonly to?: string;
}

/** A resolved range: the inclusive Thai dates, and the half-open UTC instants that cover them. */
export interface ThaiDateRange {
  readonly from: string;
  readonly to: string;
  readonly start: Date;
  readonly endExclusive: Date;
  /** Every Thai date from `from` to `to`, oldest first — so a chart has a point for every day. */
  readonly days: readonly string[];
}

/** The Thai calendar date an instant falls on, as `YYYY-MM-DD`. */
function thaiDateOf(instant: Date): string {
  return isoDateOf(instant.getTime() + THAI_OFFSET_MS);
}

/**
 * `from`/`to` as the caller gave them (either may be missing), checked and turned into instants.
 * A missing `to` is today; a missing `from` is `DEFAULT_RANGE_DAYS` back from `to`. Every refusal is
 * `VALIDATION_FAILED` with the field it is about, like any other bad query parameter.
 */
export function resolveThaiDateRange(now: Date, { from, to }: ThaiDateQuery): ThaiDateRange {
  const toDay = to === undefined ? dayNumberOf(thaiDateOf(now)) : parseDay(to, 'to');
  const fromDay = from === undefined ? toDay - (DEFAULT_RANGE_DAYS - 1) : parseDay(from, 'from');

  if (fromDay > toDay) {
    throw new AppException('VALIDATION_FAILED', { fieldErrors: { from: 'วันเริ่มต้องไม่อยู่หลังวันสิ้นสุด' } });
  }
  if (toDay - fromDay + 1 > MAX_RANGE_DAYS) {
    throw new AppException('VALIDATION_FAILED', { fieldErrors: { from: `เลือกช่วงได้ไม่เกิน ${MAX_RANGE_DAYS} วัน` } });
  }

  const days: string[] = [];
  for (let day = fromDay; day <= toDay; day += 1) {
    days.push(dateOfDayNumber(day));
  }

  return {
    from: dateOfDayNumber(fromDay),
    to: dateOfDayNumber(toDay),
    start: instantAt(fromDay * MS_PER_DAY - THAI_OFFSET_MS),
    endExclusive: instantAt((toDay + 1) * MS_PER_DAY - THAI_OFFSET_MS),
    days,
  };
}

/** Days since 1970-01-01 of a calendar date — whole numbers, so ranges are plain integer arithmetic. */
function dayNumberOf(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / MS_PER_DAY;
}

function dateOfDayNumber(day: number): string {
  return isoDateOf(day * MS_PER_DAY);
}

/** The UTC calendar date of a millisecond timestamp. */
function isoDateOf(ms: number): string {
  return instantAt(ms).toISOString().slice(0, 10);
}

function instantAt(ms: number): Date {
  // eslint-disable-next-line no-restricted-syntax -- not a wall-clock read; every caller derives `ms` from `Clock` or from a date it was given
  return new Date(ms);
}

/** A real calendar date — `2026-02-30` matches the pattern but is not one, and is refused. */
function parseDay(value: string, field: 'from' | 'to'): number {
  const day = ISO_DATE.test(value) ? dayNumberOf(value) : Number.NaN;
  if (Number.isNaN(day) || dateOfDayNumber(day) !== value) {
    throw new AppException('VALIDATION_FAILED', { fieldErrors: { [field]: ISO_DATE_MESSAGE } });
  }

  return day;
}
