import type { DiscoverItem, DiscoverSection } from './types';

export type DiscoverBoardCategory = 'movie' | 'tv' | 'variety' | 'animation' | 'documentary';
export const BOARD_CATEGORIES: ReadonlyArray<{ id: DiscoverBoardCategory; label: string }> = [
  { id: 'movie', label: '电影' }, { id: 'tv', label: '剧集' }, { id: 'variety', label: '综艺' },
  { id: 'animation', label: '动漫' }, { id: 'documentary', label: '纪录片' },
];

export interface BoardBrandBadge {
  id: string;
  label: string;
  color: string;
  bg: string;
}

export const BOARD_PLATFORMS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'all', label: '全部平台' },
  { id: 'douban', label: '豆瓣' },
  { id: 'imdb', label: 'IMDb' },
  { id: 'bangumi', label: 'Bangumi' },
  { id: 'netflix', label: 'Netflix' },
  { id: 'hbo', label: 'HBO Max' },
  { id: 'apple', label: 'Apple TV+' },
  { id: 'disney', label: 'Disney+' },
  { id: 'amazon', label: 'Prime Video' },
];

export function getBoardBrandBadge(boardId: string, provider: DiscoverBoard['provider']): BoardBrandBadge | null {
  if (boardId.startsWith('tv-netflix')) {
    return { id: 'netflix', label: 'Netflix', color: '#E50914', bg: 'rgba(229, 9, 20, 0.14)' };
  }
  if (boardId.startsWith('tv-hbo')) {
    return { id: 'hbo', label: 'HBO Max', color: '#9B6BFF', bg: 'rgba(107, 56, 251, 0.14)' };
  }
  if (boardId.startsWith('tv-apple')) {
    return { id: 'apple', label: 'Apple TV+', color: '#D4D4D8', bg: 'rgba(162, 170, 173, 0.16)' };
  }
  if (boardId.startsWith('tv-disney')) {
    return { id: 'disney', label: 'Disney+', color: '#3B82F6', bg: 'rgba(17, 60, 207, 0.16)' };
  }
  if (boardId.startsWith('tv-amazon')) {
    return { id: 'amazon', label: 'Prime Video', color: '#00A8E1', bg: 'rgba(0, 168, 225, 0.14)' };
  }
  if (boardId.startsWith('imdb_')) {
    return { id: 'imdb', label: 'IMDb', color: '#F5C518', bg: 'rgba(245, 197, 24, 0.14)' };
  }
  if (boardId.startsWith('bangumi_')) {
    return { id: 'bangumi', label: 'Bangumi', color: '#F09199', bg: 'rgba(240, 145, 153, 0.14)' };
  }
  if (provider === 'douban') {
    return { id: 'douban', label: '豆瓣', color: '#22C55E', bg: 'rgba(34, 197, 94, 0.12)' };
  }
  if (provider === 'tmdb') {
    return { id: 'tmdb', label: 'TMDB', color: '#01B4E4', bg: 'rgba(1, 180, 228, 0.12)' };
  }
  return null;
}
export interface DiscoverBoard {
  id: string;
  title: string;
  provider: 'douban' | 'tmdb' | 'bangumi' | 'plugin' | 'imdb';
  description: string;
  externalUrl?: string;
  mediaType?: 'movie' | 'tv';
  category?: DiscoverBoardCategory;
}

export function pluginSectionToBoard(section: Pick<DiscoverSection, 'id' | 'browseId' | 'title' | 'mediaType'>): DiscoverBoard {
  const mediaType = section.mediaType === 'tv' ? 'tv' : 'movie';
  return {
    id: section.browseId || section.id,
    title: section.title,
    provider: 'plugin',
    description: '插件提供的内容列表。',
    mediaType,
    category: mediaType,
  };
}

