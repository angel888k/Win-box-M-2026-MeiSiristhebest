import { describe, expect, it, vi } from 'vitest';
import type { SrMode } from '../src/shared/player';
import type { SuperResolutionPort } from '../src/renderer/features/playback/application/superResolutionPort';
import { changeSuperResolutionMode } from '../src/renderer/features/playback/application/superResolutionUseCases';
import { formatSuperResolutionFeedback, formatSuperResolutionRenderStatus } from '../src/renderer/features/playback/presentation/superResolutionFeedback';

function createPort(overrides: Partial<SuperResolutionPort> = {}): SuperResolutionPort {
  return {
    readCapability: vi.fn(async () => ({ available: true, modes: [], mode: 'off' })),
    saveMode: vi.fn(async () => undefined),
    applyMode: vi.fn(async () => ({ ok: true, acknowledged: true })),
    ...overrides,
  };
}

describe('changeSuperResolutionMode', () => {
  it('persists the preference before applying it to the live session', async () => {
    const order: string[] = [];
    const port = createPort({
      saveMode: vi.fn(async () => { order.push('save'); }),
      applyMode: vi.fn(async () => { order.push('apply'); return { ok: true, acknowledged: true }; }),
    });

    await expect(changeSuperResolutionMode(port, 'quality' as SrMode)).resolves.toEqual({
      type: 'saved-and-acknowledged', mode: 'quality', renderVerified: false,
    });
    expect(order).toEqual(['save', 'apply']);
  });

  it('does not apply a mode when saving it fails', async () => {
    const port = createPort({ saveMode: vi.fn(async () => { throw new Error('disk full'); }) });

    await expect(changeSuperResolutionMode(port, 'quality' as SrMode)).resolves.toMatchObject({
      type: 'persistence-failed', error: new Error('disk full'),
    });
    expect(port.applyMode).not.toHaveBeenCalled();
  });

  it('reports a persisted mode when the player declines the live command', async () => {
    const port = createPort({ applyMode: vi.fn(async () => ({ ok: false })) });

    await expect(changeSuperResolutionMode(port, 'quality' as SrMode)).resolves.toEqual({
      type: 'saved-but-unconfirmed', mode: 'quality',
    });
    expect(port.saveMode).toHaveBeenCalledWith('quality');
  });

  it('does not call a write-only player adapter applied without an MPV acknowledgement', async () => {
    const port = createPort({ applyMode: vi.fn(async () => ({ ok: true, acknowledged: false })) });

    await expect(changeSuperResolutionMode(port, 'quality' as SrMode)).resolves.toEqual({
      type: 'saved-but-unconfirmed', mode: 'quality',
    });
  });

  it('keeps the saved mode when sending the live command throws', async () => {
    const port = createPort({ applyMode: vi.fn(async () => { throw new Error('session closed'); }) });

    await expect(changeSuperResolutionMode(port, 'off')).resolves.toMatchObject({
      type: 'saved-but-command-failed', mode: 'off', error: new Error('session closed'),
    });
  });
});

describe('formatSuperResolutionFeedback', () => {
  it('formats capability-independent application outcomes as explicit user feedback', () => {
    expect(formatSuperResolutionFeedback({ type: 'saved-and-acknowledged', mode: 'off', renderVerified: false })).toEqual({
      kind: 'ok', message: 'MPV 已确认清空着色器列表；GPU 实际渲染状态尚未核验。',
    });
    expect(formatSuperResolutionFeedback({ type: 'saved-but-unconfirmed', mode: 'quality' })).toMatchObject({
      kind: 'error', message: '档位已保存，但 MPV 未确认切换命令成功。请确认使用 MPV 内核后重试；下次启动时仍会按保存的档位尝试加载。',
    });
    expect(formatSuperResolutionFeedback({ type: 'saved-but-command-failed', mode: 'quality', error: 'pipe closed' }).message)
      .toContain('pipe closed');
    expect(formatSuperResolutionFeedback({ type: 'persistence-failed', error: new Error('disk full') }).message)
      .toContain('disk full');
  });
});

describe('formatSuperResolutionRenderStatus', () => {
  it('never equates command acknowledgement with a shader render pass', () => {
    expect(formatSuperResolutionRenderStatus({ state: 'observed', matchingPasses: ['Anime4K Restore'] }))
      .toContain('MPV 渲染管线已观察到所选着色器');
    expect(formatSuperResolutionRenderStatus({ state: 'unsupported', detail: 'property unavailable' }))
      .toContain('不支持渲染 pass 查询');
    expect(formatSuperResolutionRenderStatus({ state: 'not-observed', activePasses: ['Bicubic scaler'] }))
      .toContain('没有发现所选档位的着色器');
  });
});
