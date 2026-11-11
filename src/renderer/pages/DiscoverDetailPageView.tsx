import type { MetaExtra, MetaHit } from '../../shared/types';
import BackButton from '../components/BackButton';
import { MovieSourcesPanel } from '../features/detail/MovieSourcesPanel';

interface DiscoverDetailPageViewProps {
  title: string;
  year: string;
  type: string;
  rating: string;
  fallbackPoster: string;
  meta: MetaHit | null;
  extra: MetaExtra | null;
  loading: boolean;
  error: string;
}

export function DiscoverDetailPageView(props: DiscoverDetailPageViewProps) {
  const poster = props.meta?.poster || props.fallbackPoster;
  return <div className="content movie-detail-content">
    <BackButton fallback="/" />
    <section className="movie-overview" aria-label="影片资料">
      {poster && <img className="movie-overview-poster" src={poster} alt={props.title} />}
      <div><h1>{props.title || '影片详情'}</h1><p className="muted">{props.year} {props.type === 'tv' ? '剧集' : '电影'}{props.rating ? ` · 评分 ${props.rating}` : ''}</p>
        {props.extra?.genres.length ? <p>{props.extra.genres.join(' · ')}</p> : null}
        {props.extra?.directors.length ? <p>导演：{props.extra.directors.join('、')}</p> : null}
        {props.extra?.cast.length ? <p>主演：{props.extra.cast.slice(0, 12).map(person => person.name).join('、')}</p> : null}
        {props.extra?.watchProviders?.length ? (
          <div className="movie-watch-providers" aria-label="正版流媒体播出平台">
            <span className="muted">播出平台：</span>
            {props.extra.watchProviders.map((wp) => (
              <span key={wp.id} className="watch-provider-chip" title={wp.name}>
                {wp.logo && <img src={wp.logo} alt="" className="watch-provider-logo" />}
                <span>{wp.name}</span>
              </span>
            ))}
          </div>
        ) : null}
        <p className="movie-overview-text">{props.meta?.overview || (props.loading ? '加载中…' : '暂无简介')}</p>
      </div>
    </section>
    <MovieSourcesPanel key={props.title} title={props.title} poster={poster} />
  </div>;
}
