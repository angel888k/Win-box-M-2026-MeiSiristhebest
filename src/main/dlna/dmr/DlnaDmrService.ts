// src/main/dlna/dmr/DlnaDmrService.ts — DLNA DMR (Digital Media Renderer) 手机投屏接收端服务
import { createSocket, type Socket } from 'node:dgram';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../../../shared/types';
import {
  AVT_SCPD_XML,
  AV_TRANSPORT_SERVICE,
  CM_SCPD_XML,
  CONNECTION_MANAGER_SERVICE,
  DMR_DEVICE_TYPE,
  RC_SCPD_XML,
  RENDERING_CONTROL_SERVICE,
  buildDmrDescriptionXml,
  buildGenaAvtLastChangeXml,
  buildGenaEventEnvelopeXml,
  buildGenaRcLastChangeXml,
  extractCallbackUrl,
  extractTagValue,
  extractTitleFromDidl,
  getLocalIpAddress,
  hmsToSeconds,
  parseTimeoutSeconds,
  secondsToHms,
  wrapSoapResponse,
} from './dmrProtocol';

const SSDP_MULTICAST_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;

export interface DlnaDmrCallbacks {
  onPlayMedia?: (url: string, title: string) => Promise<void> | void;
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  onSeek?: (seconds: number) => void;
  onSetVolume?: (volume: number) => void;
}

export interface DlnaDmrServiceOptions {
  friendlyName?: string;
  port: number;
  logger: Logger;
  callbacks?: DlnaDmrCallbacks;
}

interface GenaSubscription {
  sid: string;
  serviceType: 'avt' | 'rc';
  callbackUrl: string;
  seq: number;
  timer: NodeJS.Timeout;
}

export class DlnaDmrService {
  readonly uuid: string;
  friendlyName: string;
  readonly port: number;
  private logger: Logger;
  private callbacks: DlnaDmrCallbacks;
  private ssdpSocket?: Socket;
  private isRunning = false;

  // DMR 播放器状态同步
  private transportState: 'STOPPED' | 'PLAYING' | 'PAUSED_PLAYBACK' = 'STOPPED';
  private currentUri = '';
  private currentTitle = '';
  private duration = 0;
  private position = 0;
  private volume = 100;
  private mute = false;

  // GENA 事件订阅列表 (SID -> GenaSubscription)
  private subscriptions = new Map<string, GenaSubscription>();

  constructor(options: DlnaDmrServiceOptions) {
    this.uuid = `winbox-dmr-${randomUUID()}`;
    this.friendlyName = options.friendlyName || 'Win-Box (投屏播放器)';
    this.port = options.port;
    this.logger = options.logger;
    this.callbacks = options.callbacks || {};
  }

  get running(): boolean {
    return this.isRunning;
  }

  get activeSubscriptionsCount(): number {
    return this.subscriptions.size;
  }

