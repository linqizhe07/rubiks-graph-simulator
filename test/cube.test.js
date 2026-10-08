'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Cube = require('../js/cube.js');

const isIdentity = p => p.every((v, i) => v === i);
const permOf = str => Cube.seqPerm(Cube.parse(str));
const samePerm = (a, b) => assert.deepEqual(Array.from(a), Array.from(b));

test('54 个槽位互不相同，且每个面 9 个', () => {
  assert.equal(Cube.SLOTS.length, 54);
  const keys = new Set(Cube.SLOTS.map(s => s.pos.join() + '|' + s.normal.join()));
  assert.equal(keys.size, 54);
  for (const s of Cube.SLOTS) {
    // 贴纸在其法向所在的面上
    assert.equal(s.pos[s.axis], s.normal[s.axis]);
  }
});

test('每个基本转动都是双射，且 4 次回到原状', () => {
  for (const base of Object.keys(Cube.BASE)) {
    const p = Cube.movePerm({ base, amount: 1 });
    assert.equal(new Set(p).size, 54, base);
    assert.equal(Cube.order(p), 4, base);
    samePerm(Cube.movePerm({ base, amount: 2 }), Cube.compose(p, p));
    samePerm(Cube.movePerm({ base, amount: -1 }), Cube.inverse(p));
  }
});

test('顺时针记号方向正确（从该面外侧看顺时针）', () => {
  const name = i => Cube.SLOTS[i].name;
  const dest = (base, from) => name(Cube.movePerm({ base, amount: 1 })[Cube.SLOTS.findIndex(s => s.name === from)]);
  // U：前面的上排去左面；R：前面的右列去上面；F：上面的下排去右面
  assert.equal(dest('U', 'F1'), 'L1');
  assert.equal(dest('R', 'F3'), 'U3');
  assert.equal(dest('F', 'U7'), 'R1');
  // 面自身顺时针：角块 1 → 3
  assert.equal(dest('U', 'U1'), 'U3');
  assert.equal(dest('D', 'D1'), 'D3');
  assert.equal(dest('L', 'L1'), 'L3');
  assert.equal(dest('B', 'B1'), 'B3');
});

test('经典公式的阶数', () => {
  assert.equal(Cube.order(permOf('R U')), 105);
  assert.equal(Cube.order(permOf("R U R' U'")), 6);
  assert.equal(Cube.order(permOf("R U R' U R U2 R'")), 6);
  assert.equal(Cube.order(permOf("R U R' U' R' F R2 U' R' U' R U R' F'")), 2); // T-perm
  assert.equal(Cube.order(permOf('M2 U M2 U2 M2 U M2')), 2); // H-perm
  assert.equal(Cube.order(permOf("R U2 D' B D'")), 1260);
});

test('超级翻转：所有角块与中心不动、所有棱块原地翻转', () => {
  const p = permOf("U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2");
  assert.equal(Cube.order(p), 2);
  const moved = Cube.cycles(p).filter(c => c.length > 1);
  assert.equal(moved.length, 12); // 12 条棱 × 2 张贴纸互换
  for (const c of moved) {
    const [a, b] = c.map(i => Cube.SLOTS[i]);
    assert.deepEqual(a.pos, b.pos); // 同一棱块的两张贴纸
  }
});

test('整体转动 = 三层同向转动；宽层转动 = 两层', () => {
  samePerm(permOf('x'), permOf("R M' L'"));
  samePerm(permOf('y'), permOf("U E' D'"));
  samePerm(permOf('z'), permOf("F S B'"));
  samePerm(permOf('r'), permOf("R M'"));
  samePerm(permOf('Rw'), permOf('r'));
  samePerm(permOf("u'"), permOf("U' E"));
  samePerm(permOf('f2'), permOf('F2 S2'));
});

test('公式解析：记号、括号、交换子、共轭', () => {
  const str = s => Cube.seqToString(Cube.parse(s));
  assert.equal(str("R U2' x Rw M' F3 B4"), "R U2' x r M' F'");
  assert.equal(str("R'2 U’"), "R2' U'");
  assert.equal(str('(R U)3'), 'R U R U R U');
  assert.equal(str("(R U)'"), "U' R'");
  assert.equal(str('[R, U]'), "R U R' U'");
  assert.equal(str("[F: R U R' U']"), "F R U R' U' F'");
  assert.equal(str('[R, U]2'), "R U R' U' R U R' U'");
  assert.throws(() => Cube.parse('R Q'), /无法识别/);
  assert.throws(() => Cube.parse('(R U'), /缺少/);
  assert.throws(() => Cube.parse('R U)'), /多余/);
  assert.throws(() => Cube.parse('(R U)9999'), /超过/);
});

test('任意序列接上其逆序列回到原状', () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 20; k++) {
    const seq = Cube.scramble(25, rng);
    assert.ok(isIdentity(Cube.seqPerm(seq.concat(Cube.invertSeq(seq)))));
    let st = Cube.solvedState();
    for (const m of seq) st = Cube.applyMove(st, m);
    assert.ok(!Cube.isSolved(st));
    for (const m of Cube.invertSeq(seq)) st = Cube.applyMove(st, m);
    assert.ok(Cube.isSolved(st));
  }
});

test('打乱序列不出现同面相邻、同轴三连', () => {
  const axis = { U: 1, D: 1, L: 0, R: 0, F: 2, B: 2 };
  for (let k = 0; k < 50; k++) {
    const seq = Cube.scramble(22);
    assert.equal(seq.length, 22);
    for (let i = 1; i < seq.length; i++) {
      assert.notEqual(seq[i].base, seq[i - 1].base);
      if (i > 1) assert.ok(!(axis[seq[i].base] === axis[seq[i - 1].base] && axis[seq[i].base] === axis[seq[i - 2].base]));
    }
  }
});

test('合并相邻同名转动', () => {
  const str = s => Cube.seqToString(Cube.simplify(Cube.parse(s)));
  assert.equal(str("R R"), 'R2');
  assert.equal(str("R R'"), '');
  assert.equal(str("R2 R"), "R'");
  assert.equal(str("U R R' U"), 'U2');
});

test('整体转动后仍判定为已还原', () => {
  let st = Cube.solvedState();
  for (const m of Cube.parse("x y2 z' M2 E2 S2 M2 E2 S2")) st = Cube.applyMove(st, m);
  assert.ok(Cube.isSolved(st));
});
