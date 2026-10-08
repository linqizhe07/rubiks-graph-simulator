/*!
 * graph-view.js — 图论视图的 Canvas 渲染
 *
 * 为了高帧率：
 *  · 背景与 9 个灰色圆环预渲染到离屏画布，每帧一次 drawImage；
 *  · 节点按颜色预渲染成精灵图，每帧 54 次 drawImage，不做逐点描边；
 *  · 拖尾由动画参数解析计算（与帧率无关），每个运动节点一条渐变路径。
 */
(function () {
  'use strict';
  const G = window.RubikGraph, Cube = window.RubikCube;
  const TAU = Math.PI * 2;

  const BG = '#FBFAF5', LINE = '#A69F95', DARK = '#39342E', OUTLINE = '#3C342D', LABEL = '#A39A8E';
  // U R F D L B —— 取自参考动画的配色
  const FACE_COLORS = ['#FCB43C', '#F88B30', '#2C6749', '#FFFFFF', '#ED4528', '#154391'];
  const TRAIL_RGB = ['252,180,60', '248,139,48', '44,103,73', '170,162,150', '237,69,40', '21,67,145'];
  const NAME_INK = ['#5B3B00', '#5A2600', '#FFFFFF', '#3C342D', '#FFFFFF', '#FFFFFF'];
  const TRAIL_T = 0.17;     // 拖尾时长（占一次转动的比例）
  const TRAIL_ALPHA = 0.55;
  const TRAIL_N = 14;
  const CAPTION_SPACE = 30; // CSS px
  // 预先拼好渐变色字符串，避免每帧分配
  const TRAIL_FROM = TRAIL_RGB.map(c => `rgba(${c},0)`);
  const TRAIL_TO = TRAIL_RGB.map(c => `rgba(${c},${TRAIL_ALPHA})`);
  const FONT = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", Arial, sans-serif';

  function createGraphView(canvas) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const base = document.createElement('canvas');
    const sprites = [];
    const tmp = [0, 0];
    const eBuf = new Float64Array(TRAIL_N + 1);
    let dpr = 1, W = 1, H = 1, scale = 1, ox = 0, oy = 0, half = 0;
    let labelsOn = true;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      W = Math.max(1, Math.round(rect.width * dpr));
      H = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = W;
      canvas.height = H;
      const b = G.BOUNDS, pad = 0.07;
      const bw = b.x1 - b.x0 + 2 * pad, bh = b.y1 - b.y0 + 2 * pad;
      // 给底部说明文字留位置（窄屏上说明可能换行）
      const cap = canvas.parentElement && canvas.parentElement.querySelector('.caption');
      const capSpace = Math.max(CAPTION_SPACE, cap ? cap.offsetHeight + 14 : 0);
      const availH = Math.max(1, H - capSpace * dpr);
      scale = Math.min(W / bw, availH / bh);
      ox = W / 2 - ((b.x0 + b.x1) / 2) * scale;
      oy = availH / 2 - ((b.y0 + b.y1) / 2) * scale;
      buildSprites();
      buildBase();
    }

    function circleLabel(c, ci, color, alpha, knockout = true) {
      const x = ox + ci.labelX * scale, y = oy + ci.labelY * scale;
      c.globalAlpha = 1;
      if (knockout) {
        c.fillStyle = BG;
        c.beginPath();
        c.arc(x, y, 0.058 * scale, 0, TAU);
        c.fill();
      }
      c.globalAlpha = alpha;
      c.fillStyle = color;
      c.font = `650 ${Math.max(9, Math.round(0.08 * scale))}px ${FONT}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(ci.name, x, y + 0.004 * scale);
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
      if (labelsOn) for (const ci of G.CIRCLES) circleLabel(c, ci, LABEL, 1);
    }

    function buildSprites() {
      const rOuter = G.DOT_R * scale;
      const size = Math.ceil(rOuter * 2 + 4);
      half = size / 2;
      const lw = G.DOT_STROKE * scale;
      for (let f = 0; f < 6; f++) {
        const s = sprites[f] || (sprites[f] = document.createElement('canvas'));
        s.width = s.height = size;
        const c = s.getContext('2d');
        c.clearRect(0, 0, size, size);
        c.beginPath();
        c.arc(half, half, rOuter - lw / 2, 0, TAU);
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
      for (let k = 0; k <= TRAIL_N; k++) eBuf[k] = a.ease(t0 + ((t - t0) * k) / TRAIL_N);
      ctx.setTransform(scale, 0, 0, scale, ox, oy);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = G.TRAIL_W;
      const mv = a.data.moving;
      for (let i = 0; i < mv.length; i++) {
        const m = mv[i];
        const col = Cube.colorOf(fs.stickers[m.slot]);
        G.pathPos(m, eBuf[0], tmp);
        const x0 = tmp[0], y0 = tmp[1];
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        for (let k = 1; k <= TRAIL_N; k++) {
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

    function drawName(id, x, y) {
      ctx.fillStyle = NAME_INK[Cube.colorOf(id)];
      ctx.fillText(Cube.SLOTS[id].name, x, y);
    }

    function drawArrows(arrows) {
      ctx.setTransform(scale, 0, 0, scale, ox, oy);
      ctx.lineCap = 'round';
      ctx.lineWidth = 0.016;
      ctx.globalAlpha = 0.9;
      const trim0 = G.DOT_R + 0.012, trim1 = G.DOT_R + 0.02, head = 0.05;
      for (const a of arrows) {
        const p = G.SLOT_POS[a.from], q = G.SLOT_POS[a.to];
        const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
        if (L < 1e-6) continue;
        const bend = Math.min(0.2, L * 0.2);
        const mx = (p[0] + q[0]) / 2 - (dy / L) * bend, my = (p[1] + q[1]) / 2 + (dx / L) * bend;
        let ux = mx - p[0], uy = my - p[1], ul = Math.hypot(ux, uy);
        const sx = p[0] + (ux / ul) * trim0, sy = p[1] + (uy / ul) * trim0;
        let vx = q[0] - mx, vy = q[1] - my, vl = Math.hypot(vx, vy);
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

    /**
     * fs: { stickers, anim: {data, t, e, ease} | null, highlight: Float32Array(9),
     *       hoverFace, hoverFaceAlpha, trails, names, arrows }
     */
    function render(fs) {
      const st = fs.stickers, anim = fs.anim;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.drawImage(base, 0, 0);

      // 正在转动 / 悬停的圆环加深
      ctx.setTransform(scale, 0, 0, scale, ox, oy);
      ctx.lineWidth = G.LINE_W * 1.1;
      ctx.strokeStyle = DARK;
      let lit = false;
      for (let i = 0; i < 9; i++) {
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
        for (let i = 0; i < 9; i++) {
          const h = fs.highlight[i];
          if (h < 0.004) continue;
          circleLabel(ctx, G.CIRCLES[i], LABEL, 1);
          circleLabel(ctx, G.CIRCLES[i], DARK, h, false);
        }
      }

      if (anim && fs.trails) drawTrails(fs);

      // 节点：先画静止的，再画运动中的（压在上面）
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const mask = anim ? anim.data.mask : null;
      for (let s = 0; s < 54; s++) {
        if (mask && mask[s]) continue;
        const p = G.SLOT_POS[s];
        ctx.drawImage(sprites[Cube.colorOf(st[s])], ox + p[0] * scale - half, oy + p[1] * scale - half);
      }
      if (anim) {
        const mv = anim.data.moving;
        for (let i = 0; i < mv.length; i++) {
          G.pathPos(mv[i], anim.e, tmp);
          ctx.drawImage(sprites[Cube.colorOf(st[mv[i].slot])], ox + tmp[0] * scale - half, oy + tmp[1] * scale - half);
        }
      }

      // 悬停的面：给 9 个节点加一圈描边
      if (fs.hoverFace >= 0 && fs.hoverFaceAlpha > 0.01) {
        ctx.globalAlpha = fs.hoverFaceAlpha;
        ctx.strokeStyle = DARK;
        ctx.lineWidth = 0.016 * scale;
        const rr = (G.DOT_R + 0.022) * scale;
        for (let k = 0; k < 9; k++) {
          const p = G.SLOT_POS[fs.hoverFace * 9 + k];
          ctx.beginPath();
          ctx.arc(ox + p[0] * scale, oy + p[1] * scale, rr, 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      if (fs.names) {
        ctx.font = `600 ${Math.max(7, Math.round(0.066 * scale))}px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const dy = 0.004 * scale;
        for (let s = 0; s < 54; s++) {
          if (mask && mask[s]) continue;
          const p = G.SLOT_POS[s];
          drawName(st[s], ox + p[0] * scale, oy + p[1] * scale + dy);
        }
        if (anim) {
          for (const m of anim.data.moving) {
            G.pathPos(m, anim.e, tmp);
            drawName(st[m.slot], ox + tmp[0] * scale, oy + tmp[1] * scale + dy);
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
      buildBase();
    }

    return { resize, render, toGraph, pxToUnits, setLayerLabels };
  }

  window.createGraphView = createGraphView;
  window.GRAPH_FACE_COLORS = FACE_COLORS;
})();
