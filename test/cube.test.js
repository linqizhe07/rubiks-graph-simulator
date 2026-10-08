'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RubikCube = require('../js/cube.js');

const C3 = RubikCube.create(3);
const isIdentity = p => p.every((v, i) => v === i);
const permOf = (str, C = C3) => C.seqPerm(C.parse(str));
const samePerm = (a, b) => assert.deepEqual(Array.from(a), Array.from(b));
const ORDERS = [2, 3, 4, 5, 6, 7];

test('6N² 个槽位互不相同，且每个面 N² 个', () => {
  for (const N of ORDERS) {
    const C = RubikCube.create(N);
    assert.equal(C.SLOTS.length, 6 * N * N);
    const keys = new Set(C.SLOTS.map(s => s.pos.join() + '|' + s.normal.join()));
    assert.equal(keys.size, 6 * N * N);
    for (const s of C.SLOTS) assert.equal(s.pos[s.axis], s.normal[s.axis] * (N - 1));
    // 表面小块数 = N³ - (N-2)³
    assert.equal(C.CUBIES.length, N ** 3 - Math.max(0, N - 2) ** 3);
  }
});

test('每一层的转动都是双射，且 4 次回到原状', () => {
  for (const N of ORDERS) {
    const C = RubikCube.create(N);
    for (let axis = 0; axis < 3; axis++) {
      for (let l = 0; l < N; l++) {
        const m = { axis, layers: [l], turns: 1 };
        const p = C.movePerm(m);
        assert.equal(new Set(p).size, C.STICKERS);
        assert.equal(C.order(p), 4, `N=${N} axis=${axis} layer=${l}`);
        samePerm(C.movePerm({ ...m, turns: 2 }), C.compose(p, p));
        samePerm(C.movePerm({ ...m, turns: -1 }), C.inverse(p));
      }
    }
  }
});

test('顺时针记号方向正确（从该面外侧看顺时针）', () => {
  const name = i => C3.SLOTS[i].name;
  const dest = (mv, from) => name(C3.movePerm(C3.parse(mv)[0])[C3.SLOTS.findIndex(s => s.name === from)]);
  assert.equal(dest('U', 'F1'), 'L1');
  assert.equal(dest('R', 'F3'), 'U3');
  assert.equal(dest('F', 'U7'), 'R1');
  assert.equal(dest('U', 'U1'), 'U3');
  assert.equal(dest('D', 'D1'), 'D3');
  assert.equal(dest('L', 'L1'), 'L3');
  assert.equal(dest('B', 'B1'), 'B3');
});

test('经典公式的阶数', () => {
  assert.equal(C3.order(permOf('R U')), 105);
  assert.equal(C3.order(permOf("R U R' U'")), 6);
  assert.equal(C3.order(permOf("R U R' U R U2 R'")), 6);
  assert.equal(C3.order(permOf("R U R' U' R' F R2 U' R' U' R U R' F'")), 2); // T-perm
  assert.equal(C3.order(permOf('M2 U M2 U2 M2 U M2')), 2); // H-perm
  assert.equal(C3.order(permOf("R U2 D' B D'")), 1260);
});

test('超级翻转：所有角块与中心不动、所有棱块原地翻转', () => {
  const p = permOf("U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2");
  assert.equal(C3.order(p), 2);
  const moved = C3.cycles(p).filter(c => c.length > 1);
  assert.equal(moved.length, 12);
  for (const c of moved) {
    const [a, b] = c.map(i => C3.SLOTS[i]);
    assert.deepEqual(a.pos, b.pos);
  }
});

