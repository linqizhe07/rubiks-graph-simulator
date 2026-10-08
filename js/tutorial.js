/*!
 * tutorial.js — 新手引导教学（三阶，层先法）
 *
 * 流程：入门（认识中心/棱/角、动手练记号） → 7 个还原阶段。
 * 每一步都给出：为什么这样转、分组的公式、下一下转哪里（图上闪烁提示）。
 * 用户自己转对了就前进；转错了也没关系，会按当前状态重新规划；随时可以让它「帮我转」。
 * 所有文字都走 i18n.js，切换语言时原地重绘，不丢失进度。
 */
(function () {
  'use strict';
  const I = window.I18N;
  const t = (k, p) => I.t(k, p);
  const R = v => I.render(v);

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

  function createTutorial(app, el) {
    let active = false;
    let mode = 'lesson'; // lesson | solve | done | wait
    let lessonIdx = 0;
    let step = null;     // 当前小步（求解器给出）
    let all = [];        // 当前小步的全部转动
    let doneCount = 0;   // 已完成的转动数
    let expected = [];   // 剩余的期望转动
    let solver = null;
    let fb = null;       // 当前反馈 { key, params, kind }
    let feedbackTimer = 0, waitTimer = 0;

    const model = () => app.model();
    const fmt = m => model().moveToString(m);

    // ---------- 提示文字 ----------
    function describe(m) {
      const name = fmt(m);
      const letter = name.replace(/['2]/g, '');
      const prime = name.includes("'"), dbl = name.includes('2');
      if (/^[xyz]$/.test(letter)) {
        const what = t('rot.' + letter) + (dbl ? t('rot.half') : prime ? t('rot.rev') : '');
        const k = (prime && !dbl ? 'Shift + ' : '') + letter.toUpperCase();
        return what + '　<span class="muted">' + t('key.hint', { keys: dbl ? t('key.twice', { k }) : k }) + '</span>';
      }
      const faceKey = 'face.' + letter;
      const face = I.DICT.zh[faceKey] ? t(faceKey) : t('face.layer', { name: letter });
      const what = t('desc.turn', { face, dir: t(dbl ? 'dir.half' : prime ? 'dir.ccw' : 'dir.cw') });
      let keys = '';
      if (letter.length === 1) {
        const k = (prime && !dbl ? 'Shift + ' : '') + letter;
        keys = t('key.hint', { keys: dbl ? t('key.twice', { k }) : k });
      }
      if ('UDLRFB'.includes(letter) && letter.length === 1) {
        keys += t('key.click', {
          shift: prime && !dbl ? t('key.clickShift') : '',
          face: t(faceKey),
          twice: dbl ? t('key.clickTwice') : '',
        });
      }
      return what + (keys ? '　<span class="muted">' + keys + '</span>' : '');
    }

    function chips(moves, from) {
      return moves.map((m, i) => {
        const idx = from + i;
        const cls = idx < doneCount ? 'chip done' : idx === doneCount ? 'chip now' : 'chip';
        return `<span class="${cls}">${fmt(m)}</span>`;
      }).join('');
    }

    function render() {
      if (!active) return;
      const lesson = mode === 'lesson' ? LESSONS[lessonIdx] : null;
      const chapter = lesson ? 0 : step ? (step.done ? 8 : step.chapter) : 1;
      const prog = solver && mode !== 'lesson' ? solver.progress(app.logical()) : null;
      el.chapters.innerHTML = [0, 1, 2, 3, 4, 5, 6, 7].map(i => {
        let cls = 'pill';
        if (i === chapter) cls += ' now';
        else if (i === 0 ? chapter > 0 : (prog && prog[i] && chapter > i) || chapter === 8) cls += ' done';
        return `<button type="button" class="${cls}" data-ch="${i}">${i ? i + ' ' : ''}${t('ch.' + i)}</button>`;
      }).join('');

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
      if (expected.length && mode !== 'wait') hint = t('tut.next', { m: fmt(expected[0]), what: describe(expected[0]) });
      el.title.textContent = title;
      el.text.textContent = text;
      el.moves.innerHTML = movesHtml;
      el.hint.innerHTML = hint;
      el.feedback.textContent = fb ? t(fb.key, fb.params) : '';
      el.feedback.className = 'coach-feedback ' + (fb ? fb.kind : '');

      // 按钮
      let primary = null, secondary = null;
      if (lesson && lesson.next) primary = { label: lesson.next, fn: lesson.action === 'scramble' ? startSolving : nextLesson };
      else if (lesson && lesson.expect) { primary = { label: 'tb.helpOne', fn: helpOne }; secondary = { label: 'tb.skip', fn: startSolving }; }
      else if (mode === 'solve' && step && !step.done) { primary = { label: 'tb.helpOne', fn: helpOne }; secondary = { label: 'tb.playStep', fn: helpAll }; }
      else if (step && step.done) primary = { label: 'tb.again', fn: () => startSolving() };
      if (lesson && lessonIdx === LESSONS.length - 1 && !app.isSolved()) secondary = { label: 'tb.useCurrent', fn: () => startSolving(true) };
      else if (lesson && lesson.next && lessonIdx < LESSONS.length - 1) secondary = { label: 'tb.skip', fn: startSolving };
      setButton(el.primary, primary);
      setButton(el.secondary, secondary);
      updateGuide();
      app.layoutChanged();
    }

    function setButton(btn, cfg) {
      btn.hidden = !cfg;
      if (!cfg) return;
      btn.textContent = t(cfg.label);
      btn.onclick = cfg.fn;
    }

    function feedback(key, params, kind) {
      fb = { key, params, kind: kind || '' };
      el.feedback.textContent = t(key, params);
      el.feedback.className = 'coach-feedback ' + fb.kind;
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => { fb = null; el.feedback.textContent = ''; }, 3200);
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
      app.setGuide({ focus, focus2, next: expected[0] || null });
    }

    // ---------- 流程 ----------
    function setExpect(moves) {
      all = moves.slice();
      expected = moves.map(m => ({ axis: m.axis, layers: m.layers, turns: m.turns }));
      doneCount = 0;
    }
    function showLesson(i) {
      mode = 'lesson';
      lessonIdx = Math.max(0, Math.min(LESSONS.length - 1, i));
      step = null;
      const L = LESSONS[lessonIdx];
      setExpect(L.expect ? model().parse(L.expect) : []);
      render();
    }
    const nextLesson = () => showLesson(lessonIdx + 1);

    function plan(fbKey, fbParams, kind) {
      if (!solver) solver = window.RubikSolver.create(model());
      step = solver.nextStep(app.logical());
      mode = step && step.done ? 'done' : 'solve';
      setExpect(step && !step.done ? step.moves : []);
      if (fbKey) feedback(fbKey, fbParams, kind);
      render();
    }
    function whenIdle(fn) {
      clearTimeout(waitTimer);
      const check = () => { if (app.busy()) waitTimer = setTimeout(check, 120); else fn(); };
      check();
    }
    // 默认先打乱再开始；fromCurrent === true 时直接从当前状态开始
    function startSolving(fromCurrent) {
      if (fromCurrent === true) {
        plan();
        return;
      }
      mode = 'wait';
      step = null;
      setExpect([]);
      render();
      app.scramble();
      whenIdle(() => plan());
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
        if (mode !== 'lesson') whenIdle(() => plan('fb.changed'));
        return;
      }
      const want = expected[0];
      if (want) {
        const C = model();
        if (C.sameMove(m, want)) {
          expected.shift();
          doneCount++;
          if (!expected.length) return stepDone();
          render();
          return;
        }
        if (Math.abs(want.turns) === 2 && Math.abs(m.turns) === 1 && C.sameLayers(m, want)) {
          expected[0] = { axis: want.axis, layers: want.layers, turns: m.turns };
          feedback('fb.half', null, 'ok');
          render();
          return;
        }
      }
      if (mode === 'lesson') {
        if (LESSONS[lessonIdx].expect) feedback('fb.wrongLesson', { got: fmt(m), want: fmt(want) }, 'warn');
        return;
      }
      // 求解模式：转得不一样也没关系，按当前状态重新规划
      plan('fb.replan', { got: fmt(m) }, 'warn');
    }
    function onBatch(source) {
      if (!active || mode === 'wait' || mode === 'lesson') return;
      whenIdle(() => (source === 'reset' ? plan() : plan('fb.changed')));
    }

    function stepDone() {
      render();
      if (mode === 'lesson') {
        feedback('fb.good', null, 'ok');
        setTimeout(() => { if (active && mode === 'lesson') nextLesson(); }, 650);
        return;
      }
      const was = step ? step.stage : 0;
      whenIdle(() => {
        if (!active || mode !== 'solve') return;
        plan();
        if (step && step.done) feedback('fb.allDone', null, 'ok');
        else if (step && step.stage > was) feedback('fb.stageDone', { stage: { key: window.RubikSolver.STAGES[was].titleKey } }, 'ok');
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

    function start() {
      let switched = false;
      if (app.N !== 3) {
        app.setOrder(3);
        switched = true;
      }
      solver = window.RubikSolver.create(model());
      active = true;
      el.root.hidden = false;
      app.teaching(true);
      app.resetView();
      showLesson(0);
      if (switched) feedback('fb.switch3', null, 'ok');
    }
    function stop() {
      active = false;
      clearTimeout(waitTimer);
      el.root.hidden = true;
      app.setGuide(null);
      app.teaching(false);
    }
    function onOrderChange(n) {
      if (active && n !== 3) stop();
    }

    return {
      start, stop, onMove, onBatch, onOrderChange, render,
      get active() { return active; },
    };
  }

  window.createTutorial = createTutorial;
})();