export const DOMESTIC_BOARDS: readonly DiscoverBoard[] = [
  {
    "id": "movie_hot_gaia",
    "title": "豆瓣热门电影",
    "provider": "douban",
    "mediaType": "movie",
    "category": "movie",
    "description": "按豆瓣当前热门顺序浏览电影。",
    "externalUrl": "https://m.douban.com/subject_collection/movie_hot_gaia"
  },
  {
    "id": "movie_showing",
    "title": "院线正在上映",
    "provider": "douban",
    "mediaType": "movie",
    "category": "movie",
    "description": "查看豆瓣收录的当前院线上映电影。",
    "externalUrl": "https://m.douban.com/subject_collection/movie_showing"
  },
  {
    "id": "movie_soon",
    "title": "院线即将上映",
    "provider": "douban",
    "mediaType": "movie",
    "category": "movie",
    "description": "查看豆瓣收录的院线待映电影。",
    "externalUrl": "https://m.douban.com/subject_collection/movie_soon"
  },
  {
    "id": "movie_weekly_best",
    "title": "一周口碑电影榜",
    "provider": "douban",
    "mediaType": "movie",
    "category": "movie",
    "description": "浏览豆瓣一周口碑电影榜。",
    "externalUrl": "https://m.douban.com/subject_collection/movie_weekly_best"
  },
  {
    "id": "movie_top250",
    "title": "豆瓣电影 Top250",
    "provider": "douban",
    "mediaType": "movie",
    "category": "movie",
    "description": "按原站排名浏览 Top250，查看评分并搜索片源。",
    "externalUrl": "https://movie.douban.com/top250"
  },
  {
    "id": "tv_hot",
    "title": "豆瓣热门剧集",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "按豆瓣当前热门顺序浏览剧集。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_hot"
  },
  {
    "id": "tv_domestic",
    "title": "近期热门国产剧",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "浏览豆瓣近期热门国产剧列表。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_domestic"
  },
  {
    "id": "tv_american",
    "title": "近期热门美剧",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "浏览豆瓣近期热门美剧列表。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_american"
  },
  {
    "id": "tv_korean",
    "title": "近期热门韩剧",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "浏览豆瓣近期热门韩剧列表。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_korean"
  },
  {
    "id": "tv_japanese",
    "title": "近期热门日剧",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "浏览豆瓣近期热门日剧列表。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_japanese"
  },
  {
    "id": "tv_chinese_best_weekly",
    "title": "华语剧集口碑榜",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "查看本周华语剧集口碑榜。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_chinese_best_weekly"
  },
  {
    "id": "tv_global_best_weekly",
    "title": "全球剧集口碑榜",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "查看本周全球剧集口碑榜。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_global_best_weekly"
  },
  {
    "id": "tv_variety_show",
    "title": "近期热门综艺",
    "provider": "douban",
    "mediaType": "tv",
    "category": "variety",
    "description": "浏览豆瓣近期热门综艺节目。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_variety_show"
  },
  {
    "id": "tv_animation",
    "title": "近期热门动漫",
    "provider": "douban",
    "mediaType": "tv",
    "category": "animation",
    "description": "浏览豆瓣近期热门动画剧集。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_animation"
  },
  {
    "id": "bangumi_calendar",
    "title": "新番放映表（每日放送）",
    "provider": "bangumi",
    "mediaType": "tv",
    "category": "animation",
    "description": "按星期浏览 Bangumi 番组计划今日与本周新番放送列表。",
    "externalUrl": "https://bgm.tv/calendar"
  },
  {
    "id": "tv_documentary",
    "title": "近期热门纪录片",
    "provider": "douban",
    "mediaType": "tv",
    "category": "documentary",
    "description": "浏览豆瓣近期热门纪录剧集。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_documentary"
  },
  {
    "id": "imdb_top250_movie",
    "title": "IMDb 电影 Top 250",
    "provider": "imdb",
    "mediaType": "movie",
    "category": "movie",
    "description": "全球影迷最权威的影史高分电影 Top 250 殿堂榜单。",
    "externalUrl": "https://www.imdb.com/chart/top/"
  },
  {
    "id": "imdb_top250_tv",
    "title": "IMDb 剧集 Top 250",
    "provider": "imdb",
    "mediaType": "tv",
    "category": "tv",
    "description": "全球影迷最权威的影史高分电视剧 Top 250 殿堂榜单。",
    "externalUrl": "https://www.imdb.com/chart/toptv/"
  },
  {
    "id": "movie_real_time_hotest",
    "title": "豆瓣电影实时热门",
    "provider": "douban",
    "mediaType": "movie",
    "category": "movie",
    "description": "按豆瓣实时热度浏览电影。",
    "externalUrl": "https://m.douban.com/subject_collection/movie_real_time_hotest"
  },
  {
    "id": "tv_real_time_hotest",
    "title": "豆瓣剧集实时热门",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "按豆瓣实时热度浏览剧集。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_real_time_hotest"
  },
  {
    "id": "tv_score_top",
    "title": "豆瓣高分经典神剧",
    "provider": "douban",
    "mediaType": "tv",
    "category": "tv",
    "description": "按豆瓣评分排序浏览殿堂级经典神剧。",
    "externalUrl": "https://m.douban.com/subject_collection/tv_score_top"
  },
  {
    "id": "movie_scifi",
    "title": "豆瓣热门科幻电影",
    "provider": "douban",
    "mediaType": "movie",
    "category": "movie",
    "description": "浏览豆瓣热门高分科幻题材电影。",
    "externalUrl": "https://m.douban.com/subject_collection/movie_scifi"
  },
  {
    "id": "movie_comedy",
    "title": "豆瓣热门喜剧电影",
    "provider": "douban",
    "mediaType": "movie",
    "category": "movie",
    "description": "浏览豆瓣热门幽默喜剧电影精选。",
    "externalUrl": "https://m.douban.com/subject_collection/movie_comedy"
  },
  {
    "id": "movie_action",
    "title": "豆瓣热门动作电影",
    "provider": "douban",
    "mediaType": "movie",
    "category": "movie",
    "description": "浏览豆瓣热门动作冒险电影精选。",
    "externalUrl": "https://m.douban.com/subject_collection/movie_action"
  },
  {
    "id": "movie_animation",
    "title": "豆瓣高分动画电影",
    "provider": "douban",
    "mediaType": "movie",
    "category": "animation",
    "description": "浏览豆瓣高口碑动画电影精选。",
    "externalUrl": "https://m.douban.com/subject_collection/movie_animation"
  }
];

