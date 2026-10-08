/*!
 * solver.js — 三阶魔方「层先法」分步讲解
 *
 * nextStep(state) 根据当前状态给出「下一小步」：属于哪个阶段、为什么这样转、具体转哪几下，
 * 以及需要高亮的贴纸。每完成一小步再调用一次，用户转错了也能从当前状态重新规划。
 * 讲解文字以「文案键 + 参数」返回（见 i18n.js），界面可以随时切换中英文重新渲染。
 *
 * 阶段：摆正 → 白色十字 → 底层角块 → 第二层棱块 → 顶层十字 → 顶面全黄 → 顶角归位 → 顶棱归位
 * 用到的公式都是新手教程里最常见的那几个：
 *   右手公式 R U R' U'、右插 U R U' R' U' F' U F、左插 U' L' U L U F U' F'、
 *   F R U R' U' F'、小鱼 R U R' U R U2 R'、车灯 R' F R' B2 R F' R' B2 R2、
 *   三棱换 R U' R U R U R U' R' U' R2
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RubikSolver = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const U = 0, R = 1, F = 2, D = 3, L = 4, B = 5;
  const OPP = [3, 4, 5, 0, 1, 2];
  const WHITE = 3, YELLOW = 0; // 颜色编号 = 原始面编号（U 黄 R 橙 F 绿 D 白 L 红 B 蓝）

  const STAGES = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({
    titleKey: 'stage.' + i,
    chapter: i === 0 ? 1 : i,
  }));

  // 文案描述符：{ key, params }；颜色参数 { color } / { colorL }（带「色」字的长写法）
  const M = (key, params) => ({ key, params });
  const C = c => ({ color: c });
  const CL = c => ({ colorL: c });
  const edgeName = (a, b) => M('piece.edge', { a: C(a), b: C(b) });
  const cornerName = (a, b, c) => M('piece.corner', { a: C(a), b: C(b), c: C(c) });

  function create(model) {
    if (model.N !== 3) throw new Error('层先法教学只支持三阶魔方');
    const S = model.SLOTS;
    const P = str => model.parse(str);
    const col = (st, s) => model.colorOf(st[s]);
    const fc = (st, f) => col(st, f * 9 + 4);
    const applySeq = (st, seq) => { for (const m of seq) st = model.applyMove(st, m); return st; };
    const cubieAt = faces => model.CUBIES.find(c =>
      c.slots.length === faces.length && faces.every(f => c.slots.some(s => S[s].face === f)));
    const slotOn = (pc, f) => pc.slots.find(s => S[s].face === f);
    const SIDES = [F, R, B, L];
    const PAIRS = [[F, R], [R, B], [B, L], [L, F]];
    const DFR = cubieAt([D, F, R]), UFR = cubieAt([U, F, R]), UFL = cubieAt([U, F, L]);
    const UF = cubieAt([U, F]), UB = cubieAt([U, B]);
    const UEDGE = SIDES.map(f => cubieAt([U, f]));
    const UCORNER = PAIRS.map(([a, b]) => cubieAt([U, a, b]));

    const ALG = {
      sexy: P("R U R' U'"),
      right: P("U R U' R' U' F' U F"),
      left: P("U' L' U L U F U' F'"),
      fruruf: P("F R U R' U' F'"),
      sune: P("R U R' U R U2 R'"),
      aperm: P("R' F R' B2 R F' R' B2 R2"),
      uperm: P("R U' R U R U R U' R' U' R2"),
    };
    const uTurn = k => [[], P('U'), P('U2'), P("U'")][((k % 4) + 4) % 4];
    const yTurn = k => [[], P('y'), P('y2'), P("y'")][((k % 4) + 4) % 4];
    const repeat = (seq, n) => { let out = []; for (let i = 0; i < n; i++) out = out.concat(seq); return out; };

    function findPiece(st, colors) {
      for (const pc of model.CUBIES) {
        if (pc.slots.length !== colors.length) continue;
        const cs = pc.slots.map(s => col(st, s));
        if (colors.every(c => cs.includes(c))) return pc;
      }
      return null;
    }
    const solvedPiece = (st, pc) => pc.slots.every(s => col(st, s) === fc(st, S[s].face));
    const faceOfColor = (st, c) => [0, 1, 2, 3, 4, 5].find(f => fc(st, f) === c);
    const idsOf = (st, pc) => pc.slots.map(s => st[s]);
    const centerIds = (st, faces) => faces.map(f => st[f * 9 + 4]);

    // ---------- 各阶段是否完成 ----------
    const orientOk = st => fc(st, D) === WHITE;
    const crossOk = st => SIDES.every(f => solvedPiece(st, cubieAt([D, f])));
    const cornersOk = st => PAIRS.every(([a, b]) => solvedPiece(st, cubieAt([D, a, b])));
    const middleOk = st => PAIRS.every(([a, b]) => solvedPiece(st, cubieAt([a, b])));
    const yEdgesUp = st => UEDGE.map(pc => col(st, slotOn(pc, U)) === YELLOW);
    const yCornersUp = st => UCORNER.map(pc => col(st, slotOn(pc, U)) === YELLOW);
    const topCornersOk = st => UCORNER.every(pc => solvedPiece(st, pc));
    function progress(st) {
      const done = [orientOk(st)];
      done.push(done[0] && crossOk(st));
      done.push(done[1] && cornersOk(st));
      done.push(done[2] && middleOk(st));
      done.push(done[3] && yEdgesUp(st).every(Boolean));
      done.push(done[4] && yCornersUp(st).every(Boolean));
      done.push(done[5] && topCornersOk(st));
      done.push(model.isSolved(st) && done[6]);
      return done;
    }

    // ---------- 小范围搜索（只追踪少数几张贴纸，快） ----------
    const FACE_MOVES = [];
    for (let f = 0; f < 6; f++) {
      for (const amount of [1, -1, 2]) {
        const m = model.faceMove(f, amount);
        FACE_MOVES.push({ face: f, move: m, perm: model.movePerm(m) });
      }
    }
    // 在恰好 depth 步内找一条让 goal 成立的转法（迭代加深由调用方负责）
    function search(tracked, goal, depth) {
      const cur = Int16Array.from(tracked);
      const path = [];
      function dfs(left, last) {
        if (left === 0) return goal(cur);
        for (let i = 0; i < FACE_MOVES.length; i++) {
          const mv = FACE_MOVES[i];
          if (mv.face === last || (last >= 0 && OPP[mv.face] === last && mv.face > last)) continue;
          const saved = Int16Array.from(cur);
          for (let k = 0; k < cur.length; k++) cur[k] = mv.perm[cur[k]];
          path.push(mv.move);
          if (dfs(left - 1, mv.face)) return true;
          path.pop();
          cur.set(saved);
        }
        return false;
      }
      return dfs(depth, -1) ? path.slice() : null;
    }

    const part = (labelKey, moves, params) => ({ label: M(labelKey, params), moves });
    function step(stage, title, text, parts, focus, focus2) {
      const moves = [];
      for (const p of parts) for (const m of p.moves) moves.push(m);
      return {
        stage, chapter: STAGES[stage].chapter, stageTitle: M(STAGES[stage].titleKey),
        title, text, parts: parts.filter(p => p.moves.length), moves,
        focus: focus || [], focus2: focus2 || [],
      };
    }

    // ---------- 阶段 0：摆正（白色中心朝下） ----------
    function orientStep(st) {
      for (const c of ['x2', 'x', "x'", 'z', "z'"]) {
        const seq = P(c);
        if (fc(applySeq(st, seq), D) === WHITE) {
          return step(0, M('s0.title'), M('s0.text'), [part('part.rotate', seq)],
            centerIds(st, [0, 1, 2, 3, 4, 5].filter(f => fc(st, f) === WHITE)));
        }
      }
      return null;
    }

    // ---------- 阶段 1：白色十字 ----------
    function crossStep(st) {
      const Uperm = model.movePerm(P('U')[0]);
      const done = SIDES.filter(f => solvedPiece(st, cubieAt([D, f]))).length;
      // 1) 顶层已有白色朝上的棱块：转 U 对准颜色，再把那一面转 180°
      let best = null;
      for (const f of SIDES) {
        const pc = cubieAt([U, f]);
        if (col(st, slotOn(pc, U)) !== WHITE) continue;
        const side = slotOn(pc, f), c = col(st, side), target = faceOfColor(st, c);
        let k = 0, s = side;
        while (S[s].face !== target && k < 4) { s = Uperm[s]; k++; }
        if (!best || k < best.k) best = { k, pc, c, target };
      }
      if (best) {
        const { k, pc, c, target } = best;
        const drop = model.faceMove(target, 2);
        return step(1,
          M('s1.down.title', { done, c: C(c) }),
          M('s1.down.text', {
            c: C(c), cL: CL(c), m: model.moveToString(drop),
            align: M(k ? 's1.align' : 's1.aligned', { c: C(c), cL: CL(c) }),
          }),
          [part('part.align', uTurn(k)), part('part.down', [drop])],
          idsOf(st, pc), centerIds(st, [target, D]));
      }
      // 2) 否则：挑一块还没归位的白色棱块，用最少的步数把它翻到顶层、白色朝上（不碰坏已拼好的十字臂）
      const keep = [];
      for (const f of SIDES) {
        const pc = cubieAt([D, f]);
        if (solvedPiece(st, pc)) for (const s of pc.slots) keep.push(s);
      }
      const cands = [];
      for (const f of SIDES) {
        const c = fc(st, f), pc = findPiece(st, [WHITE, c]);
        if (pc === cubieAt([D, f]) && solvedPiece(st, pc)) continue;
        cands.push({ c, pc, white: pc.slots.find(s => col(st, s) === WHITE) });
      }
      for (let depth = 1; depth <= 7; depth++) {
        for (const cand of cands) {
          const tracked = [cand.white, ...keep];
          const sol = search(tracked, cur => {
            if (S[cur[0]].face !== U) return false;
            for (let i = 1; i < cur.length; i++) if (cur[i] !== tracked[i]) return false;
            return true;
          }, depth);
          if (sol) {
            const where = cand.pc.slots.some(s => S[s].face === D) ? 's1.where.bottom'
              : cand.pc.slots.some(s => S[s].face === U) ? 's1.where.top' : 's1.where.middle';
            return step(1,
              M('s1.up.title', { done, c: C(cand.c) }),
              M('s1.up.text', { c: C(cand.c), where: M(where) }),
              [part('part.up', sol)], idsOf(st, cand.pc), centerIds(st, [U]));
          }
        }
      }
      return null;
    }

    // ---------- 阶段 2：底层角块 ----------
    function cornerPlan(st, colors) {
      const parts = [];
      let cur = st;
      const name = cornerName(colors[0], colors[1], colors[2]);
      if (findPiece(cur, colors).slots.some(s => S[s].face === D)) {
        // 在底层但不对：转到右前下方，用一次右手公式把它拿到顶层
        let k = 0;
        while (k < 4 && findPiece(applySeq(cur, yTurn(k)), colors) !== DFR) k++;
        parts.push(part('part.rotate', yTurn(k)));
        parts.push(part('part.sexyN', ALG.sexy, { n: 1 }));
        return {
          parts, cost: 100 + parts.reduce((n, p) => n + p.moves.length, 0),
          title: M('s2.pop.title', { name }),
          text: M('s2.pop.text', { name, where: M(k ? 's2.pop.rot' : 's2.pop.here') }),
        };
      }
      // 目标位置（两个侧面颜色之间）转到右前下方
      let j = 0;
      for (; j < 4; j++) {
        const t = applySeq(cur, yTurn(j));
        const pair = [fc(t, F), fc(t, R)];
        if (pair.includes(colors[1]) && pair.includes(colors[2])) break;
      }
      parts.push(part('part.rotate', yTurn(j)));
      cur = applySeq(cur, yTurn(j));
      let m = 0;
      while (m < 4 && findPiece(applySeq(cur, uTurn(m)), colors) !== UFR) m++;
      parts.push(part('part.above', uTurn(m)));
      cur = applySeq(cur, uTurn(m));
      let r = 0;
      while (r < 6 && !(findPiece(cur, colors) === DFR && solvedPiece(cur, DFR))) { cur = applySeq(cur, ALG.sexy); r++; }
      parts.push(part('part.sexyN', repeat(ALG.sexy, r), { n: r }));
      return {
        parts, cost: parts.reduce((n, p) => n + p.moves.length, 0),
        title: M('s2.ins.title', { name }),
        text: M('s2.ins.text', {
          name, a: CL(colors[1]), b: CL(colors[2]), r,
          s1: M(j ? 's2.s1.rot' : 's2.s1.here'), s2: M(m ? 's2.s2.move' : 's2.s2.here'),
        }),
      };
    }
    function cornersStep(st) {
      const done = PAIRS.filter(([a, b]) => solvedPiece(st, cubieAt([D, a, b]))).length;
      let best = null;
      for (const [a, b] of PAIRS) {
        if (solvedPiece(st, cubieAt([D, a, b]))) continue;
        const colors = [WHITE, fc(st, a), fc(st, b)];
        const plan = cornerPlan(st, colors);
        plan.colors = colors;
        if (!best || plan.cost < best.cost) best = plan;
      }
      best.title.params.done = done;
      const pc = findPiece(st, best.colors);
      return step(2, best.title, best.text, best.parts, idsOf(st, pc),
        centerIds(st, [faceOfColor(st, best.colors[1]), faceOfColor(st, best.colors[2])]));
    }

    // ---------- 阶段 3：第二层棱块 ----------
    function middleStep(st) {
      const done = PAIRS.filter(([a, b]) => solvedPiece(st, cubieAt([a, b]))).length;
      let best = null;
      for (const f of SIDES) {
        const pc = cubieAt([U, f]);
        const top = col(st, slotOn(pc, U)), side = col(st, slotOn(pc, f));
        if (top === YELLOW || side === YELLOW) continue;
        const parts = [];
        let j = 0;
        while (j < 4 && fc(applySeq(st, yTurn(j)), F) !== side) j++;
        parts.push(part('part.rotate', yTurn(j)));
        let cur = applySeq(st, yTurn(j));
        const colors = [top, side];
        let m = 0;
        while (m < 4) {
          const t = applySeq(cur, uTurn(m));
          if (findPiece(t, colors) === UF && col(t, slotOn(UF, F)) === side) break;
          m++;
        }
        parts.push(part('part.align', uTurn(m)));
        cur = applySeq(cur, uTurn(m));
        const toRight = top === fc(cur, R);
        parts.push(part(toRight ? 'part.right' : 'part.left', toRight ? ALG.right : ALG.left));
        const cost = parts.reduce((n, p) => n + p.moves.length, 0);
        if (!best || cost < best.cost) best = { cost, parts, top, side, toRight, pc, j, m };
      }
      if (best) {
        const { top, side, toRight, pc, j, m } = best;
        return step(3,
          M('s3.ins.title', { done, name: edgeName(side, top) }),
          M('s3.ins.text', {
            name: edgeName(side, top), topL: CL(top),
            s1: M(j ? 's3.s1.rot' : 's3.s1.here', { sideL: CL(side) }),
            s2: M(m ? 's3.s2.move' : 's3.s2.here', { sideL: CL(side) }),
            dir: M(toRight ? 'dir.right' : 'dir.left'),
            alg: M(toRight ? 'alg.right' : 'alg.left'),
            algMoves: toRight ? "U R U' R' U' F' U F" : "U' L' U L U F U' F'",
          }),
          best.parts, idsOf(st, pc), centerIds(st, [faceOfColor(st, side), faceOfColor(st, top)]));
      }
      // 顶层没有可用的棱：中间层有放错的，先用右插公式把它换出来
      for (const [a, b] of PAIRS) {
        const pos = cubieAt([a, b]);
        if (solvedPiece(st, pos)) continue;
        const ca = fc(st, a), cb = fc(st, b);
        let j = 0;
        while (j < 4) {
          const t = applySeq(st, yTurn(j));
          const pair = [fc(t, F), fc(t, R)];
          if (pair.includes(ca) && pair.includes(cb)) break;
          j++;
        }
        const [c1, c2] = pos.slots.map(s => col(st, s));
        return step(3,
          M('s3.pop.title', { done }),
          M('s3.pop.text', { name: edgeName(c1, c2), where: M(j ? 's3.pop.rot' : 's3.pop.here') }),
          [part('part.rotate', yTurn(j)), part('part.right', ALG.right)], idsOf(st, pos));
      }
      return null;
    }

    // ---------- 阶段 4：顶层十字 ----------
    function yCrossStep(st) {
      const ups = yEdgesUp(st); // [F, R, B, L]
      const n = ups.filter(Boolean).length;
      let k = 0, shape, how;
      if (n === 0) { shape = 'shape.dot'; how = 's4.how.dot'; }
      else if ((ups[0] && ups[2]) || (ups[1] && ups[3])) {
        shape = 'shape.line';
        while (k < 4 && !(yEdgesUp(applySeq(st, uTurn(k))).every((v, i) => v === (i === 1 || i === 3)))) k++;
        how = k ? 's4.how.line.rot' : 's4.how.line.here';
      } else {
        shape = 'shape.L';
        while (k < 4 && !(yEdgesUp(applySeq(st, uTurn(k))).every((v, i) => v === (i === 2 || i === 3)))) k++;
        how = k ? 's4.how.L.rot' : 's4.how.L.here';
      }
      return step(4, M('s4.title', { shape: M(shape) }), M('s4.text', { shape: M(shape), how: M(how) }),
        [part('part.adjust', uTurn(k)), { label: "F R U R' U' F'", moves: ALG.fruruf }],
        UEDGE.map(pc => st[slotOn(pc, U)]), centerIds(st, [U]));
    }

    // ---------- 阶段 5：顶面全黄（小鱼公式） ----------
    function yFaceStep(st) {
      const n = yCornersUp(st).filter(Boolean).length;
      let rule, goal, cond;
      if (n === 1) { rule = M('s5.rule1'); goal = 's5.goal1'; cond = t => col(t, slotOn(UFL, U)) === YELLOW; }
      else if (n === 0) { rule = M('s5.rule0'); goal = 's5.goal0'; cond = t => col(t, slotOn(UFL, L)) === YELLOW; }
      else { rule = M('s5.ruleN', { n }); goal = 's5.goal2'; cond = t => col(t, slotOn(UFL, F)) === YELLOW; }
      let k = 0;
      while (k < 4 && !cond(applySeq(st, uTurn(k)))) k++;
      if (k === 4) k = 0;
      return step(5, M('s5.title', { n }), M('s5.text', { rule, how: M(k ? 's5.turn' : 's5.now'), goal: M(goal) }),
        [part('part.adjust', uTurn(k)), part('part.sune', ALG.sune)],
        UCORNER.map(pc => st[slotOn(pc, U)]), centerIds(st, [U]));
    }

    // ---------- 阶段 6：顶角归位（车灯） ----------
    function topCornersStep(st) {
      for (let k = 0; k < 4; k++) {
        if (topCornersOk(applySeq(st, uTurn(k)))) {
          return step(6, M('s6.align.title'), M('s6.align.text'),
            [part('part.alignTop', uTurn(k))], UCORNER.flatMap(pc => idsOf(st, pc)));
        }
      }
      const lights = SIDES.filter(f => {
        const [a, b] = UCORNER.filter(pc => pc.slots.some(s => S[s].face === f));
        return col(st, slotOn(a, f)) === col(st, slotOn(b, f));
      });
      let k = 0, text;
      if (lights.length) {
        while (k < 4) {
          const t = applySeq(st, uTurn(k));
          const [a, b] = UCORNER.filter(pc => pc.slots.some(s => S[s].face === B));
          if (col(t, slotOn(a, B)) === col(t, slotOn(b, B))) break;
          k++;
        }
        text = M('s6.lights', { how: M(k ? 's6.how.rot' : 's6.how.here') });
      } else {
        text = M('s6.none');
      }
      return step(6, M('s6.title'), text,
        [part('part.lightsBack', uTurn(k)), part('part.aperm', ALG.aperm)],
        UCORNER.flatMap(pc => idsOf(st, pc)));
    }

    // ---------- 阶段 7：顶棱归位 ----------
    function topEdgesStep(st) {
      const solvedSides = SIDES.filter(f => solvedPiece(st, cubieAt([U, f])));
      let j = 0, text;
      if (solvedSides.length) {
        while (j < 4 && !solvedPiece(applySeq(st, yTurn(j)), UB)) j++;
        text = M('s7.bar', { how: M(j ? 's7.how.rot' : 's7.how.here') });
      } else {
        text = M('s7.none');
      }
      return step(7, M('s7.title'), text,
        [part('part.barBack', yTurn(j)), part('part.uperm', ALG.uperm)],
        UEDGE.flatMap(pc => idsOf(st, pc)));
    }

    function nextStep(st) {
      if (!orientOk(st)) return orientStep(st);
      if (!crossOk(st)) return crossStep(st);
      if (!cornersOk(st)) return cornersStep(st);
      if (!middleOk(st)) return middleStep(st);
      if (!yEdgesUp(st).every(Boolean)) return yCrossStep(st);
      if (!yCornersUp(st).every(Boolean)) return yFaceStep(st);
      if (!topCornersOk(st)) return topCornersStep(st);
      if (!model.isSolved(st)) return topEdgesStep(st);
      return { done: true, stage: 8, chapter: 8, title: M('tut.done.title'), text: M('tut.done.text'), parts: [], moves: [], focus: [], focus2: [] };
    }

    // 一口气求出完整解法（测试、演示用）
    function solveAll(st, maxSteps = 80) {
      const steps = [];
      for (let i = 0; i < maxSteps; i++) {
        const s = nextStep(st);
        if (!s || s.done) return { steps, state: st, solved: !!(s && s.done) };
        steps.push(s);
        st = applySeq(st, s.moves);
      }
      return { steps, state: st, solved: false };
    }

    return { nextStep, solveAll, progress, STAGES };
  }

  return { create, STAGES };
});
