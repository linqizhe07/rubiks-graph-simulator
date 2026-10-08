'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RubikCube = require('../js/cube.js');
const RubikGraph = require('../js/graph.js');

const EPS = 1e-9;
const DEG = 180 / Math.PI;
const ORDERS = [2, 3, 4, 5, 6, 7];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const onCircle = (p, c) => Math.abs(Math.hypot(p[0] - c.cx, p[1] - c.cy) - c.r) < EPS;
const setup = N => { const C = RubikCube.create(N); return [C, RubikGraph.create(C)]; };

test('3N 个圆，每个圆恰好经过 4N 个节点（就是这一层的环带）', () => {
  for (const N of ORDERS) {
    const [C, G] = setup(N);
    assert.equal(G.CIRCLES.length, 3 * N);
    for (const c of G.CIRCLES) {
      const on = G.SLOT_POS.map((p, i) => i).filter(i => onCircle(G.SLOT_POS[i], c));
      const belt = C.SLOTS.filter(s => s.layer[c.axis] === c.layer && s.axis !== c.axis).map(s => s.index);
      assert.equal(on.length, 4 * N, `N=${N} ${c.name}`);
      assert.deepEqual(on, belt);
    }
  }
});

test('每个节点恰好在 2 个圆上', () => {
  for (const N of ORDERS) {
    const [, G] = setup(N);
    G.SLOT_POS.forEach((p, s) => {
      const on = G.CIRCLES.filter(c => onCircle(p, c)).map(c => c.index);
      assert.deepEqual(on.sort((a, b) => a - b), G.SLOT_CIRCLES[s].slice().sort((a, b) => a - b));
    });
  }
});

test('节点互不重叠', () => {
  for (const N of ORDERS) {
    const [, G] = setup(N);
    let min = Infinity;
    for (let i = 0; i < G.SLOT_POS.length; i++) {
      for (let j = i + 1; j < G.SLOT_POS.length; j++) min = Math.min(min, dist(G.SLOT_POS[i], G.SLOT_POS[j]));
    }
    assert.ok(min > 2 * G.DOT_R, `N=${N} 最小间距 ${min} 节点直径 ${2 * G.DOT_R}`);
  }
});

test('三阶几何与参考动画一致（逐帧测得的 54 个节点）', () => {
  const [, G] = setup(3);
  assert.equal(G.GAP, 0.2132);
  assert.equal(G.DOT_R, 0.1063);
  const pk = [[1394,547],[1733,547],[1333,565],[1563,567],[1795,565],[1853,599],[1274,599],[1621,601],[1506,601],[1376,604],[1750,604],[1564,624],[1323,627],[1804,627],[1458,645],[1668,645],[1517,658],[1377,658],[1750,658],[1610,658],[1274,666],[1852,666],[1330,685],[1563,685],[1797,685],[1289,728],[1837,728],[1407,735],[1720,735],[1680,779],[1447,779],[1735,798],[1392,798],[1494,806],[1633,806],[1686,836],[1441,837],[1494,860],[1633,860],[1391,865],[1735,865],[1450,898],[1677,898],[1511,917],[1615,916],[1563,981],[1610,1008],[1517,1008],[1668,1021],[1459,1022],[1563,1043],[1506,1066],[1622,1066],[1563,1100]];
  const O = [1563.33, 765.5], SC = 239.96;
  for (const p of G.SLOT_POS) {
    const q = [O[0] + p[0] * SC, O[1] + p[1] * SC];
    const nearest = Math.min(...pk.map(v => dist(v, q)));
    assert.ok(nearest < 1.5, `误差 ${nearest}px`);
  }
});

test('内三角是 R/U/F，对面 L/D/B 在外侧', () => {
  for (const N of ORDERS) {
    const [C, G] = setup(N);
    const r = f => Math.hypot(...G.FACE_CENTER[C.FACES.indexOf(f)]);
    for (const f of 'URF') assert.ok(r(f) < 0.7, f);
    for (const f of 'DLB') assert.ok(r(f) > 1.1, f);
  }
});

