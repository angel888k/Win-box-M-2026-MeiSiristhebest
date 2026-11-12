import {
  newSourceStat,
  notePlaybackFail,
  notePlaybackSuccess,
  noteSourceFail,
  noteSourceOk,
  scheduleOrder,
  sourceBudgetMs,
  type SourceStat,
} from './searchScheduler';

export interface SearchHealthSource {
  key: string;
  runtimeScope?: string;
}

/** Session-local search history shared by aggregate search and spider prewarming. */
export class SourceSearchHealth {
  private readonly statistics = new Map<string, SourceStat>();

  constructor(private readonly now: () => number = Date.now) {}

  scheduleOrder(sources: readonly SearchHealthSource[]): number[] {
    return scheduleOrder(
      sources.length,
      (index) => this.scopeOf(sources[index]),
      this.statistics,
      this.now(),
    );
  }

  budget(source: SearchHealthSource, declaredTimeoutMs: number, maximumMs: number): number {
    return sourceBudgetMs(
      this.statistics.get(this.scopeOf(source)),
      declaredTimeoutMs,
      maximumMs,
      this.now(),
    );
  }

  succeeded(scope: string, elapsedMs: number, empty: boolean): void {
    noteSourceOk(this.statOf(scope), elapsedMs, { empty, now: this.now() });
  }

  failed(scope: string): void {
    noteSourceFail(this.statOf(scope), this.now());
  }

  playbackSucceeded(scopeOrKey: string): void {
    this.recordPlayback(scopeOrKey, true);
  }

  playbackFailed(scopeOrKey: string): void {
    this.recordPlayback(scopeOrKey, false);
  }

  getStat(scopeOrKey: string): Readonly<SourceStat> | undefined {
    return this.statistics.get(scopeOrKey);
  }

  clear(): void {
    this.statistics.clear();
  }

  private recordPlayback(scopeOrKey: string, ok: boolean): void {
    const now = this.now();
    const primary = this.statOf(scopeOrKey);
    if (ok) {
      notePlaybackSuccess(primary, now);
    } else {
      notePlaybackFail(primary, now);
    }

    // 若传入的是 bare source key，同步更新其下所有关联 profile 的 runtimeScope
    for (const [scope, stat] of this.statistics.entries()) {
      if (scope !== scopeOrKey && (scope.endsWith(`,"${scopeOrKey}"]`) || scope.endsWith(`:${scopeOrKey}`))) {
        if (ok) {
          notePlaybackSuccess(stat, now);
        } else {
          notePlaybackFail(stat, now);
        }
      }
    }
  }

  private scopeOf(source: SearchHealthSource): string {
    return source.runtimeScope || source.key;
  }

  private statOf(scope: string): SourceStat {
    let statistic = this.statistics.get(scope);
    if (!statistic) {
      statistic = newSourceStat();
      this.statistics.set(scope, statistic);
    }
    return statistic;
  }
}
