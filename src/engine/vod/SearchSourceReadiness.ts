// Filters aggregate-search sources by spider runtime readiness before workers start.
import type { Logger, SourceBean } from '../../shared/types';
import type { AggSearchInput } from './aggSearch';
import { throwIfSearchAborted } from './searchRuntime';

export interface SourceRuntimeReadinessSnapshot {
  state: 'ready' | 'preparing' | 'unavailable';
  reason?: string;
}

export interface SourceRuntimeReadinessPort {
  inspect(source: SourceBean): SourceRuntimeReadinessSnapshot | null;
}

export interface SearchSourceReadinessOptions {
  sources: readonly SourceBean[];
  unsupportedScopes: ReadonlySet<string>;
  signal?: AbortSignal;
}

export class SearchSourceReadiness {
  constructor(
    private readonly runtimeReadiness: SourceRuntimeReadinessPort,
    private readonly logger: Pick<Logger, 'i'>,
  ) {}

  async prepare(options: SearchSourceReadinessOptions): Promise<{ active: number[]; skipped: Array<AggSearchInput | null> }> {
    const { sources, unsupportedScopes, signal } = options;
    const skipped: Array<AggSearchInput | null> = Array.from({ length: sources.length }, () => null);
    const active: number[] = [];
    let pendingCount = 0;

    for (let i = 0; i < sources.length; i++) {
      throwIfSearchAborted(signal);
      const source = sources[i];
      if (unsupportedScopes.has(source.runtimeScope || source.key)) {
        skipped[i] = {
          key: source.key, name: source.name || source.key, status: 'error',
          error: '已跳过：该源在桌面端不支持（本会话已判定，单源搜索仍可单独尝试）', ms: 0,
        };
        continue;
      }
      if (source.type !== 3) {
        active.push(i);
        continue;
      }
      try {
        const runtime = this.runtimeReadiness.inspect(source);
        const isFailedReason = Boolean(runtime?.reason && /(?:404|下载失败|未配置|未指定)/.test(runtime.reason));
        if (!runtime || runtime.state === 'ready') {
          active.push(i);
        } else if (runtime.state === 'unavailable' || isFailedReason) {
          skipped[i] = {
            key: source.key, name: source.name || source.key, status: 'error',
            error: runtime.reason || '运行时不可用：请检查该源的 jar 地址或运行时配置', ms: 0,
          };
        } else {
          pendingCount++;
          skipped[i] = {
            key: source.key, name: source.name || source.key, status: 'error',
            error: '运行时就绪中：' + (runtime.reason || '正在后台下载/转换 jar') + '；本次未参与，完成后可重搜',
            ms: 0,
          };
        }
      } catch {
        // Readiness probes are advisory; normal source execution owns the final error.
        active.push(i);
      }
    }

    if (pendingCount > 0) this.logger.i('全源搜索：' + pendingCount + ' 个源仍在准备，先搜索已就绪来源');
    return { active, skipped };
  }
}
