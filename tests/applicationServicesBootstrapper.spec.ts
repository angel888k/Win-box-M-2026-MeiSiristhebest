import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => `${process.env.TEMP || 'C:/Windows/Temp'}/winbox-bootstrapper-test/${name}`,
    setPath: vi.fn(),
    getAppPath: () => process.cwd(),
    isPackaged: false,
    getVersion: () => '1.29.1',
    on: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  nativeTheme: {
    themeSource: 'dark',
  },
  BrowserWindow: {
    getAllWindows: () => [],
    fromWebContents: () => null,
  },
  Notification: vi.fn().mockImplementation(() => ({ show: vi.fn() })),
  clipboard: {
    readText: () => '',
    writeText: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

import { createApplicationServicesBootstrapper } from '../src/main/bootstrap/ApplicationServicesBootstrapper';

describe('ApplicationServicesBootstrapper', () => {
  it('instantiates all core services and implements lifecycle contracts', () => {
    const bootstrapper = createApplicationServicesBootstrapper({
      mainWindowProvider: () => null,
    });

    expect(bootstrapper.hostServices).toBeDefined();
    expect(bootstrapper.uiPreferences).toBeDefined();
    expect(bootstrapper.plugins).toBeDefined();
    expect(bootstrapper.playerEngines).toBeDefined();
    expect(bootstrapper.proxy).toBeDefined();
    expect(bootstrapper.dlnaDmr).toBeDefined();
    expect(bootstrapper.torrent).toBeDefined();
    expect(typeof bootstrapper.start).toBe('function');
    expect(typeof bootstrapper.dispose).toBe('function');

    // Calling dispose cleans up without throwing
    expect(() => bootstrapper.dispose()).not.toThrow();
  });
});
