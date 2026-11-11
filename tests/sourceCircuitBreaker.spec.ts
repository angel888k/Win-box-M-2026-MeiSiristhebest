import { describe, expect, it } from 'vitest';
import { SourceCircuitBreaker, COOLDOWN_LEVELS_MS } from '../src/engine/vod/sourceCircuitBreaker';

describe('SourceCircuitBreaker 阶梯熔断与自愈机制', () => {
  it('未失败的源默认可用', () => {
    const breaker = new SourceCircuitBreaker();
    expect(breaker.isAvailable('p1', 's1')).toBe(true);
    expect(breaker.getCooldownRemainingMs('p1', 's1')).toBe(0);
  });

  it('第 1 次偶发失败记录计数但暂不阻断重试，连续第 2 次失败触发冷却 15 分钟', () => {
    const breaker = new SourceCircuitBreaker();
    const t0 = 1000000;
    const duration1 = breaker.recordFailure('p1', 's1', 'timeout', t0);
    expect(duration1).toBe(0);
    expect(breaker.isAvailable('p1', 's1', t0 + 1000)).toBe(true);
    expect(breaker.getRecord('p1', 's1')?.failureCount).toBe(1);

    const duration2 = breaker.recordFailure('p1', 's1', 'timeout again', t0 + 1000);
    expect(duration2).toBe(COOLDOWN_LEVELS_MS[0]); // 15 mins
    expect(breaker.isAvailable('p1', 's1', t0 + 2000)).toBe(false);
    expect(breaker.isAvailable('p1', 's1', t0 + 1000 + COOLDOWN_LEVELS_MS[0] + 1)).toBe(true);
    expect(breaker.getCooldownRemainingMs('p1', 's1', t0 + 1000 + 60000)).toBe(COOLDOWN_LEVELS_MS[0] - 60000);
  });

  it('连续第 3 次失败升级为冷却 2 小时', () => {
    const breaker = new SourceCircuitBreaker();
    const t0 = 1000000;
    breaker.recordFailure('p1', 's1', 'timeout', t0);
    breaker.recordFailure('p1', 's1', 'timeout 2', t0 + 1000);
    const duration3 = breaker.recordFailure('p1', 's1', 'timeout 3', t0 + 2000);
    expect(duration3).toBe(COOLDOWN_LEVELS_MS[1]); // 2 hours
    expect(breaker.getRecord('p1', 's1')?.failureCount).toBe(3);
  });

  it('连续第 4 次及以上失败升级为冷却 24 小时', () => {
    const breaker = new SourceCircuitBreaker();
    const t0 = 1000000;
    breaker.recordFailure('p1', 's1', 'error', t0);
    breaker.recordFailure('p1', 's1', 'error', t0 + 10);
    breaker.recordFailure('p1', 's1', 'error', t0 + 20);
    const duration4 = breaker.recordFailure('p1', 's1', 'error', t0 + 30);
    expect(duration4).toBe(COOLDOWN_LEVELS_MS[2]); // 24 hours
    expect(breaker.getRecord('p1', 's1')?.failureCount).toBe(4);

    const duration5 = breaker.recordFailure('p1', 's1', 'error', t0 + 40);
    expect(duration5).toBe(COOLDOWN_LEVELS_MS[2]);
    expect(breaker.getRecord('p1', 's1')?.failureCount).toBe(5);
  });

  it('成功一次即刻自愈清零', () => {
    const breaker = new SourceCircuitBreaker();
    const t0 = 1000000;
    breaker.recordFailure('p1', 's1', 'error', t0);
    breaker.recordFailure('p1', 's1', 'error', t0 + 10);
    expect(breaker.isAvailable('p1', 's1', t0 + 20)).toBe(false);

    breaker.recordSuccess('p1', 's1');
    expect(breaker.isAvailable('p1', 's1', t0 + 20)).toBe(true);
    expect(breaker.getRecord('p1', 's1')).toBeUndefined();
  });

  it('重置与状态导出导入', () => {
    const breaker = new SourceCircuitBreaker();
    breaker.recordFailure('p1', 's1', 'error', 1000);
    breaker.recordFailure('p1', 's1', 'error', 1000);
    breaker.recordFailure('p1', 's2', 'error', 1000);
    breaker.recordFailure('p1', 's2', 'error', 1000);

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
