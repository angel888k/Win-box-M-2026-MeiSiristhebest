import type { AggregateSearchSessionClock } from './aggregateSearchSession';

export interface AggregateSearchRetryPolicy {
  delayMs: number;
  maxAttempts: number;
}

const DEFAULT_POLICY: AggregateSearchRetryPolicy = {
  // Retries now target only sources that are still preparing; keep the delay
  // short enough to notice a finished conversion without replaying the profile.
  delayMs: 10_000,
  maxAttempts: 36,
};

/** Schedules bounded retries for sources that were still pending after a search. */
export class AggregateSearchRetrySchedule {
  private attempts = 0;
  private timer: unknown = null;

  constructor(
    private readonly clock: AggregateSearchSessionClock,
    private readonly policy: AggregateSearchRetryPolicy = DEFAULT_POLICY,
  ) {}

  schedule(isCurrent: () => boolean, retry: () => void): boolean {
    if (this.attempts >= this.policy.maxAttempts) return false;
    this.cancelPending();
    this.attempts += 1;
    this.timer = this.clock.schedule(() => {
      this.timer = null;
      if (isCurrent()) retry();
    }, this.policy.delayMs);
    return true;
  }

  reset(): void {
    this.cancelPending();
    this.attempts = 0;
  }

  cancel(): void {
    this.cancelPending();
  }

  private cancelPending(): void {
    if (this.timer === null) return;
    this.clock.cancel(this.timer);
    this.timer = null;
  }
}
