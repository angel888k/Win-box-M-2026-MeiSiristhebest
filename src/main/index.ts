// src/main/index.ts — Electron 主进程入口 (WindowBootstrapper)
// ★★ 第一条 import（import 即执行，勿挪位置）：把数据目录切到**安装目录/data**
import './util/dataDirBootstrap';
import { resourcesDir } from './util/paths';
import { registerAppQuitCleanup } from './util/appQuit';
import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileLogger } from './util/logger';
import { applyUiScale, registerUiWindow, scaledWindowFor, setMainWindowProvider } from './ui/uiScale';
import { BASE_WINDOW } from '../shared/uiScale';
import { applyWindowCorner } from './util/windowCorner';
import { bossKey } from './bossKey';
import { playerWindow, onPlayerWindowClosed } from './player/PlayerWindow';
import { windowSurfaceColor } from './preferences/WindowSurfacePolicy';
import { setupGpuCrashRecovery } from './bootstrap/gpuCrashRecovery';
import { logEnvironmentDiagnostics } from './bootstrap/environmentDiagnostics';
import { setupDevReload } from './bootstrap/devReload';
import {
  createApplicationServicesBootstrapper,
  type ApplicationServicesBootstrapper,
} from './bootstrap/ApplicationServicesBootstrapper';

declare const __dirname: string;

let mainWindow: BrowserWindow | null = null;
let services: ApplicationServicesBootstrapper | null = null;

const isDev = (): boolean => !app.isPackaged && process.env.NODE_ENV !== 'production';

setupDevReload();

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-dev-shm-usage');

function createWindow(): void {
  const size = scaledWindowFor(BASE_WINDOW);
  const themeId = services?.uiPreferences.get().values.themeId ?? 'dark';
  mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    backgroundColor: windowSurfaceColor(themeId, 'application'),
    title: 'Win-Box',
    frame: false,
    autoHideMenuBar: true,
    icon: app.isPackaged
      ? (existsSync(join(resourcesDir(), 'ui', 'icon.png')) ? join(resourcesDir(), 'ui', 'icon.png') : undefined)
      : join(__dirname, '..', '..', 'build', 'icon.png'),
    ...(process.platform === 'win32' ? { backgroundMaterial: 'mica' as const } : {}),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const showIfHidden = (reason: string) => {
    if (mainWindow && !mainWindow.isDestroyed() && !bossKey.isActive && !mainWindow.isVisible()) {
      fileLogger.w(`主窗口在 ${reason} 后仍被隐藏，重新显示`);
      mainWindow.show();
    }
  };
  mainWindow.on('hide', () => setTimeout(() => showIfHidden('hide event'), 0));
  mainWindow.once('ready-to-show', () => showIfHidden('ready-to-show'));

  registerUiWindow(mainWindow);
  setMainWindowProvider(() => mainWindow);
  applyUiScale();

  const setCorner = (round: boolean) => {
    if (mainWindow && !mainWindow.isDestroyed()) applyWindowCorner(mainWindow, round);
  };
  const refreshContent = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      try { mainWindow.webContents.invalidate(); } catch { /* ignore */ }
    }
  };
  mainWindow.on('maximize', () => { setCorner(false); refreshContent(); });
  mainWindow.on('unmaximize', () => { setCorner(true); refreshContent(); });

  if (isDev()) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    setTimeout(() => showIfHidden('openDevTools'), 0);
  } else {
    mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// 单实例锁保护
if (!app.requestSingleInstanceLock()) {
  fileLogger.w('已有实例在运行（单实例锁被占用）→ 本次启动退出');
  app.quit();
} else {
  app.on('second-instance', () => {
    fileLogger.w('检测到第二实例启动：退出老板模式并展示主窗口');
    try { if (bossKey.isActive) bossKey.exit(); } catch { /* ignore */ }
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(async () => {
  logEnvironmentDiagnostics();

  services = createApplicationServicesBootstrapper({ mainWindowProvider: () => mainWindow });
  await services.start();

  setupGpuCrashRecovery(() => mainWindow, playerWindow);

  if (process.env.WINBOX_MEMORY_PROBE === '1') {
    setTimeout(() => {
      void import('./util/memProbe').then((m) => m.sampleMemory('idle@15s')).catch(() => undefined);
    }, 15_000).unref?.();
  }

  bossKey.start(() => {
    const ws: BrowserWindow[] = [];
    if (mainWindow && !mainWindow.isDestroyed()) ws.push(mainWindow);
    const pw = playerWindow();
    if (pw) ws.push(pw);
    return ws;
  });
  bossKey.apply();

  onPlayerWindowClosed(() => {
    void services?.hostServices.driveFileCleanup.deletePending().catch(() => undefined);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  services?.dispose();
  if (process.platform !== 'darwin') app.quit();
});

registerAppQuitCleanup(app, {
  cleanup: () => services?.hostServices.driveFileCleanup.deletePending() ?? Promise.resolve(),
  timeoutMs: 8_000,
  onError: (error) => fileLogger.w(`退出清理失败：${error instanceof Error ? error.message : String(error)}`),
  dispose: () => { services?.dispose(); },
});

process.on('beforeExit', () => {
  try { services?.dispose(); } catch { /* ignore */ }
});
