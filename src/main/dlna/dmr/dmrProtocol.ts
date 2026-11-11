// src/main/dlna/dmr/dmrProtocol.ts — DLNA DMR (Digital Media Renderer) 协议纯函数
import { networkInterfaces } from 'node:os';

export const DMR_DEVICE_TYPE = 'urn:schemas-upnp-org:device:MediaRenderer:1';
export const AV_TRANSPORT_SERVICE = 'urn:schemas-upnp-org:service:AVTransport:1';
export const RENDERING_CONTROL_SERVICE = 'urn:schemas-upnp-org:service:RenderingControl:1';
export const CONNECTION_MANAGER_SERVICE = 'urn:schemas-upnp-org:service:ConnectionManager:1';

/** 格式化秒数为 hh:mm:ss 形式（DLNA 规范） */
export function secondsToHms(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

/** 解析 hh:mm:ss 或 hh:mm:ss.ms 为秒数 */
export function hmsToSeconds(hms: string): number {
  if (!hms || typeof hms !== 'string') return 0;
  const parts = hms.trim().split(':');
  if (parts.length === 3) {
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const s = parseFloat(parts[2]) || 0;
    return h * 3600 + m * 60 + s;
  }
  return parseFloat(hms) || 0;
}

/** 获取本机的优先局域网 IPv4 地址 */
export function getLocalIpAddress(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    const netList = nets[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal && net.address) {
        // 优先 192.168.x.x / 10.x.x.x / 172.16~31.x.x
        if (
          net.address.startsWith('192.168.') ||
          net.address.startsWith('10.') ||
          /^172\.(1[6-9]|2\d|3[0-1])\./.test(net.address)
        ) {
          return net.address;
        }
      }
    }
  }
  // 兜底返回第一个非内部 IPv4
  for (const name of Object.keys(nets)) {
    const netList = nets[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal && net.address) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

/** 生成设备描述文件 (description.xml) */
export function buildDmrDescriptionXml(options: {
  friendlyName: string;
  uuid: string;
}): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <device>
    <deviceType>${DMR_DEVICE_TYPE}</deviceType>
    <friendlyName>${escapeXml(options.friendlyName)}</friendlyName>
    <manufacturer>Win-Box</manufacturer>
    <manufacturerURL>https://github.com/win-box</manufacturerURL>
    <modelDescription>Win-Box DLNA Digital Media Renderer</modelDescription>
    <modelName>Win-Box DMR</modelName>
    <modelNumber>1.0</modelNumber>
    <modelURL>https://github.com/win-box</modelURL>
    <UDN>uuid:${options.uuid}</UDN>
    <serviceList>
      <service>
        <serviceType>${AV_TRANSPORT_SERVICE}</serviceType>
        <serviceId>urn:upnp-org:serviceId:AVTransport</serviceId>
        <SCPDURL>/dmr/avt_scpd.xml</SCPDURL>
        <controlURL>/dmr/avt_control</controlURL>
        <eventSubURL>/dmr/avt_event</eventSubURL>
      </service>
      <service>
        <serviceType>${RENDERING_CONTROL_SERVICE}</serviceType>
        <serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId>
        <SCPDURL>/dmr/rc_scpd.xml</SCPDURL>
        <controlURL>/dmr/rc_control</controlURL>
        <eventSubURL>/dmr/rc_event</eventSubURL>
      </service>
      <service>
        <serviceType>${CONNECTION_MANAGER_SERVICE}</serviceType>
        <serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId>
        <SCPDURL>/dmr/cm_scpd.xml</SCPDURL>
        <controlURL>/dmr/cm_control</controlURL>
        <eventSubURL>/dmr/cm_event</eventSubURL>
      </service>
    </serviceList>
  </device>
</root>`;
}

export const AVT_SCPD_XML = `<?xml version="1.0" encoding="utf-8"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList>
    <action><name>SetAVTransportURI</name></action>
    <action><name>Play</name></action>
    <action><name>Pause</name></action>
    <action><name>Stop</name></action>
    <action><name>Seek</name></action>
    <action><name>GetTransportInfo</name></action>
    <action><name>GetPositionInfo</name></action>
    <action><name>GetMediaInfo</name></action>
    <action><name>GetDeviceCapabilities</name></action>
  </actionList>
  <serviceStateTable>
    <stateVariable sendEvents="yes"><name>LastChange</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>TransportState</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>CurrentTrackURI</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>RelTime</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>TrackDuration</name><dataType>string</dataType></stateVariable>
  </serviceStateTable>
</scpd>`;

export const RC_SCPD_XML = `<?xml version="1.0" encoding="utf-8"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList>
    <action><name>GetVolume</name></action>
    <action><name>SetVolume</name></action>
    <action><name>GetMute</name></action>
    <action><name>SetMute</name></action>
  </actionList>
  <serviceStateTable>
    <stateVariable sendEvents="yes"><name>LastChange</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>Volume</name><dataType>ui2</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>Mute</name><dataType>boolean</dataType></stateVariable>
  </serviceStateTable>
</scpd>`;

export const CM_SCPD_XML = `<?xml version="1.0" encoding="utf-8"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList>
    <action><name>GetProtocolInfo</name></action>
    <action><name>GetCurrentConnectionIDs</name></action>
    <action><name>GetCurrentConnectionInfo</name></action>
  </actionList>
  <serviceStateTable>
    <stateVariable sendEvents="no"><name>SourceProtocolInfo</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>SinkProtocolInfo</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>CurrentConnectionIDs</name><dataType>string</dataType></stateVariable>
  </serviceStateTable>
</scpd>`;

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 从 XML 文本中提取某个标签的内部内容（宽容解析，兼容手机端各种转义） */
export function extractTagValue(xml: string, tagName: string): string {
  const match = xml.match(new RegExp(`<[a-zA-Z0-9_:]*${tagName}[^>]*>([\\s\\S]*?)<\\/[a-zA-Z0-9_:]*${tagName}>`, 'i'));
  if (!match || !match[1]) return '';
  return unescapeXml(match[1].trim());
}

export function unescapeXml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 从 CurrentURIMetaData (DIDL-Lite) 提取视频标题 */
export function extractTitleFromDidl(didl: string): string {
  if (!didl) return '';
  // 可能是嵌套转义的 XML
  let text = didl;
  if (text.includes('&lt;') || text.includes('&gt;')) {
    text = unescapeXml(text);
  }
  const title = extractTagValue(text, 'title');
  return title || '';
}

/** 包装 SOAP Response */
export function wrapSoapResponse(actionName: string, serviceType: string, innerXml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${actionName}Response xmlns:u="${serviceType}">
      ${innerXml}
    </u:${actionName}Response>
  </s:Body>
</s:Envelope>`;
}

