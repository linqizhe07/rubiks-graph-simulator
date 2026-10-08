'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Cube = require('../js/cube.js');
const G = require('../js/graph.js');

const EPS = 1e-9;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const onCircle = (p, c) => Math.abs(Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r) < EPS;
const DEG = 180 / Math.PI;

test('9 个圆，每个圆恰好经过 12 个节点', () => {
  assert.equal(G.CIRCLES.length, 9);
  for (const c of G.CIRCLES) {
    const on = G.SLOT_POS.filter(p => onCircle(p, c));
    assert.equal(on.length, 12, c.name);
  }
});

test('每个节点恰好在 2 个圆上（9 × 12 = 54 × 2）', () => {
  G.SLOT_POS.forEach((p, s) => {
    const on = G.CIRCLES.filter(c => onCircle(p, c)).map(c => c.index);
    assert.deepEqual(on.sort(), G.SLOT_CIRCLES[s].slice().sort());
  });
});

test('圆上的节点正是该层的 12 张环带贴纸', () => {
  for (const c of G.CIRCLES) {
    const belt = Cube.SLOTS.filter(s => s.pos[c.axis] === c.layer && s.axis !== c.axis).map(s => s.index);
    const on = G.SLOT_POS.map((p, i) => i).filter(i => onCircle(G.SLOT_POS[i], c));
    assert.deepEqual(on, belt, c.name);
  }
});

test('节点互不重叠', () => {
  let min = Infinity;
  for (let i = 0; i < 54; i++) for (let j = i + 1; j < 54; j++) min = Math.min(min, dist(G.SLOT_POS[i], G.SLOT_POS[j]));
  assert.ok(min > 2 * G.DOT_R, `最小间距 ${min}`);
});

test('内三角是 U/R/F，各自位于本组同心圆的圆心附近；对面在外侧', () => {
  const r = f => Math.hypot(...G.FACE_CENTER[Cube.FACES.indexOf(f)]);
  for (const f of 'URF') assert.ok(r(f) < 0.7, f);
  for (const f of 'DLB') assert.ok(r(f) > 1.1, f);
  // 相对的面隔着中心相对
  const dot = (a, b) => { const p = G.FACE_CENTER[Cube.FACES.indexOf(a)], q = G.FACE_CENTER[Cube.FACES.indexOf(b)]; return p[0] * q[0] + p[1] * q[1]; };
  assert.ok(dot('U', 'D') < 0 && dot('R', 'L') < 0 && dot('F', 'B') < 0);
});

const ALL_MOVES = [];
for (const base of Object.keys(Cube.BASE)) for (const amount of [1, -1, 2, -2]) ALL_MOVES.push({ base, amount });

test('动画路径：起点是原槽位，终点是置换后的槽位', () => {
  const out = [0, 0];
  for (const move of ALL_MOVES) {
    const anim = G.buildAnimation(move);
    const moved = new Set(anim.moving.map(m => m.slot));
    for (let s = 0; s < 54; s++) {
      if (anim.perm[s] !== s) assert.ok(moved.has(s), Cube.moveToString(move) + ' 漏掉了 ' + s);
    }
    for (const m of anim.moving) {
      assert.ok(dist(G.pathPos(m, 0, out), G.SLOT_POS[m.slot]) < 1e-9);
      assert.ok(dist(G.pathPos(m, 1, out), G.SLOT_POS[anim.perm[m.slot]]) < 1e-9, Cube.moveToString(move));
      // 环带上的节点全程留在圆上
      if (Cube.SLOTS[m.slot].axis !== anim.axis) {
        const c = G.CIRCLES[G.circleIndex(anim.axis, Cube.SLOTS[m.slot].pos[anim.axis])];
        for (let e = 0; e <= 1; e += 0.125) assert.ok(onCircle(G.pathPos(m, e, out), c));
      }
    }
  }
});

test('四分之一圈：12 个点同向走 3 格，其中 3 个穿过空白弧段，弧长总和 = 3 整圈', () => {
  for (const base of ['R', 'M', 'L', 'U', 'E', 'D', 'F', 'S', 'B']) {
    const anim = G.buildAnimation({ base, amount: 1 });
    const belt = anim.moving.filter(m => Cube.SLOTS[m.slot].axis !== anim.axis).map(m => m.segs[0].da * DEG);
    assert.equal(belt.length, 12);
    assert.equal(new Set(belt.map(Math.sign)).size, 1, base);
    const abs = belt.map(Math.abs).sort((a, b) => a - b);
    assert.ok(abs.slice(0, 9).every(a => a > 40 && a < 90), base + ' ' + abs);
    assert.ok(abs.slice(9).every(a => a > 140 && a < 200), base + ' ' + abs);
    assert.ok(Math.abs(abs.reduce((x, y) => x + y, 0) - 1080) < 1e-6, base);
  }
});

test('面自转：8 个非中心节点同向转动', () => {
  for (const f of Cube.FACES) {
    const anim = G.buildAnimation({ base: f, amount: 1 });
    const face = anim.moving.filter(m => Cube.SLOTS[m.slot].face === Cube.FACES.indexOf(f));
    assert.equal(face.length, 8, f);
    assert.equal(new Set(face.map(m => Math.sign(m.segs[0].da))).size, 1, f);
  }
});

test('点击方向：moveForCircle / moveForFace 让节点按屏幕顺时针运动', () => {
  for (const c of G.CIRCLES) {
    for (const dir of [1, -1]) {
      const anim = G.buildAnimation(G.moveForCircle(c.index, dir));
      for (const m of anim.moving) {
        const slot = Cube.SLOTS[m.slot];
        if (slot.axis !== c.axis && slot.pos[c.axis] === c.layer) assert.equal(Math.sign(m.segs[0].da), dir, c.name);
      }
    }
  }
  Cube.FACES.forEach((name, f) => {
    for (const dir of [1, -1]) {
      const anim = G.buildAnimation(G.moveForFace(f, dir));
      for (const m of anim.moving) if (Cube.SLOTS[m.slot].face === f) assert.equal(Math.sign(m.segs[0].da), dir, name);
    }
  });
  // 外层面的自转方向与其顺时针记号一致（所有面都是「从外面看」的视角）
  assert.deepEqual(Array.from(G.FACE_DIR), [1, 1, 1, 1, 1, 1]);
});

test('命中测试', () => {
  for (let s = 0; s < 54; s++) assert.equal(G.nearestDot(...G.SLOT_POS[s]), s);
  for (const c of G.CIRCLES) assert.equal(G.nearestCircle(c.labelX, c.labelY, 0.05), c.index);
});
