// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SrState } from '../src/shared/plugin';
import type { SuperResolutionPort } from '../src/renderer/features/playback/application/superResolutionPort';
import { useSuperResolution } from '../src/renderer/features/playback/useSuperResolution';

const capability: SrState = { available: true, modes: [{ id: 'quality', label: 'Quality' }], mode: 'off' };

function createPort(): SuperResolutionPort {
  return {
    readCapability: vi.fn(async () => capability),
    saveMode: vi.fn(async () => undefined),
    applyMode: vi.fn(async () => ({ ok: true, acknowledged: true })),
  };
}

function Harness({ enabled, sessionKey = 'episode-1', port }: { enabled: boolean; sessionKey?: string; port: SuperResolutionPort }) {
  const resolution = useSuperResolution(enabled, sessionKey, port);
  return (
    <div>
      <output data-testid='open'>{String(resolution.open)}</output>
      <output data-testid='mode'>{resolution.mode}</output>
      <div data-testid='feedback'>{resolution.feedback?.message ?? ''}</div>
      <button onClick={() => resolution.setOpen(true)}>Open</button>
      <button onClick={() => void resolution.apply('quality')}>Apply</button>
      <button onClick={() => void resolution.apply('off')}>Disable</button>
    </div>
  );
}

afterEach(cleanup);

describe('useSuperResolution', () => {
  it('loads capability when MPV is allowed, regardless of the selected kernel, and closes the panel when the resource changes', async () => {
    const port = createPort();
    const view = render(<Harness enabled port={port} />);
    await waitFor(() => expect(port.readCapability).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByTestId('open').textContent).toBe('true');

    view.rerender(<Harness enabled sessionKey="episode-2" port={port} />);
    expect(screen.getByTestId('open').textContent).toBe('false');
    expect(port.readCapability).toHaveBeenCalledOnce();
  });

  it('saves the selected mode before sending it to the active mpv session', async () => {
    const port = createPort();
    render(<Harness enabled port={port} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(screen.getByTestId('feedback').textContent).toContain('MPV 已确认切换'));
    expect(port.saveMode).toHaveBeenCalledWith('quality');
    expect(port.applyMode).toHaveBeenCalledWith('quality');
    expect(screen.getByTestId('mode').textContent).toBe('quality');
  });

  it('does not send a mode after persistence fails', async () => {
    const port = createPort();
    vi.mocked(port.saveMode).mockRejectedValue(new Error('disk full'));
    render(<Harness enabled port={port} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(screen.getByTestId('feedback').textContent).toContain('disk full'));
    expect(port.applyMode).not.toHaveBeenCalled();
    expect(screen.getByTestId('mode').textContent).toBe('off');
  });

  it('applies rapid mode changes in click order so an older request cannot win last', async () => {
    const port = createPort();
    const calls: string[] = [];
    let finishFirstApply!: (result: { ok: boolean; acknowledged: boolean }) => void;
    const firstApply = new Promise<{ ok: boolean; acknowledged: boolean }>((resolve) => {
      finishFirstApply = resolve;
    });
    vi.mocked(port.saveMode).mockImplementation(async (mode) => { calls.push(`save:${mode}`); });
    vi.mocked(port.applyMode).mockImplementation(async (mode) => {
      calls.push(`apply:${mode}`);
      return mode === 'quality' ? firstApply : { ok: true, acknowledged: true };
    });
    render(<Harness enabled port={port} />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(port.applyMode).toHaveBeenCalledOnce());
    expect(calls).toEqual(['save:quality', 'apply:quality']);

    finishFirstApply({ ok: true, acknowledged: true });
    await waitFor(() => expect(port.applyMode).toHaveBeenCalledTimes(2));
    expect(calls).toEqual(['save:quality', 'apply:quality', 'save:off', 'apply:off']);
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('off'));
  });
});
