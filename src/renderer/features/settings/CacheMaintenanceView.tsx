import type { DataDirInfo } from '../../../shared/types';

type CacheMaintenanceViewProps = {
  active: boolean;
  busy: boolean;
  refreshing: boolean;
  dataDir: DataDirInfo | null;
  feedback: { text: string; kind: 'ok' | 'err' } | null;
  onClearCache(): void;
  onRefreshUsage(): void;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unitIndex);
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function CacheMaintenanceView({ active, busy, refreshing, dataDir, feedback, onClearCache, onRefreshUsage }: CacheMaintenanceViewProps) {
  if (!active) return null;

  const usage = dataDir?.storageUsage;
  const usageRows = usage ? [
    ['保留用户数据（本操作不清理）', usage.retainedDataBytes],
    ['Chromium 缓存（本操作会清理）', usage.browserCacheBytes],
    ['Spider 转换缓存（本操作会清理）', usage.spiderCacheBytes],
    ['应用私有缓存与运行时（Python、Native、更新包；本操作保留）', usage.otherAppCacheBytes],
    ['媒体播放器运行时（MPV、FFmpeg；本操作保留）', usage.mediaRuntimeBytes],
  ] as const : [];

  return (
    <div className="card" id="cfg-cache" style={{ padding: 12, marginBottom: 16 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted" style={{ fontWeight: 600 }}>本地存储与缓存</span>
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        占用统计只读取文件大小，不读取文件内容。此操作仅清空 Chromium 缓存和 Spider 转换缓存；设置、订阅、账号、观看记录、插件、应用运行时及 MPV/FFmpeg 均会保留。
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button disabled={busy || refreshing} onClick={onRefreshUsage}>
          {refreshing ? '读取中…' : '刷新占用'}
        </button>
        <button className="primary" disabled={busy || refreshing} onClick={onClearCache}>
          {busy ? '正在清理…' : '清理可重建缓存'}
        </button>
      </div>
      {feedback && <div className="muted" style={{ fontSize: 12, marginTop: 4, color: feedback.kind === 'ok' ? 'var(--text-success)' : 'var(--text-warn)' }} aria-live="polite">{feedback.text}</div>}
      {dataDir && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8, display: 'grid', gap: 4 }}>
          <div>
            当前数据目录：{' '}
            <code style={{ color: 'var(--text-primary)', userSelect: 'text', overflowWrap: 'anywhere' }}>{dataDir.path}</code>
            {dataDir.mode === 'activated' && dataDir.migration?.cleanedLegacy ? '（已迁移，旧目录已清理）' : ''}
            {dataDir.mode === 'activated' && !dataDir.migration?.cleanedLegacy ? '（安装目录/data）' : ''}
            {dataDir.mode === 'fallback' ? `（回退使用：${dataDir.reason || '计划目录不可用'}）` : ''}
            {dataDir.mode === 'dev' ? '（开发态：系统默认位置）' : ''}
          </div>
          {dataDir.planned && dataDir.planned !== dataDir.path && (
            <div>
              计划安装目录：{' '}
              <code style={{ color: 'var(--text-primary)', userSelect: 'text', overflowWrap: 'anywhere' }}>{dataDir.planned}</code>
            </div>
          )}
        </div>
      )}
      {usage && (
        <section aria-label="本地存储占用" style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle, #555)' }}>
            <strong>数据目录总占用{usage.complete ? '' : '（至少）'}</strong>
            <strong>{formatBytes(usage.totalBytes)}</strong>
          </div>
          <dl style={{ margin: 0 }}>
            {usageRows.map(([label, bytes]) => (
              <div key={label} className="row" style={{ justifyContent: 'space-between', gap: 16, padding: '5px 0' }}>
                <dt className="muted" style={{ fontSize: 12 }}>{label}</dt>
                <dd style={{ margin: 0, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{formatBytes(bytes)}</dd>
              </div>
            ))}
          </dl>
          {!usage.complete && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>部分文件不可访问或扫描达到安全上限；显示值为下限，可稍后刷新。</div>}
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>分类互不重叠，合计为总占用；未跟随符号链接。</div>
        </section>
      )}
    </div>
  );
}
