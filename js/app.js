/*!
 * app.js — 状态、动画队列、交互与主循环
 *
 * 所有动画都由 requestAnimationFrame 的时间戳驱动（与帧率无关），
 * 在 120Hz / 144Hz 屏幕上自动跑满刷新率；空闲时不重绘。
 */
(function () {
  'use strict';
  const Cube = window.RubikCube, G = window.RubikGraph;
  const $ = id => document.getElementById(id);
  const fmt = Cube.moveToString;

  const graphCanvas = $('graph'), cubeCanvas = $('cube3d');
  const graphView = window.createGraphView(graphCanvas);
  const cubeView = window.createCubeView(cubeCanvas);

  // ---------- 状态 ----------
  let stickers = Cube.solvedState();
  let queue = [];             // { move, factor } | { wait: ms }
  let anim = null;            // 当前正在播放的转动
  const history = [];         // 从还原状态起的全部转动（含尚未播放完的）
  const redoStack = [];
  let scrambled = false;      // 离开还原状态后置位，用于还原时的庆祝效果
  const settings = { speed: 50, trails: true, labels: true, names: false, show3d: true, arrows: false };

  const highlight = new Float32Array(9), target = new Float32Array(9);
  const hover = { circle: -1, face: -1 };
  let padHover = null;
  let faceAlpha = 0, faceShown = -1;
  let arrows = null, analysis = null;
  let needGraph = true, need3d = true;
  const bumps = [];

  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const circlesOf = m => {
    const b = Cube.BASE[m.base];
    return b.layers.map(l => G.circleIndex(b.axis, l));
  };

  // ---------- 队列 ----------
  function push(move, opts = {}) {
    const m = { base: move.base, amount: move.amount };
    queue.push({ move: m, factor: opts.factor || 1 });
    history.push(m);
    if (!opts.keepRedo) redoStack.length = 0;
    return m;
  }
  function doMove(move) {
    push(move);
    refreshUI();
  }
  // 撤掉还没开始播放的转动（连同历史记录）
  function dropQueued() {
    while (queue.length) {
      const it = queue[queue.length - 1];
      if (it.wait) { queue.pop(); continue; }
      if (history.length && history[history.length - 1] === it.move) {
        queue.pop();
        history.pop();
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
    else queue.push({ move: Cube.invertMove(m), factor: 1 });
    refreshUI();
  }
  function redo() {
    if (!redoStack.length) return;
    const m = redoStack.pop();
    history.push(m);
    queue.push({ move: m, factor: 1 });
    refreshUI();
  }
  function solve() {
    dropQueued();
    if (!history.length) { refreshUI(); return; }
    const inv = Cube.simplify(Cube.invertSeq(history));
    history.length = 0;
    redoStack.length = 0;
    for (const m of inv) queue.push({ move: m, factor: 0.75 });
    refreshUI();
  }
  function scramble() {
    for (const m of Cube.scramble(22)) push(m, { factor: 0.55 });
    refreshUI();
  }
  function reset() {
    queue = [];
    anim = null;
    stickers = Cube.solvedState();
    history.length = 0;
    redoStack.length = 0;
    scrambled = false;
    refreshUI();
  }
  function demo() {
    reset();
    const seq = Cube.scramble(18);
    for (const m of seq) push(m, { factor: 0.5 });
    queue.push({ wait: 650 });
    for (const m of Cube.invertSeq(seq)) push(m, { factor: 0.8 });
    refreshUI();
  }

  function baseDuration() {
    return 1000 * Math.pow(0.09, settings.speed / 100); // 1000ms … 90ms，对数刻度
  }
  function durationOf(item) {
    const b = Cube.BASE[item.move.base];
    let d = baseDuration() * item.factor;
    if (Math.abs(item.move.amount) === 2) d *= 1.5;
    if (b.layers.length === 3) d *= 1.2;
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
        stickers = Cube.applyPerm(stickers, anim.data.perm);
        if (!Cube.isSolved(stickers)) scrambled = true;
      }
      anim = null;
      needGraph = need3d = true;
      if (queue.length) startNext(Math.max(end, now - 40)); // 保持节奏，接续上一步的结束时刻
      else settled = true;
    }
    if (settled) {
      if (scrambled && Cube.isSolved(stickers)) {
        scrambled = false;
        celebrate(now);
      }
      refreshUI();
    }
  }

  function celebrate(now) {
    [0, 3, 6, 1, 4, 7, 2, 5, 8].forEach((ci, k) => bumps.push({ ci, at: now + 120 + k * 55 }));
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
    for (let k = bumps.length - 1; k >= 0; k--) {
      if (now >= bumps[k].at) {
        highlight[bumps[k].ci] = 1;
        bumps.splice(k, 1);
        needGraph = true;
      }
    }
    for (let i = 0; i < 9; i++) {
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

  // ---------- 渲染 ----------
  const gfs = { stickers, anim: null, highlight, hoverFace: -1, hoverFaceAlpha: 0, trails: true, names: false, arrows: null };
  const cAnim = { axis: 0, layers: [0], angle: 0 };
  const cHover = { axis: 0, layers: [0], alpha: 0.9 };
  const cfs = { stickers, anim: null, hover: null };

  function hoverLayer() {
    let ci = hover.circle;
    if (ci < 0 && padHover && padHover.length) {
      const c = G.CIRCLES[padHover[0]];
      cHover.axis = c.axis;
      cHover.layers = padHover.map(i => G.CIRCLES[i].layer);
      return cHover;
    }
    if (ci < 0) return null;
    const c = G.CIRCLES[ci];
    cHover.axis = c.axis;
    cHover.layers = [c.layer];
    return cHover;
  }

  function render() {
    const moving = !!(anim && !anim.wait);
    let drew = false;
    if (needGraph || moving) {
      gfs.stickers = stickers;
      gfs.anim = moving ? anim : null;
      gfs.hoverFace = faceShown;
      gfs.hoverFaceAlpha = faceAlpha;
      gfs.trails = settings.trails;
      gfs.names = settings.names;
      gfs.arrows = arrows;
      graphView.render(gfs);
      drew = true;
    }
    if (settings.show3d && (need3d || moving)) {
      cfs.stickers = stickers;
      if (moving) {
        cAnim.axis = anim.data.axis;
        cAnim.layers = anim.data.layers;
        cAnim.angle = (anim.e * anim.data.turns * Math.PI) / 2;
        cfs.anim = cAnim;
      } else cfs.anim = null;
      cfs.hover = hoverLayer();
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
  if (matchMedia('(pointer: coarse)').matches) {
    hintEl.textContent = '点节点：转动它所在的面 · 点圆环：转动这一层 · 沿圆环拖动节点：按拖动方向转';
  }
  const DEFAULT_HINT = hintEl.textContent;
  let drag = null;

  function setHover(circle, face) {
    if (hover.circle === circle && hover.face === face) return;
    hover.circle = circle;
    hover.face = face;
    need3d = true;
    graphCanvas.style.cursor = circle >= 0 || face >= 0 ? 'pointer' : '';
    if (face >= 0) {
      const cw = G.moveForFace(face, 1), ccw = G.moveForFace(face, -1);
      hintEl.innerHTML = `<b>${Cube.FACES[face]} 面</b> · 点击 <kbd>${fmt(cw)}</kbd> · Shift/右键 <kbd>${fmt(ccw)}</kbd> · 拖动节点：沿经过它的圆环转动`;
    } else if (circle >= 0) {
      const c = G.CIRCLES[circle];
      const ring = ['内圈', '中圈', '外圈'][1 - c.layer];
      hintEl.innerHTML = `<b>${c.name} 层</b>（${ring}，经过 12 个节点）· 点击顺时针 <kbd>${fmt(G.moveForCircle(circle, 1))}</kbd> · Shift/右键 <kbd>${fmt(G.moveForCircle(circle, -1))}</kbd>`;
    } else {
      hintEl.textContent = DEFAULT_HINT;
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
    if (hit.dot >= 0) setHover(G.FACE_CIRCLE[Cube.SLOTS[hit.dot].face], Cube.SLOTS[hit.dot].face);
    else setHover(hit.circle, -1);
  });
  const endDrag = e => {
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.used && e.type === 'pointerup') {
      const dir = drag.ccw ? -1 : 1;
      if (drag.dot >= 0) doMove(G.moveForFace(Cube.SLOTS[drag.dot].face, dir));
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
  const KEYS = {
    KeyU: 'U', KeyD: 'D', KeyL: 'L', KeyR: 'R', KeyF: 'F', KeyB: 'B',
    KeyM: 'M', KeyE: 'E', KeyS: 'S', KeyX: 'x', KeyY: 'y', KeyZ: 'z',
  };
  window.addEventListener('keydown', e => {
    const t = e.target;
    if (t && t.matches && t.matches('input[type="text"], textarea, select')) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const base = KEYS[e.code];
    if (!base) return;
    e.preventDefault();
    doMove({ base, amount: e.shiftKey ? -1 : 1 });
  });

  // ---------- 按钮 ----------
  const PAD = [['外层', ['U', 'D', 'R', 'L', 'F', 'B']], ['中层', ['M', 'E', 'S']], ['整体', ['x', 'y', 'z']]];
  function buildPad() {
    const pad = $('movepad');
    for (const [title, bases] of PAD) {
      const group = document.createElement('div');
      group.className = 'pad-group';
      const label = document.createElement('div');
      label.className = 'pad-title';
      label.textContent = title;
      const grid = document.createElement('div');
      grid.className = 'pad-grid';
      grid.style.setProperty('--cols', bases.length);
      for (const amount of [1, -1]) {
        for (const base of bases) {
          const mv = { base, amount };
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
  buildPad();

  $('btnScramble').addEventListener('click', scramble);
  $('btnSolve').addEventListener('click', solve);
  $('btnDemo').addEventListener('click', demo);
  $('btnUndo').addEventListener('click', undo);
  $('btnRedo').addEventListener('click', redo);
  $('btnReset').addEventListener('click', reset);

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
  });
  bindToggle('optArrows', 'arrows', () => buildArrows());
  document.body.classList.toggle('no3d', !settings.show3d);

  // ---------- 公式实验室 ----------
  const PRESETS = [
    ['Sexy Move', "R U R' U'"],
    ['Sune', "R U R' U R U2 R'"],
    ['T 置换', "R U R' U' R' F R2 U' R' U' R U R' F'"],
    ['Y 置换', "F R U' R' U' R U R' F' R U R' U' R' F R F'"],
    ['H 置换', 'M2 U M2 U2 M2 U M2'],
    ['棋盘格', 'M2 E2 S2'],
    ['超级翻转', "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2"],
    ['方中方', "F L F U' R U F2 L2 U' L' B D' B' L2 U"],
    ['交换子 [R, U]', '[R, U]'],
    ['R U（阶数 105）', 'R U'],
  ];
  const CYCLE_COLORS = ['#E8590C', '#1C7ED6', '#2B8A3E', '#AE3EC9', '#F08C00', '#0C8599', '#D6336C', '#5C940D', '#4263EB', '#862E9C', '#C92A2A', '#087F5B'];
  const algoEl = $('algo'), presetEl = $('preset'), infoEl = $('analysis');
  for (const [name, alg] of PRESETS) {
    const o = document.createElement('option');
    o.value = alg;
    o.textContent = name;
    presetEl.appendChild(o);
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
    repBtn.textContent = '重复至复原';
    if (!text) {
      infoEl.innerHTML = '<span class="muted">把公式看成 54 个节点上的置换：这里会显示它的阶数与循环分解，勾选「置换箭头」可在图上画出每个贴纸的去向。</span>';
      buildArrows();
      return;
    }
    try {
      const seq = Cube.parse(text);
      const perm = Cube.seqPerm(seq);
      const cycles = Cube.cycles(perm).filter(c => c.length > 1);
      const ord = Cube.order(perm);
      const moved = cycles.reduce((n, c) => n + c.length, 0);
      const byLen = new Map();
      for (const c of cycles) byLen.set(c.length, (byLen.get(c.length) || 0) + 1);
      const type = [...byLen.entries()].sort((a, b) => b[0] - a[0]).map(([len, n]) => `${len}-循环 ×${n}`).join('，');
      analysis = { seq, perm, cycles, ord };
      infoEl.innerHTML =
        `<b>${seq.length}</b> 步 · 阶数 <b>${ord}</b>（连做 ${ord} 次回到原状）· 移动 <b>${moved}</b>/54 个贴纸` +
        (type ? ` · ${type}` : ' · 恒等置换');
      if (seq.length && ord > 1 && seq.length * ord <= 2400) {
        repBtn.disabled = false;
        repBtn.textContent = `重复 ×${ord}`;
      }
    } catch (err) {
      infoEl.innerHTML = `<span class="err">${escapeHtml(err.message)}</span>`;
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
    const seq = inverse ? Cube.invertSeq(analysis.seq) : analysis.seq;
    const factor = times > 1 ? 0.6 : 1;
    for (let k = 0; k < times; k++) for (const m of seq) push(m, { factor });
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
      el.innerHTML = '<span class="muted">转动记录会显示在这里</span>';
      return;
    }
    const shown = history.slice(-150);
    el.innerHTML = (history.length > shown.length ? '<span class="muted">…</span>' : '') +
      shown.map(m => `<span class="chip">${fmt(m)}</span>`).join('');
    el.scrollLeft = el.scrollWidth;
  }
  function refreshUI() {
    const busy = !!anim || queue.length > 0;
    const solved = Cube.isSolved(stickers);
    $('stateText').textContent = busy ? '转动中' : solved ? '已还原' : '未还原';
    $('moveCount').textContent = history.length;
    $('btnUndo').disabled = !history.length;
    $('btnRedo').disabled = !redoStack.length;
    $('btnSolve').disabled = !history.length;
    renderHistory();
    needGraph = need3d = true;
  }

  // ---------- 尺寸 ----------
  function resizeAll() {
    graphView.resize();
    cubeView.resize();
    needGraph = need3d = true;
    render();
  }
  const ro = new ResizeObserver(resizeAll);
  ro.observe(graphCanvas);
  ro.observe(cubeCanvas);
  let mq = null;
  (function watchDpr() {
    if (mq) mq.removeEventListener('change', watchDpr);
    mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', watchDpr);
    resizeAll();
  })();

  graphView.setLayerLabels(settings.labels);
  analyze();
  refreshUI();
  requestAnimationFrame(frame);

  // 便于调试：rubikApp.tick(t) 可用合成时间戳手动推进一帧
  window.rubikApp = {
    get stickers() { return stickers; },
    get anim() { return anim; },
    doMove, scramble, solve, reset, demo, undo, redo, tick, history,
    queue: () => queue,
  };
})();
