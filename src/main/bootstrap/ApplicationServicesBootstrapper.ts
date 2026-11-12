// src/main/bootstrap/ApplicationServicesBootstrapper.ts — 核心引擎与跨领域服务装配器
import { app, BrowserWindow, clipboard, ipcMain, nativeTheme, Notification, shell } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLive } from '../../engine/config/LiveConfigParser';
import { pkgSubUrl } from '../../engine/config/localPkg';
import { localLiveUrl } from '../../engine/live/localLive';
import { hostRegexFor } from '../../engine/util/m3u8Purify';
import { LOCAL_PROXY_BASE, LOCAL_PROXY_PORT } from '../../shared/constants';
import { IPC } from '../../shared/ipc-channels';
import type { PluginDialogReply } from '../../shared/pluginDialog';
import { colorSchemeFor } from '../../shared/ui/themeTokens';
import { createConfigurationApplicationServices } from '../configuration/createConfigurationApplicationServices';
import { LocalImportApplicationService } from '../configuration/LocalImportApplicationService';
import { createDanmakuServiceAssembly } from '../danmaku/createDanmakuServiceAssembly';
import { DlnaService } from '../dlna/DlnaService';
import { DlnaDmrService } from '../dlna/dmr/DlnaDmrService';
import { DownloadManager } from '../download/DownloadManager';
import { registerIpc } from '../ipc';
import type { MainIpcApplicationPorts } from '../ipc/MainIpcApplicationPorts';
import { LocalLiveFileImporter } from '../live/LocalLiveFileImporter';
import { createMetadataService } from '../meta/createMetadataService';
import { HttpClient } from '../net/HttpClient';
import { PlayerEngineController } from '../player/PlayerEngineController';
import { playerSettings } from '../player/playerSettings';
import { openPlayerWindow, playerWindow } from '../player/PlayerWindow';
import { createPluginSandboxApi } from '../plugin/pluginHostApi';
import { PluginDialogService } from '../plugin/PluginDialogService';
import { PluginHost } from '../plugin/PluginHost';
import { PluginKv } from '../plugin/PluginKv';
import { applyWindowSurfacePolicy } from '../preferences/WindowSurfacePolicy';
import { LocalProxyServer } from '../server/LocalProxyServer';
import { SettingsBackupService } from '../settings/SettingsBackupService';
import { createDefaultSpiderHostInfrastructure } from '../spider/createDefaultSpiderHostInfrastructure';
import { createSpiderHostServices } from '../spider/createSpiderHostServices';
import type { SpiderHostServices } from '../spider/SpiderHostServices';
import { DavStore } from '../store/DavStore';
import { DavService } from '../webdav/DavService';
import { JsonStore } from '../store/JsonStore';
import { LocalPkgStore } from '../store/LocalPkgStore';
import { UiPreferencesService } from '../store/UiPreferencesService';
import { createSubscriptionAssembly } from '../subscriptions/createSubscriptionAssembly';
import { createSubtitleServiceAssembly } from '../subtitle/createSubtitleServiceAssembly';
import { TorrentPlay } from '../torrent/torrentPlay';
import { UpdateService } from '../update/UpdateService';
import { clearWinboxCache, type ClearCacheResult } from '../util/cacheClean';
import { safeStorageDriveCodec } from '../util/driveCodec';
import { fileLogger } from '../util/logger';
import {
  builtinPluginsDir,
  cacheDir,
  distDir,
  legacyLocalImportsDir,
  localImportsDir,
  pluginsDir,
  userDataDir,
} from '../util/paths';
import {
  isFirstLaunchAfterUpdate,
  lastRunVersionPath,
  readLastRunVersion,
  writeLastRunVersion,
} from '../util/updateCacheReset';

export interface ApplicationServicesBootstrapperOptions {
  mainWindowProvider: () => BrowserWindow | null;
}

export interface ApplicationServicesBootstrapper {
  readonly hostServices: SpiderHostServices;
  readonly uiPreferences: UiPreferencesService;
  readonly plugins: PluginHost;
  readonly playerEngines: PlayerEngineController;
  readonly proxy: LocalProxyServer;
  readonly dlnaDmr: DlnaDmrService;
  readonly torrent: TorrentPlay;
  start(): Promise<{ privateCacheReset: ClearCacheResult | null }>;
  dispose(): void;
}

