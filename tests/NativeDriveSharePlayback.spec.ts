import { describe, expect, it, vi } from 'vitest';
import { NativeDriveSharePlayback, type NativeDriveSharePorts } from '../src/main/drive/NativeDriveSharePlayback';

function ports(overrides: Partial<NativeDriveSharePorts> = {}): NativeDriveSharePorts {
  return {
    cookie: vi.fn(() => ''),
    resolveQuarkShare: vi.fn(async () => ({ url: '', header: {}, ok: false })),
    resolveUcShare: vi.fn(async () => ({ url: '', header: {}, ok: false })),
    resolveBaiduShare: vi.fn(async () => ({ url: '', header: {}, ok: false })),
    resolveKnownShareFile: vi.fn(async () => null),
    isQuarkPanProxy: vi.fn(() => false),
    isBaiduDescriptor: vi.fn(() => false),
    enqueueCleanup: vi.fn(),
    wrapUrl: vi.fn((url: string) => url),
    logger: { i: vi.fn(), w: vi.fn() },
    ...overrides,
  };
}

describe('NativeDriveSharePlayback', () => {
  it('skips native drive work only during automatic recovery', async () => {
    const adapters = ports();
    const playback = new NativeDriveSharePlayback(adapters);
    const id = 'https://pan.quark.cn/s/share123';

    const automatic = await playback.resolve(id, 'main', true);
    expect(automatic.result?.message).toContain('自动换源跳过');
    expect(adapters.resolveKnownShareFile).not.toHaveBeenCalled();

    await playback.resolve(id, 'main');
    expect(adapters.resolveKnownShareFile).toHaveBeenCalledWith(id, 'main', 'quark', id, expect.any(Array));
  });
});
