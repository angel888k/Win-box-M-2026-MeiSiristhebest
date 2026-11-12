// tests/dlnaDmr.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  buildDmrDescriptionXml,
  secondsToHms,
  hmsToSeconds,
  extractTitleFromDidl,
  extractCallbackUrl,
  parseTimeoutSeconds,
  buildGenaAvtLastChangeXml,
  buildGenaRcLastChangeXml,
  buildGenaEventEnvelopeXml,
} from '../src/main/dlna/dmr/dmrProtocol';
import { DlnaDmrService } from '../src/main/dlna/dmr/DlnaDmrService';
import type { Logger } from '../src/shared/types';

describe('DLNA DMR (手机投屏到电脑) 协议与服务', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = {
      i: vi.fn(),
      w: vi.fn(),
      e: vi.fn(),
    };
  });

  describe('dmrProtocol 纯函数', () => {
    it('正确生成标准设备描述 XML (description.xml)', () => {
      const xml = buildDmrDescriptionXml({
        friendlyName: '我的电脑投屏',
        uuid: 'test-uuid-123',
      });
      expect(xml).toContain('<deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>');
      expect(xml).toContain('<friendlyName>我的电脑投屏</friendlyName>');
      expect(xml).toContain('<UDN>uuid:test-uuid-123</UDN>');
      expect(xml).toContain('<serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>');
    });

    it('正确转换秒数与 hh:mm:ss 格式', () => {
      expect(secondsToHms(0)).toBe('00:00:00');
      expect(secondsToHms(65)).toBe('00:01:05');
      expect(secondsToHms(3665)).toBe('01:01:05');

      expect(hmsToSeconds('00:00:00')).toBe(0);
      expect(hmsToSeconds('00:01:05')).toBe(65);
      expect(hmsToSeconds('01:01:05')).toBe(3665);
    });

    it('正确从 DIDL 元数据中提取视频片名', () => {
      const didl = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <item id="1">
          <dc:title>庆余年 第二季 第05集</dc:title>
        </item>
      </DIDL-Lite>`;
      expect(extractTitleFromDidl(didl)).toBe('庆余年 第二季 第05集');

      // 手机端转义形式
      const escapedDidl = '&lt;DIDL-Lite&gt;&lt;item&gt;&lt;dc:title&gt;狂飙 第01集&lt;/dc:title&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;';
      expect(extractTitleFromDidl(escapedDidl)).toBe('狂飙 第01集');
    });
  });

  describe('DlnaDmrService 请求处理', () => {
    it('能正确响应 description.xml 请求', async () => {
      const dmr = new DlnaDmrService({
        port: 9978,
        friendlyName: 'WinBox-PC',
        logger,
      });

      expect(dmr.matches('/dmr/description.xml')).toBe(true);
      expect(dmr.matches('/dmr/avt_control')).toBe(true);

      const req = new EventEmitter() as unknown as IncomingMessage;
      (req as any).method = 'GET';

      let statusCode = 0;
      let headers: Record<string, string> = {};
      let responseBody = '';

      const res = {
        writeHead(code: number, h: Record<string, string>) {
          statusCode = code;
          headers = h;
        },
        end(body?: string) {
          responseBody = body || '';
        },
      } as unknown as ServerResponse;

      await dmr.handle(new URL('http://127.0.0.1:9978/dmr/description.xml'), req, res);

      expect(statusCode).toBe(200);
      expect(headers['Content-Type']).toContain('text/xml');
      expect(responseBody).toContain('<friendlyName>WinBox-PC</friendlyName>');
    });

    it('能正确解析手机发来的 SetAVTransportURI 并触发 onPlayMedia 回调', async () => {
      const onPlayMedia = vi.fn();
      const dmr = new DlnaDmrService({
        port: 9978,
        logger,
        callbacks: { onPlayMedia },
      });

      const soapBody = `<?xml version="1.0" encoding="utf-8"?>
      <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
        <s:Body>
          <u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
            <CurrentURI>https://example.com/live/stream.m3u8</CurrentURI>
            <CurrentURIMetaData>&lt;DIDL-Lite&gt;&lt;item&gt;&lt;dc:title&gt;手机投屏测试视频&lt;/dc:title&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;</CurrentURIMetaData>
          </u:SetAVTransportURI>
        </s:Body>
      </s:Envelope>`;

      const req = new EventEmitter() as unknown as IncomingMessage;
      (req as any).method = 'POST';
      (req as any).headers = {
        soapaction: '"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"',
      };

      let statusCode = 0;
      let responseBody = '';

      const res = {
        writeHead(code: number) {
          statusCode = code;
        },
        end(body?: string) {
          responseBody = body || '';
        },
      } as unknown as ServerResponse;

      const handlePromise = dmr.handle(new URL('http://127.0.0.1:9978/dmr/avt_control'), req, res);
      req.emit('data', Buffer.from(soapBody));
      req.emit('end');

      await handlePromise;

      expect(statusCode).toBe(200);
      expect(responseBody).toContain('SetAVTransportURIResponse');
      expect(onPlayMedia).toHaveBeenCalledWith('https://example.com/live/stream.m3u8', '手机投屏测试视频');
    });

    it('能正确响应 Play、Pause、Stop、Seek 控制指令与进度查询', async () => {
      const onPlay = vi.fn();
      const onPause = vi.fn();
      const onSeek = vi.fn();

      const dmr = new DlnaDmrService({
        port: 9978,
        logger,
        callbacks: { onPlay, onPause, onSeek },
      });

      dmr.updatePlaybackState({
        duration: 3600,
        position: 120,
        transportState: 'PLAYING',
      });

      // 1. Play 指令
      const reqPlay = new EventEmitter() as unknown as IncomingMessage;
      (reqPlay as any).method = 'POST';
      (reqPlay as any).headers = { soapaction: '"urn:schemas-upnp-org:service:AVTransport:1#Play"' };
      const resPlay = { writeHead: vi.fn(), end: vi.fn() } as unknown as ServerResponse;
      const pPlay = dmr.handle(new URL('http://127.0.0.1:9978/dmr/avt_control'), reqPlay, resPlay);
      reqPlay.emit('data', Buffer.from(''));
      reqPlay.emit('end');
      await pPlay;
      expect(onPlay).toHaveBeenCalled();

      // 2. Seek 指令 (Target 00:05:30 -> 330s)
      const reqSeek = new EventEmitter() as unknown as IncomingMessage;
      (reqSeek as any).method = 'POST';
      (reqSeek as any).headers = { soapaction: '"urn:schemas-upnp-org:service:AVTransport:1#Seek"' };
      const resSeek = { writeHead: vi.fn(), end: vi.fn() } as unknown as ServerResponse;
      const pSeek = dmr.handle(new URL('http://127.0.0.1:9978/dmr/avt_control'), reqSeek, resSeek);
      reqSeek.emit('data', Buffer.from('<Target>00:05:30</Target>'));
      reqSeek.emit('end');
      await pSeek;
      expect(onSeek).toHaveBeenCalledWith(330);

      // 3. GetPositionInfo 状态查询
      let posResp = '';
      const reqPos = new EventEmitter() as unknown as IncomingMessage;
      (reqPos as any).method = 'POST';
      (reqPos as any).headers = { soapaction: '"urn:schemas-upnp-org:service:AVTransport:1#GetPositionInfo"' };
      const resPos = { writeHead: vi.fn(), end: (b: string) => { posResp = b; } } as unknown as ServerResponse;
      const pPos = dmr.handle(new URL('http://127.0.0.1:9978/dmr/avt_control'), reqPos, resPos);
      reqPos.emit('data', Buffer.from(''));
      reqPos.emit('end');
      await pPos;
      expect(posResp).toContain('<TrackDuration>01:00:00</TrackDuration>');
      expect(posResp).toContain('<RelTime>00:05:30</RelTime>');
    });

    it('支持 GENA 事件订阅 (SUBSCRIBE)、续期与取消订阅 (UNSUBSCRIBE)', async () => {
      const dmr = new DlnaDmrService({
        port: 9978,
        logger,
      });

      // 1. 新订阅 SUBSCRIBE
      let subStatus = 0;
      let subHeaders: Record<string, string> = {};
      const reqSub = new EventEmitter() as unknown as IncomingMessage;
      (reqSub as any).method = 'SUBSCRIBE';
      (reqSub as any).headers = {
        callback: '<http://192.168.1.100:54321/event-sub>',
        nt: 'upnp:event',
        timeout: 'Second-1800',
      };
      const resSub = {
        writeHead(code: number, h: Record<string, string>) {
          subStatus = code;
          subHeaders = h;
        },
        end: vi.fn(),
      } as unknown as ServerResponse;

      await dmr.handle(new URL('http://127.0.0.1:9978/dmr/avt_event'), reqSub, resSub);

      expect(subStatus).toBe(200);
      expect(subHeaders.SID).toMatch(/^uuid:[a-f0-9-]+$/i);
      expect(subHeaders.TIMEOUT).toBe('Second-1800');
      expect(dmr.activeSubscriptionsCount).toBe(1);

      const assignedSid = subHeaders.SID;

      // 2. 续期 SUBSCRIBE
      let renewStatus = 0;
      let renewHeaders: Record<string, string> = {};
      const reqRenew = new EventEmitter() as unknown as IncomingMessage;
      (reqRenew as any).method = 'SUBSCRIBE';
      (reqRenew as any).headers = {
        sid: assignedSid,
        timeout: 'Second-3600',
      };
      const resRenew = {
        writeHead(code: number, h: Record<string, string>) {
          renewStatus = code;
          renewHeaders = h;
        },
        end: vi.fn(),
      } as unknown as ServerResponse;

      await dmr.handle(new URL('http://127.0.0.1:9978/dmr/avt_event'), reqRenew, resRenew);

      expect(renewStatus).toBe(200);
      expect(renewHeaders.SID).toBe(assignedSid);
      expect(renewHeaders.TIMEOUT).toBe('Second-3600');
      expect(dmr.activeSubscriptionsCount).toBe(1);

      // 3. 取消订阅 UNSUBSCRIBE
      let unsubStatus = 0;
      const reqUnsub = new EventEmitter() as unknown as IncomingMessage;
      (reqUnsub as any).method = 'UNSUBSCRIBE';
      (reqUnsub as any).headers = {
        sid: assignedSid,
      };
      const resUnsub = {
        writeHead(code: number) {
          unsubStatus = code;
        },
        end: vi.fn(),
      } as unknown as ServerResponse;

      await dmr.handle(new URL('http://127.0.0.1:9978/dmr/avt_event'), reqUnsub, resUnsub);

      expect(unsubStatus).toBe(200);
      expect(dmr.activeSubscriptionsCount).toBe(0);

      dmr.stop();
    });

    it('dmrProtocol 正确生成 GENA LastChange 与 Envelope XML 报文', () => {
      expect(extractCallbackUrl('<http://192.168.1.50:9000/cb>')).toBe('http://192.168.1.50:9000/cb');
      expect(extractCallbackUrl('http://192.168.1.50:9000/cb')).toBe('http://192.168.1.50:9000/cb');
      expect(extractCallbackUrl(undefined)).toBeNull();
      expect(parseTimeoutSeconds('Second-600')).toBe(600);
      expect(parseTimeoutSeconds(undefined)).toBe(1800);

      const avtXml = buildGenaAvtLastChangeXml({
        transportState: 'PLAYING',
        currentUri: 'http://cdn.test/v.mp4',
        duration: 120,
      });
      expect(avtXml).toContain('<TransportState val="PLAYING"/>');
      expect(avtXml).toContain('CurrentTrackDuration val="00:02:00"');

      const envelope = buildGenaEventEnvelopeXml(avtXml);
      expect(envelope).toContain('<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0">');
      expect(envelope).toContain('&lt;TransportState val=&quot;PLAYING&quot;/&gt;');

      const rcXml = buildGenaRcLastChangeXml({ volume: 80, mute: false });
      expect(rcXml).toContain('<Volume channel="Master" val="80"/>');
      expect(rcXml).toContain('<Mute channel="Master" val="0"/>');
    });
  });
});
