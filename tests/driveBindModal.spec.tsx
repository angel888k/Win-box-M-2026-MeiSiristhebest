// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DriveBindingPorts } from '../src/renderer/features/driveBinding/application/driveBindingPorts';

vi.mock('../src/renderer/components/DriveLogin', () => ({ default: () => null }));

import DriveBindModal from '../src/renderer/components/DriveBindModal';

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

const ports: DriveBindingPorts = {
  credentials: {
    load: async () => ({}),
    save: async () => {},
    remove: async () => {},
    probe: async () => ({ state: 'unsupported' }),
  },
  webLogin: { login: async () => {} },
  ucTvToken: {
    status: async () => ({ bound: false }),
    createQr: async () => ({ imageDataUrl: '' }),
    pollQr: async () => ({ state: 'wait' }),
    remove: async () => {},
  },
};

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) { this.removeAttribute('open'); },
  });
});

afterAll(() => {
  if (originalShowModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

afterEach(() => cleanup());

describe('DriveBindModal', () => {
  it('exposes global account scope, provider selection, and disabled save state', () => {
    render(<DriveBindModal siteName="演示线路" onClose={vi.fn()} onSaved={vi.fn()} ports={ports} />);

    expect(screen.getByRole('dialog', { name: '全局网盘账号' })).toBeTruthy();
    expect(screen.getByText(/所有支持该网盘的子仓和站点共享/)).toBeTruthy();

    const quark = screen.getByRole('tab', { name: /夸克网盘/ });
    expect(quark.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: '保存绑定' }).hasAttribute('disabled')).toBe(true);

    const baidu = screen.getByRole('tab', { name: /百度网盘/ });
    fireEvent.click(baidu);
    expect(baidu.getAttribute('aria-selected')).toBe('true');
    expect(quark.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('textbox', { name: '百度 Cookie' })).toBeTruthy();
  });

  it('labels a saved credential separately and displays the real provider probe result', async () => {
    const probePorts: DriveBindingPorts = {
      ...ports,
      credentials: {
        ...ports.credentials,
        load: async () => ({ quark: 'saved-cookie' }),
        probe: async () => ({ state: 'valid', checkedAt: 1_799_999_999_000 }),
      },
    };
    render(<DriveBindModal siteName="演示线路" onClose={vi.fn()} onSaved={vi.fn()} ports={probePorts} />);
    const probeButton = await screen.findByRole('button', { name: '检查已保存凭据' });
    await act(async () => { fireEvent.click(probeButton); });
    expect((await screen.findByRole('status')).textContent).toContain('服务端确认有效');
    expect(screen.getByText(/实际播放仍取决于当前线路和资源权限/)).toBeTruthy();
  });
});
