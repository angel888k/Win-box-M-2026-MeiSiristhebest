import type { DriveCredentialProbeResult } from '../../../../shared/driveCredential';

export type DriveCredentialStatus =
  | { kind: 'missing'; label: '未设置'; explanation: string }
  | { kind: 'saved-unverified'; label: '已保存 · 未验证'; explanation: string }
  | { kind: 'valid'; label: '服务端确认有效'; explanation: string; checkedAt: number }
  | { kind: 'invalid'; label: '服务端拒绝凭据'; explanation: string; checkedAt: number }
  | { kind: 'unknown'; label: '状态未知'; explanation: string; checkedAt: number }
  | { kind: 'unsupported'; label: '在线状态未知'; explanation: string };

/** Local storage proves only that a credential exists; online validity needs an explicit provider response. */
export function driveCredentialStatus(isSaved: boolean, probe?: DriveCredentialProbeResult | null): DriveCredentialStatus {
  if (!isSaved || probe?.state === 'missing') {
    return { kind: 'missing', label: '未设置', explanation: '当前本机没有保存该网盘的登录凭据。' };
  }
  if (!probe) {
    return {
      kind: 'saved-unverified',
      label: '已保存 · 未验证',
      explanation: '凭据已保存在本机，但尚未确认服务端仍接受该登录状态。',
    };
  }

  switch (probe.state) {
    case 'valid':
      return { kind: 'valid', label: '服务端确认有效', explanation: '服务端检查刚刚接受了这份凭据；实际播放仍取决于当前线路和资源权限。', checkedAt: probe.checkedAt };
    case 'invalid':
      return { kind: 'invalid', label: '服务端拒绝凭据', explanation: '检查接口拒绝了当前登录状态。重新登录后再试；这不代表该来源中的所有影片都失效。', checkedAt: probe.checkedAt };
    case 'unknown':
      return { kind: 'unknown', label: '状态未知', explanation: '网络错误或服务端响应异常，无法确认登录状态；凭据可能仍有效。', checkedAt: probe.checkedAt };
    case 'unsupported':
      return { kind: 'unsupported', label: '在线状态未知', explanation: '已保存凭据，但该网盘尚无可靠的通用在线检查接口。实际可用性需在使用时由服务端响应确认。' };
  }
}