export const TMDB_BOARDS: readonly DiscoverBoard[] = [
  {
    "id": "movie-popular",
    "title": "热门电影",
    "provider": "tmdb",
    "mediaType": "movie",
    "category": "movie",
    "description": "按 TMDB 热度浏览电影。",
    "externalUrl": "https://www.themoviedb.org/movie"
  },
  {
    "id": "movie-now-playing",
    "title": "院线正在上映",
    "provider": "tmdb",
    "mediaType": "movie",
    "category": "movie",
    "description": "浏览 TMDB 收录的当前院线上映电影。",
    "externalUrl": "https://www.themoviedb.org/movie/now-playing"
  },
  {
    "id": "movie-upcoming",
    "title": "即将上映",
    "provider": "tmdb",
    "mediaType": "movie",
    "category": "movie",
    "description": "浏览 TMDB 即将上映片单。",
    "externalUrl": "https://www.themoviedb.org/movie/upcoming"
  },
  {
    "id": "movie-top",
    "title": "高分电影",
    "provider": "tmdb",
    "mediaType": "movie",
    "category": "movie",
    "description": "按 TMDB 评分排序浏览电影。",
    "externalUrl": "https://www.themoviedb.org/movie/top-rated"
  },
  {
    "id": "tv-popular",
    "title": "热门剧集",
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": "按 TMDB 热度浏览剧集。",
    "externalUrl": "https://www.themoviedb.org/tv"
  },
  {
    "id": "tv-top",
    "title": "高分剧集",
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": "按 TMDB 评分排序浏览剧集。",
    "externalUrl": "https://www.themoviedb.org/tv/top-rated"
  },
  {
    "id": "tv-airing-today",
    "title": "今日播出剧集",
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": "查看 TMDB 收录的今日播出剧集。",
    "externalUrl": "https://www.themoviedb.org/tv/airing-today"
  },
  {
    "id": "tv-on-the-air",
    "title": "七日内播出剧集",
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": "查看 TMDB 收录的未来七日内播出剧集。",
    "externalUrl": "https://www.themoviedb.org/tv/on-the-air"
  },
  {
    "id": "tv-netflix",
    "title": "Netflix 高分神作",
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": "Netflix 出品与播出的高口碑经典神剧（如《怪奇物语》《黑镜》《后翼弃兵》等）。",
    "externalUrl": "https://www.themoviedb.org/network/213"
  },
  {
    "id": "tv-netflix-popular",
    "title": "Netflix 当下热门",
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": "Netflix 全球当前实时热度最高的剧集。",
    "externalUrl": "https://www.themoviedb.org/network/213"
  },
  {
    "id": "tv-hbo",
    "title": "HBO 传世美剧",
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": "HBO 出品的传世经典高分美剧（如《切尔诺贝利》《权力的游戏》《火线》《兄弟连》等）。",
    "externalUrl": "https://www.themoviedb.org/network/49"
  },
  {
    "id": "tv-apple",
    "title": "Apple TV+ 精品剧",
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": "Apple TV+ 打造的高口碑自制剧集（如《人生切割术》《足球教练》《羊毛战记》等）。",
    "externalUrl": "https://www.themoviedb.org/network/2552"
  },
  {
    "id": "tv-disney",
    "title": "Disney+ 漫威与星战宇宙",
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": "Disney+ 独播漫威、星战等热门系列剧集（如《洛基》《曼达洛人》《安多》等）。",
    "externalUrl": "https://www.themoviedb.org/network/2739"
  },
  {
    "id": "tv-amazon",
    "title": "Prime Video 热门大作",
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": "Amazon Prime Video 原创与独播高分剧集（如《黑袍纠察队》《辐射》《指环王》等）。",
    "externalUrl": "https://www.themoviedb.org/network/1024"
  },
  {
    "id": `movie-annual-${new Date().getFullYear()}`,
    "title": `${new Date().getFullYear()} 年度高分电影`,
    "provider": "tmdb",
    "mediaType": "movie",
    "category": "movie",
    "description": `${new Date().getFullYear()} 年上映的高口碑院线与流媒体电影精选盘点。`,
    "externalUrl": `https://www.themoviedb.org/discover/movie?primary_release_year=${new Date().getFullYear()}`
  },
  {
    "id": `tv-annual-${new Date().getFullYear()}`,
    "title": `${new Date().getFullYear()} 年度高分剧集`,
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": `${new Date().getFullYear()} 年开播的高口碑电视剧集精选盘点。`,
    "externalUrl": `https://www.themoviedb.org/discover/tv?first_air_date_year=${new Date().getFullYear()}`
  },
  {
    "id": `movie-annual-${new Date().getFullYear() - 1}`,
    "title": `${new Date().getFullYear() - 1} 年度高分电影`,
    "provider": "tmdb",
    "mediaType": "movie",
    "category": "movie",
    "description": `${new Date().getFullYear() - 1} 年上映的高口碑院线与流媒体电影精选盘点。`,
    "externalUrl": `https://www.themoviedb.org/discover/movie?primary_release_year=${new Date().getFullYear() - 1}`
  },
  {
    "id": `tv-annual-${new Date().getFullYear() - 1}`,
    "title": `${new Date().getFullYear() - 1} 年度高分剧集`,
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": `${new Date().getFullYear() - 1} 年开播的高口碑电视剧集精选盘点。`,
    "externalUrl": `https://www.themoviedb.org/discover/tv?first_air_date_year=${new Date().getFullYear() - 1}`
  },
  {
    "id": `movie-annual-${new Date().getFullYear() - 2}`,
    "title": `${new Date().getFullYear() - 2} 年度高分电影`,
    "provider": "tmdb",
    "mediaType": "movie",
    "category": "movie",
    "description": `${new Date().getFullYear() - 2} 年上映的高口碑院线与流媒体电影精选盘点。`,
    "externalUrl": `https://www.themoviedb.org/discover/movie?primary_release_year=${new Date().getFullYear() - 2}`
  },
  {
    "id": `tv-annual-${new Date().getFullYear() - 2}`,
    "title": `${new Date().getFullYear() - 2} 年度高分剧集`,
    "provider": "tmdb",
    "mediaType": "tv",
    "category": "tv",
    "description": `${new Date().getFullYear() - 2} 年开播的高口碑电视剧集精选盘点。`,
    "externalUrl": `https://www.themoviedb.org/discover/tv?first_air_date_year=${new Date().getFullYear() - 2}`
  },
  {
    "id": "movie-scifi-top",
    "title": "影史科幻神作精选",
    "provider": "tmdb",
    "mediaType": "movie",
    "category": "movie",
    "description": "高评分科幻经典电影合集（如《星际穿越》《盗梦空间》《黑客帝国》等）。",
    "externalUrl": "https://www.themoviedb.org/discover/movie?with_genres=878"
  },
  {
    "id": "movie-animation-top",
    "title": "高分动画电影合集",
    "provider": "tmdb",
    "mediaType": "movie",
    "category": "animation",
    "description": "高口碑经典动画电影合集（如吉卜力、皮克斯、新海诚等）。",
    "externalUrl": "https://www.themoviedb.org/discover/movie?with_genres=16"
  }
];

