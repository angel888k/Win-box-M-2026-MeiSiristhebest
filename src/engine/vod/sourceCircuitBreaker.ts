// src/engine/vod/sourceCircuitBreaker.ts
// ★ 数据源健康度阶梯熔断与自愈机制。
// 解决 TVBox 多仓导入后死源过多导致全源搜索等待超时的问题。
// 阶梯熔断策略：
//   - 连续 1 次失败/超时：冷静隔离 15 分钟
//   - 连续 2 次失败/超时：冷却隔离 2 小时
//   - 连续 3 次及以上失败：长期隔离 24 小时
//   - 成功一次即刻自愈（计数归零、冷却解除）
//   - 强制刷新（options.refresh === true）或手动重试绕过熔断
// 纯 TS、零 Node/Electron 依赖，engine 与 renderer 均可复用与单测。
import { sourceIdentityKey } from '../../shared/sourceIdentity';

export interface CircuitBreakerRecord {
  failureCount: number;
  lastFailureTime: number;
  cooldownUntil: number;
  lastError?: string;
}

export const COOLDOWN_LEVELS_MS = [
  15 * 60 * 1000,      // 第 1 级：15 分钟
  2 * 60 * 60 * 1000,  // 第 2 级：2 小时
  24 * 60 * 60 * 1000, // 第 3 级：24 小时
] as const;

export class SourceCircuitBreaker {
  private readonly records = new Map<string, CircuitBreakerRecord>();

  constructor(initialData?: Record<string, CircuitBreakerRecord>) {
    if (initialData) {
      for (const [key, val] of Object.entries(initialData)) {
        if (val && typeof val === 'object') {
          this.records.set(key, { ...val });
        }
      }
    }
  }

  /** 获取指定源的健康/熔断记录 */
  getRecord(profileId?: string, key?: string): Readonly<CircuitBreakerRecord> | undefined {
    if (!key) return undefined;
    return this.records.get(sourceIdentityKey(profileId, key));
  }

  /** 判断指定源当前是否可用（未被熔断或冷却期已过） */
  isAvailable(profileId?: string, key?: string, now = Date.now()): boolean {
    if (!key) return true;
    const rec = this.records.get(sourceIdentityKey(profileId, key));
    if (!rec) return true;
    return now >= rec.cooldownUntil;
  }

  /** 获取冷却剩余时间（毫秒）；未冷却返回 0 */
  getCooldownRemainingMs(profileId?: string, key?: string, now = Date.now()): number {
    if (!key) return 0;
    const rec = this.records.get(sourceIdentityKey(profileId, key));
    if (!rec) return 0;
    return Math.max(0, rec.cooldownUntil - now);
  }

  /** 记录失败：失败计数递增，并按阶梯计算下一次冷却时间戳 */
  recordFailure(profileId?: string, key?: string, error?: string, now = Date.now()): number {
    if (!key) return 0;
    const identity = sourceIdentityKey(profileId, key);
    const existing = this.records.get(identity);
    const failureCount = (existing ? existing.failureCount : 0) + 1;
    const cooldownDuration = this.calculateCooldown(failureCount);
    const cooldownUntil = now + cooldownDuration;

    this.records.set(identity, {
      failureCount,
      lastFailureTime: now,
      cooldownUntil,
      lastError: error,
    });

    return cooldownDuration;
  }

  /** 记录成功：重置失败计数与冷却状态（自愈） */
  recordSuccess(profileId?: string, key?: string): void {
    if (!key) return;
    const identity = sourceIdentityKey(profileId, key);
    this.records.delete(identity);
  }

  /** 手动重置指定源或全部源的熔断状态 */
  reset(profileId?: string, key?: string): void {
    if (key) {
      this.records.delete(sourceIdentityKey(profileId, key));
    } else {
      this.records.clear();
    }
  }

  /** 导出当前熔断状态（便于持久化） */
  exportState(): Record<string, CircuitBreakerRecord> {
    const out: Record<string, CircuitBreakerRecord> = {};
    for (const [key, val] of this.records.entries()) {
      out[key] = { ...val };
    }
    return out;
  }

  /** 计算阶梯冷却时长（毫秒）：单次偶发失败不阻断下一次重试，连续 2 次起触发梯度熔断 */
  private calculateCooldown(failureCount: number): number {
    if (failureCount <= 1) return 0;
    if (failureCount === 2) return COOLDOWN_LEVELS_MS[0];
    if (failureCount === 3) return COOLDOWN_LEVELS_MS[1];
    return COOLDOWN_LEVELS_MS[2];
  }
}