test('动画路径：起点是原槽位，终点是置换后的槽位，环带节点全程在圆上', () => {
  const out = [0, 0];
  for (const N of ORDERS) {
    const [C, G] = setup(N);
    const moves = [];
    for (let axis = 0; axis < 3; axis++) {
      for (let l = 0; l < N; l++) for (const turns of [1, -1, 2, -2]) moves.push({ axis, layers: [l], turns });
      moves.push({ axis, layers: C.ALL, turns: 1 });
    }
    for (const move of moves) {
      const anim = G.buildAnimation(move);
      const moved = new Set(anim.moving.map(m => m.slot));
      for (let s = 0; s < C.STICKERS; s++) if (anim.perm[s] !== s) assert.ok(moved.has(s));
      for (const m of anim.moving) {
        assert.ok(dist(G.pathPos(m, 0, out), G.SLOT_POS[m.slot]) < 1e-9);
        assert.ok(dist(G.pathPos(m, 1, out), G.SLOT_POS[anim.perm[m.slot]]) < 1e-9, C.moveToString(move));
        const slot = C.SLOTS[m.slot];
        if (slot.axis !== anim.axis) {
          const c = G.CIRCLES[G.circleIndex(anim.axis, slot.layer[anim.axis])];
          for (let e = 0; e <= 1; e += 0.25) assert.ok(onCircle(G.pathPos(m, e, out), c));
        }
      }
    }
  }
});

test('四分之一圈：环带节点同向走一个面的距离，弧长总和 = N 整圈', () => {
  for (const N of ORDERS) {
    const [C, G] = setup(N);
    for (let axis = 0; axis < 3; axis++) {
      for (let l = 0; l < N; l++) {
        const anim = G.buildAnimation({ axis, layers: [l], turns: 1 });
        const belt = anim.moving.filter(m => C.SLOTS[m.slot].axis !== axis).map(m => m.segs[0].da * DEG);
        assert.equal(belt.length, 4 * N);
        assert.equal(new Set(belt.map(Math.sign)).size, 1);
        const sum = belt.reduce((a, b) => a + Math.abs(b), 0);
        assert.ok(Math.abs(sum - 360 * N) < 1e-6, `N=${N} sum=${sum}`);
      }
    }
  }
});

test('面自转：所有非中心节点同向转动，且都是「从外面看」的顺时针', () => {
  for (const N of ORDERS) {
    const [C, G] = setup(N);
    C.FACES.forEach((name, f) => {
      const anim = G.buildAnimation(C.faceMove(f, 1));
      const face = anim.moving.filter(m => C.SLOTS[m.slot].face === f);
      assert.equal(face.length, N * N - (N % 2), `N=${N} ${name}`);
      assert.equal(new Set(face.map(m => Math.sign(m.segs[0].da))).size, 1);
    });
    assert.deepEqual(Array.from(G.FACE_DIR), [1, 1, 1, 1, 1, 1]);
  }
});

test('点击方向：moveForCircle / moveForFace 让节点按屏幕方向运动', () => {
  for (const N of [2, 3, 4, 5]) {
    const [C, G] = setup(N);
    for (const c of G.CIRCLES) {
      for (const dir of [1, -1]) {
        const anim = G.buildAnimation(G.moveForCircle(c.index, dir));
        for (const m of anim.moving) {
          const slot = C.SLOTS[m.slot];
          if (slot.axis !== c.axis) assert.equal(Math.sign(m.segs[0].da), dir);
        }
      }
    }
    C.FACES.forEach((_, f) => {
      for (const dir of [1, -1]) {
        const anim = G.buildAnimation(G.moveForFace(f, dir));
        for (const m of anim.moving) if (C.SLOTS[m.slot].face === f) assert.equal(Math.sign(m.segs[0].da), dir);
      }
    });
  }
});

test('命中测试', () => {
  for (const N of ORDERS) {
    const [, G] = setup(N);
    for (let s = 0; s < G.SLOT_POS.length; s++) assert.equal(G.nearestDot(...G.SLOT_POS[s]), s);
    for (const c of G.CIRCLES) assert.equal(G.nearestCircle(c.labelX, c.labelY, 0.05), c.index);
  }
});