/** Keep the homepage summary small; additional lists are requested when opened. */
export const HOME_BOARD_IDS = ['movie_hot_gaia', 'movie_showing', 'movie_top250', 'tv_hot', 'tv_chinese_best_weekly'] as const;

export function discoverBoardById(id: string): DiscoverBoard | undefined {
  const direct = [...DOMESTIC_BOARDS, ...TMDB_BOARDS].find(board => board.id === id);
  if (direct) return direct;

  const movieAnnualMatch = id.match(/^movie-annual-(\d{4})$/);
  if (movieAnnualMatch) {
    const year = Number(movieAnnualMatch[1]);
    return {
      id,
      title: `${year} 年度高分电影`,
      provider: 'tmdb',
      mediaType: 'movie',
      category: 'movie',
      description: `${year} 年上映的高口碑院线与流媒体电影精选盘点。`,
      externalUrl: `https://www.themoviedb.org/discover/movie?primary_release_year=${year}`,
    };
  }

  const tvAnnualMatch = id.match(/^tv-annual-(\d{4})$/);
  if (tvAnnualMatch) {
    const year = Number(tvAnnualMatch[1]);
    return {
      id,
      title: `${year} 年度高分剧集`,
      provider: 'tmdb',
      mediaType: 'tv',
      category: 'tv',
      description: `${year} 年开播的高口碑电视剧集精选盘点。`,
      externalUrl: `https://www.themoviedb.org/discover/tv?first_air_date_year=${year}`,
    };
  }

  return undefined;
}

export function boardSourceName(board: DiscoverBoard): string {
  return board.provider === 'douban'
    ? '豆瓣'
    : board.provider === 'tmdb'
    ? 'TMDB'
    : board.provider === 'bangumi'
    ? 'Bangumi'
    : board.provider === 'imdb'
    ? 'IMDb'
    : '插件';
}

export const BOARD_PAGE_SIZE = 20;

export function normalizeBoardPage(value: unknown): number {
  const page = Number(value);
  return Number.isFinite(page) ? Math.max(1, Math.min(500, Math.floor(page))) : 1;
}

export interface DiscoverBoardPage {
  board: DiscoverBoard;
  items: DiscoverItem[];
  page: number;
  pageSize: number;
  /** 原站未提供总量时为 null。 */
  total: number | null;
  /** 仅限接口允许访问的页数；可能小于原站总量对应的页数。 */
  totalPages: number | null;
  hasMore: boolean;
  fetchedAt: number;
  stale: boolean;
  notice?: string;
}
