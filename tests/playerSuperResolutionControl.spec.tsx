// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import type { SrState } from '../src/shared/plugin';
import { SR_MODE_LABEL } from '../src/shared/player';
import type { SuperResolutionControlModel } from '../src/renderer/features/playback/presentation/PlayerControlModels';
import { PlayerSuperResolutionControl } from '../src/renderer/features/playback/PlayerSuperResolutionControl';

const capability: SrState = {
  available: true,
  modes: [{ id: 'quality', label: 'Anime4K 质量档' }],
  mode: 'off',
};

function Harness(overrides: Partial<SuperResolutionControlModel>) {
  const [open, setOpen] = useState(overrides.open ?? false);
  const model: SuperResolutionControlModel = {
    visible: true,
    active: false,
    mpvStatusResolved: true,
    mpvAvailable: true,
    capabilityLoading: false,
    capabilityError: null,
    info: capability,
    mode: 'off',
    feedback: null,
    renderStatus: null,
    renderStatusLoading: false,
    renderStatusError: null,
    ...overrides,
    open,
    containerRef: overrides.containerRef ?? { current: null },
    onOpen: () => setOpen(true),
    onClose: () => setOpen(false),
    onSwitchToMpv: overrides.onSwitchToMpv ?? vi.fn(),
    onSelect: overrides.onSelect ?? vi.fn(),
  };
  return <PlayerSuperResolutionControl {...model} />;
}

afterEach(cleanup);

describe('PlayerSuperResolutionControl', () => {
  it('explains that the feature is MPV-only and offers a switch when MPV is available', () => {
    const onSwitchToMpv = vi.fn();
    render(<Harness onSwitchToMpv={onSwitchToMpv} />);

    const trigger = screen.getByRole('button', { name: '超分辨率' });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(trigger);

    expect(screen.getByText(/HTML5 与 PotPlayer 不接收/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '切换到 MPV 内核' }));
    expect(onSwitchToMpv).toHaveBeenCalledOnce();
  });

  it('does not show algorithm choices until MPV is active', () => {
    render(<Harness open />);

    expect(screen.queryByRole('button', { name: 'Anime4K 质量档' })).toBeNull();
    expect(screen.getByText(/当前播放内核不是 MPV/)).toBeTruthy();
  });

  it('shows the real shader modes when the active MPV capability is ready', () => {
    render(<Harness open active />);
    expect(screen.getByRole('button', { name: 'Anime4K 质量档' })).toBeTruthy();
    expect(screen.getByRole('button', { name: SR_MODE_LABEL.off })).toBeTruthy();
  });

  it('distinguishes a selected mode from a shader pass observed in the active render pipeline', () => {
    render(<Harness open active mode="quality" renderStatus={{ state: 'observed', activePasses: ['Anime4K Restore'], matchingPasses: ['Anime4K Restore'] }} />);
    expect(screen.getByText(/MPV 渲染管线已观察到所选着色器/).textContent).toContain('Anime4K Restore');
    expect(screen.getByText(/不代表已确认使用独立显卡硬件加速/)).toBeTruthy();
  });

  it('reports a failed capability check instead of leaving a disabled dead control', () => {
    render(<Harness open active capabilityError="IPC unavailable" info={null} />);

    expect(screen.getByRole('alert').textContent).toContain('IPC unavailable');
    expect((screen.getByRole('button', { name: '超分辨率' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
