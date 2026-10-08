/*!
 * app.js — 阶数切换、状态、动画队列、交互、新手教学与主循环
 *
 * 所有动画都由 requestAnimationFrame 的时间戳驱动（与帧率无关），
 * 在 120Hz / 144Hz 屏幕上自动跑满刷新率；空闲时不重绘。
 */
(function () {
  'use strict';
  const RubikCube = window.RubikCube, RubikGraph = window.RubikGraph, I18N = window.I18N;
  const $ = id => document.getElementById(id);
  const t = (k, p) => I18N.t(k, p);
  const errText = err => (err && err.i18n ? t(err.i18n.key, err.i18n.params) : String(err && err.message));
  // 先定好语言，再注册切换回调（否则用英文打开时回调会在模型初始化之前触发）
  I18N.setLang(I18N.detect());
  const ORDERS = [2, 3, 4, 5, 6, 7];

  const graphCanvas = $('graph'), cubeCanvas = $('cube3d');
  const graphView = window.createGraphView(graphCanvas);
  const cubeView = window.createCubeView(cubeCanvas);

  // ---------- 状态 ----------
  let N = 3, model = null, G = null;
  let stickers = null;        // 画面上的状态（动画播完的部分）
  let logical = null;         // 逻辑状态 = 画面状态 + 队列里所有转动
  let queue = [];             // { move, factor } | { wait: ms }
  let anim = null;            // 当前正在播放的转动
  const history = [];         // 从还原状态起的全部转动（含尚未播放完的）
  const redoStack = [];
  let scrambled = false;      // 离开还原状态后置位，用于还原时的庆祝效果
  const settings = { speed: 50, trails: true, labels: true, names: false, show3d: true, arrows: false };

  let highlight = new Float32Array(9), target = new Float32Array(9);
  const hover = { circle: -1, face: -1 };
  let padHover = null;
  let faceAlpha = 0, faceShown = -1;
  let arrows = null, analysis = null;
  let needGraph = true, need3d = true;
  const bumps = [];
  const guide = { focus: null, focus2: null, next: null };
  let pulse = 0;
  let tutor = null;

  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const fmt = m => model.moveToString(m);
  const circlesOf = m => m.layers.map(l => G.circleIndex(m.axis, l));
  const notify = (m, source) => { if (tutor) tutor.onMove(m, source); };
  const notifyBatch = source => { if (tutor) tutor.onBatch(source); };

  // ---------- 阶数 ----------
  function setOrder(n, opts = {}) {
    N = n;
    model = RubikCube.create(N);
    G = RubikGraph.create(model);
    stickers = model.solvedState();
    logical = stickers;
    queue = [];
    anim = null;
    history.length = 0;
    redoStack.length = 0;
    scrambled = false;
    highlight = new Float32Array(G.CIRCLES.length);
    target = new Float32Array(G.CIRCLES.length);
    bumps.length = 0;
    hover.circle = hover.face = -1;
    padHover = null;
    faceShown = -1;
    faceAlpha = 0;
    graphView.setGraph(G);
    cubeView.setModel(model);
    for (const b of document.querySelectorAll('#orderPicker button')) b.setAttribute('aria-pressed', String(+b.dataset.n === N));
    buildPad();
    refreshPresets();
    analyze();
    updateTexts();
    if (tutor && !opts.fromTutor) tutor.onOrderChange(N);
    try {
      const q = new URLSearchParams(location.search);
      if (N === 3) q.delete('n'); else q.set('n', N);
      q.delete('learn');
      q.delete('hint');
      const s = q.toString();
      window.history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
    } catch (_) { /* file:// 等环境 */ }
    refreshUI();
  }

  // ---------- 队列 ----------
  function push(move, opts = {}) {
    const m = { axis: move.axis, layers: move.layers, turns: move.turns };
    queue.push({ move: m, factor: opts.factor || 1 });
    history.push(m);
    if (!opts.keepRedo) redoStack.length = 0;
    logical = model.applyMove(logical, m);
    if (!opts.silent) notify(m, opts.source || 'user');
    return m;
  }
  function doMove(move, source = 'user') {
    push(move, { source });
    refreshUI();
  }
  // 撤掉还没开始播放的转动（连同历史记录与逻辑状态）
  function dropQueued() {
    while (queue.length) {
      const it = queue[queue.length - 1];
      if (it.wait) { queue.pop(); continue; }
      if (history.length && history[history.length - 1] === it.move) {
        queue.pop();
        history.pop();
        logical = model.applyMove(logical, model.invertMove(it.move));
        continue;
      }
      break;
    }
  }
  function undo() {
    if (!history.length) return;
    const m = history.pop();
    redoStack.push(m);
    const last = queue[queue.length - 1];
    if (last && last.move === m) queue.pop();
    else queue.push({ move: model.invertMove(m), factor: 1 });
    logical = model.applyMove(logical, model.invertMove(m));
    notify(model.invertMove(m), 'undo');
    refreshUI();
  }
  function redo() {
    if (!redoStack.length) return;
    const m = redoStack.pop();
    history.push(m);
    queue.push({ move: m, factor: 1 });
    logical = model.applyMove(logical, m);
    notify(m, 'redo');
    refreshUI();
  }
  function solve() {
    dropQueued();
    if (history.length) {
      const inv = model.simplify(model.invertSeq(history));
      history.length = 0;
      redoStack.length = 0;
      for (const m of inv) {
        queue.push({ move: m, factor: 0.75 });
        logical = model.applyMove(logical, m);
      }
      notifyBatch('solve');
    }
    refreshUI();
  }
  function scramble() {
    for (const m of model.scramble()) push(m, { factor: 0.55, silent: true });
    notifyBatch('scramble');
    refreshUI();
  }
  function reset() {
    queue = [];
    anim = null;
    stickers = model.solvedState();
    logical = stickers;
    history.length = 0;
    redoStack.length = 0;
    scrambled = false;
    notifyBatch('reset');
    refreshUI();
  }
  function demo() {
    reset();
    const seq = model.scramble(Math.min(N === 2 ? 11 : 18, 30));
    for (const m of seq) push(m, { factor: 0.5, silent: true });
    queue.push({ wait: 650 });
    for (const m of model.invertSeq(seq)) push(m, { factor: 0.8, silent: true });
    notifyBatch('demo');
    refreshUI();
  }

  function baseDuration() {
    return 1000 * Math.pow(0.09, settings.speed / 100); // 1000ms … 90ms，对数刻度
  }
  function durationOf(item) {
    const m = item.move;
    let d = baseDuration() * item.factor;
    if (Math.abs(m.turns) === 2) d *= 1.5;
    if (m.layers.length === N) d *= 1.2;
    if (queue.length > 3) d *= Math.max(0.4, 1 - 0.035 * (queue.length - 3)); // 排队多时自动加速
    return Math.max(50, d);
  }

  function startNext(now) {
    anim = null;
    if (!queue.length) return;
    const item = queue.shift();
    if (item.wait) { anim = { wait: true, start: now, duration: item.wait }; return; }
    anim = { item, data: G.buildAnimation(item.move), start: now, duration: durationOf(item), t: 0, e: 0, ease };
  }

  function advance(now) {
    let settled = false;
    if (!anim && queue.length) startNext(now);
    for (let guard = 0; anim && guard < 200; guard++) {
      const t = (now - anim.start) / anim.duration;
      if (t < 1) {
        anim.t = t < 0 ? 0 : t;
        anim.e = ease(anim.t);
        break;
      }
      const end = anim.start + anim.duration;
      if (!anim.wait) {
        stickers = model.applyPerm(stickers, anim.data.perm);
        if (!model.isSolved(stickers)) scrambled = true;
      }
      anim = null;
      needGraph = need3d = true;
      if (queue.length) startNext(Math.max(end, now - 40)); // 保持节奏，接续上一步的结束时刻
      else settled = true;
    }
    if (settled) {
      if (scrambled && model.isSolved(stickers)) {
        scrambled = false;
        celebrate(now);
      }
      refreshUI();
    }
  }

  function celebrate(now) {
    const order = [];
    for (let k = 0; k < N; k++) for (let a = 0; a < 3; a++) order.push(a * N + k);
    order.forEach((ci, k) => bumps.push({ ci, at: now + 120 + k * Math.round(495 / order.length) }));
    const el = $('stateText');
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  // ---------- 高亮（指数平滑，与帧率无关） ----------
  function updateHighlights(dt, now) {
    target.fill(0);
    if (anim && !anim.wait) for (const ci of anim.data.circles) target[ci] = 1;
    if (hover.circle >= 0) target[hover.circle] = Math.max(target[hover.circle], 0.42);
    if (padHover) for (const ci of padHover) target[ci] = Math.max(target[ci], 0.42);
    if (guide.next && !(anim && !anim.wait)) for (const ci of circlesOf(guide.next)) target[ci] = Math.max(target[ci], 0.28 + 0.34 * pulse);
    for (let k = bumps.length - 1; k >= 0; k--) {
      if (now >= bumps[k].at) {
        highlight[bumps[k].ci] = 1;
        bumps.splice(k, 1);
        needGraph = true;
      }
    }
    for (let i = 0; i < highlight.length; i++) {
      const h = highlight[i], tg = target[i];
      if (h === tg) continue;
      let nh = h + (tg - h) * (1 - Math.exp(-dt / (tg > h ? 45 : 190)));
      if (Math.abs(tg - nh) < 0.004) nh = tg;
      highlight[i] = nh;
      needGraph = true;
    }
    if (hover.face >= 0) faceShown = hover.face;
    const ft = hover.face >= 0 ? 1 : 0;
    if (faceAlpha !== ft) {
      faceAlpha += (ft - faceAlpha) * (1 - Math.exp(-dt / 60));
      if (Math.abs(ft - faceAlpha) < 0.01) faceAlpha = ft;
      needGraph = true;
    }
  }

  // 提示中的下一步若是转某个面，就让那个面的节点一起闪
  function guideFace() {
    const m = guide.next;
    if (!m || m.layers.length !== 1) return -1;
    const l = m.layers[0];
    if (l !== 0 && l !== N - 1) return -1;
    return model.FACES.findIndex((_, f) => model.FACE_AXIS[f] === m.axis && (model.NORMALS[f][m.axis] > 0) === (l === N - 1));
  }

  // ---------- 渲染 ----------
  const gfs = { stickers: null, anim: null, highlight: null, hoverFace: -1, hoverFaceAlpha: 0, trails: true, names: false, arrows: null, focus: null, focus2: null, pulse: 0 };
  const cAnim = { axis: 0, layers: [0], angle: 0 };
  const cHover = { axis: 0, layers: [0], alpha: 0.9 };
  const cfs = { stickers: null, anim: null, hover: null, focus: null, focus2: null, pulse: 0, labels: true };

  function hoverLayer() {
    let src = null;
    if (hover.circle >= 0) src = { axis: G.CIRCLES[hover.circle].axis, layers: [G.CIRCLES[hover.circle].layer], alpha: 0.9 };
    else if (padHover && padHover.length) src = { axis: G.CIRCLES[padHover[0]].axis, layers: padHover.map(i => G.CIRCLES[i].layer), alpha: 0.9 };
    else if (guide.next && !(anim && !anim.wait)) src = { axis: guide.next.axis, layers: guide.next.layers, alpha: 0.35 + 0.5 * pulse };
    if (!src) return null;
    cHover.axis = src.axis;
    cHover.layers = src.layers;
    cHover.alpha = src.alpha;
    return cHover;
  }

  function render() {
    const moving = !!(anim && !anim.wait);
    const guiding = !!(guide.focus || guide.focus2 || guide.next);
    let drew = false;
    if (needGraph || moving || guiding) {
      gfs.stickers = stickers;
      gfs.anim = moving ? anim : null;
      gfs.highlight = highlight;
      const gf = hover.face < 0 && faceAlpha < 0.01 && !moving ? guideFace() : -1;
      gfs.hoverFace = gf >= 0 ? gf : faceShown;
      gfs.hoverFaceAlpha = gf >= 0 ? 0.25 + 0.45 * pulse : faceAlpha;
      gfs.trails = settings.trails;
      gfs.names = settings.names;
      gfs.arrows = arrows;
      gfs.focus = guide.focus;
      gfs.focus2 = guide.focus2;
      gfs.pulse = pulse;
      graphView.render(gfs);
      drew = true;
    }
    if (settings.show3d && (need3d || moving || guiding)) {
      cfs.stickers = stickers;
      if (moving) {
        cAnim.axis = anim.data.axis;
        cAnim.layers = anim.data.layers;
        cAnim.angle = (anim.e * anim.data.turns * Math.PI) / 2;
        cfs.anim = cAnim;
      } else cfs.anim = null;
      cfs.hover = hoverLayer();
      cfs.focus = guide.focus;
      cfs.focus2 = guide.focus2;
      cfs.pulse = pulse;
      cfs.labels = settings.labels;
      cubeView.render(cfs);
      drew = true;
    }
    needGraph = need3d = false;
    return drew;
  }

  // ---------- 主循环 & 帧率 ----------
  const fpsEl = $('fps'), ftEl = $('ftime');
  let lastNow = performance.now(), fpsT0 = lastNow, frames = 0, workSum = 0, workN = 0;
  function tick(now) {
    const dt = Math.min(100, Math.max(0, now - lastNow));
    lastNow = now;
    frames++;
    pulse = 0.5 + 0.5 * Math.sin((now / 1150) * Math.PI * 2);
    advance(now);
    updateHighlights(dt, now);
    if (cubeView.update(dt)) need3d = true;
    const w0 = performance.now();
    if (render()) { workSum += performance.now() - w0; workN++; }
    if (now - fpsT0 >= 500) {
      fpsEl.textContent = Math.round((frames * 1000) / (now - fpsT0));
      if (workN) ftEl.textContent = (workSum / workN).toFixed(2);
      frames = 0; workSum = 0; workN = 0; fpsT0 = now;
    }
  }
  function frame(now) {
    tick(now);
    requestAnimationFrame(frame);
  }

  // ---------- 图论视图交互 ----------
  const hintEl = $('hint');
  const touch = matchMedia('(pointer: coarse)').matches;
  const defaultHint = () => t(touch ? 'hint.touch' : 'hint.default');
  let drag = null;

  function setHover(circle, face, force) {
    if (!force && hover.circle === circle && hover.face === face) return;
    hover.circle = circle;
    hover.face = face;
    need3d = true;
    graphCanvas.style.cursor = circle >= 0 || face >= 0 ? 'pointer' : '';
    if (face >= 0) {
      hintEl.innerHTML = t('hint.face', { face: model.FACES[face], cw: fmt(G.moveForFace(face, 1)), ccw: fmt(G.moveForFace(face, -1)) });
    } else if (circle >= 0) {
      const c = G.CIRCLES[circle];
      const ring = c.layer === N - 1 ? t('ring.inner') : c.layer === 0 ? t('ring.outer') : t('ring.k', { k: N - c.layer });
      hintEl.innerHTML = t('hint.circle', { name: c.name, ring, n: 4 * N, cw: fmt(G.moveForCircle(circle, 1)), ccw: fmt(G.moveForCircle(circle, -1)) });
    } else {
      hintEl.textContent = defaultHint();
    }
  }

  function pick(x, y) {
    const dot = G.nearestDot(x, y);
    if (dot >= 0) return { dot, circle: -1 };
    return { dot: -1, circle: G.nearestCircle(x, y, graphView.pxToUnits(11)) };
  }

  graphCanvas.addEventListener('pointerdown', e => {
    const [x, y] = graphView.toGraph(e.clientX, e.clientY);
    const hit = pick(x, y);
    if (hit.dot < 0 && hit.circle < 0) return;
    e.preventDefault();
    try { graphCanvas.setPointerCapture(e.pointerId); } catch (_) { /* 合成事件没有活动指针 */ }
    drag = { id: e.pointerId, x0: x, y0: y, ...hit, used: false, ccw: e.shiftKey || e.button === 2 };
  });
  graphCanvas.addEventListener('pointermove', e => {
    const [x, y] = graphView.toGraph(e.clientX, e.clientY);
    if (drag && drag.id === e.pointerId) {
      if (drag.used) return;
      const dx = x - drag.x0, dy = y - drag.y0, len = Math.hypot(dx, dy);
      if (len < graphView.pxToUnits(9)) return;
      const cands = drag.dot >= 0 ? G.SLOT_CIRCLES[drag.dot] : [drag.circle];
      let best = -1, bestDot = 0;
      for (const ci of cands) {
        const tg = G.tangentCW(ci, drag.x0, drag.y0);
        const d = (tg[0] * dx + tg[1] * dy) / len;
        if (Math.abs(d) > Math.abs(bestDot)) { bestDot = d; best = ci; }
      }
      if (best >= 0 && Math.abs(bestDot) > 0.3) {
        drag.used = true;
        setHover(best, -1);
        doMove(G.moveForCircle(best, Math.sign(bestDot)));
      }
      return;
    }
    const hit = pick(x, y);
    if (hit.dot >= 0) setHover(G.FACE_CIRCLE[model.SLOTS[hit.dot].face], model.SLOTS[hit.dot].face);
    else setHover(hit.circle, -1);
  });
  const endDrag = e => {
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.used && e.type === 'pointerup') {
      const dir = drag.ccw ? -1 : 1;
      if (drag.dot >= 0) doMove(G.moveForFace(model.SLOTS[drag.dot].face, dir));
      else doMove(G.moveForCircle(drag.circle, dir));
    }
    drag = null;
  };
  graphCanvas.addEventListener('pointerup', endDrag);
  graphCanvas.addEventListener('pointercancel', endDrag);
  graphCanvas.addEventListener('pointerleave', () => { if (!drag) setHover(-1, -1); });
  graphCanvas.addEventListener('contextmenu', e => e.preventDefault());

  cubeView.onViewChange = () => { need3d = true; };

  // ---------- 键盘 ----------
  // 数字前缀选内层：先按 2 再按 R = 2R（第二层）
  const KEYS = {
    KeyU: 'U', KeyD: 'D', KeyL: 'L', KeyR: 'R', KeyF: 'F', KeyB: 'B',
    KeyM: 'M', KeyE: 'E', KeyS: 'S', KeyX: 'x', KeyY: 'y', KeyZ: 'z',
  };
  let prefix = 0, prefixTimer = 0;
  function flashHint(text) {
    hintEl.textContent = text;
    clearTimeout(prefixTimer);
    prefixTimer = setTimeout(() => { prefix = 0; hintEl.textContent = defaultHint(); }, 1600);
  }
  window.addEventListener('keydown', e => {
    const t = e.target;
    if (t && t.matches && t.matches('input[type="text"], textarea, select')) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code === 'KeyH') { e.preventDefault(); toggleHint(); return; }
    if (e.code === 'Escape' && tutor.active) { tutor.stop(); return; }
    const digit = /^Digit([2-9])$/.exec(e.code);
    if (digit && +digit[1] <= N && N >= 3) {
      prefix = +digit[1];
      flashHint(t('hint.prefix', { p: prefix }));
      return;
    }
    const base = KEYS[e.code];
    if (!base) return;
    e.preventDefault();
    const token = (prefix && 'UDLRFB'.includes(base) ? prefix : '') + base + (e.shiftKey ? "'" : '');
    prefix = 0;
    try {
      doMove(model.parse(token)[0]);
      hintEl.textContent = defaultHint();
    } catch (err) {
      flashHint(errText(err));
    }
  });

  // ---------- 转动按钮 ----------
  function padGroups() {
    const g = [['pad.faces', ['U', 'D', 'R', 'L', 'F', 'B']]];
    if (N % 2 === 1) g.push(['pad.middle', ['M', 'E', 'S']]);
    if (N >= 4) g.push(['pad.second', ['2U', '2D', '2R', '2L', '2F', '2B']]);
    if (N >= 4) g.push(['pad.wide', ['Uw', 'Dw', 'Rw', 'Lw', 'Fw', 'Bw']]);
    g.push(['pad.rot', ['x', 'y', 'z']]);
    return g;
  }
  function buildPad() {
    const pad = $('movepad');
    pad.textContent = '';
    for (const [title, tokens] of padGroups()) {
      const group = document.createElement('div');
      group.className = 'pad-group';
      const label = document.createElement('div');
      label.className = 'pad-title';
      label.textContent = t(title);
      const grid = document.createElement('div');
      grid.className = 'pad-grid';
      grid.style.setProperty('--cols', tokens.length);
      for (const suffix of ['', "'"]) {
        for (const tk of tokens) {
          const mv = model.parse(tk + suffix)[0];
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'pad-btn';
          b.textContent = fmt(mv);
          b.addEventListener('click', () => doMove(mv));
          b.addEventListener('pointerenter', () => { padHover = circlesOf(mv); need3d = true; });
          b.addEventListener('pointerleave', () => { padHover = null; need3d = true; });
          grid.appendChild(b);
        }
      }
      group.append(label, grid);
      pad.appendChild(group);
    }
  }

  $('btnScramble').addEventListener('click', scramble);
  $('btnSolve').addEventListener('click', solve);
  $('btnDemo').addEventListener('click', demo);
  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);
  $('btnReset').addEventListener('click', reset);

  $('orderPicker').addEventListener('click', e => {
    const b = e.target.closest('button[data-n]');
    if (b && +b.dataset.n !== N) setOrder(+b.dataset.n);
  });

  const speedEl = $('speed');
  const speedOut = $('speedOut');
  const showSpeed = () => { speedOut.textContent = Math.round(baseDuration()) + ' ms'; };
  speedEl.addEventListener('input', () => { settings.speed = +speedEl.value; showSpeed(); });
  settings.speed = +speedEl.value;
  showSpeed();

  function bindToggle(id, key, after) {
    const el = $(id);
    settings[key] = el.checked;
    el.addEventListener('change', () => {
      settings[key] = el.checked;
      if (after) after();
      needGraph = need3d = true;
    });
  }
  bindToggle('optTrails', 'trails');
  bindToggle('optLabels', 'labels', () => graphView.setLayerLabels(settings.labels));
  bindToggle('optNames', 'names');
  bindToggle('opt3d', 'show3d', () => {
    document.body.classList.toggle('no3d', !settings.show3d);
    updateGraphInset();
  });
  bindToggle('optArrows', 'arrows', () => buildArrows());
  document.body.classList.toggle('no3d', !settings.show3d);

  // ---------- 公式实验室 ----------
  const PRESETS = [
    ['preset.sexy', "R U R' U'"],
    ['preset.sune', "R U R' U R U2 R'"],
    ['preset.t', "R U R' U' R' F R2 U' R' U' R U R' F'"],
    ['preset.y', "F R U' R' U' R U R' F' R U R' U' R' F R F'"],
    ['preset.h', 'M2 U M2 U2 M2 U M2'],
    ['preset.checker', 'M2 E2 S2'],
    ['preset.superflip', "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2"],
    ['preset.cic', "F L F U' R U F2 L2 U' L' B D' B' L2 U"],
    ['preset.comm', '[R, U]'],
    ['preset.comm2', '[2R, U]'],
    ['preset.ru', 'R U'],
  ];
  const CYCLE_COLORS = ['#E8590C', '#1C7ED6', '#2B8A3E', '#AE3EC9', '#F08C00', '#0C8599', '#D6336C', '#5C940D', '#4263EB', '#862E9C', '#C92A2A', '#087F5B'];
  const algoEl = $('algo'), presetEl = $('preset'), infoEl = $('analysis');
  function refreshPresets() {
    const keep = presetEl.value;
    presetEl.length = 0;
    const first = document.createElement('option');
    first.value = '';
    first.textContent = t('preset.placeholder');
    presetEl.appendChild(first);
    for (const [name, alg] of PRESETS) {
      try { model.parse(alg); } catch (_) { continue; }
      const o = document.createElement('option');
      o.value = alg;
      o.textContent = t(name);
      presetEl.appendChild(o);
    }
    presetEl.value = [...presetEl.options].some(o => o.value === keep) ? keep : '';
  }
  presetEl.addEventListener('change', () => {
    if (!presetEl.value) return;
    algoEl.value = presetEl.value;
    analyze();
  });

  const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function buildArrows() {
    arrows = null;
    if (settings.arrows && analysis) {
      arrows = [];
      analysis.cycles.forEach((cyc, k) => {
        const color = CYCLE_COLORS[k % CYCLE_COLORS.length];
        for (const s of cyc) arrows.push({ from: s, to: analysis.perm[s], color });
      });
    }
    needGraph = true;
  }

  function analyze() {
    const text = algoEl.value.trim();
    analysis = null;
    const repBtn = $('btnRepeat');
    repBtn.disabled = true;
    repBtn.textContent = t('btn.repeat');
    if (!text) {
      infoEl.innerHTML = `<span class="muted">${t('an.empty', { n: 6 * N * N })}</span>`;
      buildArrows();
      return;
    }
    try {
      const seq = model.parse(text);
      const perm = model.seqPerm(seq);
      const cycles = model.cycles(perm).filter(c => c.length > 1);
      const ord = model.order(perm);
      const moved = cycles.reduce((n, c) => n + c.length, 0);
      const byLen = new Map();
      for (const c of cycles) byLen.set(c.length, (byLen.get(c.length) || 0) + 1);
      const type = [...byLen.entries()].sort((a, b) => b[0] - a[0]).map(([len, n]) => t('an.cycle', { len, n })).join(t('an.sep'));
      analysis = { seq, perm, cycles, ord };
      infoEl.innerHTML = t('an.result', { len: seq.length, ord, moved, total: model.STICKERS }) + ' · ' + (type || t('an.identity'));
      if (seq.length && ord > 1 && seq.length * ord <= 2400) {
        repBtn.disabled = false;
        repBtn.textContent = t('btn.repeatN', { n: ord });
      }
    } catch (err) {
      infoEl.innerHTML = `<span class="err">${escapeHtml(errText(err))}</span>`;
    }
    buildArrows();
  }
  let analyzeTimer = 0;
  algoEl.addEventListener('input', () => {
    presetEl.value = '';
    clearTimeout(analyzeTimer);
    analyzeTimer = setTimeout(analyze, 120);
  });
  function playAlgo(inverse, times = 1) {
    analyze();
    if (!analysis) return;
    const seq = inverse ? model.invertSeq(analysis.seq) : analysis.seq;
    const factor = times > 1 ? 0.6 : 1;
    for (let k = 0; k < times; k++) for (const m of seq) push(m, { factor, silent: true });
    notifyBatch('algo');
    refreshUI();
  }
  algoEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); playAlgo(false); } });
  $('btnPlay').addEventListener('click', () => playAlgo(false));
  $('btnPlayInv').addEventListener('click', () => playAlgo(true));
  $('btnRepeat').addEventListener('click', () => { if (analysis) playAlgo(false, analysis.ord); });

  // ---------- 状态显示 ----------
  function renderHistory() {
    const el = $('history');
    if (!history.length) {
      el.innerHTML = `<span class="muted">${t('history.empty')}</span>`;
      return;
    }
    const shown = history.slice(-150);
    el.innerHTML = (history.length > shown.length ? '<span class="muted">…</span>' : '') +
      shown.map(m => `<span class="chip">${fmt(m)}</span>`).join('');
    el.scrollLeft = el.scrollWidth;
  }
  function refreshUI() {
    const busy = !!anim || queue.length > 0;
    const solved = model.isSolved(stickers);
    $('stateText').textContent = t(busy ? 'state.turning' : solved ? 'state.solved' : 'state.unsolved');
    $('moveCount').textContent = history.length;
    $('moveUnit').textContent = t(history.length === 1 ? 'state.unit1' : 'state.unit');
    $('btnUndo').disabled = !history.length;
    $('btnRedo').disabled = !redoStack.length;
    $('btnSolve').disabled = !history.length;
    renderHistory();
    needGraph = need3d = true;
  }

  // ---------- 提示与入门教程 ----------
  const coach = $('coach');
  tutor = window.createTutorial({
    get N() { return N; },
    model: () => model,
    logical: () => logical,
    history: () => history,
    isSolved: () => model.isSolved(logical),
    busy: () => !!anim || queue.length > 0,
    playMove: m => doMove(m, 'tutor'),
    playMoves: ms => { for (const m of ms) push(m, { source: 'tutor', factor: 0.85 }); refreshUI(); },
    scramble: () => { for (const m of model.scramble()) push(m, { factor: 0.5, silent: true }); refreshUI(); },
    setOrder: n => setOrder(n, { fromTutor: true }),
    setGuide: g => {
      guide.focus = g ? g.focus : null;
      guide.focus2 = g ? g.focus2 : null;
      guide.next = g ? g.next : null;
      needGraph = need3d = true;
    },
    resetView: () => cubeView.resetView(),
    layoutChanged: () => {
      syncCoachSpace();
      updateGraphInset();
      $('btnHint').setAttribute('aria-pressed', String(!!tutor && tutor.active && tutor.view === 'card'));
      $('btnTutor').setAttribute('aria-pressed', String(!!tutor && tutor.active && tutor.view === 'coach'));
    },
    teaching: on => {
      document.body.classList.toggle('teaching', on);
      syncCoachSpace();
      if (on) {
        // 窄屏：把图滚到顶上，正好落在教学面板上方；宽屏：回到页面顶部
        if (matchMedia('(max-width: 860px)').matches) graphCanvas.parentElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
        else window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
  }, {
    root: coach,
    chapters: $('coachChapters'),
    title: $('coachTitle'),
    text: $('coachText'),
    moves: $('coachMoves'),
    hint: $('coachHint'),
    primary: $('coachPrimary'),
    secondary: $('coachSecondary'),
    feedback: $('coachFeedback'),
    close: $('coachClose'),
  }, {
    root: $('hintCard'),
    title: $('hcTitle'),
    moveRow: $('hcMoveRow'),
    move: $('hcMove'),
    what: $('hcWhat'),
    key: $('hcKey'),
    ctx: $('hcCtx'),
    prog: $('hcProg'),
    doBtn: $('hcDo'),
    more: $('hcMore'),
    close: $('hcClose'),
    feedback: $('hcFeedback'),
  });
  const toggleHint = () => (tutor.active && tutor.view === 'card' ? tutor.stop() : tutor.showHint());
  $('btnHint').addEventListener('click', toggleHint);
  $('btnTutor').addEventListener('click', () => (tutor.active && tutor.view === 'coach' ? tutor.stop() : tutor.startTutorial()));
  // 提示卡的位置：宽屏放在 3D 面板下部（3D 魔方让出高度）；关掉 3D 视图时浮在图的左上角（图向右让位）；
  // 窄屏由 CSS 固定在屏幕底部
  const narrowMQ = matchMedia('(max-width: 860px)');
  function updateGraphInset() {
    const cardEl = $('hintCard');
    const host = settings.show3d ? cubeCanvas.parentElement : graphCanvas.parentElement;
    if (cardEl.parentElement !== host) host.appendChild(cardEl);
    const shown = !cardEl.hidden && !narrowMQ.matches;
    const inCube = shown && settings.show3d;
    const changedCube = cubeView.setInsetBottom(inCube ? cardEl.offsetHeight + 14 : 0);
    const changedGraph = graphView.setInsetLeft(shown && !inCube ? cardEl.offsetWidth + 20 : 0);
    if (changedCube || changedGraph) { needGraph = need3d = true; render(); }
  }
  // 教学面板固定在底部：给页面留出同样高度的空白
  function syncCoachSpace() {
    document.documentElement.style.setProperty('--coach-h', coach.hidden ? '0px' : coach.offsetHeight + 'px');
  }
  new ResizeObserver(syncCoachSpace).observe(coach);

  // ---------- 中英文 ----------
  function applyStatic() {
    document.documentElement.lang = I18N.lang === 'zh' ? 'zh-CN' : 'en';
    document.title = t('doc.title');
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = t('doc.desc');
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
    for (const el of document.querySelectorAll('[data-i18n-attr]')) {
      for (const pair of el.dataset.i18nAttr.split(';')) {
        const [attr, key] = pair.split(':').map(s => s && s.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      }
    }
    for (const b of document.querySelectorAll('#langPicker button')) b.setAttribute('aria-pressed', String(b.dataset.lang === I18N.lang));
  }
  // 随阶数 / 语言变化的文字
  function updateTexts() {
    $('subtitle').textContent = t('subtitle', { nodes: 6 * N * N, circles: 3 * N });
    if (hover.circle < 0 && hover.face < 0) hintEl.textContent = defaultHint();
    const fits = graphView.namesFit();
    $('optNames').disabled = !fits;
    $('optNames').parentElement.title = fits ? '' : t('opt.names.small');
  }
  I18N.onChange(lang => {
    try { localStorage.setItem('rubik-graph-lang', lang); } catch (_) { /* 隐私模式等 */ }
    applyStatic();
    updateTexts();
    buildPad();
    refreshPresets();
    analyze();
    refreshUI();
    if (hover.circle >= 0 || hover.face >= 0) setHover(hover.circle, hover.face, true);
    tutor.render();
    syncCoachSpace();
  });
  $('langPicker').addEventListener('click', e => {
    const b = e.target.closest('button[data-lang]');
    if (b) I18N.setLang(b.dataset.lang);
  });

  // ---------- 尺寸 ----------
  function resizeAll() {
    graphView.resize();
    cubeView.resize();
    updateGraphInset();
    const fits = graphView.namesFit();
    $('optNames').disabled = !fits;
    needGraph = need3d = true;
    render();
  }
  const ro = new ResizeObserver(resizeAll);
  ro.observe(graphCanvas);
  ro.observe(cubeCanvas);
  let mq = null;
  function watchDpr() {
    if (mq) mq.removeEventListener('change', watchDpr);
    mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', watchDpr);
    resizeAll();
  }

  const qs = new URLSearchParams(location.search);
  const startN = +qs.get('n');
  applyStatic();
  setOrder(ORDERS.includes(startN) ? startN : 3);
  graphView.setLayerLabels(settings.labels);
  watchDpr();
  if (qs.has('learn')) tutor.startTutorial();
  else if (qs.has('hint')) tutor.showHint();
  requestAnimationFrame(frame);

  // 便于调试：rubikApp.tick(t) 可用合成时间戳手动推进一帧
  window.rubikApp = {
    get stickers() { return stickers; },
    get logical() { return logical; },
    get anim() { return anim; },
    get model() { return model; },
    get N() { return N; },
    tutor, setOrder, doMove, scramble, solve, reset, demo, undo, redo, tick, history,
    queue: () => queue,
  };
})();
