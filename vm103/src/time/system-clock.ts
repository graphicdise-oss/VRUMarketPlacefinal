 
import { Injectable } from '@nestjs/common';
import { Clock } from './clock.js';

/**
 * The real clock, used everywhere except tests.
 *
 * The lint rule that forbids `new Date()` across src/ is disabled for this file only. That is
 * the whole point of a seam: exactly one place reads the wall clock, and everything else asks
 * this. If a second file ever needs the same exemption, that is the signal something is
 * bypassing the seam rather than that the rule is inconvenient.
 */
@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
