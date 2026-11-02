// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerRecoveryOverlay } from '../src/renderer/features/playback/PlayerRecoveryOverlay';
import { copyPlayerDiagnostic, createPlayerDiagnosticText, redactPlaybackDiagnosticMessage } from '../src/renderer/features/playback/application/playerDiagnostic';
import { createPlayerDiagnosticRecord } from '../src/renderer/features/playback/application/playerDiagnosticHistory';
import type { PlayerClipboardPort } from '../src/renderer/features/playback/application/playerClipboard';

afterEach(cleanup);

describe('player failure diagnostics', () => {
  it('classifies HTTP access failures and removes URLs and credentials from copied text', () => {
    const text = createPlayerDiagnosticText({
      title: '目标影片',
      sourceName: '备用源',
      message: 'HLS 请求失败 HTTP 403 https://media.example/stream.m3u8?token=secret',
    });

    expect(text).toContain('故障阶段：访问权限');
    expect(text).toContain('HTTP：403');
    expect(text).toContain('媒体：目标影片');
    expect(text).toContain('来源：备用源');
    expect(text).not.toContain('media.example');
    expect(text).not.toContain('secret');
  });

  it('does not invent a diagnosis when the error does not identify a failure stage', () => {
    const text = createPlayerDiagnosticText({ message: '未知错误' });

    expect(text).toContain('故障阶段：暂无法确认');
    expect(text).toContain('播放器未能确认失败阶段');
    expect(text).toContain('内核：未报告');
  });

  it('redacts credential headers before rendering diagnostic details', () => {
    expect(redactPlaybackDiagnosticMessage('Cookie: a=secret; b=other')).toBe('Cookie=[已隐藏]');
    expect(redactPlaybackDiagnosticMessage('Authorization: Bearer secret')).toBe('Authorization=[已隐藏]');
  });

  it('shows structured failure context without exposing untrusted codes or URLs', () => {
    render(
      <PlayerRecoveryOverlay
        fallback={{ kind: 'idle' }}
        parseError="HLS failed https://media.example/live.m3u8?token=secret"
        failure={{ stage: 'network', engine: 'hls.js', httpStatus: 503, code: 'frag-load-error', retryable: true }}
        canRetryCurrent={false}
        canSearchAgain={false}
        canGoPrevious={false}
        canGoNext={false}
        showEpisodeNavigation={false}
        onSelectAlternative={() => undefined}
        onRetryCurrent={() => undefined}
        onSearchAgain={() => undefined}
        onPreviousEpisode={() => undefined}
        onNextEpisode={() => undefined}
      />,
    );

    fireEvent.click(screen.getByText('查看播放诊断'));
    expect(screen.getByText('hls.js')).toBeTruthy();
    expect(screen.getByText('503')).toBeTruthy();
    expect(screen.getByText('frag-load-error')).toBeTruthy();
    expect(screen.getByText('是')).toBeTruthy();
    expect(screen.queryByText(/media\.example|token=secret/)).toBeNull();
  });

  it('copies a redacted summary and reports clipboard failure without throwing', async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    const clipboard: PlayerClipboardPort = { writeText };
    await expect(copyPlayerDiagnostic({
      message: 'HTTP 404 https://media.example/expired?auth=secret',
    }, clipboard)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain('故障阶段：媒体地址');
    expect(writeText.mock.calls[0][0]).not.toContain('secret');

    const unavailable: PlayerClipboardPort = { writeText: vi.fn(async (_text: string) => { throw new Error('clipboard unavailable'); }) };
    await expect(copyPlayerDiagnostic({ message: '失败' }, unavailable)).resolves.toBe(false);
  });

  it('keeps diagnosis and copy feedback inside the recovery overlay', async () => {
    const onCopyDiagnostic = vi.fn(async () => true);
    render(
      <PlayerRecoveryOverlay
        fallback={{ kind: 'unavailable', message: 'HTTP 403 https://media.example/play?token=secret' }}
        parseError=""
        canRetryCurrent={false}
        canSearchAgain={false}
        canGoPrevious={false}
        canGoNext={false}
        showEpisodeNavigation={false}
        onSelectAlternative={() => undefined}
        onRetryCurrent={() => undefined}
        onSearchAgain={() => undefined}
        onPreviousEpisode={() => undefined}
        onNextEpisode={() => undefined}
        onCopyDiagnostic={onCopyDiagnostic}
      />,
    );

    fireEvent.click(screen.getByText('查看播放诊断'));
    expect(screen.getByText('故障阶段：访问权限')).toBeTruthy();
    expect(screen.queryByText(/media\\.example|token=secret/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '复制诊断摘要' }));
    expect(await screen.findByRole('button', { name: '已复制诊断摘要' })).toBeTruthy();
    expect(onCopyDiagnostic).toHaveBeenCalledWith(
      expect.stringContaining('链接已隐藏'),
      expect.objectContaining({ stage: 'authorization', httpStatus: 403 }),
    );
  });

  it('shows local history in the diagnostic panel and allows clearing it', () => {
    const onClearDiagnosticHistory = vi.fn();
    render(
      <PlayerRecoveryOverlay
        fallback={{ kind: 'unavailable', message: 'HTTP 503 network timeout' }}
        parseError=""
        failure={{ stage: 'network', engine: 'hls.js', httpStatus: 503, retryable: true }}
        canRetryCurrent={false}
        canSearchAgain={false}
        canGoPrevious={false}
        canGoNext={false}
        showEpisodeNavigation={false}
        onSelectAlternative={() => undefined}
        onRetryCurrent={() => undefined}
        onSearchAgain={() => undefined}
        onPreviousEpisode={() => undefined}
        onNextEpisode={() => undefined}
        diagnosticHistory={[createPlayerDiagnosticRecord({
          title: '旧影片',
          sourceName: '旧来源',
          message: 'HTTP 404 旧链接失效',
          failure: { stage: 'missing-media', engine: 'html5', httpStatus: 404, retryable: false },
        }, 1_700_000_000_000)]}
        onClearDiagnosticHistory={onClearDiagnosticHistory}
      />,
    );

    fireEvent.click(screen.getByText('查看播放诊断'));
    expect(screen.getByRole('region', { name: '最近播放故障记录' })).toBeTruthy();
    expect(screen.getByText('旧影片')).toBeTruthy();
    expect(screen.getByText('旧来源 · 媒体地址')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除记录' }));
    expect(onClearDiagnosticHistory).toHaveBeenCalledOnce();
  });
});
