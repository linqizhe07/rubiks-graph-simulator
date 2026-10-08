/*!
 * cube.js — N×N×N 魔方模型
 *
 * 6N² 个贴纸槽位（slot），每一步转动都是这些槽位上的一个置换。
 * 坐标系：x → R，y → U，z → F（右手系）。为了让任意阶都用整数运算，
 * 采用「双倍坐标」：每个轴上的层坐标是 -(N-1), -(N-3), …, N-1。
 *
 * 一步转动统一表示为 { axis, layers, turns }：
 *   axis   0/1/2 = x/y/z
 *   layers 参与转动的层号（0 = 负方向 L/D/B 一侧，N-1 = 正方向 R/U/F 一侧）
 *   turns  绕 +axis 的四分之一圈数（右手定则），取值 ±1 或 ±2
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RubikCube = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 面的顺序采用常见的 facelet 约定：U R F D L B
  const FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  const NORMALS = [[0, 1, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0], [-1, 0, 0], [0, 0, -1]];
  const FACE_AXIS = [1, 0, 2, 1, 0, 2];
  // 各面「顺时针」对应的绕 +axis 四分之一圈数：U R F 为 -1，D L B 为 +1
  const FACE_CW = [-1, -1, -1, 1, 1, 1];
  const AXIS_LETTER = ['x', 'y', 'z'];
  const POS_FACE = ['R', 'U', 'F'], NEG_FACE = ['L', 'D', 'B'];
  const MID_LETTER = ['M', 'E', 'S'], MID_REF = [1, 1, -1]; // M 随 L、E 随 D、S 随 F
  const LETTER_INFO = { R: [0, 1], L: [0, -1], U: [1, 1], D: [1, -1], F: [2, 1], B: [2, -1] };

  // 绕坐标轴旋转 s·90°（右手定则，s = ±1）
  function rot(v, axis, s) {
    const x = v[0], y = v[1], z = v[2];
    if (axis === 0) return [x, -s * z, s * y];
    if (axis === 1) return [s * z, y, -s * x];
    return [-s * y, s * x, z];
  }
  const range = (lo, hi) => { const a = []; for (let i = lo; i <= hi; i++) a.push(i); return a; };

  // 解析错误：message 为中文，e.i18n 给界面按当前语言显示
  const ERR_ZH = {
    char: '无法识别的字符「{ch}」（第 {pos} 个字符）',
    missingLetter: '「{pre}」后面缺少转动字母',
    rotPrefix: '「{text}」：整体转动前面不能带数字',
    midPrefix: '「{text}」：中层转动前面不能带数字',
    midEven: '{ch} 只适用于奇数阶魔方（{n} 阶没有正中间那一层）',
    range: '「{text}」超出了 {n} 阶魔方的层数',
    tooLong: '公式展开后超过 {max} 步',
    missing: '缺少「{what}」',
    extra: '多余的「{ch}」（第 {pos} 个字符）',
  };
  function fail(code, params) {
    const e = new SyntaxError(ERR_ZH[code].replace(/\{(\w+)\}/g, (_, k) => params[k]));
    e.i18n = { key: 'err.' + code, params };
    throw e;
  }

  const MIN_N = 2, MAX_N = 7;
  const models = new Map();

  function create(N) {
    N = Math.round(N);
    if (!(N >= MIN_N && N <= MAX_N)) throw new RangeError(`阶数需在 ${MIN_N} 到 ${MAX_N} 之间`);
    if (models.has(N)) return models.get(N);
    const K = N - 1, NN = N * N, STICKERS = 6 * NN;
    const layerOf = c => (c + K) / 2;

    // 每个面按展开图的习惯（从外面看）编号：row 自上而下，col 自左而右
    function stickerPos(f, r, c) {
      const a = 2 * r - K, b = 2 * c - K;
      switch (FACES[f]) {
        case 'U': return [b, K, a];
        case 'R': return [K, -a, -b];
        case 'F': return [b, -a, K];
        case 'D': return [b, -K, -a];
        case 'L': return [-K, -a, b];
        case 'B': return [-b, -a, -K];
      }
      throw new Error('bad face');
    }

    const key = (p, n) => p.join(',') + '|' + n.join(',');
    const SLOTS = [];
    const slotByKey = new Map();
    for (let f = 0; f < 6; f++) {
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const pos = stickerPos(f, r, c).map(v => v || 0); // 去掉 -0
          const normal = NORMALS[f];
          const index = SLOTS.length;
          SLOTS.push({
            index, face: f, row: r, col: c, pos, normal,
            axis: FACE_AXIS[f], layer: pos.map(layerOf),
            name: FACES[f] + (r * N + c + 1),
          });
          slotByKey.set(key(pos, normal), index);
        }
      }
    }
    const slotAt = (pos, normal) => slotByKey.get(key(pos, normal));

    // 表面上的小块（中心 / 棱 / 角 ……），按位置分组
    const cubieMap = new Map();
    for (const s of SLOTS) {
      const k = s.pos.join(',');
      if (!cubieMap.has(k)) cubieMap.set(k, { pos: s.pos, slots: [] });
      cubieMap.get(k).slots.push(s.index);
    }
    const CUBIES = [...cubieMap.values()];

    // ---------- 置换 ----------
    // 约定：perm[s] = 位于槽位 s 的贴纸转动后到达的槽位
    function identity() {
      const p = new Int16Array(STICKERS);
      for (let i = 0; i < STICKERS; i++) p[i] = i;
      return p;
    }
    function compose(p, q) { // 先 p 后 q
      const r = new Int16Array(STICKERS);
      for (let i = 0; i < STICKERS; i++) r[i] = q[p[i]];
      return r;
    }
    function inverse(p) {
      const r = new Int16Array(STICKERS);
      for (let i = 0; i < STICKERS; i++) r[p[i]] = i;
      return r;
    }

    const quarterCache = new Map();
    function quarterPerm(axis, layers, s) {
      const k = axis + ':' + layers.join(',') + ':' + s;
      let p = quarterCache.get(k);
      if (p) return p;
      const inLayer = new Uint8Array(N);
      for (const l of layers) inLayer[l] = 1;
      p = new Int16Array(STICKERS);
      for (const slot of SLOTS) {
        p[slot.index] = inLayer[slot.layer[axis]]
          ? slotAt(rot(slot.pos, axis, s), rot(slot.normal, axis, s))
          : slot.index;
      }
      quarterCache.set(k, p);
      return p;
    }

    const moveKey = m => m.axis + '|' + m.layers.join(',') + '|' + m.turns;
    const moveCache = new Map();
    function movePerm(m) {
      const k = moveKey(m);
      let p = moveCache.get(k);
      if (p) return p;
      const q = quarterPerm(m.axis, m.layers, Math.sign(m.turns));
      p = identity();
      for (let i = 0; i < Math.abs(m.turns); i++) p = compose(p, q);
      moveCache.set(k, p);
      return p;
    }
    function seqPerm(seq) {
      let p = identity();
      for (const m of seq) p = compose(p, movePerm(m));
      return p;
    }

    // state[slot] = 贴纸编号（0..6N²-1，编号 / N² 即原始面 = 颜色）
    const solvedState = identity;
    function applyPerm(state, p) {
      const next = new Int16Array(STICKERS);
      for (let i = 0; i < STICKERS; i++) next[p[i]] = state[i];
      return next;
    }
    const applyMove = (state, m) => applyPerm(state, movePerm(m));
    const colorOf = id => (id / NN) | 0;
    function isSolved(state) {
      for (let f = 0; f < 6; f++) {
        const c = colorOf(state[f * NN]);
        for (let i = 1; i < NN; i++) if (colorOf(state[f * NN + i]) !== c) return false;
      }
      return true;
    }

    // ---------- 记号 ----------
    const ALL = range(0, K);
    const contiguous = ls => ls.every((l, i) => i === 0 || l === ls[i - 1] + 1);
    // 一步转动的「字母部分」与参考方向（记号顺时针 = turns 乘以 ref）
    function describe(m) {
      const ls = m.layers, n = ls.length, a = m.axis;
      if (n === N) return { letter: AXIS_LETTER[a], ref: -1 };
      const wideName = (face, w) => (w === 1 ? face : w === 2 ? face + 'w' : w + face + 'w');
      if (contiguous(ls) && ls[n - 1] === K) return { letter: wideName(POS_FACE[a], n), ref: -1 };
      if (contiguous(ls) && ls[0] === 0) return { letter: wideName(NEG_FACE[a], n), ref: 1 };
      if (n === 1) return layerInfo(a, ls[0]);
      if (contiguous(ls)) {
        if (K - ls[n - 1] <= ls[0]) return { letter: `${N - ls[n - 1]}-${N - ls[0]}${POS_FACE[a]}w`, ref: -1 };
        return { letter: `${ls[0] + 1}-${ls[n - 1] + 1}${NEG_FACE[a]}w`, ref: 1 };
      }
      return { letter: `[${ls.join(',')}]${AXIS_LETTER[a]}`, ref: -1 };
    }
    // 单独一层的名字：R、2R、M、2L、L ……
    function layerInfo(axis, i) {
      if (N % 2 === 1 && i === K / 2 && N >= 3) return { letter: MID_LETTER[axis], ref: MID_REF[axis] };
      if (i > K / 2) return { letter: (i === K ? '' : N - i) + POS_FACE[axis], ref: -1 };
      return { letter: (i === 0 ? '' : i + 1) + NEG_FACE[axis], ref: 1 };
    }
    const layerName = (axis, i) => layerInfo(axis, i).letter;
    function moveToString(m) {
      const { letter, ref } = describe(m);
      const amount = m.turns * ref;
      return letter + (Math.abs(amount) === 2 ? '2' : '') + (amount < 0 ? "'" : '');
    }
    const seqToString = seq => seq.map(moveToString).join(' ');
    const invertMove = m => ({ axis: m.axis, layers: m.layers, turns: -m.turns });
    const invertSeq = seq => seq.slice().reverse().map(invertMove);
    const sameLayers = (a, b) => a.axis === b.axis && a.layers.length === b.layers.length && a.layers.every((l, i) => l === b.layers[i]);
    // 效果相同（R2 与 R2' 视为相同）
    const sameMove = (a, b) => sameLayers(a, b) && (((a.turns - b.turns) % 4) + 4) % 4 === 0;
    const faceMove = (f, amount) => ({
      axis: FACE_AXIS[f], layers: [NORMALS[f][FACE_AXIS[f]] > 0 ? K : 0], turns: amount * FACE_CW[f],
    });

    /**
     * 解析公式。支持：R U' F2、宽层 Rw / r / 3Rw、单独的内层 2R、
     * 中层 M E S（奇数阶）、整体转动 x y z，括号重复 (R U)6、(R U)'，
     * 交换子 [A, B] = A B A' B'，共轭 [A: B] = A B A'。
     */
    const MAX_PARSED = 5000;
    function parse(str) {
      const s = String(str).replace(/[’‘`´′]/g, "'");
      let i = 0;
      function suffix() {
        let num = '';
        while (i < s.length && /\d/.test(s[i])) num += s[i++];
        let prime = false;
        if (s[i] === "'") { prime = true; i++; }
        if (!num) while (i < s.length && /\d/.test(s[i])) num += s[i++];
        return { n: num ? parseInt(num, 10) : 1, prime };
      }
      function repeat(out, unit, n) {
        if (out.length + unit.length * n > MAX_PARSED) fail('tooLong', { max: MAX_PARSED });
        for (let k = 0; k < n; k++) for (const m of unit) out.push(m);
      }
      function token(out) {
        let pre = '';
        const start = i;
        while (i < s.length && /\d/.test(s[i])) pre += s[i++];
        const ch = s[i];
        if (ch === undefined) fail('missingLetter', { pre });
        if (!/[UDLRFBudlrfbMESxyzXYZ]/.test(ch)) fail('char', { ch, pos: i + 1 });
        i++;
        let wide = false;
        if (s[i] === 'w' && 'UDLRFB'.includes(ch)) { wide = true; i++; }
        const { n: raw, prime } = suffix();
        let n = raw % 4, p = prime;
        if (n === 0) return;
        if (n === 3) { n = 1; p = !p; }
        const amount = p ? -n : n;
        const text = s.slice(start, i);
        let axis, layers, ref;
        if (/[xyzXYZ]/.test(ch)) {
          if (pre) fail('rotPrefix', { text });
          axis = 'xyz'.indexOf(ch.toLowerCase());
          layers = ALL;
          ref = -1;
        } else if (/[MES]/.test(ch)) {
          if (pre) fail('midPrefix', { text });
          if (N % 2 === 0) fail('midEven', { ch, n: N });
          axis = 'MES'.indexOf(ch);
          layers = [K / 2];
          ref = MID_REF[axis];
        } else {
          const upper = ch.toUpperCase();
          const [ax, side] = LETTER_INFO[upper];
          axis = ax;
          ref = side > 0 ? -1 : 1;
          const isWide = wide || ch !== upper;
          const k = pre ? parseInt(pre, 10) : (isWide ? 2 : 1);
          if (k < 1 || k > N) fail('range', { text, n: N });
          if (isWide) layers = side > 0 ? range(N - k, K) : range(0, k - 1);
          else layers = side > 0 ? [N - k] : [k - 1];
        }
        repeat(out, [{ axis, layers, turns: amount * ref }], 1);
      }
      function seq(stop) {
        const out = [];
        for (;;) {
          while (i < s.length && /\s/.test(s[i])) i++;
          if (i >= s.length) {
            if (stop) fail('missing', { what: stop === ',:' ? ', / :' : stop });
            return out;
          }
          const ch = s[i];
          if (stop && stop.includes(ch)) return out;
          if (')],:'.includes(ch)) fail('extra', { ch, pos: i + 1 });
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
            let unit = sep === ',' ? a.concat(b, invertSeq(a), invertSeq(b)) : a.concat(b, invertSeq(a));
            if (prime) unit = invertSeq(unit);
            repeat(out, unit, n);
            continue;
          }
          token(out);
        }
      }
      return seq(null);
    }

    // 合并相邻的同层转动（R R → R2，R R' → 抵消）
    function simplify(seq) {
      const out = [];
      for (const m of seq) {
        const last = out[out.length - 1];
        if (last && sameLayers(last, m)) {
          const t = last.turns + m.turns;
          const q = ((t % 4) + 4) % 4;
          out.pop();
          if (q === 0) continue;
          out.push({ axis: m.axis, layers: m.layers, turns: q === 1 ? 1 : q === 3 ? -1 : 2 * (Math.sign(t) || Math.sign(last.turns)) });
        } else {
          out.push({ axis: m.axis, layers: m.layers, turns: m.turns });
        }
      }
      return out;
    }

    // ---------- 置换分析 ----------
    function cycles(p) {
      const seen = new Uint8Array(STICKERS), out = [];
      for (let i = 0; i < STICKERS; i++) {
        if (seen[i]) continue;
        const cyc = [];
        for (let j = i; !seen[j]; j = p[j]) { seen[j] = 1; cyc.push(j); }
        out.push(cyc);
      }
      return out;
    }
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const order = p => cycles(p).reduce((acc, c) => (acc / gcd(acc, c.length)) * c.length, 1);

    // ---------- 打乱（随机转动；相邻两步不同轴） ----------
    const SCRAMBLE_LEN = { 2: 11, 3: 22, 4: 40, 5: 60, 6: 80, 7: 100 };
    function scramble(len, rng = Math.random) {
      len = len || SCRAMBLE_LEN[N] || 20 * K;
      const pool = [];
      for (let axis = 0; axis < 3; axis++) {
        if (N === 2) { pool.push({ axis, layers: [K], ref: -1 }); continue; }
        for (let w = 1; w <= Math.floor(N / 2); w++) {
          pool.push({ axis, layers: range(N - w, K), ref: -1 });
          pool.push({ axis, layers: range(0, w - 1), ref: 1 });
        }
      }
      const amounts = [1, -1, 2];
      const seq = [];
      let lastAxis = -1;
      while (seq.length < len) {
        const p = pool[Math.floor(rng() * pool.length)];
        if (p.axis === lastAxis) continue;
        seq.push({ axis: p.axis, layers: p.layers, turns: amounts[Math.floor(rng() * 3)] * p.ref });
        lastAxis = p.axis;
      }
      return seq;
    }

    const model = {
      N, K, STICKERS, FACES, NORMALS, FACE_AXIS, FACE_CW, SLOTS, CUBIES, ALL,
      slotAt, quarterPerm, movePerm, seqPerm, identity, compose, inverse,
      solvedState, applyPerm, applyMove, colorOf, isSolved,
      moveToString, seqToString, invertMove, invertSeq, sameMove, sameLayers, moveKey,
      faceMove, layerName, parse, simplify, cycles, order, scramble,
    };
    models.set(N, model);
    return model;
  }

  return { create, FACES, NORMALS, FACE_AXIS, FACE_CW, rot };
});