export function createApplicationServicesBootstrapper(
  options: ApplicationServicesBootstrapperOptions,
): ApplicationServicesBootstrapper {
  const { mainWindowProvider } = options;

  const pluginDialogs = new PluginDialogService(() => mainWindowProvider()?.webContents ?? null);
  ipcMain.on(IPC.PLUGIN_DIALOG_READY, (event) => pluginDialogs.markReady(event.sender.id));
  ipcMain.on(IPC.PLUGIN_DIALOG_REPLY, (event, reply: PluginDialogReply) => pluginDialogs.reply(event.sender.id, reply));

  const localPkgs = new LocalPkgStore(
    new JsonStore(join(userDataDir(), 'local-pkgs.json')),
    LOCAL_PROXY_BASE,
    localImportsDir(),
    legacyLocalImportsDir(),
  );

  const hostInfrastructure = createDefaultSpiderHostInfrastructure();
  const configurationServices = createConfigurationApplicationServices({
    persistence: hostInfrastructure.userConfigPersistence,
    logger: hostInfrastructure.logger,
    localPackages: localPkgs,
  });

  const torrent = new TorrentPlay(fileLogger, () => playerSettings.settings.btExternalPlayer);
  const davStore = new DavStore(
    new JsonStore(join(userDataDir(), 'webdav-servers.json')),
    fileLogger,
    safeStorageDriveCodec(),
  );
  const dav = new DavService(hostInfrastructure.http, davStore, fileLogger);
  const dlna = new DlnaService(fileLogger);
  const updater = new UpdateService(fileLogger);

  const uiPreferences = new UiPreferencesService(
    new JsonStore(join(userDataDir(), 'ui-preferences.json')),
    (snapshot) => {
      nativeTheme.themeSource = colorSchemeFor(snapshot.values.themeId);
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue;
        const role = window === playerWindow() ? 'player' : 'application';
        applyWindowSurfacePolicy(window, snapshot.values.themeId, role);
        window.webContents.send(IPC.UI_PREFERENCES_CHANGED, snapshot);
      }
    },
  );
  nativeTheme.themeSource = colorSchemeFor(uiPreferences.get().values.themeId);

  const pluginHttp = new HttpClient();
  const plugins = new PluginHost({
    pluginsDir: pluginsDir(),
    builtinDir: builtinPluginsDir(),
    statePath: join(userDataDir(), 'plugins-state.json'),
    settingsPath: join(userDataDir(), 'plugin-settings.json'),
    enginePaths: () => playerSettings.settings.enginePaths,
  });

  plugins.attachSandbox({
    workerFile: join(distDir(), 'plugin-worker.cjs'),
    logger: fileLogger,
    api: createPluginSandboxApi({
      http: pluginHttp,
      logger: fileLogger,
      pluginsDir: pluginsDir(),
      settings: plugins.pluginSettingsAccess(),
      kv: new PluginKv(new JsonStore(join(userDataDir(), 'plugin-kv.json'))),
      playerRelay: (op, value) => {
        const w = playerWindow();
        if (!w) return { ok: false, reason: '播放器未打开' };
        try {
          w.webContents.send(IPC.PLAYER_CTL, { op, value });
          return { ok: true };
        } catch {
          return { ok: false, reason: '播放器窗口不可用' };
        }
      },
      notify: (title, body) => {
        try {
          new Notification({ title: String(title), body: String(body) }).show();
        } catch {
          /* ignore */
        }
      },
      clipboardRead: () => clipboard.readText(),
      clipboardWrite: (text) => clipboard.writeText(String(text)),
      dialogBox: (op, message, title, pluginId) => pluginDialogs.request(pluginId || '插件', op, message, title),
      openExternal: (url) => shell.openExternal(url),
    }),
  });

  const playerEngines = new PlayerEngineController(fileLogger);

  const subtitleService = createSubtitleServiceAssembly({
    userDataDirectory: hostInfrastructure.directories.userData,
    logger: hostInfrastructure.logger,
    credentialCodec: hostInfrastructure.credentialCodec,
    listPluginProviders: async () => (await plugins.subtitleProviders()) ?? [],
  }).service;

  const danmakuServices = createDanmakuServiceAssembly({
    userDataDirectory: hostInfrastructure.directories.userData,
    logger: hostInfrastructure.logger,
    listPluginSources: async () => (await plugins.danmakuSources()) ?? [],
  });

  const metadataService = createMetadataService({
    userDataDir: hostInfrastructure.directories.userData,
    cacheDir: hostInfrastructure.directories.cache,
    logger: hostInfrastructure.logger,
    driveCodec: hostInfrastructure.credentialCodec,
    metadataProviders: async () => (await plugins.metaProviders()) ?? [],
    discoverySources: async () => (await plugins.discoverSources()) ?? [],
  });

  const hostServices = createSpiderHostServices(hostInfrastructure, {
    configuration: configurationServices,
    createSubscriptionImports: (coordinator) =>
      createSubscriptionAssembly({
        userDataDirectory: hostInfrastructure.directories.userData,
        profiles: configurationServices.userConfig,
        logger: fileLogger,
        coordinator,
        onImportProgress: (event) => {
          for (const window of BrowserWindow.getAllWindows()) {
            try {
              if (!window.isDestroyed()) window.webContents.send(IPC.CFG_IMPORT_JOB_PROGRESS, event);
            } catch {
              // A window can close while the import job continues.
            }
          }
        },
        onPersistenceError: (error) =>
          fileLogger.w(`订阅导入任务进度保存失败：${error instanceof Error ? error.message : String(error)}`),
      }).imports,
    localPackages: localPkgs,
    integrations: {
      torrentPlayback: torrent,
      liveTemplates: () => plugins.liveTemplates(),
    },
    runtimeProviders: [plugins.spiderRuntimeProvider()],
  });

  const syncDriveCredentialFiles = (): void => {
    hostServices.driveCredentialSynchronizer.sync(hostServices.drives.list(), hostServices.ucTvStore.get());
  };

  const resetSpidersAfterDriveChange = (): void => {
    hostServices.aggregateSearch.invalidateCredentials();
    hostServices.spiderRuntime.resetAfterDriveCredentialChange();
  };

  const ipcServices: MainIpcApplicationPorts = {
    localImports: new LocalImportApplicationService({
      pythonFiles: {
        copyPython: (sourcePath) => localPkgs.importPython(sourcePath),
        discard: (reference, currentConfig) => localPkgs.discardImport(reference, currentConfig),
      },
      sources: hostServices.sourceConfiguration,
      packages: {
        inspect: (root) => localPkgs.inspectSubscription(root),
        copyAndRegister: (root, name) => localPkgs.importSubscription(root, name),
        rootOf: (index) => localPkgs.rootOf(index),
        discard: (reference, currentConfig) => localPkgs.discardImport(reference, currentConfig),
      },
      subscriptions: hostServices.subscriptionImports,
      liveFiles: new LocalLiveFileImporter({
        read: (path) => readFileSync(path),
        writeUtf8: (fileName, text) => {
          const directory = join(userDataDir(), 'local-live');
          mkdirSync(directory, { recursive: true });
          writeFileSync(join(directory, fileName), Buffer.from(text, 'utf-8'));
        },
      }),
      liveChannels: {
        add: (channel) => hostServices.liveChannelConfiguration.add(channel),
        count: () => hostServices.livePlayback.lives.length,
      },
      packageUrl: pkgSubUrl,
      liveChannel: (name, fileName) =>
        parseLive(
          {
            name,
            api: '',
            type: '0',
            url: localLiveUrl(LOCAL_PROXY_BASE, fileName),
          },
          0,
        ),
      logger: { warn: (message) => fileLogger.w(message) },
    }),
    sourceConfiguration: hostServices.sourceConfiguration,
    configRuntimeSync: {
      status: () => {
        const service = configurationServices.userConfig;
        const revision = service.revision;
        const pendingRevision = service.pendingRuntimeSyncRevision;
        if (pendingRevision === null) return { status: 'synchronized', revision, pendingRevision: null };
        const outcome = service.lastCommitOutcome;
        if (outcome?.status === 'committed-runtime-sync-failed' && outcome.revision === pendingRevision) {
          return { status: 'failed', revision, pendingRevision, error: outcome.error };
        }
        return { status: 'pending', revision, pendingRevision };
      },
      retry: () => configurationServices.userConfig.retryRuntimeSync(),
    },
    sourceReads: {
      importConfig: (source) => hostServices.subscriptionImports.importConfig(source),
      get sites() {
        return hostServices.sourceRuntimeConfiguration.current?.sites ?? [];
      },
      get importReport() {
        return hostServices.subscriptionImports.latestReport;
      },
      driveBindLearned: () => hostServices.driveBindingLearning.learnedSourceKeys(),
    },
    subscriptionImports: hostServices.subscriptionImports,
    subscriptionGroups: hostServices.subscriptionGroups,
    profileConfiguration: hostServices.profileConfiguration,
    liveChannelConfiguration: hostServices.liveChannelConfiguration,
    sourceDiagnostics: hostServices.sourceDiagnostics,
    driveAccounts: hostServices.driveAccounts,
    spiderRuntime: hostServices.spiderRuntime,
    driveFileCleanup: hostServices.driveFileCleanup,
    livePlayback: hostServices.livePlayback,
    vod: {
      home: (key, profileId, signal) => hostServices.sourceCatalog.home(key, profileId, signal),
      category: (key, tid, page, extend, profileId, signal) =>
        hostServices.sourceCatalog.category(key, tid, page, extend, profileId, signal),
      detail: (key, ids, profileId, signal) => hostServices.sourceCatalog.detail(key, ids, profileId, signal),
      search: (key, keyword, profileId, signal) => hostServices.sourceCatalog.search(key, keyword, profileId, signal),
      searchAll: (keyword, options, onProgress, signal) =>
        hostServices.aggregateSearchRunner.run(keyword, options, onProgress, signal),
      play: (key, flag, id, profileId, parseOffset, fastRecovery) =>
        hostServices.playbackRequest.execute(key, flag, id, profileId, parseOffset, fastRecovery),
      prewarm: (key, flag, id, profileId, signal) =>
        hostServices.playbackRequest.prewarm(key, flag, id, profileId, signal),
      reportPlaybackHealth: (key, ok) => {
        if (ok) {
          hostServices.searchHealth.playbackSucceeded(key);
        } else {
          hostServices.searchHealth.playbackFailed(key);
        }
      },
    },
  };

  const disposeSpiderServices = (): void => {
    hostServices.subscriptionImports.dispose();
    try {
      hostServices.spiderRuntime.dispose();
    } catch {
      /* ignore */
    }
  };

  const settingsBackup = new SettingsBackupService({
    userConfig: {
      snapshot: () => configurationServices.sources.getSnapshot(),
      restore: (value) => configurationServices.userConfig.restore(value),
    },
    drives: {
      list: () => hostServices.driveAccounts.list(),
      set: (provider, token) => hostServices.driveAccounts.set(provider, token),
      remove: (provider) => hostServices.driveAccounts.remove(provider),
    },
    subtitle: subtitleService,
    metadata: metadataService,
    danmaku: {
      getSettings: () => danmakuServices.store.settings,
      setSettings: (settings) => {
        danmakuServices.store.settings = settings;
      },
    },
    driveRuntime: {
      resetAfterCredentialChange: resetSpidersAfterDriveChange,
      syncCredentialFiles: syncDriveCredentialFiles,
    },
  });

  const proxy = new LocalProxyServer(
    fileLogger,
    () => hostServices.driveAccounts.list(),
    {
      enabled: () => playerSettings.settings.m3u8Purify,
      rulesFor: (url) => hostRegexFor(url, hostServices.sourceRuntimeConfiguration.current?.rules),
    },
    (id) => dav.authHeader(id),
  );

  proxy.pkgRoot = (i) => localPkgs.rootOf(i);
  hostServices.sourceConfiguration.initializeLocalImports();

  const pushSpeed = (kbs: number): void => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('net:speed', kbs);
    }
  };
  proxy.onSpeed = pushSpeed;
  torrent.onSpeed = pushSpeed;
  proxy.onSpiderProxy = (port) => hostServices.bridge.pinSpiderProxy(port);
  proxy.onPythonProxy = (key, params) => hostServices.pythonSourceProxy.execute(key, params);
  proxy.bt = torrent;

  proxy.onRemoteAction = async (action) => {
    fileLogger.i(`remote: 收到指令 ${action.do} ${action.name || ''} ${action.url || ''}`);
    if (action.do === 'pushStore' && action.url) {
      try {
        const res = await hostServices.subscriptionImports.importConfig({
          url: action.url,
          name: action.name || '推送仓库',
        });
        fileLogger.i(`remote: 仓库推送导入完成，共 ${res.config.sites.length} 源`);
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) {
            w.webContents.send(IPC.WIN_REPORT_ERROR, {
              message: `已成功导入手机推送的仓库：${action.name || action.url}`,
            });
          }
        }
      } catch (e) {
        fileLogger.w(`remote: 仓库推送导入失败: ${(e as Error).message}`);
      }
    } else if (action.do === 'push' && action.url) {
      openPlayerWindow({
        key: 'push',
        flag: 'push',
        title: action.name || '手机推送播放',
        episodes: [{ name: action.name || '推送视频', url: action.url }],
        epIndex: 0,
        lastUrl: action.url,
        lastName: action.name || '推送视频',
      });
    } else if (action.do === 'livePush' && (action.address || action.url)) {
      const liveUrl = action.address || action.url || '';
      openPlayerWindow({
        key: 'livePush',
        flag: 'livePush',
        title: action.name || '手机推送直播',
        episodes: [{ name: action.name || '直播频道', url: liveUrl }],
        epIndex: 0,
        lastUrl: liveUrl,
        lastName: action.name || '直播频道',
      });
    } else if (action.do === 'pushAliToken' && action.token) {
      try {
        await hostServices.driveAccounts.set('ali', action.token);
        fileLogger.i('remote: 阿里云盘 Token 保存成功');
      } catch (e) {
        fileLogger.w(`remote: 阿里云盘 Token 保存失败: ${(e as Error).message}`);
      }
    } else if (action.do === 'search' && action.word) {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) {
          w.show();
          w.focus();
          w.webContents.send('nav:search', { keyword: action.word });
        }
      }
    } else if (action.do === 'danmaku' && action.text) {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) {
          w.webContents.send(IPC.DANMAKU_EMIT_REALTIME, { text: action.text });
        }
      }
    }
  };

  const dlnaDmr = new DlnaDmrService({
    port: LOCAL_PROXY_PORT,
    logger: fileLogger,
    friendlyName: 'Win-Box 投屏',
  });
  proxy.dlnaDmr = dlnaDmr;

  dlnaDmr.setCallbacks({
    onPlayMedia: async (url, title) => {
      fileLogger.i(`DLNA DMR: 收到手机投屏播放请求 title=${title} url=${url}`);
      openPlayerWindow({
        key: 'dlnaDmr',
        flag: 'dlnaDmr',
        title: title || '手机投屏播放',
        episodes: [{ name: title || '投屏视频', url }],
        epIndex: 0,
        lastUrl: url,
        lastName: title || '投屏视频',
      });
    },
    onPlay: () => {
      const w = playerWindow();
      if (w && !w.isDestroyed()) w.webContents.send(IPC.PLAYER_CTL, { op: 'play' });
    },
    onPause: () => {
      const w = playerWindow();
      if (w && !w.isDestroyed()) w.webContents.send(IPC.PLAYER_CTL, { op: 'pause' });
    },
    onStop: () => {
      const w = playerWindow();
      if (w && !w.isDestroyed()) w.webContents.send(IPC.PLAYER_CTL, { op: 'stop' });
    },
    onSeek: (seconds) => {
      const w = playerWindow();
      if (w && !w.isDestroyed()) w.webContents.send(IPC.PLAYER_CTL, { op: 'seek', value: seconds });
    },
    onSetVolume: (vol) => {
      const w = playerWindow();
      if (w && !w.isDestroyed()) w.webContents.send(IPC.PLAYER_CTL, { op: 'volume', value: vol / 100 });
    },
  });

  const downloadManager = new DownloadManager({
    defaultDownloadDir: join(app.getPath('downloads'), 'Win-Box'),
    logger: fileLogger,
  });

  registerIpc(
    ipcServices,
    dav,
    dlna,
    updater,
    uiPreferences,
    plugins,
    playerEngines,
    {
      subtitles: subtitleService,
      danmaku: danmakuServices.service,
      metadata: metadataService,
      downloads: downloadManager,
    },
    settingsBackup,
    dlnaDmr,
  );

  return {
    hostServices,
    uiPreferences,
    plugins,
    playerEngines,
    proxy,
    dlnaDmr,
    torrent,

    async start(): Promise<{ privateCacheReset: ClearCacheResult | null }> {
      let privateCacheReset: ClearCacheResult | null = null;
      try {
        const marker = lastRunVersionPath(userDataDir());
        const prev = readLastRunVersion(marker);
        if (app.isPackaged && isFirstLaunchAfterUpdate(prev, app.getVersion())) {
          privateCacheReset = clearWinboxCache(cacheDir());
          fileLogger.i(
            `更新后首次启动（${prev} → ${app.getVersion()}）：已清空应用私有缓存 winbox-cache（释放 ${(privateCacheReset.freedBytes / 1024 / 1024).toFixed(1)}MB；`
              + `清理 ${privateCacheReset.cleared.length} 项${privateCacheReset.cleared.length ? `：${privateCacheReset.cleared.slice(0, 12).join('/')}` : ''}`
              + `${privateCacheReset.failed.length ? `；失败 ${privateCacheReset.failed.join('/')}` : ''}）`,
          );
        }
        if (app.isPackaged) writeLastRunVersion(marker, app.getVersion());
      } catch (e) {
        fileLogger.w('更新后清空私有缓存失败：' + (e instanceof Error ? e.message : String(e)));
      }

      try {
        await proxy.start();
      } catch {
        fileLogger.w('本地代理启动失败，直播归一化可能受影响');
      }

      try {
        const { initProxySettings } = await import('../net/proxy');
        initProxySettings(join(userDataDir(), 'proxy.json'));
      } catch (e) {
        fileLogger.w('代理设置初始化失败：' + (e as Error).message);
      }

      try {
        const { initPlayDiag } = await import('../util/playDiag');
        initPlayDiag({
          logDir: () => join(userDataDir(), 'logs'),
          log: (m: string) => fileLogger.i(m),
        });
      } catch (e) {
        fileLogger.w('播放诊断初始化失败：' + (e as Error).message);
      }

      try {
        syncDriveCredentialFiles();
      } catch {
        /* 同步失败不影响启动 */
      }
      try {
        await hostServices.driveAccounts.refreshSessions();
      } catch (e) {
        fileLogger.w('网盘会话刷新失败（保留现有绑定）：' + (e as Error).message);
      }
      try {
        syncDriveCredentialFiles();
      } catch {
        /* 同步失败不影响启动 */
      }

      hostServices.spiderRuntime.enablePrewarm();

      if (privateCacheReset) {
        try {
          hostServices.spiderRuntime.rewarmAfterCacheClear();
        } catch {
          /* ignore */
        }
      }

      try {
        await plugins.init();
        const items = await plugins.list();
        fileLogger.i(
          `插件：登记 ${items.length} 个（${items.map((p) => `${p.id}@${p.version}/${p.source}`).join('、') || '无'}）`,
        );
      } catch (e) {
        fileLogger.w('插件初始化失败：' + (e instanceof Error ? e.message : String(e)));
      }

      try {
        dlnaDmr.startSsdp();
      } catch (e) {
        fileLogger.w('DLNA DMR 启动失败: ' + (e instanceof Error ? e.message : String(e)));
      }

      void hostServices.subscriptionImports.refreshIfDue();
      void hostServices.driveFileCleanup.deletePending().catch(() => undefined);

      return { privateCacheReset };
    },

    dispose(): void {
      try {
        void hostServices.driveFileCleanup.deletePending();
      } catch {
        /* ignore */
      }
      try {
        disposeSpiderServices();
      } catch {
        /* ignore */
      }
      try {
        torrent.dispose();
      } catch {
        /* ignore */
      }
      try {
        proxy.stop();
      } catch {
        /* ignore */
      }
      try {
        dlnaDmr.stop();
      } catch {
        /* ignore */
      }
      try {
        plugins.dispose();
      } catch {
        /* ignore */
      }
      try {
        playerEngines.dispose();
      } catch {
        /* ignore */
      }
      try {
        pluginDialogs.dispose();
      } catch {
        /* ignore */
      }
    },
  };
}