  setCallbacks(callbacks: DlnaDmrCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  updatePlaybackState(state: {
    transportState?: 'STOPPED' | 'PLAYING' | 'PAUSED_PLAYBACK';
    duration?: number;
    position?: number;
    volume?: number;
    mute?: boolean;
  }): void {
    const prevTransportState = this.transportState;
    const prevDuration = this.duration;
    const prevVolume = this.volume;
    const prevMute = this.mute;

    if (state.transportState) this.transportState = state.transportState;
    if (typeof state.duration === 'number') this.duration = Math.max(0, state.duration);
    if (typeof state.position === 'number') this.position = Math.max(0, state.position);
    if (typeof state.volume === 'number') this.volume = Math.max(0, Math.min(100, state.volume));
    if (typeof state.mute === 'boolean') this.mute = state.mute;

    const avtChanged =
      (state.transportState && state.transportState !== prevTransportState) ||
      (typeof state.duration === 'number' && Math.abs(state.duration - prevDuration) > 0.5);
    const rcChanged =
      (typeof state.volume === 'number' && state.volume !== prevVolume) ||
      (typeof state.mute === 'boolean' && state.mute !== prevMute);

    if (avtChanged) {
      this.notifyAvtSubscribers();
    }
    if (rcChanged) {
      this.notifyRcSubscribers();
    }
  }

  matches(pathname: string): boolean {
    return (
      pathname === '/dmr/description.xml' ||
      pathname === '/dmr/avt_scpd.xml' ||
      pathname === '/dmr/rc_scpd.xml' ||
      pathname === '/dmr/cm_scpd.xml' ||
      pathname === '/dmr/avt_control' ||
      pathname === '/dmr/rc_control' ||
      pathname === '/dmr/cm_control' ||
      pathname === '/dmr/avt_event' ||
      pathname === '/dmr/rc_event' ||
      pathname === '/dmr/cm_event'
    );
  }

  async handle(u: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = u.pathname;

    // 0. GENA 事件订阅机制 (SUBSCRIBE / UNSUBSCRIBE)
    if (req.method === 'SUBSCRIBE') {
      this.handleGenaSubscribe(pathname, req, res);
      return;
    }
    if (req.method === 'UNSUBSCRIBE') {
      this.handleGenaUnsubscribe(pathname, req, res);
      return;
    }

    // 1. 设备描述与 SCPD XML 请求 (GET)
    if (req.method === 'GET') {
      if (pathname === '/dmr/description.xml') {
        const xml = buildDmrDescriptionXml({
          friendlyName: this.friendlyName,
          uuid: this.uuid,
        });
        res.writeHead(200, {
          'Content-Type': 'text/xml; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(xml);
        return;
      }
      if (pathname === '/dmr/avt_scpd.xml') {
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
        res.end(AVT_SCPD_XML);
        return;
      }
      if (pathname === '/dmr/rc_scpd.xml') {
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
        res.end(RC_SCPD_XML);
        return;
      }
      if (pathname === '/dmr/cm_scpd.xml') {
        res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
        res.end(CM_SCPD_XML);
        return;
      }
    }

    // 2. SOAP 控制请求 (POST)
    if (req.method === 'POST') {
      let bodyText = '';
      try {
        bodyText = await new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
          req.on('error', reject);
        });
      } catch (err) {
        this.logger.w(`[DLNA DMR] 读取 SOAP 请求失败: ${err}`);
        res.writeHead(400);
        res.end();
        return;
      }

      const soapAction = String(req.headers.soapaction || '').replace(/"/g, '');

      if (pathname === '/dmr/avt_control') {
        this.handleAvTransportControl(soapAction, bodyText, res);
        return;
      }
      if (pathname === '/dmr/rc_control') {
        this.handleRenderingControl(soapAction, bodyText, res);
        return;
      }
      if (pathname === '/dmr/cm_control') {
        this.handleConnectionManager(soapAction, bodyText, res);
        return;
      }
    }

    res.writeHead(404);
    res.end();
  }

  private handleAvTransportControl(action: string, body: string, res: ServerResponse): void {
    if (action.includes('SetAVTransportURI')) {
      const uri = extractTagValue(body, 'CurrentURI');
      const meta = extractTagValue(body, 'CurrentURIMetaData');
      const title = extractTitleFromDidl(meta) || '手机投屏视频';
      this.currentUri = uri;
      this.currentTitle = title;
      this.transportState = 'PLAYING';
      this.logger.i(`[DLNA DMR] 收到手机投屏 SetAVTransportURI: ${title} -> ${uri.slice(0, 80)}`);
      if (uri) {
        void this.callbacks.onPlayMedia?.(uri, title);
      }
      this.notifyAvtSubscribers();
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(wrapSoapResponse('SetAVTransportURI', AV_TRANSPORT_SERVICE, ''));
      return;
    }

    if (action.includes('Play')) {
      this.transportState = 'PLAYING';
      this.logger.i('[DLNA DMR] 收到手机控制指令: Play');
      this.callbacks.onPlay?.();
      this.notifyAvtSubscribers();
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(wrapSoapResponse('Play', AV_TRANSPORT_SERVICE, ''));
      return;
    }

    if (action.includes('Pause')) {
      this.transportState = 'PAUSED_PLAYBACK';
      this.logger.i('[DLNA DMR] 收到手机控制指令: Pause');
      this.callbacks.onPause?.();
      this.notifyAvtSubscribers();
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(wrapSoapResponse('Pause', AV_TRANSPORT_SERVICE, ''));
      return;
    }

    if (action.includes('Stop')) {
      this.transportState = 'STOPPED';
      this.logger.i('[DLNA DMR] 收到手机控制指令: Stop');
      this.callbacks.onStop?.();
      this.notifyAvtSubscribers();
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(wrapSoapResponse('Stop', AV_TRANSPORT_SERVICE, ''));
      return;
    }

    if (action.includes('Seek')) {
      const target = extractTagValue(body, 'Target');
      const seconds = hmsToSeconds(target);
      this.position = seconds;
      this.logger.i(`[DLNA DMR] 收到手机控制指令: Seek -> ${target} (${seconds}s)`);
      this.callbacks.onSeek?.(seconds);
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(wrapSoapResponse('Seek', AV_TRANSPORT_SERVICE, ''));
      return;
    }

    if (action.includes('GetTransportInfo')) {
      const inner = `<CurrentTransportState>${this.transportState}</CurrentTransportState>
<CurrentTransportStatus>OK</CurrentTransportStatus>
<CurrentSpeed>1</CurrentSpeed>`;
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(wrapSoapResponse('GetTransportInfo', AV_TRANSPORT_SERVICE, inner));
      return;
    }

    if (action.includes('GetPositionInfo')) {
      const trackDur = secondsToHms(this.duration);
      const relTime = secondsToHms(this.position);
      const inner = `<Track>1</Track>
<TrackDuration>${trackDur}</TrackDuration>
<TrackMetaData></TrackMetaData>
<TrackURI>${this.currentUri}</TrackURI>
<RelTime>${relTime}</RelTime>
<AbsTime>${relTime}</AbsTime>
<RelCount>0</RelCount>
<AbsCount>0</AbsCount>`;
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(wrapSoapResponse('GetPositionInfo', AV_TRANSPORT_SERVICE, inner));
      return;
    }

    if (action.includes('GetMediaInfo')) {
      const trackDur = secondsToHms(this.duration);
      const inner = `<NrTracks>1</NrTracks>
<MediaDuration>${trackDur}</MediaDuration>
<CurrentURI>${this.currentUri}</CurrentURI>
<CurrentURIMetaData></CurrentURIMetaData>
<NextURI></NextURI>
<NextURIMetaData></NextURIMetaData>
<PlayMedium>NETWORK</PlayMedium>
<RecordMedium>NOT_IMPLEMENTED</RecordMedium>
<WriteStatus>NOT_IMPLEMENTED</WriteStatus>`;
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(wrapSoapResponse('GetMediaInfo', AV_TRANSPORT_SERVICE, inner));
      return;
    }

    // 默认空响应
    res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
    res.end(wrapSoapResponse(action.split('#')[1] || 'Action', AV_TRANSPORT_SERVICE, ''));
  }

  private handleRenderingControl(action: string, body: string, res: ServerResponse): void {
    if (action.includes('GetVolume')) {
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(wrapSoapResponse('GetVolume', RENDERING_CONTROL_SERVICE, `<CurrentVolume>${this.volume}</CurrentVolume>`));
      return;
    }

    if (action.includes('SetVolume')) {
      const vol = parseInt(extractTagValue(body, 'DesiredVolume'), 10);
      if (Number.isFinite(vol)) {
        this.volume = Math.max(0, Math.min(100, vol));
        this.callbacks.onSetVolume?.(this.volume);
        this.notifyRcSubscribers();
      }
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(wrapSoapResponse('SetVolume', RENDERING_CONTROL_SERVICE, ''));
      return;
    }

    if (action.includes('SetMute')) {
      const desiredMute = extractTagValue(body, 'DesiredMute');
      this.mute = desiredMute === '1' || desiredMute.toLowerCase() === 'true';
      this.notifyRcSubscribers();
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(wrapSoapResponse('SetMute', RENDERING_CONTROL_SERVICE, ''));
      return;
    }

    if (action.includes('GetMute')) {
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(wrapSoapResponse('GetMute', RENDERING_CONTROL_SERVICE, `<CurrentMute>${this.mute ? '1' : '0'}</CurrentMute>`));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
    res.end(wrapSoapResponse(action.split('#')[1] || 'Action', RENDERING_CONTROL_SERVICE, ''));
  }

  private handleConnectionManager(action: string, _body: string, res: ServerResponse): void {
    if (action.includes('GetProtocolInfo')) {
      const protocols = 'http-get:*:video/mp4:*,http-get:*:video/x-matroska:*,http-get:*:video/quicktime:*,http-get:*:application/vnd.apple.mpegurl:*,http-get:*:video/mp2t:*';
      const inner = `<Source></Source><Sink>${protocols}</Sink>`;
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(wrapSoapResponse('GetProtocolInfo', CONNECTION_MANAGER_SERVICE, inner));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
    res.end(wrapSoapResponse(action.split('#')[1] || 'Action', CONNECTION_MANAGER_SERVICE, ''));
  }

  /** 启动 SSDP 组播服务，使局域网内手机能够发现此设备 */
  startSsdp(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const socket = createSocket({ type: 'udp4', reuseAddr: true });
      this.ssdpSocket = socket;

      socket.on('error', (err) => {
        this.logger.w(`[DLNA DMR] SSDP socket error: ${err.message}`);
      });

      socket.on('message', (msg, rinfo) => {
        const text = msg.toString('utf-8');
        if (text.startsWith('M-SEARCH')) {
          this.handleMSearch(text, rinfo.address, rinfo.port);
        }
      });

      socket.bind(SSDP_PORT, () => {
        try {
          socket.addMembership(SSDP_MULTICAST_ADDR);
          socket.setMulticastTTL(4);
          this.broadcastAlive();
          this.logger.i(`[DLNA DMR] 投屏接收端上线，就绪监听: ${this.friendlyName} (port=${this.port})`);
        } catch (e) {
          this.logger.w(`[DLNA DMR] 加入组播失败: ${e}`);
        }
      });
    } catch (err) {
      this.logger.w(`[DLNA DMR] 启动 SSDP 失败: ${err}`);
    }
  }

  private handleMSearch(msg: string, remoteAddress: string, remotePort: number): void {
    const lines = msg.split(/\r?\n/);
    let st = '';
    for (const line of lines) {
      if (line.toUpperCase().startsWith('ST:')) {
        st = line.slice(3).trim();
        break;
      }
    }

    const matches =
      st === 'ssdp:all' ||
      st === 'upnp:rootdevice' ||
      st === DMR_DEVICE_TYPE ||
      st === AV_TRANSPORT_SERVICE;

    if (!matches) return;

    const localIp = getLocalIpAddress();
    const location = `http://${localIp}:${this.port}/dmr/description.xml`;

    const response =
      'HTTP/1.1 200 OK\r\n' +
      'CACHE-CONTROL: max-age=1800\r\n' +
      `DATE: ${new Date().toUTCString()}\r\n` +
      'EXT:\r\n' +
      `LOCATION: ${location}\r\n` +
      'SERVER: Windows/10.0 UPnP/1.0 WinBox/1.0\r\n' +
      `ST: ${st === 'ssdp:all' ? DMR_DEVICE_TYPE : st}\r\n` +
      `USN: uuid:${this.uuid}::${st === 'ssdp:all' ? DMR_DEVICE_TYPE : st}\r\n` +
      '\r\n';

    const buf = Buffer.from(response, 'utf-8');
    this.ssdpSocket?.send(buf, 0, buf.length, remotePort, remoteAddress, () => {});
  }

  private broadcastAlive(): void {
    if (!this.ssdpSocket) return;
    const localIp = getLocalIpAddress();
    const location = `http://${localIp}:${this.port}/dmr/description.xml`;

    const notify =
      'NOTIFY * HTTP/1.1\r\n' +
      `HOST: ${SSDP_MULTICAST_ADDR}:${SSDP_PORT}\r\n` +
      `NT: ${DMR_DEVICE_TYPE}\r\n` +
      'NTS: ssdp:alive\r\n' +
      `LOCATION: ${location}\r\n` +
      `USN: uuid:${this.uuid}::${DMR_DEVICE_TYPE}\r\n` +
      'CACHE-CONTROL: max-age=1800\r\n' +
      'SERVER: Windows/10.0 UPnP/1.0 WinBox/1.0\r\n' +
      '\r\n';

    const buf = Buffer.from(notify, 'utf-8');
    this.ssdpSocket.send(buf, 0, buf.length, SSDP_PORT, SSDP_MULTICAST_ADDR, () => {});
  }

  private handleGenaSubscribe(pathname: string, req: IncomingMessage, res: ServerResponse): void {
    const sidHeader = req.headers.sid as string | undefined;
    const callbackHeader = req.headers.callback as string | undefined;
    const timeoutHeader = req.headers.timeout as string | undefined;

    // 1. 订阅续期 (Renewal)
    if (sidHeader) {
      const sub = this.subscriptions.get(sidHeader.trim());
      if (!sub) {
        res.writeHead(412, { 'Content-Type': 'text/plain' });
        res.end('Precondition Failed: Invalid SID');
        return;
      }
      const timeoutSec = parseTimeoutSeconds(timeoutHeader);
      clearTimeout(sub.timer);
      sub.timer = setTimeout(() => {
        this.subscriptions.delete(sub.sid);
      }, timeoutSec * 1000);
      res.writeHead(200, {
        SERVER: 'Windows/10.0 UPnP/1.0 WinBox/1.0',
        SID: sub.sid,
        TIMEOUT: `Second-${timeoutSec}`,
        'Content-Length': '0',
      });
      res.end();
      return;
    }

    // 2. 新订阅 (New Subscription)
    const callbackUrl = extractCallbackUrl(callbackHeader);
    if (!callbackUrl) {
      res.writeHead(412, { 'Content-Type': 'text/plain' });
      res.end('Precondition Failed: Missing or invalid CALLBACK header');
      return;
    }

    const serviceType = pathname.includes('rc_event') ? 'rc' : 'avt';
    const timeoutSec = parseTimeoutSeconds(timeoutHeader);
    const sid = `uuid:${randomUUID()}`;

    const timer = setTimeout(() => {
      this.subscriptions.delete(sid);
    }, timeoutSec * 1000);

    const subscription: GenaSubscription = {
      sid,
      serviceType,
      callbackUrl,
      seq: 0,
      timer,
    };
    this.subscriptions.set(sid, subscription);

    res.writeHead(200, {
      SERVER: 'Windows/10.0 UPnP/1.0 WinBox/1.0',
      SID: sid,
      TIMEOUT: `Second-${timeoutSec}`,
      'Content-Length': '0',
    });
    res.end();

    // 立即向手机推送初始事件 (SEQ 0)
    if (serviceType === 'avt') {
      const lastChange = buildGenaAvtLastChangeXml({
        transportState: this.transportState,
        currentUri: this.currentUri,
        duration: this.duration,
      });
      void this.dispatchGenaNotification(subscription, lastChange);
    } else {
      const lastChange = buildGenaRcLastChangeXml({
        volume: this.volume,
        mute: this.mute,
      });
      void this.dispatchGenaNotification(subscription, lastChange);
    }
  }

  private handleGenaUnsubscribe(_pathname: string, req: IncomingMessage, res: ServerResponse): void {
    const sidHeader = req.headers.sid as string | undefined;
    if (!sidHeader) {
      res.writeHead(412, { 'Content-Type': 'text/plain' });
      res.end('Precondition Failed: Missing SID');
      return;
    }
    const sub = this.subscriptions.get(sidHeader.trim());
    if (!sub) {
      res.writeHead(412, { 'Content-Type': 'text/plain' });
      res.end('Precondition Failed: Invalid SID');
      return;
    }
    clearTimeout(sub.timer);
    this.subscriptions.delete(sub.sid);
    res.writeHead(200, {
      SERVER: 'Windows/10.0 UPnP/1.0 WinBox/1.0',
      'Content-Length': '0',
    });
    res.end();
  }

  private async dispatchGenaNotification(sub: GenaSubscription, lastChangeXml: string): Promise<void> {
    try {
      const u = new URL(sub.callbackUrl);
      const isHttps = u.protocol === 'https:';
      const client = isHttps ? https : http;
      const body = buildGenaEventEnvelopeXml(lastChangeXml);
      const seq = sub.seq;
      sub.seq = (sub.seq + 1) >>> 0;

      await new Promise<void>((resolve, reject) => {
        const req = client.request(
          u,
          {
            method: 'NOTIFY',
            headers: {
              HOST: u.host,
              'CONTENT-TYPE': 'text/xml; charset="utf-8"',
              NT: 'upnp:event',
              NTS: 'upnp:propchange',
              SID: sub.sid,
              SEQ: String(seq),
              'CONTENT-LENGTH': Buffer.byteLength(body, 'utf-8'),
              'USER-AGENT': 'Windows/10.0 UPnP/1.0 WinBox/1.0',
            },
            timeout: 4000,
          },
          (res) => {
            res.resume();
            resolve();
          }
        );
        req.on('timeout', () => {
          req.destroy(new Error('GENA NOTIFY timed out'));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });
    } catch (err) {
      this.logger.w(`[DLNA DMR] GENA 事件通知发送失败 (${sub.callbackUrl}): ${err}`);
    }
  }

  private notifyAvtSubscribers(): void {
    if (this.subscriptions.size === 0) return;
    const lastChange = buildGenaAvtLastChangeXml({
      transportState: this.transportState,
      currentUri: this.currentUri,
      duration: this.duration,
    });
    for (const sub of this.subscriptions.values()) {
      if (sub.serviceType === 'avt') {
        void this.dispatchGenaNotification(sub, lastChange);
      }
    }
  }

  private notifyRcSubscribers(): void {
    if (this.subscriptions.size === 0) return;
    const lastChange = buildGenaRcLastChangeXml({
      volume: this.volume,
      mute: this.mute,
    });
    for (const sub of this.subscriptions.values()) {
      if (sub.serviceType === 'rc') {
        void this.dispatchGenaNotification(sub, lastChange);
      }
    }
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    for (const sub of this.subscriptions.values()) {
      clearTimeout(sub.timer);
    }
    this.subscriptions.clear();

    if (this.ssdpSocket) {
      try {
        const notifyBye =
          'NOTIFY * HTTP/1.1\r\n' +
          `HOST: ${SSDP_MULTICAST_ADDR}:${SSDP_PORT}\r\n` +
          `NT: ${DMR_DEVICE_TYPE}\r\n` +
          'NTS: ssdp:byebye\r\n' +
          `USN: uuid:${this.uuid}::${DMR_DEVICE_TYPE}\r\n` +
          '\r\n';
        const buf = Buffer.from(notifyBye, 'utf-8');
        this.ssdpSocket.send(buf, 0, buf.length, SSDP_PORT, SSDP_MULTICAST_ADDR, () => {
          try { this.ssdpSocket?.close(); } catch { /* ignore */ }
          this.ssdpSocket = undefined;
        });
      } catch {
        try { this.ssdpSocket.close(); } catch { /* ignore */ }
        this.ssdpSocket = undefined;
      }
    }
  }
}
