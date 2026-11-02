import { describe, expect, it } from 'vitest';
import { driveCredentialStatus } from '../src/renderer/features/driveBinding/application/driveCredentialStatus';

describe('driveCredentialStatus', () => {
  it('does not infer service health from a locally saved credential', () => {
    expect(driveCredentialStatus(true)).toMatchObject({ kind: 'saved-unverified', label: '已保存 · 未验证' });
    expect(driveCredentialStatus(false, { state: 'valid', checkedAt: 1 })).toMatchObject({ kind: 'missing', label: '未设置' });
  });

  it('exposes a timestamped valid or rejected server response without overclaiming', () => {
    expect(driveCredentialStatus(true, { state: 'valid', checkedAt: 1 })).toMatchObject({ kind: 'valid', checkedAt: 1 });
    expect(driveCredentialStatus(true, { state: 'invalid', checkedAt: 2 })).toMatchObject({
      kind: 'invalid',
      label: '服务端拒绝凭据',
      explanation: expect.stringContaining('不代表该来源中的所有影片都失效'),
      checkedAt: 2,
    });
  });

  it('keeps unsupported and network failure states distinct from invalid credentials', () => {
    expect(driveCredentialStatus(true, { state: 'unknown', checkedAt: 3 })).toMatchObject({
      kind: 'unknown', explanation: expect.stringContaining('凭据可能仍有效'),
    });
    expect(driveCredentialStatus(true, { state: 'unsupported' })).toMatchObject({ kind: 'unsupported', label: '在线状态未知' });
  });
});