test('整体转动 = 所有层同向转动；宽层转动 = 多层', () => {
  samePerm(permOf('x'), permOf("R M' L'"));
  samePerm(permOf('y'), permOf("U E' D'"));
  samePerm(permOf('z'), permOf("F S B'"));
  samePerm(permOf('r'), permOf("R M'"));
  samePerm(permOf('Rw'), permOf('r'));
  samePerm(permOf("u'"), permOf("U' E"));
  samePerm(permOf('f2'), permOf('F2 S2'));
  const C4 = RubikCube.create(4), C5 = RubikCube.create(5);
  samePerm(permOf('Rw', C4), permOf("R 2R", C4));
  samePerm(permOf('3Rw', C5), permOf("R 2R M'", C5));
  samePerm(permOf('x', C5), permOf("R 2R M' 2L' L'", C5));
  samePerm(permOf('Lw', C4), permOf('L 2L', C4));
  samePerm(permOf('3r', C4), permOf('3Rw', C4));
});

test('记号的显示与解析互为逆运算', () => {
  for (const N of ORDERS) {
    const C = RubikCube.create(N);
    for (let axis = 0; axis < 3; axis++) {
      for (let l = 0; l < N; l++) {
        for (const turns of [1, -1, 2, -2]) {
          const m = { axis, layers: [l], turns };
          const back = C.parse(C.moveToString(m));
          assert.equal(back.length, 1);
          assert.deepEqual(back[0], m, `N=${N} ${C.moveToString(m)}`);
        }
      }
    }
  }
  const str = (s, C = C3) => C.seqToString(C.parse(s));
  assert.equal(str("R U2' x Rw M' F3 B4"), "R U2' x Rw M' F'");
  assert.equal(str("R'2 U’"), "R2' U'");
  assert.equal(str("2R 3Rw r 2L'", RubikCube.create(5)), "2R 3Rw Rw 2L'");
});

test('公式解析：括号、交换子、共轭与错误提示', () => {
  const str = s => C3.seqToString(C3.parse(s));
  assert.equal(str('(R U)3'), 'R U R U R U');
  assert.equal(str("(R U)'"), "U' R'");
  assert.equal(str('[R, U]'), "R U R' U'");
  assert.equal(str("[F: R U R' U']"), "F R U R' U' F'");
  assert.equal(str('[R, U]2'), "R U R' U' R U R' U'");
  assert.throws(() => C3.parse('R Q'), /无法识别/);
  assert.throws(() => C3.parse('(R U'), /缺少/);
  assert.throws(() => C3.parse('R U)'), /多余/);
  assert.throws(() => C3.parse('(R U)9999'), /超过/);
  assert.throws(() => RubikCube.create(4).parse('M'), /奇数阶/);
  assert.throws(() => C3.parse('4R'), /超出/);
  assert.throws(() => C3.parse('2x'), /整体转动/);
});

test('任意序列接上其逆序列回到原状（各阶）', () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const N of ORDERS) {
    const C = RubikCube.create(N);
    for (let k = 0; k < 6; k++) {
      const seq = C.scramble(undefined, rng);
      assert.ok(isIdentity(C.seqPerm(seq.concat(C.invertSeq(seq)))));
      let st = C.solvedState();
      for (const m of seq) st = C.applyMove(st, m);
      assert.ok(!C.isSolved(st), `N=${N}`);
      for (const m of C.invertSeq(seq)) st = C.applyMove(st, m);
      assert.ok(C.isSolved(st));
    }
  }
});

test('打乱序列：长度合适、相邻两步不同轴', () => {
  for (const N of ORDERS) {
    const C = RubikCube.create(N);
    const seq = C.scramble();
    assert.ok(seq.length >= 11);
    for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i].axis, seq[i - 1].axis);
  }
});

test('合并相邻同层转动', () => {
  const str = s => C3.seqToString(C3.simplify(C3.parse(s)));
  assert.equal(str('R R'), 'R2');
  assert.equal(str("R R'"), '');
  assert.equal(str('R2 R'), "R'");
  assert.equal(str("U R R' U"), 'U2');
  assert.equal(str("R U R' U' U R U' R'"), '');
});

test('整体转动与中层转动后仍按颜色判定为已还原', () => {
  let st = C3.solvedState();
  for (const m of C3.parse("x y2 z' M2 E2 S2 M2 E2 S2")) st = C3.applyMove(st, m);
  assert.ok(C3.isSolved(st));
});
