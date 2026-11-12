import { describe, expect, it } from 'vitest';
import { SourceCircuitBreaker, COOLDOWN_LEVELS_MS } from '../src/engine/vod/sourceCircuitBreaker';

describe('SourceCircuitBreaker 阶梯熔断与自愈机制', () => {
  it('未失败的源默认可用', () => {
    const breaker = new SourceCircuitBreaker();
    expect(breaker.isAvailable('p1', 's1')).toBe(true);
    expect(breaker.getCooldownRemainingMs('p1', 's1')).toBe(0);
  });

  it('瞬时网络抖动：同一并发窗口内的多次失败归并，不重复累加 failureCount，防止闪断导致 24 小时误封', () => {
    const breaker = new SourceCircuitBreaker();
    const t0 = 1000000;
    // 3 个并发请求在 50ms 内先后失败
    const d1 = breaker.recordFailure('p1', 's1', 'timeout 1', t0);
    const d2 = breaker.recordFailure('p1', 's1', 'timeout 2', t0 + 20);
    const d3 = breaker.recordFailure('p1', 's1', 'timeout 3', t0 + 50);

    expect(d1).toBe(0);
    expect(d2).toBe(0);
    expect(d3).toBe(0);
    // 并发归并后，失败计数仍为 1，没有被放大为 3 次而封禁 2 小时或 24 小时
    expect(breaker.getRecord('p1', 's1')?.failureCount).toBe(1);
    expect(breaker.isAvailable('p1', 's1', t0 + 60)).toBe(true);
  });

  it('独立时间窗口发生的第 2 次失败触发冷却 15 分钟，冷却期内的并发失败不提前晋级', () => {
    const breaker = new SourceCircuitBreaker();
    const t0 = 1000000;
    // 第一次独立失败（t0）
    breaker.recordFailure('p1', 's1', 'timeout 1', t0);
    expect(breaker.getRecord('p1', 's1')?.failureCount).toBe(1);

    // 第二次独立失败（窗口 3s 外，t0 + 5000）
    const duration2 = breaker.recordFailure('p1', 's1', 'timeout 2', t0 + 5000);
    expect(duration2).toBe(COOLDOWN_LEVELS_MS[0]); // 15 mins
    expect(breaker.getRecord('p1', 's1')?.failureCount).toBe(2);
    expect(breaker.isAvailable('p1', 's1', t0 + 5100)).toBe(false);

    // 此时仍处于 15 分钟冷却期内，飞行的并发请求再度返回错误，不应将 15 分钟晋级为 2 小时
    const durationBurst = breaker.recordFailure('p1', 's1', 'inflight error', t0 + 5200);
    expect(durationBurst).toBe(COOLDOWN_LEVELS_MS[0] - 200);
    expect(breaker.getRecord('p1', 's1')?.failureCount).toBe(2);
  });

  it('冷却期结束后的半开试探失败，升级为冷却 2 小时', () => {
    const breaker = new SourceCircuitBreaker();
    const t0 = 1000000;
    breaker.recordFailure('p1', 's1', 'error 1', t0);
    breaker.recordFailure('p1', 's1', 'error 2', t0 + 5000); // 触发 15m 冷却

    // 15 分钟冷却期结束
    const halfOpenTime = t0 + 5000 + COOLDOWN_LEVELS_MS[0] + 1;
    expect(breaker.isAvailable('p1', 's1', halfOpenTime)).toBe(true);

    // 半开试探请求失败，升级到 2 小时
    const duration3 = breaker.recordFailure('p1', 's1', 'error 3', halfOpenTime);
    expect(duration3).toBe(COOLDOWN_LEVELS_MS[1]); // 2 hours
    expect(breaker.getRecord('p1', 's1')?.failureCount).toBe(3);
    expect(breaker.isAvailable('p1', 's1', halfOpenTime + 1000)).toBe(false);
  });

  it('连续第 4 次及以上失败升级为冷却 24 小时', () => {
    const breaker = new SourceCircuitBreaker();
    const t0 = 1000000;
    breaker.recordFailure('p1', 's1', 'error 1', t0, { force: true });
    breaker.recordFailure('p1', 's1', 'error 2', t0 + 10, { force: true });
    breaker.recordFailure('p1', 's1', 'error 3', t0 + 20, { force: true });
    const duration4 = breaker.recordFailure('p1', 's1', 'error 4', t0 + 30, { force: true });
    expect(duration4).toBe(COOLDOWN_LEVELS_MS[2]); // 24 hours
    expect(breaker.getRecord('p1', 's1')?.failureCount).toBe(4);

    const duration5 = breaker.recordFailure('p1', 's1', 'error 5', t0 + 40, { force: true });
    expect(duration5).toBe(COOLDOWN_LEVELS_MS[2]);
    expect(breaker.getRecord('p1', 's1')?.failureCount).toBe(5);
  });

  it('成功一次即刻自愈清零', () => {
    const breaker = new SourceCircuitBreaker();
    const t0 = 1000000;
    breaker.recordFailure('p1', 's1', 'error', t0);
    breaker.recordFailure('p1', 's1', 'error', t0 + 5000);
    expect(breaker.isAvailable('p1', 's1', t0 + 5010)).toBe(false);

    breaker.recordSuccess('p1', 's1');
    expect(breaker.isAvailable('p1', 's1', t0 + 5010)).toBe(true);
    expect(breaker.getRecord('p1', 's1')).toBeUndefined();
  });

  it('重置与状态导出导入', () => {
    const breaker = new SourceCircuitBreaker();
    breaker.recordFailure('p1', 's1', 'error', 1000, { force: true });
    breaker.recordFailure('p1', 's1', 'error', 1000, { force: true });
    breaker.recordFailure('p1', 's2', 'error', 1000, { force: true });
    breaker.recordFailure('p1', 's2', 'error', 1000, { force: true });

    const exported = breaker.exportState();
    const breaker2 = new SourceCircuitBreaker(exported);
    expect(breaker2.isAvailable('p1', 's1', 1000)).toBe(false);
    expect(breaker2.isAvailable('p1', 's2', 1000)).toBe(false);

    breaker2.reset('p1', 's1');
    expect(breaker2.isAvailable('p1', 's1', 1000)).toBe(true);
    expect(breaker2.isAvailable('p1', 's2', 1000)).toBe(false);

    breaker2.reset();
    expect(breaker2.isAvailable('p1', 's2', 1000)).toBe(true);
  });
});
