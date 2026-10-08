'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RubikCube = require('../js/cube.js');
const RubikSolver = require('../js/solver.js');

const C = RubikCube.create(3);
const solver = RubikSolver.create(C);
let seed = 20261008;
const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const applySeq = (st, seq) => { for (const m of seq) st = C.applyMove(st, m); return st; };

// 每个阶段最多允许的小步数（层先法的正常上限）
const MAX_STEPS = [1, 8, 8, 8, 3, 3, 3, 3];

function checkRun(start, label) {
  const { steps, state, solved } = solver.solveAll(start);
  assert.ok(solved, `${label}：没有还原`);
  assert.ok(C.isSolved(state));
  const perStage = new Array(8).fill(0);
  let last = -1;
  for (const s of steps) {
    assert.ok(s.stage >= last, `${label}：阶段倒退 ${last} → ${s.stage}`);
    last = s.stage;
    perStage[s.stage]++;
    assert.ok(s.moves.length > 0, `${label}：空步骤 ${s.title}`);
    assert.ok(s.title && s.text, '每一步都要有标题和讲解');
  }
  perStage.forEach((n, i) => assert.ok(n <= MAX_STEPS[i], `${label}：阶段 ${i} 用了 ${n} 步`));
  return steps.reduce((n, s) => n + s.moves.length, 0);
}

test('层先法：300 个随机打乱全部还原，阶段只前进不后退', () => {
  let total = 0, maxMoves = 0;
  for (let k = 0; k < 300; k++) {
    const st = applySeq(C.solvedState(), C.scramble(25, rng));
    const moves = checkRun(st, `#${k}`);
    total += moves;
    maxMoves = Math.max(maxMoves, moves);
  }
  assert.ok(total / 300 < 200, `平均 ${total / 300} 步`);
  assert.ok(maxMoves < 300, `最多 ${maxMoves} 步`);
});

test('层先法：魔方被整体转动、中层转动打乱朝向时，先摆正再还原', () => {
  for (let k = 0; k < 60; k++) {
    let st = applySeq(C.solvedState(), C.scramble(20, rng));
    st = applySeq(st, C.parse(['x', "z'", 'x2 y', "M E' S", 'z y2'][k % 5]));
    checkRun(st, `rot#${k}`);
  }
});

test('层先法：已还原时直接完成；只差最后几步时不走回头路', () => {
  assert.ok(solver.nextStep(C.solvedState()).done);
  const almost = applySeq(C.solvedState(), C.parse("R U' R U R U R U' R' U' R2"));
  const s = solver.nextStep(almost);
  assert.equal(s.stage, 7);
  const tPerm = applySeq(C.solvedState(), C.parse("R U R' U' R' F R2 U' R' U' R U R' F'"));
  assert.ok(solver.nextStep(tPerm).stage >= 6);
});

test('层先法：中途从任意状态重新规划都能完成', () => {
  for (let k = 0; k < 40; k++) {
    let st = applySeq(C.solvedState(), C.scramble(25, rng));
    const plan = solver.solveAll(st).steps;
    // 按计划做到一半，再随手乱转两下，然后重新规划
    for (const s of plan.slice(0, Math.floor(plan.length / 2))) st = applySeq(st, s.moves);
    st = applySeq(st, C.scramble(2, rng));
    checkRun(st, `replan#${k}`);
  }
});

test('讲解文字：中英文词典键一致，所有步骤在两种语言下都能完整渲染', () => {
  const I18N = require('../js/i18n.js');
  const zh = Object.keys(I18N.DICT.zh).sort(), en = Object.keys(I18N.DICT.en).sort();
  assert.deepEqual(en, zh);
  // 两种语言里同一个键的占位符必须一致
  for (const k of zh) {
    // 颜色有短写法 {c} 和带「色」字的长写法 {cL}，两者都会传入，视为同一个占位符
    const ph = s => [...new Set((s.match(/\{\w+\}/g) || []).map(p => p.replace(/L\}$/, '}')))].sort().join();
    assert.equal(ph(I18N.DICT.en[k]), ph(I18N.DICT.zh[k]), k);
  }
  for (const lang of ['zh', 'en']) {
    I18N.setLang(lang);
    for (let k = 0; k < 30; k++) {
      let st = applySeq(C.solvedState(), C.scramble(25, rng));
      if (k % 5 === 0) st = applySeq(st, C.parse('x z'));
      const { steps } = solver.solveAll(st);
      steps.push(solver.nextStep(C.solvedState()));
      for (const s of steps) {
        for (const m of [s.title, s.text, s.stageTitle, ...s.parts.map(p => p.label)].filter(Boolean)) {
          const out = I18N.render(m);
          assert.ok(out.length > 1, `${lang}: 空文案`);
          assert.ok(!/\{\w+\}/.test(out), `${lang}: 未填充的占位符 ${out}`);
          assert.ok(!/^(s\d|part|stage|shape|dir|alg|piece|tut)\./.test(out), `${lang}: 缺少文案 ${out}`);
          if (lang === 'en') assert.ok(!/[一-鿿]/.test(out), `en 中混入中文：${out}`);
        }
      }
    }
  }
  I18N.setLang('zh');
});

test('二阶提示：随机打乱（含整体转动和 L/D/B）都给出不超过 11 步的最短解', () => {
  const C2 = RubikCube.create(2);
  const opt = RubikSolver.createOptimal2(C2);
  const apply2 = (st, seq) => { for (const m of seq) st = C2.applyMove(st, m); return st; };
  assert.deepEqual(opt.solve(C2.solvedState()), []);
  assert.equal(opt.solve(apply2(C2.solvedState(), C2.parse('R'))).length, 1);
  assert.equal(opt.solve(apply2(C2.solvedState(), C2.parse("x R U"))).length, 2);
  assert.equal(opt.solve(apply2(C2.solvedState(), C2.parse("L D'"))).length, 2);
  const extra = ['', 'x', 'y2', 'z L', 'x y D2 B', "L2 D B'"];
  for (let k = 0; k < 60; k++) {
    let st = apply2(C2.solvedState(), C2.scramble(20, rng));
    st = apply2(st, C2.parse(extra[k % extra.length]));
    const sol = opt.solve(st);
    assert.ok(sol && sol.length <= 11, `第 ${k} 个：${sol && sol.length} 步`);
    assert.ok(C2.isSolved(apply2(st, sol)), `第 ${k} 个没有还原`);
  }
});

test('层先法：每一步都很快算出来', () => {
  const t0 = Date.now();
  let n = 0;
  for (let k = 0; k < 40; k++) n += solver.solveAll(applySeq(C.solvedState(), C.scramble(25, rng))).steps.length;
  const per = (Date.now() - t0) / n;
  assert.ok(per < 30, `平均每步 ${per.toFixed(1)} ms`);
});
