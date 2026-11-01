/**
 * 演示模式（部门巡礼）每步停留多久。
 *
 * 之前是固定 3600ms，与实际内容无关：4 人的部门空等，40 人的部门还没看清
 * 就被切走。这里按部门规模给时长——人数是主项，Agent 只算半个权重（它们
 * 在环上更小、更容易扫完），上下限防止一边倒。
 *
 * 纯函数、无 React：页面只管在渲染循环里调用。
 */

export const TOUR_STEP_MIN_MS = 2600;
export const TOUR_STEP_MAX_MS = 6000;
const PER_NODE_MS = 220;

export function tourStepMs(memberCount: number, agentCount: number): number {
  const members = Number.isFinite(memberCount) ? Math.max(0, memberCount) : 0;
  const agents = Number.isFinite(agentCount) ? Math.max(0, agentCount) : 0;
  const weight = members + agents * 0.5;
  const raw = TOUR_STEP_MIN_MS + weight * PER_NODE_MS;
  return Math.round(Math.min(TOUR_STEP_MAX_MS, Math.max(TOUR_STEP_MIN_MS, raw)));
}
