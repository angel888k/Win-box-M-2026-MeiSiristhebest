import {
  classifyPlaybackFailure,
  type PlaybackFailureContext,
  type PlaybackFailureEngine,
  type PlaybackFailureStage,
} from '../../../../shared/playbackFailure';
import type { PlayerDiagnosticInput } from './playerDiagnostic';
import { redactPlaybackDiagnosticMessage } from './playerDiagnostic';

export interface PlayerDiagnosticRecord {
  recordedAt: number;
  title: string;
  sourceName: string;
  message: string;
  failure: PlaybackFailureContext;
}

export interface PlayerDiagnosticHistoryPort {
  read(): readonly PlayerDiagnosticRecord[];
  write(records: readonly PlayerDiagnosticRecord[]): void;
  clear(): void;
}

export const PLAYER_DIAGNOSTIC_HISTORY_LIMIT = 50;
const DUPLICATE_WINDOW_MS = 15_000;
const engines = new Set<PlaybackFailureEngine>(['html5', 'hls.js', 'mpegts.js', 'mpv', 'external', 'unknown']);
const stages = new Set<PlaybackFailureStage>(['startup', 'authorization', 'missing-media', 'network', 'demux', 'decode', 'engine', 'unknown']);

function safeLabel(value: string | undefined): string {
  return redactPlaybackDiagnosticMessage(value || '').slice(0, 120) || '未提供';
}

function safeFailure(value: unknown): PlaybackFailureContext | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<PlaybackFailureContext>;
  if (!stages.has(candidate.stage as PlaybackFailureStage) || !engines.has(candidate.engine as PlaybackFailureEngine)) return null;
  const httpStatus = Number.isInteger(candidate.httpStatus) && candidate.httpStatus! >= 100 && candidate.httpStatus! <= 599
    ? candidate.httpStatus
    : undefined;
  const code = typeof candidate.code === 'string' && /^[a-z0-9_.:-]{1,48}$/i.test(candidate.code)
    ? candidate.code
    : undefined;
  return {
    stage: candidate.stage as PlaybackFailureStage,
    engine: candidate.engine as PlaybackFailureEngine,
    ...(httpStatus == null ? {} : { httpStatus }),
    ...(code ? { code } : {}),
    retryable: candidate.retryable === true,
  };
}

export function normalizePlayerDiagnosticHistory(value: unknown): PlayerDiagnosticRecord[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, PLAYER_DIAGNOSTIC_HISTORY_LIMIT).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Partial<PlayerDiagnosticRecord>;
    const failure = safeFailure(row.failure);
    if (!failure || !Number.isFinite(row.recordedAt) || Math.abs(row.recordedAt!) > 8_640_000_000_000_000 || typeof row.message !== 'string') return [];
    return [{
      recordedAt: Math.max(0, Math.floor(row.recordedAt!)),
      title: safeLabel(row.title),
      sourceName: safeLabel(row.sourceName),
      message: redactPlaybackDiagnosticMessage(row.message),
      failure,
    }];
  });
}

export function createPlayerDiagnosticRecord(input: PlayerDiagnosticInput, recordedAt = Date.now()): PlayerDiagnosticRecord {
  const classified = classifyPlaybackFailure({
    engine: input.engine || 'unknown',
    reason: input.message,
  });
  return {
    recordedAt: Math.max(0, Math.floor(Number.isFinite(recordedAt) && Math.abs(recordedAt) <= 8_640_000_000_000_000 ? recordedAt : Date.now())),
    title: safeLabel(input.title),
    sourceName: safeLabel(input.sourceName),
    message: redactPlaybackDiagnosticMessage(input.message),
    failure: safeFailure(input.failure ?? classified) || classified,
  };
}

function sameFailure(left: PlayerDiagnosticRecord, right: PlayerDiagnosticRecord): boolean {
  return left.title === right.title
    && left.sourceName === right.sourceName
    && left.message === right.message
    && left.failure.stage === right.failure.stage
    && left.failure.engine === right.failure.engine
    && left.failure.httpStatus === right.failure.httpStatus
    && left.failure.code === right.failure.code;
}

/** Keep retries from flooding the local history while preserving later recurrences. */
export function appendPlayerDiagnosticRecord(
  history: readonly PlayerDiagnosticRecord[],
  record: PlayerDiagnosticRecord,
): PlayerDiagnosticRecord[] {
  const normalized = normalizePlayerDiagnosticHistory(history);
  const duplicate = normalized[0];
  if (duplicate && record.recordedAt >= duplicate.recordedAt
    && record.recordedAt - duplicate.recordedAt < DUPLICATE_WINDOW_MS
    && sameFailure(duplicate, record)) return normalized;
  return [record, ...normalized].slice(0, PLAYER_DIAGNOSTIC_HISTORY_LIMIT);
}

export function recordPlayerDiagnostic(
  input: PlayerDiagnosticInput,
  history: PlayerDiagnosticHistoryPort,
  recordedAt?: number,
): readonly PlayerDiagnosticRecord[] {
  try {
    const next = appendPlayerDiagnosticRecord(history.read(), createPlayerDiagnosticRecord(input, recordedAt));
    history.write(next);
    return next;
  } catch {
    return [];
  }
}

export function clearPlayerDiagnosticHistory(history: PlayerDiagnosticHistoryPort): void {
  try { history.clear(); } catch { /* Diagnostics storage is optional and must not affect playback. */ }
}
