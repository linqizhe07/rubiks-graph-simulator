/*!
 * graph-view.js — 图论视图的 Canvas 渲染（任意阶）
 *
 * 为了高帧率：
 *  · 背景与灰色圆环预渲染到离屏画布，每帧一次 drawImage；
 *  · 节点按颜色预渲染成精灵图，每帧逐点 drawImage，不做逐点描边；
 *  · 拖尾由动画参数解析计算（与帧率无关），每个运动节点一条渐变路径。
 */
(function () {
  'use strict';
  const TAU = Math.PI * 2;

  const BG = '#FBFAF5', LINE = '#A69F95', DARK = '#39342E', OUTLINE = '#3C342D', LABEL = '#A39A8E';
  const GUIDE = '#6741D9'; // 教学高亮：紫色，和六种贴纸颜色都不撞
  // U R F D L B —— 取自参考动画的配色
  const FACE_COLORS = ['#FCB43C', '#F88B30', '#2C6749', '#FFFFFF', '#ED4528', '#154391'];
  const TRAIL_RGB = ['252,180,60', '248,139,48', '44,103,73', '170,162,150', '237,69,40', '21,67,145'];
  const NAME_INK = ['#5B3B00', '#5A2600', '#FFFFFF', '#3C342D', '#FFFFFF', '#FFFFFF'];
  const TRAIL_T = 0.17;     // 拖尾时长（占一次转动的比例）
  const TRAIL_ALPHA = 0.55;
  const TRAIL_FROM = TRAIL_RGB.map(c => `rgba(${c},0)`);
  const TRAIL_TO = TRAIL_RGB.map(c => `rgba(${c},${TRAIL_ALPHA})`);
  const CAPTION_SPACE = 30; // CSS px
  const FONT = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", Arial, sans-serif';

  function createGraphView(canvas) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const base = document.createElement('canvas');
    const sprites = [];
    const tmp = [0, 0];
    let G = null, model = null;
    let dpr = 1, W = 1, H = 1, scale = 1, ox = 0, oy = 0, half = 0;
    let labelsOn = true, labelPx = 10, knockPx = 6, labelAll = true;
    let trailN = 14, eBuf = new Float64Array(15);
    let insetLeft = 0; // CSS px：给浮在左侧的提示卡让出的宽度

    function setGraph(graph) {
      G = graph;
      model = graph.model;
      trailN = G.N <= 3 ? 14 : G.N <= 5 ? 10 : 8;
      eBuf = new Float64Array(trailN + 1);
      layout();
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      W = Math.max(1, Math.round(rect.width * dpr));
      H = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = W;
      canvas.height = H;
      layout();
    }

    function layout() {
      if (!G) return;
      const b = G.BOUNDS, pad = 0.07;
      const bw = b.x1 - b.x0 + 2 * pad, bh = b.y1 - b.y0 + 2 * pad;
      // 给底部说明文字留位置（窄屏上说明可能换行）
      const cap = canvas.parentElement && canvas.parentElement.querySelector('.caption');
      const capSpace = Math.max(CAPTION_SPACE, cap ? cap.offsetHeight + 14 : 0);
      const availH = Math.max(1, H - capSpace * dpr);
      const left = insetLeft * dpr, availW = Math.max(1, W - left);
      scale = Math.min(availW / bw, availH / bh);
      ox = left + availW / 2 - ((b.x0 + b.x1) / 2) * scale;
      oy = availH / 2 - ((b.y0 + b.y1) / 2) * scale;
      // 层名：放得下就全部标，放不下只标外层与中层
      const fit = Math.min(0.085, 0.375 * G.GAP) * scale;
      labelAll = fit >= 9 * dpr;
      labelPx = Math.round(Math.max(fit, 9 * dpr));
      knockPx = labelPx * 0.72;
      buildSprites();
      buildBase();
    }

    const showLabel = ci => labelAll || ci.outer || ci.middle;

    function circleLabel(c, ci, color, alpha, knockout = true) {
      const x = ox + ci.labelX * scale, y = oy + ci.labelY * scale;
      c.globalAlpha = 1;
      if (knockout) {
        c.fillStyle = BG;
        c.beginPath();
        c.arc(x, y, knockPx * Math.max(1, ci.name.length * 0.62), 0, TAU);
        c.fill();
      }
      c.globalAlpha = alpha;
      c.fillStyle = color;
      c.font = `650 ${ci.name.length > 1 ? Math.round(labelPx * 0.82) : labelPx}px ${FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(ci.name, x, y + labelPx * 0.05);
      c.globalAlpha = 1;
    }

    function buildBase() {
      base.width = W;
      base.height = H;
      const c = base.getContext('2d', { alpha: false });
      c.fillStyle = BG;
      c.fillRect(0, 0, W, H);
      c.setTransform(scale, 0, 0, scale, ox, oy);
      c.lineWidth = G.LINE_W;
      c.strokeStyle = LINE;
      for (const ci of G.CIRCLES) {
        c.beginPath();
        c.arc(ci.cx, ci.cy, ci.r, 0, TAU);
        c.stroke();
      }
      c.setTransform(1, 0, 0, 1, 0, 0);
      if (labelsOn) for (const ci of G.CIRCLES) if (showLabel(ci)) circleLabel(c, ci, LABEL, 1);
    }

    function buildSprites() {
      const rOuter = G.DOT_R * scale;
      const size = Math.ceil(rOuter * 2 + 4);
      half = size / 2;
      const lw = Math.max(1, G.DOT_STROKE * scale);
      for (let f = 0; f < 6; f++) {
        const s = sprites[f] || (sprites[f] = document.createElement('canvas'));
        s.width = s.height = size;
        const c = s.getContext('2d');
        c.clearRect(0, 0, size, size);
        c.beginPath();
        c.arc(half, half, Math.max(0.5, rOuter - lw / 2), 0, TAU);
        c.fillStyle = FACE_COLORS[f];
        c.fill();
        c.lineWidth = lw;
        c.strokeStyle = OUTLINE;
        c.stroke();
      }
    }

    function drawTrails(fs) {
      const a = fs.anim;
      const t = a.t, t0 = Math.max(0, t - TRAIL_T);
      if (t - t0 < 1e-3) return;
      for (let k = 0; k <= trailN; k++) eBuf[k] = a.ease(t0 + ((t - t0) * k) / trailN);
      ctx.setTransform(scale, 0, 0, scale, ox, oy);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = G.TRAIL_W;
      const mv = a.data.moving;
      for (let i = 0; i < mv.length; i++) {
        const m = mv[i];
        const col = model.colorOf(fs.stickers[m.slot]);
        G.pathPos(m, eBuf[0], tmp);
        const x0 = tmp[0], y0 = tmp[1];
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        for (let k = 1; k <= trailN; k++) {
          G.pathPos(m, eBuf[k], tmp);
          ctx.lineTo(tmp[0], tmp[1]);
        }
        if (Math.abs(tmp[0] - x0) + Math.abs(tmp[1] - y0) < 1e-4) continue;
        const g = ctx.createLinearGradient(x0, y0, tmp[0], tmp[1]);
        g.addColorStop(0, TRAIL_FROM[col]);
        g.addColorStop(1, TRAIL_TO[col]);
        ctx.strokeStyle = g;
        ctx.stroke();
      }
    }

    function drawArrows(arrows) {
      ctx.setTransform(scale, 0, 0, scale, ox, oy);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(0.006, 0.15 * G.DOT_R);
      ctx.globalAlpha = 0.9;
      const trim0 = G.DOT_R * 1.12, trim1 = G.DOT_R * 1.2, head = G.DOT_R * 0.47;
      for (const a of arrows) {
        const p = G.SLOT_POS[a.from], q = G.SLOT_POS[a.to];
        const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
        if (L < 1e-6) continue;
        const bend = Math.min(0.2, L * 0.2);
        const mx = (p[0] + q[0]) / 2 - (dy / L) * bend, my = (p[1] + q[1]) / 2 + (dx / L) * bend;
        const ux = mx - p[0], uy = my - p[1], ul = Math.hypot(ux, uy);
        const sx = p[0] + (ux / ul) * trim0, sy = p[1] + (uy / ul) * trim0;
        let vx = q[0] - mx, vy = q[1] - my;
        const vl = Math.hypot(vx, vy);
        vx /= vl; vy /= vl;
        const ex = q[0] - vx * trim1, ey = q[1] - vy * trim1;
        ctx.strokeStyle = a.color;
        ctx.fillStyle = a.color;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(mx, my, ex - vx * head * 0.6, ey - vy * head * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - vx * head - vy * head * 0.55, ey - vy * head + vx * head * 0.55);
        ctx.lineTo(ex - vx * head + vy * head * 0.55, ey - vy * head - vx * head * 0.55);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // 教学高亮：给当前要处理的块加脉冲紫圈，给要对准的中心加细圈
    function drawGuide(fs, key, anim, strong) {
      const st = fs.stickers, want = fs[key];
      const p = fs.pulse || 0;
      const r = G.DOT_R * scale * (strong ? 1.3 + 0.1 * p : 1.24);
      ctx.strokeStyle = GUIDE;
      ctx.lineWidth = Math.max(1.5 * dpr, G.DOT_R * scale * (strong ? 0.24 : 0.13));
      ctx.globalAlpha = strong ? 0.75 + 0.25 * p : 0.6;
      ctx.beginPath();
      for (let s = 0; s < st.length; s++) {
        if (!want[st[s]] || (anim && anim.data.mask[s])) continue;
        const q = G.SLOT_POS[s];
        const x = ox + q[0] * scale, y = oy + q[1] * scale;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
      if (anim) {
        for (const m of anim.data.moving) {
          if (!want[st[m.slot]]) continue;
          G.pathPos(m, anim.e, tmp);
          const x = ox + tmp[0] * scale, y = oy + tmp[1] * scale;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, TAU);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /**
     * fs: { stickers, anim: {data, t, e, ease} | null, highlight: Float32Array(3N),
     *       hoverFace, hoverFaceAlpha, trails, names, arrows, focus, focus2, pulse }
     */
    function render(fs) {
      if (!G) return;
      const st = fs.stickers, anim = fs.anim;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.drawImage(base, 0, 0);

      // 正在转动 / 悬停 / 提示中的圆环加深
      ctx.setTransform(scale, 0, 0, scale, ox, oy);
      ctx.lineWidth = G.LINE_W * 1.1;
      ctx.strokeStyle = DARK;
      let lit = false;
      for (let i = 0; i < G.CIRCLES.length; i++) {
        const h = fs.highlight[i];
        if (h < 0.004) continue;
        lit = true;
        const c = G.CIRCLES[i];
        ctx.globalAlpha = h;
        ctx.beginPath();
        ctx.arc(c.cx, c.cy, c.r, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (lit && labelsOn) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        for (let i = 0; i < G.CIRCLES.length; i++) {
          const h = fs.highlight[i], c = G.CIRCLES[i];
          if (h < 0.004 || !showLabel(c)) continue;
          circleLabel(ctx, c, LABEL, 1);
          circleLabel(ctx, c, DARK, h, false);
        }
      }

      if (anim && fs.trails) drawTrails(fs);

      // 教学高亮的柔光底（画在节点下面）
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (fs.focus) {
        ctx.fillStyle = 'rgba(103,65,217,0.13)';
        const r = G.DOT_R * scale * 1.75;
        ctx.beginPath();
        for (let s = 0; s < st.length; s++) {
          if (!fs.focus[st[s]] || (anim && anim.data.mask[s])) continue;
          const q = G.SLOT_POS[s];
          const x = ox + q[0] * scale, y = oy + q[1] * scale;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, TAU);
        }
        ctx.fill();
      }

      // 节点：先画静止的，再画运动中的（压在上面）
      const mask = anim ? anim.data.mask : null;
      for (let s = 0; s < st.length; s++) {
        if (mask && mask[s]) continue;
        const p = G.SLOT_POS[s];
        ctx.drawImage(sprites[model.colorOf(st[s])], ox + p[0] * scale - half, oy + p[1] * scale - half);
      }
      if (anim) {
        const mv = anim.data.moving;
        for (let i = 0; i < mv.length; i++) {
          G.pathPos(mv[i], anim.e, tmp);
          ctx.drawImage(sprites[model.colorOf(st[mv[i].slot])], ox + tmp[0] * scale - half, oy + tmp[1] * scale - half);
        }
      }

      if (fs.focus2) drawGuide(fs, 'focus2', anim, false);
      if (fs.focus) drawGuide(fs, 'focus', anim, true);

      // 悬停的面：给该面的节点加一圈描边
      if (fs.hoverFace >= 0 && fs.hoverFaceAlpha > 0.01) {
        const NN = G.N * G.N;
        ctx.globalAlpha = fs.hoverFaceAlpha;
        ctx.strokeStyle = DARK;
        ctx.lineWidth = Math.max(1, 0.15 * G.DOT_R * scale);
        const rr = G.DOT_R * scale * 1.2;
        ctx.beginPath();
        for (let k = 0; k < NN; k++) {
          const p = G.SLOT_POS[fs.hoverFace * NN + k];
          const x = ox + p[0] * scale, y = oy + p[1] * scale;
          ctx.moveTo(x + rr, y);
          ctx.arc(x, y, rr, 0, TAU);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (fs.names) {
        const px = Math.round(0.62 * G.DOT_R * scale);
        if (px >= 7 * dpr) {
          ctx.font = `600 ${px}px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const dy = 0.04 * G.DOT_R * scale;
          const name = (id, x, y) => {
            ctx.fillStyle = NAME_INK[model.colorOf(id)];
            ctx.fillText(model.SLOTS[id].name, x, y);
          };
          for (let s = 0; s < st.length; s++) {
            if (mask && mask[s]) continue;
            const p = G.SLOT_POS[s];
            name(st[s], ox + p[0] * scale, oy + p[1] * scale + dy);
          }
          if (anim) {
            for (const m of anim.data.moving) {
              G.pathPos(m, anim.e, tmp);
              name(st[m.slot], ox + tmp[0] * scale, oy + tmp[1] * scale + dy);
            }
          }
        }
      }

      if (fs.arrows && fs.arrows.length) drawArrows(fs.arrows);
    }

    function toGraph(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left) * dpr, y = (clientY - rect.top) * dpr;
      return [(x - ox) / scale, (y - oy) / scale];
    }
    const pxToUnits = px => (px * dpr) / scale;
    function setLayerLabels(on) {
      labelsOn = on;
      if (G) buildBase();
    }
    // 当前阶数下「贴纸编号」是否放得下
    const namesFit = () => !!G && 0.62 * G.DOT_R * scale >= 7 * dpr;
    // 左侧让出 px 宽度；返回是否有变化
    function setInsetLeft(px) {
      px = Math.max(0, Math.round(px));
      if (px === insetLeft) return false;
      insetLeft = px;
      layout();
      return true;
    }

    return { resize, render, toGraph, pxToUnits, setLayerLabels, setGraph, namesFit, setInsetLeft };
  }

  window.createGraphView = createGraphView;
  window.GRAPH_FACE_COLORS = FACE_COLORS;
})();
