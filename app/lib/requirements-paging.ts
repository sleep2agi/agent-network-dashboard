/**
 * Requirements board paging state — #1636.
 *
 * Why this is a module and not three `useState`s inline: the board has two
 * different loads that must not share one flag.
 *
 *   替换（replace）—— 换筛选、刷新：整块列表可以进骨架屏。
 *   追加（append）—— 点「加载更多」：**已加载的行必须留在屏幕上**。
 *
 * 旧实现两条路径共用一个 `loading`，于是点「加载更多」时整张表瞬间被 8 行
 * 骨架屏替换（`rows_during_loadmore: 0`），追加慢一点就像列表被清空重来。
 * 把状态迁移收到这里，行为可以被真正断言（requirements-paging.test.mjs），
 * 而不是只在源码里做字符串检查。
 */

export type PagingPhase = 'replace' | 'append';

export interface RequirementsPagingState<T> {
  rows: T[];
  cursor: string | null;
  hasMore: boolean;
  /** 替换态加载中 —— 列表可以让位给骨架屏。 */
  loading: boolean;
  /** 追加态加载中 —— 列表必须留在原地，只有「加载更多」按钮变忙。 */
  loadingMore: boolean;
  error: string;
  needsLogin: boolean;
}

export type RequirementsPagingAction<T> =
  | { type: 'start'; phase: PagingPhase }
  | { type: 'loaded'; phase: PagingPhase; incoming: T[]; nextCursor: string | null; hasMore: boolean }
  | { type: 'failed'; phase: PagingPhase; error: string }
  | { type: 'unauthorized'; phase: PagingPhase };

export function initialPagingState<T>(): RequirementsPagingState<T> {
  return { rows: [], cursor: null, hasMore: false, loading: true, loadingMore: false, error: '', needsLogin: false };
}

export function requirementsPaging<T>(
  state: RequirementsPagingState<T>,
  action: RequirementsPagingAction<T>,
): RequirementsPagingState<T> {
  switch (action.type) {
    case 'start':
      // 追加请求已经在飞：忽略重复点击，避免同一页被拼两次。
      if (action.phase === 'append' && state.loadingMore) return state;
      return action.phase === 'append'
        ? { ...state, loadingMore: true, error: '', needsLogin: false, loading: false }
        : { ...state, loading: true, error: '', needsLogin: false, loadingMore: false };

    case 'loaded':
      return action.phase === 'append'
        ? {
            ...state,
            rows: [...state.rows, ...action.incoming],
            cursor: action.nextCursor,
            hasMore: action.hasMore,
            loading: false,
            loadingMore: false,
            error: '',
            needsLogin: false,
          }
        : {
            ...state,
            rows: action.incoming,
            cursor: action.nextCursor,
            hasMore: action.hasMore,
            loading: false,
            loadingMore: false,
            error: '',
            needsLogin: false,
          };

    // 追加失败不动已加载的行：重试只重试当前页，用户看到的内容不作废。
    case 'failed':
      return action.phase === 'append'
        ? { ...state, loadingMore: false, error: action.error }
        : { ...state, rows: [], loading: false, loadingMore: false, hasMore: false, error: action.error };

    case 'unauthorized':
      return action.phase === 'append'
        ? { ...state, loadingMore: false, needsLogin: true }
        : { ...state, rows: [], loading: false, loadingMore: false, hasMore: false, needsLogin: true };

    default:
      return state;
  }
}
