import {
  classifyPlaybackFailure,
  playbackFailureStageLabel,
  playbackFailureSummary,
  playbackFailureNextStep,
  type PlaybackFailureContext,
  type PlaybackFailureEngine,
} from '../../../../shared/playbackFailure';
import type { PlayerClipboardPort } from './playerClipboard';

export interface PlayerDiagnosticInput {
  message: string;
  title?: string;
  sourceName?: string;
  engine?: PlaybackFailureEngine;
  failure?: PlaybackFailureContext;
}

/** Remove complete URLs and common credential fields before showing or copying diagnostics. */
export function redactPlaybackDiagnosticMessage(value: string): string {
  return String(value || '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[链接已隐藏]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [已隐藏]')
    .replace(/\b(authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]*/gi, '$1=[已隐藏]')
    .replace(/\b(token|sign|auth|key|password|passwd|secret|session)=([^\s&;,]+)/gi, '$1=[已隐藏]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 500);
}

function safeLabel(value: string | undefined): string {
  return redactPlaybackDiagnosticMessage(value || '').slice(0, 120) || '未提供';
}

export function createPlayerDiagnosticText(input: PlayerDiagnosticInput): string {
  const classified = classifyPlaybackFailure({
    engine: input.engine || 'unknown',
    reason: input.message,
  });
  const failure = input.failure ?? classified;
  const message = redactPlaybackDiagnosticMessage(input.message);

  return [
    'Win-Box 播放诊断',
    `媒体：${safeLabel(input.title)}`,
    `来源：${safeLabel(input.sourceName)}`,
    `故障阶段：${playbackFailureStageLabel(failure.stage)}`,
    `初步判断：${playbackFailureSummary(failure)}`,
    `建议操作：${playbackFailureNextStep(failure)}`,
    `内核：${failure.engine === 'unknown' ? '未报告' : failure.engine}`,
    `HTTP：${failure.httpStatus ?? '未报告'}`,
    `错误码：${failure.code || '未报告'}`,
    `可重试：${failure.retryable ? '是' : '未确认'}`,
    `错误摘要：${message || '未提供'}`,
  ].join('\n');
}

/** Copy a per-failure diagnostic without exposing media URLs or request credentials. */
export async function copyPlayerDiagnostic(
  input: PlayerDiagnosticInput,
  clipboard: PlayerClipboardPort,
): Promise<boolean> {
  try {
    await clipboard.writeText(createPlayerDiagnosticText(input));
    return true;
  } catch {
    return false;
  }
}
