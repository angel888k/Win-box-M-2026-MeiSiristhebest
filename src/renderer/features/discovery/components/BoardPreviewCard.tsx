import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DiscoverItem } from '../../../../shared/types';
import { BOARD_CATEGORIES, boardSourceName, getBoardBrandBadge, type DiscoverBoard } from '../../../../shared/discoverBoards';
import type { DiscoverBoardPreviewPort } from '../application/discoveryPorts';
import { useCovers } from '../../covers/useCovers';
import { discoverCoverItem } from '../../../components/DiscoverItemCard';
import { Icon } from '../../../components/ui/Icon';

export interface BoardPreview { items: DiscoverItem[]; stale?: boolean; total?: number | null }

export default function BoardPreviewCard({ board, seed, active, previewPort }: { board: DiscoverBoard; seed?: BoardPreview; active: boolean; previewPort: DiscoverBoardPreviewPort }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ data?: BoardPreview; error?: string }>({});
  useEffect(() => {
    if (!active || visible || !ref.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '160px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [active, visible]);
  useEffect(() => {
    if (!active || !visible) return;
    let cancelled = false;
    void previewPort.loadPreview(board.id)
      .then(data => { if (!cancelled) setResult({ data }); })
      .catch(() => { if (!cancelled) setResult({ error: '预览暂不可用' }); });
    return () => { cancelled = true; };
  }, [active, visible, board.id, previewPort]);
  const preview = result.data || seed;
  const items = preview?.items.slice(0, 3) || [];
  const first = items[0];
  const cover = first ? discoverCoverItem(first) : undefined;
  const covers = useCovers(cover ? [cover] : [], active && visible, true);
  const poster = cover ? covers.picOf(cover) : '';
  const category = BOARD_CATEGORIES.find(option => option.id === board.category)?.label;
  const badge = getBoardBrandBadge(board.id, board.provider);
  return <Link ref={ref} className="board-preview-card" to={'/boards/' + encodeURIComponent(board.id)} aria-label={board.title}>
    <div className="board-preview-heading">
      <div>
        <div className="board-preview-title-row">
          <h3>{board.title}</h3>
          {badge && (
            <span
              className="board-brand-pill"
              style={{ color: badge.color, backgroundColor: badge.bg, borderColor: `${badge.color}33` }}
            >
              {badge.label}
            </span>
          )}
        </div>
        <span className="board-preview-source">{category || boardSourceName(board)}{preview?.total != null ? ` · ${preview.total} 部` : ''}</span>
      </div>
      <Icon name="right" size={15} />
    </div>
    <div className="board-preview-body" aria-busy={!preview && !result.error}>
      <div className="board-preview-cover">{poster && cover ? <img src={poster} alt="" loading="lazy" decoding="async" onError={event => covers.onError(cover, event.currentTarget.getAttribute('src') || '')} /> : <span>{preview || result.error ? '暂无封面' : ''}</span>}</div>
      {items.length > 0 ? <ol className="board-preview-list" aria-label="榜单预览">{items.map((item, index) => <li key={String(item.doubanId || item.tmdbId || item.title) + '-' + index}><span className="board-preview-number" aria-hidden="true">{index + 1}</span><span className="board-preview-name" title={item.title}>{item.title}</span>{item.rating ? <span className="board-preview-rating" aria-label={item.rating.toFixed(1) + ' 分'}>{item.rating.toFixed(1)}</span> : null}</li>)}</ol>
        : result.error || preview ? <span className="board-preview-unavailable">{result.error || '暂无数据'}</span>
          : <span className="board-preview-skeleton" aria-label="正在读取榜单预览"><i /><i /><i /></span>}
    </div>
  </Link>;
}
