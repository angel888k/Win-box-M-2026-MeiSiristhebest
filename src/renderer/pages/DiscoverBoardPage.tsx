import PosterSizeControl from '../components/PosterSizeControl';
import { usePosterSizePreference } from '../features/display/adapters/posterSizePreferenceAdapter';
import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { boardSourceName, discoverBoardById } from '../../shared/discoverBoards';
import { useDiscoverBoard } from '../features/discovery/useDiscoverBoard';
import { discoverBoardAdapter } from '../features/discovery/adapters/discoveryAdapters';
import { useBoardPageCapacity } from '../features/discovery/useBoardPageCapacity';
import DiscoverItemCard, { discoverCoverItem } from '../components/DiscoverItemCard';
import { Icon } from '../components/ui/Icon';
import { useCovers } from '../features/covers/useCovers';
import { useTheme } from '../features/theme/adapters/useThemeStore';
import { usePageActive } from '../lib/keepAlive';
import { discoverPresentationView } from '../lib/presentationRegistry';
import { discoverDetailRoute } from '../../shared/discoverDetail';
import type { DiscoverItem } from '../../shared/types';
import '../features/discovery/boards.css';

export default function DiscoverBoardPage() {
  const { boardId = '' } = useParams();
  const active = usePageActive();
  const [params, setParams] = useSearchParams();
  const contentRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  const capacity = useBoardPageCapacity(contentRef);
  const { data, loading, error, errorPhase, loadMore, refresh, retry } = useDiscoverBoard(boardId, discoverBoardAdapter, capacity);
  const board = data?.board || discoverBoardById(boardId);
  const navigate = useNavigate();
  const theme = useTheme();
  const posterSize = usePosterSizePreference();
  const view = discoverPresentationView(theme);
  const covers = useCovers((data?.items || []).map(discoverCoverItem), active, true);
  const source = board ? boardSourceName(board) : '来源';
  useEffect(() => {
    if (!active || (!params.has('page') && !params.has('perPage'))) return;
    const next = new URLSearchParams(params); next.delete('page'); next.delete('perPage');
    setParams(next, { replace: true });
  }, [active, params, setParams]);
  useEffect(() => {
    if (!active || loading || error || !data?.hasMore || !tailRef.current || !contentRef.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadMore();
    }, { root: contentRef.current, rootMargin: '0px 0px 400px 0px' });
    observer.observe(tailRef.current);
    return () => observer.disconnect();
  }, [active, loading, error, data?.hasMore, data?.items.length, loadMore]);
  const openItem = (item: DiscoverItem) => { navigate(discoverDetailRoute(item)); };
  return <div className="content board-content" ref={contentRef}>
    <nav className="board-breadcrumbs" aria-label="当前位置"><Link to="/boards"><Icon name="left" size={12} />榜单</Link></nav>
    <header className="page-heading board-heading"><div><h1>{board?.title || (error ? '榜单不可用' : '内容列表')}</h1></div>
      <div className="board-actions"><PosterSizeControl size={posterSize.size} onChange={posterSize.changeSize} /><button className="gallery-icon-button" type="button" aria-label="刷新榜单" title="刷新榜单" disabled={loading} onClick={() => { covers.refresh(); refresh(); }}><Icon name="refresh" size={16} /></button>
        {board?.externalUrl && <a className="board-text-link" href={board.externalUrl} target="_blank" rel="noreferrer">原站<Icon name="globe" size={15} /></a>}
      </div>
    </header>
    <div className="board-list-toolbar"><div className="board-summary" aria-live="polite">
      <span className="board-source">{source}</span>
      {data?.total != null ? <span>{data.total} 部</span> : data?.items.length ? <span>{data.items.length} 部</span> : null}
    </div></div>
    {error && (!data || errorPhase === 'refresh') && <div className="board-error" role="alert"><p>{error}</p><button type="button" disabled={loading} onClick={retry}>重试</button></div>}
    <section aria-label="榜单影片" aria-busy={loading}>
      {loading && !data ? <output className="empty"><span className="spinner" aria-hidden="true" />正在加载…</output>
        : data?.items.length ? <div className="grid board-items">{data.items.map((item, index) => <DiscoverItemCard key={String(item.doubanId || item.tmdbId || item.title) + '-' + index}
          it={item} poster={covers.picOf(discoverCoverItem(item))} onError={url => covers.onError(discoverCoverItem(item), url)} onOpen={() => openItem(item)} card={view.card} ratingLabel={source + '评分'} />)}</div>
          : !error && !loading ? <div className="empty"><h2>暂无内容</h2><button type="button" onClick={refresh}>重新加载</button></div> : null}
    </section>
    {data && data.items.length > 0 && <div className="board-feed-tail" ref={tailRef}>
      {loading ? <output className="board-feed-status" aria-live="polite"><span className="spinner" aria-hidden="true" />正在加载…</output>
        : error && errorPhase !== 'refresh' ? <div className="board-feed-error" role="alert"><span>{error}</span><button type="button" onClick={retry}>重试</button></div>
          : data.hasMore ? <button type="button" onClick={loadMore}>加载更多</button>
            : <output className="board-feed-status">已显示全部 {data.items.length} 部</output>}
    </div>}
  </div>;
}
