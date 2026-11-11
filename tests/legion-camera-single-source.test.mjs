// 相机参数「单一来源」契约（2026-11-11）
//
// 事故：page.tsx 与 relax-dept-angles.ts 各写一份相机参数，
//      390 实际按 pitch 1.02 渲染，优化器却按 0.85 求最优 —— 为「另一个相机」优化。
//
// 本测试做三件事，缺一不可：
//   ① 两处都必须调用同一个导出 buildLegionCamera（import 是必要条件）
//   ② 正则前先剥注释：注释里解释「为什么不再用内联公式」不该被判红
//      （今天已经两次被注释里的旧文本骗过：text-gray 残留、label-overlap 旧公式）
//   ③ 数值契约：直接跑 lib 的实现，钉住两个视口的 pitch/dist/focal
//      —— 只断言「都 import 了」不能排除「其中一处又包了一层同名函数」
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const rootPath = fileURLToPath(root);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

// 与 scripts/check-color-ratchet.mjs 同语义：去块注释与整行 // 注释，保留行内 //（可能是 URL）
function stripComments(text) {
  const withoutBlocks = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlocks
    .split('\n')
    .filter((line) => {
      const s = line.trim();
      return !(s.startsWith('//') || s.startsWith('*'));
    })
    .join('\n');
}

const lib = read('app/lib/legion-3d.ts');
const page = stripComments(read('app/legion/3d/page.tsx'));
const relax = stripComments(read('app/legion/3d/relax-dept-angles.ts'));

// ① 单一来源存在，且是导出
assert.match(lib, /export function buildLegionCamera\(/, 'lib 必须提供 buildLegionCamera');
assert.match(lib, /export const LEGION_PITCH_NARROW/, 'lib 必须提供窄屏俯角常量');
assert.match(lib, /export const LEGION_VIEW_DEFAULT/, 'lib 必须提供默认视角常量');

// ② 两处都调用它，且不再内联公式（只看代码行，不看注释）
assert.match(page, /buildLegionCamera\(/, 'page.tsx 必须调用 buildLegionCamera');
assert.doesNotMatch(
  page,
  /focal:\s*\(?\s*Math\.min\(size\.width/,
  'page.tsx 的代码里不得再内联 focal 公式（注释不算：本断言已在剥注释后的源码上运行）',
);
assert.match(relax, /buildLegionCamera\(/, 'relax 必须调用 buildLegionCamera');
assert.doesNotMatch(relax, /const PITCH = 0\.85/, 'relax 的代码里不得再自带 PITCH 常量');
assert.match(relax, /LEGION_PITCH_NARROW/, 'relax 必须按视口使用窄屏俯角');
assert.match(relax, /lookDepth: 2/, '桌面视口必须显式给出 LOOK_DEPTH');
assert.match(relax, /lookDepth: 1/, '窄屏视口必须显式给出 LOOK_DEPTH');

// ③ 数值契约：直接执行 lib 的实现（Node 22 的 type stripping），钉住两个视口的相机
const probe = `
import { buildLegionCamera, LEGION_VIEW_DEFAULT, LEGION_PITCH_NARROW } from ${JSON.stringify(
  new URL('app/lib/legion-3d.ts', root).href,
)};
const wide = buildLegionCamera({ ...LEGION_VIEW_DEFAULT, yaw: 0.62 }, { width: 1440, height: 1000 }, 2);
const narrow = buildLegionCamera({ ...LEGION_VIEW_DEFAULT, yaw: 0.62, pitch: LEGION_PITCH_NARROW }, { width: 390, height: 844 }, 1);
console.log(JSON.stringify({
  wide: { pitch: wide.pitch, dist: wide.dist, focal: wide.focal },
  narrow: { pitch: narrow.pitch, dist: narrow.dist, focal: narrow.focal },
}));
`;

const run = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', probe], {
  cwd: rootPath,
  encoding: 'utf8',
});
assert.equal(run.status, 0, `无法执行 lib 的相机实现：${(run.stderr || '').slice(0, 300)}`);
const got = JSON.parse(run.stdout.trim().split('\n').pop());

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}：期望 ${b}，实际 ${a}`);
// 桌面：dist 4.9/2 = 2.45；focal 1000×1.73×1.12/2 = 968.8
near(got.wide.pitch, 0.85, '桌面俯角');
near(got.wide.dist, 2.45, '桌面相机距离');
near(got.wide.focal, 968.8, '桌面焦距');
// 窄屏：dist 4.9/1 = 4.9；focal 390×2.4×1.12/1 = 1048.32
near(got.narrow.pitch, 1.02, '窄屏俯角（必须与页面渲染一致）');
near(got.narrow.dist, 4.9, '窄屏相机距离');
near(got.narrow.focal, 1048.32, '窄屏焦距');


// 层高（tierBoost）也必须同源：渲染端用 LOOK_TIER，排布优化必须收到同一个值。
// 2026-11-11（§94）：relax 原来用默认 tierBoost=1，而渲染端是 1.3，
// 等于「为不存在的几何求最优」。这条断言防第三次分叉。
const relaxSrc = read('app/legion/3d/relax-dept-angles.ts');
assert.match(relaxSrc, /relaxDepartmentAngles<T extends LegionNode>\(nodes: T\[\], tierBoost = 1\)/, 'relax 必须接受 tierBoost 参数');
assert.match(relaxSrc, /nodeToVec3\([^)]*tierBoost\)/, 'relax 的投影必须使用传入的 tierBoost');
assert.match(page, /relaxDepartmentAngles\(built\.nodes, LOOK_TIER\)/, 'page 必须把 LOOK_TIER 传给 relax（tierBoost 同源）');


// 减动效一致性（2026-11-11，设计师指出）：所有 ?intro* 变体在 prefers-reduced-motion 下
// 都不得产生动画。已有入场（.456）有 reduce 门；intro2 曾漏掉，这条锁死。
const pageSrc2 = stripComments(read('app/legion/3d/page.tsx'));
assert.match(pageSrc2, /function reduceMotionNow\(\)/, '必须提供 reduceMotionNow 统一判定');
assert.match(pageSrc2, /INTRO2 && !reduceMotionNow\(\)/, 'intro2 的进度计算必须先过 reduce 判定');
assert.match(pageSrc2, /intro2Reduced/, '必须导出减动效状态以便断言');
