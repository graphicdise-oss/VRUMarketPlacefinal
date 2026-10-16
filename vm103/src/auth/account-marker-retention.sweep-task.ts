import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { addDays } from '../time/clock.js';
import { SweepTask } from '../time/sweep.js';
import { SweepService } from '../time/sweep.service.js';

/**
 * One year, for markers of accounts that were never banned. Expressed in days because that is
 * what `addDays` takes and what every other retention number in this system is measured in; the
 * exactness of a calendar year buys nothing here, since nothing happens on the boundary.
 */
const UNBANNED_RETENTION_DAYS = 365;

/**
 * Deletes `DeletedAccountMarker` rows that no longer block anything (issue #22).
 *
 * K16 kept a marker for every erased account so that a banned person cannot come back clean under
 * the same address. It never said how long to keep one, and a retention period nobody sets is
 * "forever" chosen by omission — which is exactly what PDPA's data-minimisation duty is about, and
 * what #22 asked to be decided deliberately.
 *
 * The decision (2026-09-20, recorded in `docs/DECISIONS.md`): **a marker whose account was banned
 * is kept indefinitely; every other marker is deleted a year after erasure.** The asymmetry
 * follows the purpose rather than the calendar. `wasBanned = true` is the entire reason the table
 * exists — expire it and the ban expires with it, silently, which is the one outcome K16 was
 * written to prevent. `wasBanned = false` blocks nothing: `AccountMarkerService.wasBanned()` reads
 * the row and returns false, the same answer a missing row gives, so the row is a record of who
 * erased an account and when, kept for no purpose anybody can name.
 *
 * `disputeLostCount` rides along on the deleted rows and is not preserved anywhere. That is not an
 * oversight: nothing in the system reads that column on a *marker* (only on `User`), so keeping
 * the row for its sake would be keeping data against a use that does not exist.
 *
 * Plugged into the one sweep point (M5) like every other clock — never a scheduler of its own. A
 * `deleteMany` against a cutoff is idempotent by construction: a second pass in the same minute
 * deletes nothing the first one already took.
 */
@Injectable()
export class AccountMarkerRetentionSweepTask implements SweepTask, OnModuleInit {
  readonly sweepName = 'accountMarkers.purgeUnbanned';

  constructor(
    private readonly prisma: PrismaService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register(this);
  }

  async runSweep(now: Date): Promise<number> {
    const cutoff = addDays(now, -UNBANNED_RETENTION_DAYS);
    const result = await this.prisma.deletedAccountMarker.deleteMany({
      where: { wasBanned: false, deletedAt: { lte: cutoff } },
    });

    return result.count;
  }
}
