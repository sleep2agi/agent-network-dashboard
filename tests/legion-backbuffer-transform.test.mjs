// 背板尺寸与绘制变换必须同源（2026-11-11）
//
// 事故形态：applyResolution(scale) 把 canvas.width/height 缩到 scale，
// 但主绘制仍用 ctx.setTransform(dpr, 0, 0, dpr, 0, 0)。
// ⇒ 绘制坐标按满 dpr 展开，超出缩小后的背板 ⇒ 右侧/下侧被裁掉，
//    再由 CSS 把小块背板放大回容器 ⇒ 用户看到「拖一下画面就放大且缺一块」。
//
// 触发面：不只是新开关，**存量**的「超大网络交互期降档」（>250 节点，RES_LOW=0.6/0.75）
// 每次拖动都会走这条路径。实测（366 节点，dpr2）：拖动中背板 1478×1080 却画满 2464×1800。
//
// 这条测试锁住的是**同源关系**，不是具体写法：
// 只要有人让背板缩放与变换缩放再次分家，它就红。

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const root = new URL('..', import.meta.url);
const src = readFileSync(new URL('app/legion/3d/page.tsx', root), 'utf8');

// 1) 背板缩放函数存在，且确实乘了 scale
assert.match(
  src,
  /canvas\.width = Math\.round\(size\.width \* dpr \* scale\)/,
  '背板宽度必须按 size.width * dpr * scale 计算（scale 是降档系数）',
);

// 2) 主绘制变换必须乘 resScale
assert.match(
  src,
  /ctx\.setTransform\(dpr \* resScale,/,
  '主绘制变换必须随 resScale 一起缩放，否则降档时画面被裁切并放大',
);

// 3) 不允许再出现「满 dpr 变换」写死形式
//    背景层（g2.setTransform(dpr, …)）不受影响：它构建的是满尺寸图层，再 drawImage 撑满背板。
assert.ok(
  !/ctx\.setTransform\(dpr, 0, 0, dpr, 0, 0\)/.test(src),
  '主绘制不允许再写死 setTransform(dpr, …)；降档系数必须参与',
);

console.log('legion backbuffer transform: PASS（背板与变换同源）');
