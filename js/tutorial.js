/*!
 * tutorial.js — 提示与引导
 *
 * 一套「下一步该怎么转」的追踪逻辑，两种显示方式：
 *  · 提示卡（按「提示」或 H）：图的角落里一张小卡片，告诉你下一下转哪里；照着转会自动跳到下一下；
 *  · 入门教程：底部的大面板，从认识中心/棱/角、练习记号开始，再按层先法一步步讲解。
 * 规划方式按阶数而定：三阶用层先法（js/solver.js），二阶直接给最短解，四阶以上给「沿原路倒回去」的路线。
 * 用户自己转对了就前进；转得不一样也没关系，会按当前状态重新规划。所有文字都走 i18n.js。
 */
(function () {
  'use strict';
  const I = window.I18N;
  const t = (k, p) => I.t(k, p);
  const R = v => I.render(v);
  const M = (key, params) => ({ key, params });

  // 入门课：expect 为需要用户做出的转动
  const LESSONS = [
    { id: 'l0', next: 'tb.next' },
    { id: 'l1', focus: 'centers', next: 'tb.next' },
    { id: 'l2', focus: 'edges', next: 'tb.next' },
    { id: 'l3', focus: 'corners', next: 'tb.next' },
    { id: 'l4', expect: 'R' },
    { id: 'l5', expect: "R'" },
    { id: 'l6', expect: "U U'" },
    { id: 'l7', expect: "R U R' U'" },
    { id: 'l8', next: 'tb.next' },
    { id: 'l9', next: 'tb.scrambleStart', action: 'scramble' },
  ];

  function createTutorial(app, el, card) {
    let active = false;
    let view = 'card';   // card：提示卡 | coach：教程面板
    let mode = 'solve';  // lesson | solve | done | wait
    let lessonIdx = 0;
    let step = null;     // 当前小步
    let all = [];        // 当前小步的全部转动
    let doneCount = 0;   // 已完成的转动数
    let expected = [];   // 剩余的期望转动
    let fb = null;       // 当前反馈 { key, params, kind }
    let feedbackTimer = 0, waitTimer = 0, lessonTimer = 0;
    const solvers = new Map();

    const model = () => app.model();
    const fmt = m => model().moveToString(m);
    const is3 = () => model().N === 3;

    // ---------- 规划：按阶数选择方法 ----------
    const solvedStep = () => ({ done: true, title: M('hc.solved'), text: M('hc.solvedText'), parts: [], moves: [], focus: [], focus2: [] });
    function nextStep(st) {
      const C = model();
      if (!solvers.has(C)) {
        solvers.set(C, C.N === 3 ? window.RubikSolver.create(C) : C.N === 2 ? window.RubikSolver.createOptimal2(C) : null);
      }
      const sv = solvers.get(C);
      if (C.N === 3) {
        const s = sv.nextStep(st);
        return s && s.done ? Object.assign(solvedStep(), { stage: 8, chapter: 8, title: M('tut.done.title'), text: M('tut.done.text') }) : s;
      }
      if (C.isSolved(st)) return solvedStep();
      const moves = C.N === 2 ? sv.solve(st) : C.simplify(C.invertSeq(app.history()));
      if (!moves || !moves.length) return solvedStep();
      const n = moves.length;
      return C.N === 2
        ? { title: M('h2.title', { n }), text: M('h2.text'), parts: [{ label: M('part.optimal'), moves }], moves, focus: [], focus2: [] }
        : { title: M('hrev.title', { size: C.N, n }), text: M('hrev.text'), parts: [{ label: M('part.reverse'), moves }], moves, focus: [], focus2: [] };
    }

    // ---------- 提示文字 ----------
    function describe(m) {
      const name = fmt(m);
      const letter = name.replace(/['2]/g, '');
      const prime = name.includes("'"), dbl = name.includes('2');
      if (/^[xyz]$/.test(letter)) {
        const k = (prime && !dbl ? 'Shift + ' : '') + letter.toUpperCase();
        return {
          what: t('rot.' + letter) + (dbl ? t('rot.half') : prime ? t('rot.rev') : ''),
          key: t('key.hint', { keys: dbl ? t('key.twice', { k }) : k }),
        };
      }
      const faceKey = 'face.' + letter;
      const face = I.DICT.zh[faceKey] ? t(faceKey) : t('face.layer', { name: letter });
      const what = t('desc.turn', { face, dir: t(dbl ? 'dir.half' : prime ? 'dir.ccw' : 'dir.cw') });
      let key = '';
      if (/^\d?[UDLRFBMES]$/.test(letter)) {
        const k = (prime && !dbl ? 'Shift + ' : '') + letter.split('').join(' ');
        key = t('key.hint', { keys: dbl ? t('key.twice', { k }) : k });
      }
      if (/^[UDLRFB]$/.test(letter)) {
        key += t('key.click', { shift: prime && !dbl ? t('key.clickShift') : '', face: t(faceKey), twice: dbl ? t('key.clickTwice') : '' });
      }
      return { what, key };
    }

    function chips(moves, from) {
      return moves.map((m, i) => {
        const idx = from + i;
        const cls = idx < doneCount ? 'chip done' : idx === doneCount ? 'chip now' : 'chip';
        return `<span class="${cls}">${fmt(m)}</span>`;
      }).join('');
    }
    // 下一下在第几段公式里、是这段的第几下
    function partProgress() {
      if (!step) return null;
      let idx = doneCount;
      for (const p of step.parts) {
        if (idx < p.moves.length) return { label: R(p.label), i: idx + 1, n: p.moves.length };
        idx -= p.moves.length;
      }
      return null;
    }

    // ---------- 渲染 ----------
    function render() {
      el.root.hidden = !active || view !== 'coach';
      card.root.hidden = !active || view !== 'card';
      if (!active) return;
      if (view === 'coach') renderCoach();
      else renderCard();
      updateGuide();
      app.layoutChanged();
    }

    function renderCard() {
      const waiting = mode === 'wait';
      const finished = !waiting && (!step || step.done);
      const m = expected[0];
      card.title.textContent = t(finished ? 'hc.solved' : 'hc.title');
      card.moveRow.hidden = waiting || finished || !m;
      card.key.hidden = waiting || finished || !m;
      card.doBtn.hidden = waiting || finished || !m;
      card.more.hidden = waiting || !is3() || (finished && mode !== 'done');
      card.more.textContent = t(finished ? 'hc.tutorial' : 'hc.more');
      if (waiting) {
        card.ctx.textContent = t('hc.wait');
        card.prog.textContent = '';
      } else if (finished) {
        card.ctx.textContent = t('hc.solvedText');
        card.prog.textContent = '';
      } else if (m) {
        const d = describe(m);
        card.move.textContent = fmt(m);
        card.what.textContent = d.what;
        card.key.textContent = d.key;
        card.ctx.textContent = R(step.title);
        const p = partProgress();
        card.prog.textContent = p ? t('hc.progress', p) : '';
      }
      card.doBtn.textContent = t('hc.do');
      card.feedback.textContent = fb ? t(fb.key, fb.params) : '';
      card.feedback.className = 'hc-feedback ' + (fb ? fb.kind : '');
    }

    function renderCoach() {
      const lesson = mode === 'lesson' ? LESSONS[lessonIdx] : null;
      const chapter = lesson ? 0 : step ? (step.done ? 8 : step.chapter) : 1;
      const prog = is3() && mode !== 'lesson' ? solvers.get(model()).progress(app.logical()) : null;
      el.chapters.hidden = !is3();
      el.chapters.innerHTML = is3() ? [0, 1, 2, 3, 4, 5, 6, 7].map(i => {
        let cls = 'pill';
        if (i === chapter) cls += ' now';
        else if (i === 0 ? chapter > 0 : (prog && prog[i] && chapter > i) || chapter === 8) cls += ' done';
        return `<button type="button" class="${cls}" data-ch="${i}">${i ? i + ' ' : ''}${t('ch.' + i)}</button>`;
      }).join('') : '';

      let title = '', text = '', movesHtml = '', hint = '';
      if (lesson) {
        title = t(lesson.id + '.title');
        text = t(lesson.id + '.text');
        if (lesson.expect) movesHtml = `<div class="part"><div class="part-chips">${chips(all, 0)}</div></div>`;
      } else if (mode === 'wait') {
        title = t('tut.wait.title');
        text = t('tut.wait.text');
      } else if (step) {
        title = R(step.title);
        text = R(step.text);
        let from = 0;
        movesHtml = step.parts.map(p => {
          const html = `<div class="part"><div class="part-label">${R(p.label)}</div><div class="part-chips">${chips(p.moves, from)}</div></div>`;
          from += p.moves.length;
          return html;
        }).join('');
      }
      if (expected.length && mode !== 'wait') {
        const d = describe(expected[0]);
        hint = t('tut.next', { m: fmt(expected[0]), what: d.what + (d.key ? '　<span class="muted">' + d.key + '</span>' : '') });
      }
      el.title.textContent = title;
      el.text.textContent = text;
      el.moves.innerHTML = movesHtml;
      el.hint.innerHTML = hint;
      el.feedback.textContent = fb ? t(fb.key, fb.params) : '';
      el.feedback.className = 'coach-feedback ' + (fb ? fb.kind : '');

      let primary = null, secondary = null;
      if (lesson && lesson.next) primary = { label: lesson.next, fn: lesson.action === 'scramble' ? startSolving : nextLesson };
      else if (lesson && lesson.expect) { primary = { label: 'tb.helpOne', fn: helpOne }; secondary = { label: 'tb.skip', fn: startSolving }; }
      else if (mode === 'solve' && step && !step.done) { primary = { label: 'tb.helpOne', fn: helpOne }; secondary = { label: 'tb.playStep', fn: helpAll }; }
      else if (step && step.done) primary = { label: 'tb.again', fn: () => startSolving() };
      if (lesson && lessonIdx === LESSONS.length - 1 && !app.isSolved()) secondary = { label: 'tb.useCurrent', fn: () => startSolving(true) };
      else if (lesson && lesson.next && lessonIdx < LESSONS.length - 1) secondary = { label: 'tb.skip', fn: startSolving };
      setButton(el.primary, primary);
      setButton(el.secondary, secondary);
    }

    function setButton(btn, cfg) {
      btn.hidden = !cfg;
      if (!cfg) return;
      btn.textContent = t(cfg.label);
      btn.onclick = cfg.fn;
    }

    function feedback(key, params, kind) {
      fb = { key, params, kind: kind || '' };
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => { fb = null; render(); }, 3200);
      render();
    }

    // ---------- 高亮 ----------
    function maskOf(ids) {
      if (!ids || !ids.length) return null;
      const m = new Uint8Array(model().STICKERS);
      for (const id of ids) m[id] = 1;
      return m;
    }
    function lessonFocus(kind) {
      const sizes = { centers: 1, edges: 2, corners: 3 };
      const ids = [];
      for (const pc of model().CUBIES) if (pc.slots.length === sizes[kind]) ids.push(...pc.slots);
      return ids; // 贴纸编号 = 还原状态下所在的槽位
    }
    function updateGuide() {
      if (!active) { app.setGuide(null); return; }
      const lesson = mode === 'lesson' ? LESSONS[lessonIdx] : null;
      let focus = null, focus2 = null;
      if (lesson && lesson.focus) focus = maskOf(lessonFocus(lesson.focus));
      if (step && mode === 'solve' && !step.done) { focus = maskOf(step.focus); focus2 = maskOf(step.focus2); }
      app.setGuide({ focus, focus2, next: mode === 'wait' ? null : expected[0] || null });
    }

    // ---------- 流程 ----------
    function setExpect(moves) {
      all = moves.slice();
      expected = moves.map(m => ({ axis: m.axis, layers: m.layers, turns: m.turns }));
      doneCount = 0;
    }
    function showLesson(i) {
      clearTimeout(lessonTimer);
      mode = 'lesson';
      lessonIdx = Math.max(0, Math.min(LESSONS.length - 1, i));
      step = null;
      const L = LESSONS[lessonIdx];
      setExpect(L.expect ? model().parse(L.expect) : []);
      render();
    }
    const nextLesson = () => showLesson(lessonIdx + 1);

    function plan(fbKey, fbParams, kind) {
      step = nextStep(app.logical());
      mode = step.done ? 'done' : 'solve';
      setExpect(step.done ? [] : step.moves);
      if (fbKey) feedback(fbKey, fbParams, kind);
      else render();
    }
    function whenIdle(fn) {
      clearTimeout(waitTimer);
      const check = () => { if (app.busy()) waitTimer = setTimeout(check, 120); else fn(); };
      check();
    }
    function planWhenIdle(fbKey) {
      if (!app.busy()) { plan(fbKey); return; }
      mode = 'wait';
      setExpect([]);
      render();
      whenIdle(() => { if (active) plan(fbKey); });
    }
    // 默认先打乱再开始；fromCurrent === true 时直接从当前状态开始
    function startSolving(fromCurrent) {
      if (fromCurrent === true) { plan(); return; }
      mode = 'wait';
      step = null;
      setExpect([]);
      render();
      app.scramble();
      whenIdle(() => { if (active) plan(); });
    }
    function helpOne() {
      if (expected.length) app.playMove(expected[0]);
    }
    function helpAll() {
      if (expected.length) app.playMoves(expected.slice());
    }

    // 用户（或「帮我转」）做了一步
    function onMove(m, source) {
      if (!active || mode === 'wait') return;
      if (source !== 'user' && source !== 'tutor') {
        if (mode !== 'lesson') planWhenIdle('fb.changed');
        return;
      }
      const want = expected[0];
      if (want) {
        const C = model();
        if (C.sameMove(m, want)) {
          expected.shift();
          doneCount++;
          if (fb && fb.kind !== 'ok') { fb = null; clearTimeout(feedbackTimer); } // 转对了，旧的提醒不再适用
          if (!expected.length) { stepDone(); return; }
          render();
          return;
        }
        if (Math.abs(want.turns) === 2 && Math.abs(m.turns) === 1 && C.sameLayers(m, want)) {
          expected[0] = { axis: want.axis, layers: want.layers, turns: m.turns };
          feedback('fb.half', null, 'ok');
          return;
        }
      }
      if (mode === 'lesson') {
        if (LESSONS[lessonIdx].expect) feedback('fb.wrongLesson', { got: fmt(m), want: fmt(want) }, 'warn');
        return;
      }
      // 转得不一样也没关系，按当前状态重新规划（四阶以上的「倒回去」路线也会随之更新）
      plan(want ? 'fb.replan' : 'fb.changed', { got: fmt(m) }, 'warn');
    }
    function onBatch(source) {
      if (!active || mode === 'lesson') return;
      planWhenIdle(source === 'reset' ? null : 'fb.changed');
    }

    function stepDone() {
      if (mode === 'lesson') {
        feedback('fb.good', null, 'ok');
        lessonTimer = setTimeout(() => { if (active && mode === 'lesson') nextLesson(); }, 650);
        return;
      }
      render();
      const was = step && step.stage;
      whenIdle(() => {
        if (!active || mode !== 'solve') return;
        plan();
        if (step.done) feedback('fb.allDone', null, 'ok');
        else if (is3() && step.stage > was) feedback('fb.stageDone', { stage: { key: window.RubikSolver.STAGES[was].titleKey } }, 'ok');
        else feedback('fb.stepDone', null, 'ok');
      });
    }

    el.chapters.addEventListener('click', e => {
      const b = e.target.closest('[data-ch]');
      if (!b) return;
      const ch = +b.dataset.ch;
      if (ch === 0) showLesson(0);
      else if (mode === 'lesson') startSolving();
    });
    el.close.addEventListener('click', () => stop());
    card.close.addEventListener('click', () => stop());
    card.doBtn.addEventListener('click', helpOne);
    card.more.addEventListener('click', () => {
      if (mode === 'done') { startTutorial(); return; }
      setView('coach');
    });

    function setView(v) {
      view = v;
      app.teaching(v === 'coach');
      render();
    }

    // 提示：从当前状态给出下一步（任意阶数）
    function showHint() {
      const wasActive = active;
      active = true;
      if (!wasActive || mode === 'lesson') planWhenIdle();
      setView('card');
    }
    // 入门教程：只用三阶
    function startTutorial() {
      let switched = false;
      if (!is3()) { app.setOrder(3); switched = true; }
      active = true;
      app.resetView();
      showLesson(0);
      setView('coach');
      if (switched) feedback('fb.switch3', null, 'ok');
    }
    function stop() {
      active = false;
      clearTimeout(waitTimer);
      clearTimeout(lessonTimer);
      fb = null;
      app.setGuide(null);
      app.teaching(false);
      render();
    }
    function onOrderChange() {
      if (!active) return;
      if (view === 'coach' && mode === 'lesson') stop();
      else plan();
    }

    return {
      showHint, startTutorial, stop, onMove, onBatch, onOrderChange, render,
      get active() { return active; },
      get view() { return view; },
    };
  }

  window.createTutorial = createTutorial;
})();
