/*!
 * graph.js — 魔方的「图论」平面表示
 *
 * · 9 个圆 = 9 个可转动的层（3 个方向 × 3 层），同一方向的 3 层画成 3 个同心圆；
 *   三组同心圆的圆心构成一个等边三角形。
 * · 54 个节点 = 54 个贴纸。每个贴纸恰好属于两个层，于是落在这两个圆的交点上。
 *   两组同心圆相交出两块 3×3 的区域，正好是一对相对的面。
 * · 转动一层 = 圆上 12 个节点沿圆走「一个面」的距离；外层转动时，圆心处（或对侧）的面再自转 90°。
 *
 * 单位：中间那一圈的半径 = 1；屏幕坐标系（y 轴向下）。几何比例取自参考动画的逐帧测量。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cube.js'));
  else root.RubikGraph = factory(root.RubikCube);
})(typeof self !== 'undefined' ? self : this, function (Cube) {
  'use strict';

  const TAU = Math.PI * 2;
  const RHO = 0.5644;       // 图形中心到各组圆心的距离
  const GAP = 0.2132;       // 同心圆间距
  const DOT_R = 0.1063;     // 节点外半径
  const DOT_STROKE = 0.029; // 节点描边宽度
  const LINE_W = 0.0375;    // 圆环线宽
  const TRAIL_W = 0.085;    // 拖尾宽度

  // 三组同心圆的圆心方向：x 轴（R 面）右下，y 轴（U 面）正上，z 轴（F 面）左下
  const FAMILY_ANGLE = [Math.PI / 6, -Math.PI / 2, (5 * Math.PI) / 6];
  const CENTERS = FAMILY_ANGLE.map(a => [RHO * Math.cos(a), RHO * Math.sin(a)]);
  // 正向面（R/U/F）位于本组圆心，它所在的层是最内圈；相对的面（L/D/B）对应最外圈
  const radiusOf = (axis, layer) => 1 - layer * GAP;

  const LAYER_BASE = [
    { '1': 'R', '0': 'M', '-1': 'L' },
    { '1': 'U', '0': 'E', '-1': 'D' },
    { '1': 'F', '0': 'S', '-1': 'B' },
  ];

  const circleIndex = (axis, layer) => axis * 3 + (1 - layer);
  const CIRCLES = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const layer of [1, 0, -1]) {
      const [cx, cy] = CENTERS[axis];
      const r = radiusOf(axis, layer);
      const la = FAMILY_ANGLE[axis]; // 标签放在远离中心一侧的空白弧段上
      CIRCLES.push({
        index: CIRCLES.length, axis, layer, cx, cy, r,
        name: LAYER_BASE[axis][layer],
        labelX: cx + r * Math.cos(la), labelY: cy + r * Math.sin(la),
      });
    }
  }

  // 两圆交点；sameSide 为真时取与参考点位于连心线同侧的那一个
  function intersect(a, ar, b, br, ref, sameSide) {
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
    const t = (ar * ar - br * br + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, ar * ar - t * t));
    const mx = a[0] + (t * dx) / d, my = a[1] + (t * dy) / d;
    const px = -dy / d, py = dx / d;
    const p1 = [mx + h * px, my + h * py], p2 = [mx - h * px, my - h * py];
    const side = p => Math.sign(dx * (p[1] - a[1]) - dy * (p[0] - a[0]));
    return (side(p1) === side(ref)) === sameSide ? p1 : p2;
  }

  const SLOT_POS = Cube.SLOTS.map(slot => {
    const a = slot.axis;
    const [b, c] = [0, 1, 2].filter(k => k !== a);
    return intersect(
      CENTERS[b], radiusOf(b, slot.pos[b]),
      CENTERS[c], radiusOf(c, slot.pos[c]),
      CENTERS[a], slot.normal[a] > 0,
    );
  });
  const SLOT_CIRCLES = Cube.SLOTS.map(slot =>
    [0, 1, 2].filter(k => k !== slot.axis).map(k => circleIndex(k, slot.pos[k])));
  const FACE_CENTER = Cube.FACES.map((_, f) => SLOT_POS[f * 9 + 4]);
  const FACE_CIRCLE = Cube.NORMALS.map(n => {
    const a = n.findIndex(v => v !== 0);
    return circleIndex(a, n[a]);
  });

  const angleAround = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  function wrapPi(a) {
    a = (a + Math.PI) % TAU;
    if (a < 0) a += TAU;
    return a - Math.PI;
  }
  // 把角度差规整到 dir 方向的 (0, 2π) 区间
  function wrapDir(a, dir) {
    let x = a % TAU;
    if (dir > 0) { if (x <= 0) x += TAU; } else if (x >= 0) x -= TAU;
    return x;
  }

  // 绕 +axis 转 +90° 时，圆上节点在屏幕上的走向（+1 = 顺时针）。用中层的 12 个节点投票决定。
  const BELT_DIR = [0, 1, 2].map(axis => {
    const q = Cube.quarterPerm(axis, [0], 1);
    let votes = 0;
    for (const slot of Cube.SLOTS) {
      if (slot.pos[axis] !== 0 || slot.axis === axis) continue;
      const c = CENTERS[axis];
      votes += Math.sign(wrapPi(angleAround(c, SLOT_POS[q[slot.index]]) - angleAround(c, SLOT_POS[slot.index])));
    }
    return Math.sign(votes);
  });

  /**
   * 为一步转动生成每个运动节点的路径。
   * 圆上的节点沿圆弧运动；自转的面上的节点绕该面中心做极坐标插值。
   * 半圈（如 R2）拆成两段四分之一圈，按弧长参数化，保证同一时刻同步到达。
   */
  function buildAnimation(move) {
    const b = Cube.BASE[move.base];
    const turns = b.turn * move.amount;
    const sgn = Math.sign(turns), steps = Math.abs(turns);
    const q = Cube.quarterPerm(b.axis, b.layers, sgn);
    const dir = BELT_DIR[b.axis] * sgn;
    const center = CENTERS[b.axis];
    const moving = [];
    const mask = new Uint8Array(54);
    for (const slot of Cube.SLOTS) {
      if (!b.layers.includes(slot.pos[b.axis])) continue;
      const segs = [];
      let cur = slot.index, total = 0;
      for (let k = 0; k < steps; k++) {
        const nxt = q[cur];
        if (nxt === cur) break; // 面中心：原地不动
        let seg;
        if (Cube.SLOTS[cur].axis !== b.axis) {
          const r = radiusOf(b.axis, slot.pos[b.axis]);
          const a0 = angleAround(center, SLOT_POS[cur]);
          seg = { cx: center[0], cy: center[1], r0: r, r1: r, a0, da: wrapDir(angleAround(center, SLOT_POS[nxt]) - a0, dir) };
        } else {
          const pc = FACE_CENTER[Cube.SLOTS[cur].face];
          const p0 = SLOT_POS[cur], p1 = SLOT_POS[nxt];
          const a0 = angleAround(pc, p0);
          seg = {
            cx: pc[0], cy: pc[1],
            r0: Math.hypot(p0[0] - pc[0], p0[1] - pc[1]),
            r1: Math.hypot(p1[0] - pc[0], p1[1] - pc[1]),
            a0, da: wrapPi(angleAround(pc, p1) - a0),
          };
        }
        seg.len = (Math.abs(seg.da) * (seg.r0 + seg.r1)) / 2 + Math.abs(seg.r1 - seg.r0);
        total += seg.len;
        segs.push(seg);
        cur = nxt;
      }
      if (segs.length) {
        moving.push({ slot: slot.index, segs, total });
        mask[slot.index] = 1;
      }
    }
    return {
      move, axis: b.axis, layers: b.layers, turns,
      perm: Cube.movePerm(move),
      circles: b.layers.map(l => circleIndex(b.axis, l)),
      moving, mask,
    };
  }

  // e ∈ [0,1] 时节点在路径上的位置
  function pathPos(entry, e, out) {
    let u = e * entry.total;
    const segs = entry.segs;
    let i = 0;
    while (i < segs.length - 1 && u > segs[i].len) { u -= segs[i].len; i++; }
    const sg = segs[i];
    const t = sg.len > 0 ? Math.min(1, Math.max(0, u / sg.len)) : 1;
    const r = sg.r0 + (sg.r1 - sg.r0) * t;
    const a = sg.a0 + sg.da * t;
    out[0] = sg.cx + r * Math.cos(a);
    out[1] = sg.cy + r * Math.sin(a);
    return out;
  }

  // 每个面在其外层转动（顺时针记号）下在屏幕上的自转方向
  const FACE_DIR = Cube.FACES.map((name, f) => {
    const anim = buildAnimation({ base: name, amount: 1 });
    let votes = 0;
    for (const m of anim.moving) if (Cube.SLOTS[m.slot].face === f) votes += Math.sign(m.segs[0].da);
    return Math.sign(votes);
  });

  // 让某个圆在屏幕上按 screenDir（+1 顺时针 / -1 逆时针）转动的记号
  function moveForCircle(ci, screenDir) {
    const c = CIRCLES[ci];
    const base = LAYER_BASE[c.axis][c.layer];
    const t = screenDir * BELT_DIR[c.axis];
    return { base, amount: t * Cube.BASE[base].turn };
  }
  // 让某个面在屏幕上按 screenDir 自转的记号
  function moveForFace(f, screenDir) {
    return { base: Cube.FACES[f], amount: screenDir * FACE_DIR[f] };
  }

  // ---------- 命中测试 ----------
  function nearestDot(x, y, maxD = DOT_R * 1.12) {
    let best = -1, bd = maxD;
    for (let s = 0; s < 54; s++) {
      const d = Math.hypot(SLOT_POS[s][0] - x, SLOT_POS[s][1] - y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  function nearestCircle(x, y, maxD) {
    let best = -1, bd = maxD;
    for (const c of CIRCLES) {
      const d = Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r);
      if (d < bd) { bd = d; best = c.index; }
    }
    return best;
  }
  // 圆在点 (x,y) 处沿屏幕顺时针方向的单位切向量
  function tangentCW(ci, x, y) {
    const c = CIRCLES[ci];
    const a = Math.atan2(y - c.cy, x - c.cx);
    return [-Math.sin(a), Math.cos(a)];
  }

  const BOUNDS = (() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of CIRCLES) {
      x0 = Math.min(x0, c.cx - c.r); x1 = Math.max(x1, c.cx + c.r);
      y0 = Math.min(y0, c.cy - c.r); y1 = Math.max(y1, c.cy + c.r);
    }
    const m = LINE_W;
    return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
  })();

  return {
    TAU, RHO, GAP, DOT_R, DOT_STROKE, LINE_W, TRAIL_W,
    FAMILY_ANGLE, CENTERS, CIRCLES, SLOT_POS, SLOT_CIRCLES, FACE_CENTER, FACE_CIRCLE,
    BELT_DIR, FACE_DIR, BOUNDS, LAYER_BASE,
    circleIndex, radiusOf, buildAnimation, pathPos,
    moveForCircle, moveForFace, nearestDot, nearestCircle, tangentCW,
  };
});
