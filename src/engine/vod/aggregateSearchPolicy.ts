/** Aggregate search fan-out and latency policy. */
export const SEARCH_ALL_WORKERS = 16;
export const SEARCH_ALL_WORKERS_MAX = 48;
// Keep many profiles moving together while source calls remain capped globally at 48.
// This avoids long profile-sized waves in large subscriptions without unbounded I/O.
export const SEARCH_ALL_PROFILE_WORKERS = 12;
export const SEARCH_ALL_BUDGET_MS = 40_000;
export const SEARCH_ALL_SOURCE_MAX_MS = 10_000;
export const SEARCH_ALL_JS_MAX_MS = 5_000;
export const SEARCH_ALL_QUICK_MS = 3_000;
export const UNSUPPORTED_SEARCH_CODES = new Set(['TYPE_UNSUPPORTED', 'JS_FORMAT_UNSUPPORTED', 'JS_BYTECODE']);
