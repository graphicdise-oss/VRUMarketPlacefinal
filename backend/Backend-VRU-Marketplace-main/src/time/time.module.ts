import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { Clock } from './clock.js';
import { SweepOutageService } from './sweep-outage.service.js';
import { SweepScheduler } from './sweep.scheduler.js';
import { SweepService } from './sweep.service.js';
import { SystemClock } from './system-clock.js';

/**
 * Time, for the whole application.
 *
 * Global because nearly every later topic needs the clock, and a module that forgets to import
 * it would reach for `new Date()` instead — which the lint rule stops, but only after someone
 * has written it.
 *
 * `Clock` resolves to `SystemClock` here, which is the only wiring production needs. Tests
 * override the `Clock` token with an advanceable implementation through Nest's testing module;
 * there is deliberately no `NODE_ENV === 'test'` branch in this file, because a production code
 * path that behaves differently under a flag is a production code path that can be flipped.
 */
@Global()
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [{ provide: Clock, useClass: SystemClock }, SweepService, SweepOutageService, SweepScheduler],
  exports: [Clock, SweepService, SweepOutageService],
})
export class TimeModule {}