/** 从 GENA CALLBACK 请求头解析出有效的 HTTP URL */
export function extractCallbackUrl(header: string | undefined): string | null {
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/<(https?:\/\/[^>]+)>/i);
  if (match && match[1]) return match[1].trim();
  if (/^https?:\/\//i.test(header.trim())) return header.trim();
  return null;
}

/** 从 GENA TIMEOUT 请求头解析订阅超时秒数（默认 1800s） */
export function parseTimeoutSeconds(header: string | undefined): number {
  if (!header || typeof header !== 'string') return 1800;
  const match = header.match(/Second-(\d+)/i);
  if (match && match[1]) {
    const val = parseInt(match[1], 10);
    if (Number.isFinite(val) && val > 0) return Math.min(val, 86400);
  }
  return 1800;
}

/** 构建 AVTransport 服务的 LastChange XML */
export function buildGenaAvtLastChangeXml(state: {
  transportState: string;
  currentUri?: string;
  duration?: number;
}): string {
  const dur = secondsToHms(state.duration || 0);
  const uri = escapeXml(state.currentUri || '');
  return `<Event xmlns="urn:schemas-upnp-org:metadata-1-0/AVT/"><InstanceID val="0"><TransportState val="${state.transportState}"/><TransportStatus val="OK"/><CurrentPlayMode val="NORMAL"/><CurrentTrack val="1"/><NumberOfTracks val="1"/><CurrentTrackURI val="${uri}"/><CurrentTrackDuration val="${dur}"/><CurrentMediaDuration val="${dur}"/><AVTransportURI val="${uri}"/></InstanceID></Event>`;
}

/** 构建 RenderingControl 服务的 LastChange XML */
export function buildGenaRcLastChangeXml(state: {
  volume: number;
  mute: boolean;
}): string {
  return `<Event xmlns="urn:schemas-upnp-org:metadata-1-0/RCS/"><InstanceID val="0"><Volume channel="Master" val="${state.volume}"/><Mute channel="Master" val="${state.mute ? '1' : '0'}"/></InstanceID></Event>`;
}

/** 构建 GENA 事件通知的 propertyset XML 封套 */
export function buildGenaEventEnvelopeXml(lastChangeXml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0">
  <e:property>
    <LastChange>${escapeXml(lastChangeXml)}</LastChange>
  </e:property>
</e:propertyset>`;
}
