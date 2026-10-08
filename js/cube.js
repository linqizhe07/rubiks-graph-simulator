/*!
 * cube.js — 3×3×3 魔方模型
 *
 * 54 个贴纸槽位（slot），每一步转动都是这 54 个槽位上的一个置换。
 * 坐标系：x → R，y → U，z → F（右手系），每个贴纸由所在小块的位置 pos 与朝向 normal 唯一确定。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RubikCube = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 面的顺序采用常见的 facelet 约定：U R F D L B
  const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  const NORMALS = [
    [0, 1, 0], [1, 0, 0], [0, 0, 1],
    [0, -1, 0], [-1, 0, 0], [0, 0, -1],
  ];

  // 每个面按展开图的习惯（从外面看）编号：row 0..2 自上而下，col 0..2 自左而右
  function stickerPos(f, r, c) {
    const a = r - 1, b = c - 1;
    switch (FACES[f]) {
      case 'U': return [b, 1, a];
      case 'R': return [1, -a, -b];
      case 'F': return [b, -a, 1];
      case 'D': return [b, -1, -a];
      case 'L': return [-1, -a, b];
      case 'B': return [-b, -a, -1];
    }
    throw new Error('bad face');
  }

  const key = (p, n) => p.join(',') + '|' + n.join(',');
  const SLOTS = [];
  const slotByKey = new Map();
  for (let f = 0; f < 6; f++) {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const pos = stickerPos(f, r, c).map(v => v || 0); // 去掉 -0
        const normal = NORMALS[f];
        const index = SLOTS.length;
        SLOTS.push({
          index, face: f, row: r, col: c, pos, normal,
          axis: normal.findIndex(v => v !== 0),
          name: FACES[f] + (r * 3 + c + 1),
        });
        slotByKey.set(key(pos, normal), index);
      }
    }
  }
  const slotAt = (pos, normal) => slotByKey.get(key(pos, normal));

  // 绕坐标轴旋转 s·90°（右手定则，s = ±1）
  function rot(v, axis, s) {
    const x = v[0], y = v[1], z = v[2];
    if (axis === 0) return [x, -s * z, s * y];
    if (axis === 1) return [s * z, y, -s * x];
    return [-s * y, s * x, z];
  }

  // 基本转动：axis 转轴，layers 参与转动的层坐标，turn 为绕 +axis 的四分之一圈数（顺时针记号对应的方向）
  const BASE = {
    R: { axis: 0, layers: [1], turn: -1 },
    L: { axis: 0, layers: [-1], turn: 1 },
    M: { axis: 0, layers: [0], turn: 1 },
    U: { axis: 1, layers: [1], turn: -1 },
    D: { axis: 1, layers: [-1], turn: 1 },
    E: { axis: 1, layers: [0], turn: 1 },
    F: { axis: 2, layers: [1], turn: -1 },
    B: { axis: 2, layers: [-1], turn: 1 },
    S: { axis: 2, layers: [0], turn: -1 },
    r: { axis: 0, layers: [0, 1], turn: -1 },
    l: { axis: 0, layers: [-1, 0], turn: 1 },
    u: { axis: 1, layers: [0, 1], turn: -1 },
    d: { axis: 1, layers: [-1, 0], turn: 1 },
    f: { axis: 2, layers: [0, 1], turn: -1 },
    b: { axis: 2, layers: [-1, 0], turn: 1 },
    x: { axis: 0, layers: [-1, 0, 1], turn: -1 },
    y: { axis: 1, layers: [-1, 0, 1], turn: -1 },
    z: { axis: 2, layers: [-1, 0, 1], turn: -1 },
  };

  // 置换约定：perm[s] = 位于槽位 s 的贴纸转动后到达的槽位
  function identity() {
    const p = new Int16Array(54);
    for (let i = 0; i < 54; i++) p[i] = i;
    return p;
  }
  // 先 p 后 q
  function compose(p, q) {
    const r = new Int16Array(54);
    for (let i = 0; i < 54; i++) r[i] = q[p[i]];
    return r;
  }
  function inverse(p) {
    const r = new Int16Array(54);
    for (let i = 0; i < 54; i++) r[p[i]] = i;
    return r;
  }

  const quarterCache = new Map();
  function quarterPerm(axis, layers, s) {
    const k = axis + ':' + layers.join(',') + ':' + s;
    let p = quarterCache.get(k);
    if (p) return p;
    p = new Int16Array(54);
    for (const slot of SLOTS) {
      p[slot.index] = layers.includes(slot.pos[axis])
        ? slotAt(rot(slot.pos, axis, s), rot(slot.normal, axis, s))
        : slot.index;
    }
    quarterCache.set(k, p);
    return p;
  }

  // 绕 +axis 的带符号四分之一圈数
  const moveTurns = m => BASE[m.base].turn * m.amount;

  const moveCache = new Map();
  function movePerm(m) {
    const k = m.base + m.amount;
    let p = moveCache.get(k);
    if (p) return p;
    const b = BASE[m.base];
    if (!b) throw new Error('未知转动：' + m.base);
    const t = moveTurns(m);
    const q = quarterPerm(b.axis, b.layers, Math.sign(t));
    p = identity();
    for (let i = 0; i < Math.abs(t); i++) p = compose(p, q);
    moveCache.set(k, p);
    return p;
  }

  function seqPerm(seq) {
    let p = identity();
    for (const m of seq) p = compose(p, movePerm(m));
    return p;
  }

  // state[slot] = 贴纸编号（0..53，编号 / 9 即原始面 = 颜色）
  function solvedState() { return identity(); }
  function applyPerm(state, p) {
    const next = new Int16Array(54);
    for (let i = 0; i < 54; i++) next[p[i]] = state[i];
    return next;
  }
  const applyMove = (state, m) => applyPerm(state, movePerm(m));
  const colorOf = id => (id / 9) | 0;

  function isSolved(state) {
    for (let f = 0; f < 6; f++) {
      const c = colorOf(state[f * 9]);
      for (let i = 1; i < 9; i++) if (colorOf(state[f * 9 + i]) !== c) return false;
    }
    return true;
  }

  // ---------- 记号 ----------
  function moveToString(m) {
    const a = m.amount;
    return m.base + (Math.abs(a) === 2 ? '2' : '') + (a < 0 ? "'" : '');
  }
  const seqToString = seq => seq.map(moveToString).join(' ');
  const invertMove = m => ({ base: m.base, amount: -m.amount });
  const invertSeq = seq => seq.slice().reverse().map(invertMove);

  /**
   * 解析公式。支持：R U' F2 M x Rw r，括号重复 (R U)6、(R U)'，
   * 交换子 [A, B] = A B A' B'，共轭 [A: B] = A B A'。
   */
  const MAX_PARSED = 5000;
  function parse(str) {
    const s = String(str).replace(/[’‘`´′]/g, "'");
    let i = 0;
    const fail = msg => { throw new SyntaxError(msg); };
    const where = () => `（第 ${i + 1} 个字符）`;
    function suffix() {
      let num = '';
      while (i < s.length && /\d/.test(s[i])) num += s[i++];
      let prime = false;
      if (s[i] === "'") { prime = true; i++; }
      if (!num) while (i < s.length && /\d/.test(s[i])) num += s[i++];
      return { n: num ? parseInt(num, 10) : 1, prime };
    }
    function repeat(out, unit, n) {
      if (out.length + unit.length * n > MAX_PARSED) fail(`公式展开后超过 ${MAX_PARSED} 步`);
      for (let k = 0; k < n; k++) for (const m of unit) out.push(m);
    }
    function seq(stop) {
      const out = [];
      for (;;) {
        while (i < s.length && /\s/.test(s[i])) i++;
        if (i >= s.length) {
          if (stop) fail(`缺少「${stop === ',:' ? ', 或 :' : stop}」`);
          return out;
        }
        const ch = s[i];
        if (stop && stop.includes(ch)) return out;
        if (')],:'.includes(ch)) fail(`多余的「${ch}」${where()}`);
        if (ch === '(') {
          i++;
          const inner = seq(')');
          i++;
          const { n, prime } = suffix();
          repeat(out, prime ? invertSeq(inner) : inner, n);
          continue;
        }
        if (ch === '[') {
          i++;
          const a = seq(',:');
          const sep = s[i++];
          const b = seq(']');
          i++;
          const { n, prime } = suffix();
          let unit = sep === ','
            ? a.concat(b, invertSeq(a), invertSeq(b))
            : a.concat(b, invertSeq(a));
          if (prime) unit = invertSeq(unit);
          repeat(out, unit, n);
          continue;
        }
        if (!/[UDLRFBMESudlrfbxyzXYZ]/.test(ch)) fail(`无法识别的字符「${ch}」${where()}`);
        let base = /[XYZ]/.test(ch) ? ch.toLowerCase() : ch;
        i++;
        if (s[i] === 'w' && 'UDLRFB'.includes(base)) { base = base.toLowerCase(); i++; }
        const { n: raw, prime } = suffix();
        let n = raw % 4, p = prime;
        if (n === 0) continue;
        if (n === 3) { n = 1; p = !p; }
        repeat(out, [{ base, amount: p ? -n : n }], 1);
      }
    }
    return seq(null);
  }

  // 合并相邻的同名转动（R R → R2，R R' → 抵消）
  function simplify(seq) {
    const out = [];
    for (const m of seq) {
      const last = out[out.length - 1];
      if (last && last.base === m.base) {
        let a = ((last.amount + m.amount) % 4 + 4) % 4;
        out.pop();
        if (a === 0) continue;
        if (a === 3) a = -1;
        out.push({ base: m.base, amount: a });
      } else {
        out.push({ base: m.base, amount: m.amount });
      }
    }
    return out;
  }

  // ---------- 置换分析 ----------
  function cycles(p) {
    const seen = new Uint8Array(54), out = [];
    for (let i = 0; i < 54; i++) {
      if (seen[i]) continue;
      const cyc = [];
      for (let j = i; !seen[j]; j = p[j]) { seen[j] = 1; cyc.push(j); }
      out.push(cyc);
    }
    return out;
  }
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const order = p => cycles(p).reduce((acc, c) => (acc / gcd(acc, c.length)) * c.length, 1);

  // ---------- 打乱 ----------
  function scramble(n = 22, rng = Math.random) {
    const faces = 'UDLRFB';
    const axisOf = { U: 1, D: 1, L: 0, R: 0, F: 2, B: 2 };
    const amounts = [1, -1, 2];
    const seq = [];
    while (seq.length < n) {
      const f = faces[Math.floor(rng() * 6)];
      const k = seq.length;
      if (k > 0 && seq[k - 1].base === f) continue;
      if (k > 1 && axisOf[seq[k - 1].base] === axisOf[f] && axisOf[seq[k - 2].base] === axisOf[f]) continue;
      seq.push({ base: f, amount: amounts[Math.floor(rng() * 3)] });
    }
    return seq;
  }

  return {
    FACES, NORMALS, SLOTS, BASE,
    slotAt, rot, quarterPerm, movePerm, moveTurns, seqPerm,
    identity, compose, inverse, applyPerm, applyMove, solvedState, colorOf, isSolved,
    moveToString, seqToString, invertMove, invertSeq, parse, simplify,
    cycles, order, scramble,
  };
});
