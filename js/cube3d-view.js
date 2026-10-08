/*!
 * cube3d-view.js — 与图论视图同步的三维魔方（任意阶）
 *
 * Canvas 2D 软渲染（无依赖）：弱透视投影 + 背面剔除 + 画家算法。
 * 转动时沿转轴把魔方切成几块「实心长方体」：正在转的层是一块，其余静止的部分各是一块。
 * 每块都是凸体，它朝向相机的面互不遮挡；块与块之间被垂直于转轴的平面隔开，
 * 所以只要按到相机的远近逐块绘制，就不会穿插，而且每帧只需画外表面和切面上的少量多边形。
 */
(function () {
  'use strict';

  const BG = '#FBFAF5';
  const FACE_RGB = [[252, 180, 60], [248, 139, 48], [44, 103, 73], [247, 246, 242], [237, 69, 40], [21, 67, 145]];
  const BODY_RGB = [224, 220, 212];
  const CUT_RGB = [200, 194, 184];
  const CAM = 10;      // 相机距离（弱透视）
  const HALF = 1.5;    // 魔方半边长（世界坐标）
  const AMB = 0.86, DIF = 0.17;
  const LIGHT = normalize([-0.3, 0.9, 0.6]);
  const DEF_YAW = -Math.PI / 4, DEF_PITCH = 0.56;
  const FACE_LETTERS = ['U', 'R', 'F', 'D', 'L', 'B'];
  const FACE_AXIS = [1, 0, 2, 1, 0, 2], FACE_SIGN = [1, 1, 1, -1, -1, -1];

  function normalize(v) {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function mul(a, b, out) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
      }
    }
    return out;
  }
  function rotation(axis, ang, out) {
    const c = Math.cos(ang), s = Math.sin(ang);
    if (axis === 0) out.set([1, 0, 0, 0, c, -s, 0, s, c]);
    else if (axis === 1) out.set([c, 0, s, 0, 1, 0, -s, 0, c]);
    else out.set([c, -s, 0, s, c, 0, 0, 0, 1]);
    return out;
  }

  function createCubeView(canvas) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const RX = new Float64Array(9), RY = new Float64Array(9), V = new Float64Array(9);
    const A = new Float64Array(9), VA = new Float64Array(9);
    const P = new Float64Array(128);
    const BOX = new Float64Array(12);
    let dpr = 1, W = 1, H = 1, scale = 1, cx = 0, cy = 0;
    let yaw = DEF_YAW, pitch = DEF_PITCH, tYaw = yaw, tPitch = pitch;
    let drag = null;
    let model = null, N = 3, unit = 1, geo = [], faceSlots = [];
    let labelsOn = true;
    let insetBottom = 0; // CSS px：给面板底部的提示卡让出的高度

    // ---------- 几何：每张贴纸是一个圆角方块 ----------
    function setModel(m) {
      model = m;
      N = m.N;
      unit = (2 * HALF) / N;
      const half = 0.41 * unit, rr = 0.1 * unit, K = 3, inner = half - rr;
      geo = m.SLOTS.map(slot => {
        const a = slot.axis, sign = slot.normal[a];
        const [b, c] = [0, 1, 2].filter(k => k !== a);
        const center = slot.pos.map(v => (v * unit) / 2);
        center[a] = sign * (HALF + 0.004);
        const pts = new Float64Array(4 * (K + 1) * 3);
        let k = 0;
        [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([su, sv], corner) => {
          for (let j = 0; j <= K; j++) {
            const ang = (corner + j / K) * (Math.PI / 2);
            pts[k * 3 + a] = center[a];
            pts[k * 3 + b] = center[b] + su * inner + rr * Math.cos(ang);
            pts[k * 3 + c] = center[c] + sv * inner + rr * Math.sin(ang);
            k++;
          }
        });
        return pts;
      });
      faceSlots = [0, 1, 2, 3, 4, 5].map(f => m.SLOTS.filter(s => s.face === f).map(s => s.index));
    }
    const STICKER_PTS = 16;

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
      const availH = Math.max(1, H - (26 + insetBottom) * dpr); // 给底部说明文字（和提示卡）留位置
      scale = Math.min(W, availH) / 6;
      cx = W / 2;
      cy = availH / 2 - 0.08 * scale;
    }
    function setInsetBottom(px) {
      px = Math.max(0, Math.round(px));
      if (px === insetBottom) return false;
      insetBottom = px;
      layout();
      return true;
    }

    function project(M, pts, n) {
      for (let k = 0; k < n; k++) {
        const x = pts[k * 3], y = pts[k * 3 + 1], z = pts[k * 3 + 2];
        const vx = M[0] * x + M[1] * y + M[2] * z;
        const vy = M[3] * x + M[4] * y + M[5] * z;
        const vz = M[6] * x + M[7] * y + M[8] * z;
        const s = (scale * CAM) / (CAM - vz);
        P[k * 2] = cx + vx * s;
        P[k * 2 + 1] = cy - vy * s;
      }
      ctx.beginPath();
      ctx.moveTo(P[0], P[1]);
      for (let k = 1; k < n; k++) ctx.lineTo(P[k * 2], P[k * 2 + 1]);
      ctx.closePath();
    }
    const projectPoint = (M, x, y, z, out) => {
      const vx = M[0] * x + M[1] * y + M[2] * z;
      const vy = M[3] * x + M[4] * y + M[5] * z;
      const vz = M[6] * x + M[7] * y + M[8] * z;
      const s = (scale * CAM) / (CAM - vz);
      out[0] = cx + vx * s;
      out[1] = cy - vy * s;
    };

    // 着色后的颜色字符串按亮度量化缓存，避免每帧拼接大量字符串
    const shadeCache = new Map();
    function shadeRGB(rgb, k) {
      const q = Math.round(k * 160);
      const key = rgb[0] * 1e9 + rgb[1] * 1e6 + rgb[2] * 1e3 + q;
      let s = shadeCache.get(key);
      if (!s) {
        const f = q / 160;
        s = `rgb(${Math.min(255, rgb[0] * f) | 0},${Math.min(255, rgb[1] * f) | 0},${Math.min(255, rgb[2] * f) | 0})`;
        shadeCache.set(key, s);
      }
      return s;
    }

    // 沿转轴把层切成连续的若干块
    function blocksFor(an) {
      if (!an) return [{ axis: 1, i0: 0, i1: N - 1, moving: false }];
      const inL = new Uint8Array(N);
      for (const l of an.layers) inL[l] = 1;
      const out = [];
      let start = 0;
      for (let i = 1; i <= N; i++) {
        if (i === N || inL[i] !== inL[start]) {
          out.push({ axis: an.axis, i0: start, i1: i - 1, moving: !!inL[start] });
          start = i;
        }
      }
      return out;
    }

    const tmp2 = [0, 0];
    function drawBlock(blk, fs) {
      const M = blk.moving ? VA : V;
      const lo = -HALF + blk.i0 * unit, hi = -HALF + (blk.i1 + 1) * unit;
      const mn = [-HALF, -HALF, -HALF], mx = [HALF, HALF, HALF];
      mn[blk.axis] = lo;
      mx[blk.axis] = hi;
      const st = fs.stickers, hover = fs.hover;
      for (let f = 0; f < 6; f++) {
        const k = FACE_AXIS[f], sg = FACE_SIGN[f];
        // 法向与面中心（视图空间）
        const nx = M[k] * sg, ny = M[3 + k] * sg, nz = M[6 + k] * sg;
        const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
        c[k] = sg > 0 ? mx[k] : mn[k];
        const fx = M[0] * c[0] + M[1] * c[1] + M[2] * c[2];
        const fy = M[3] * c[0] + M[4] * c[1] + M[5] * c[2];
        const fz = M[6] * c[0] + M[7] * c[1] + M[8] * c[2];
        if (-nx * fx - ny * fy + nz * (CAM - fz) <= 0) continue; // 背面剔除
        const outer = k !== blk.axis || (sg < 0 ? blk.i0 === 0 : blk.i1 === N - 1);
        const shade = AMB + DIF * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
        // 面的四个角
        const [b, d] = [0, 1, 2].filter(q => q !== k);
        let n = 0;
        for (const [ub, ud] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          BOX[n * 3 + k] = c[k];
          BOX[n * 3 + b] = ub ? mx[b] : mn[b];
          BOX[n * 3 + d] = ud ? mx[d] : mn[d];
          n++;
        }
        const body = shadeRGB(outer ? BODY_RGB : CUT_RGB, shade);
        project(M, BOX, 4);
        ctx.fillStyle = body;
        ctx.fill();
        ctx.strokeStyle = body;
        ctx.lineWidth = 0.8 * dpr;
        ctx.stroke();
        // 小块之间的细缝
        if (N > 1) {
          ctx.beginPath();
          for (const q of [b, d]) {
            const other = q === b ? d : b;
            for (let i = 1; i < N; i++) {
              const v = -HALF + i * unit;
              if (v <= mn[q] + 1e-9 || v >= mx[q] - 1e-9) continue;
              const p0 = [0, 0, 0], p1 = [0, 0, 0];
              p0[k] = p1[k] = c[k];
              p0[q] = p1[q] = v;
              p0[other] = mn[other];
              p1[other] = mx[other];
              projectPoint(M, p0[0], p0[1], p0[2], tmp2);
              ctx.moveTo(tmp2[0], tmp2[1]);
              projectPoint(M, p1[0], p1[1], p1[2], tmp2);
              ctx.lineTo(tmp2[0], tmp2[1]);
            }
          }
          ctx.strokeStyle = outer ? 'rgba(60,52,45,0.10)' : 'rgba(60,52,45,0.16)';
          ctx.lineWidth = Math.max(1, 0.7 * dpr);
          ctx.stroke();
        }
        if (!outer) continue;
        // 这块的这一面上的贴纸
        const slots = faceSlots[f];
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          const slot = model.SLOTS[s];
          if (k !== blk.axis) {
            const l = slot.layer[blk.axis];
            if (l < blk.i0 || l > blk.i1) continue;
          }
          project(M, geo[s], STICKER_PTS);
          const id = st[s];
          ctx.fillStyle = shadeRGB(FACE_RGB[model.colorOf(id)], shade);
          ctx.fill();
          if (fs.focus && fs.focus[id]) {
            ctx.strokeStyle = `rgba(103,65,217,${0.75 + 0.25 * (fs.pulse || 0)})`;
            ctx.lineWidth = (N <= 3 ? 3.2 : 2.4) * dpr;
            ctx.stroke();
          } else if (fs.focus2 && fs.focus2[id]) {
            ctx.strokeStyle = 'rgba(103,65,217,0.6)';
            ctx.lineWidth = 1.8 * dpr;
            ctx.stroke();
          } else if (hover && hover.layers.includes(slot.layer[hover.axis])) {
            ctx.strokeStyle = `rgba(57,52,46,${hover.alpha})`;
            ctx.lineWidth = (N <= 4 ? 2.2 : 1.5) * dpr;
            ctx.stroke();
          }
        }
      }
    }

    // 面的名字（U / F / R …）标在朝向相机的面中央
    function drawFaceLabels(alpha) {
      ctx.globalAlpha = alpha;
      const px = Math.round(Math.max(11 * dpr, scale * 0.26));
      ctx.font = `700 ${px}px ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      for (let f = 0; f < 6; f++) {
        const k = FACE_AXIS[f], sg = FACE_SIGN[f];
        const nz = V[6 + k] * sg, nx = V[k] * sg, ny = V[3 + k] * sg;
        const p = [0, 0, 0];
        p[k] = sg * HALF;
        const fx = V[0] * p[0] + V[1] * p[1] + V[2] * p[2];
        const fy = V[3] * p[0] + V[4] * p[1] + V[5] * p[2];
        const fz = V[6] * p[0] + V[7] * p[1] + V[8] * p[2];
        const facing = -nx * fx - ny * fy + nz * (CAM - fz);
        if (facing <= 0 || nz < 0.3) continue;
        projectPoint(V, p[0], p[1], p[2], tmp2);
        ctx.lineWidth = Math.max(2, px * 0.16);
        ctx.strokeStyle = 'rgba(42,38,33,0.55)';
        ctx.strokeText(FACE_LETTERS[f], tmp2[0], tmp2[1]);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText(FACE_LETTERS[f], tmp2[0], tmp2[1]);
      }
      ctx.globalAlpha = 1;
    }

    /**
     * fs: { stickers, anim: {axis, layers, angle} | null, hover: {axis, layers, alpha} | null,
     *       focus, focus2, pulse, labels }
     */
    function render(fs) {
      if (!model) return;
      const an = fs.anim;
      rotation(0, pitch, RX);
      rotation(1, yaw, RY);
      mul(RX, RY, V);
      if (an) {
        rotation(an.axis, an.angle, A);
        mul(V, A, VA);
      }
      const blocks = blocksFor(an);
      if (blocks.length > 1) {
        // 相机在世界坐标中的位置 = CAM × V 的第三行；按与相机的远近排序，远的先画
        const e = CAM * V[6 + blocks[0].axis];
        for (const blk of blocks) {
          const lo = -HALF + blk.i0 * unit, hi = -HALF + (blk.i1 + 1) * unit;
          blk.d = Math.max(lo - e, 0, e - hi);
        }
        blocks.sort((p, q) => q.d - p.d);
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, W, H);
      // 地面软阴影
      const sy = cy + 2.25 * scale;
      const g = ctx.createRadialGradient(cx, sy, 0, cx, sy, 2.1 * scale);
      g.addColorStop(0, 'rgba(60,52,45,0.16)');
      g.addColorStop(1, 'rgba(60,52,45,0)');
      ctx.fillStyle = g;
      ctx.setTransform(1, 0, 0, 0.22, 0, sy * 0.78);
      ctx.beginPath();
      ctx.arc(cx, sy, 2.1 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      ctx.lineJoin = 'round';
      for (const blk of blocks) drawBlock(blk, fs);
      // 面名标的是「位置」，转动过程中淡一点，免得浮在正在转的层上
      if (fs.labels && labelsOn) drawFaceLabels(an ? 0.3 : 1);
    }

    // 视角缓动（双击复位时平滑回到默认视角）；返回是否需要重绘
    function update(dt) {
      if (drag) return false;
      const dy = tYaw - yaw, dp = tPitch - pitch;
      if (Math.abs(dy) < 1e-4 && Math.abs(dp) < 1e-4) {
        if (dy || dp) { yaw = tYaw; pitch = tPitch; return true; }
        return false;
      }
      const k = 1 - Math.exp(-dt / 90);
      yaw += dy * k;
      pitch += dp * k;
      return true;
    }
    function resetView() {
      const TAU = Math.PI * 2;
      tYaw = DEF_YAW + Math.round((yaw - DEF_YAW) / TAU) * TAU;
      tPitch = DEF_PITCH;
    }

    let onView = null;
    canvas.addEventListener('pointerdown', e => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* 合成事件没有活动指针 */ }
      canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointermove', e => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      yaw = tYaw = yaw + dx * 0.009;
      pitch = tPitch = Math.max(-1.45, Math.min(1.45, pitch + dy * 0.009));
      if (onView) onView();
    });
    const end = e => {
      if (!drag || drag.id !== e.pointerId) return;
      drag = null;
      canvas.classList.remove('grabbing');
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('dblclick', resetView);

    return {
      resize, render, update, setModel, resetView, setInsetBottom,
      setLabels(on) { labelsOn = on; },
      set onViewChange(fn) { onView = fn; },
    };
  }

  window.createCubeView = createCubeView;
})();
