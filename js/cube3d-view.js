/*!
 * cube3d-view.js — 与图论视图同步的三维魔方
 *
 * Canvas 2D 软渲染（无依赖）：弱透视投影 + 背面剔除 + 画家算法。
 * 转动时按转动轴把 27 个小块分成 3 片（片与片之间被垂直于转轴的平面隔开），
 * 由远到近逐片绘制，片内再按到相机的距离排序，因此转动过程中不会出现穿插。
 */
(function () {
  'use strict';
  const Cube = window.RubikCube;

  const BG = '#FBFAF5';
  const FACE_RGB = [[252, 180, 60], [248, 139, 48], [44, 103, 73], [247, 246, 242], [237, 69, 40], [21, 67, 145]];
  const BODY_RGB = [224, 220, 212];
  const CAM = 10;                 // 相机距离（弱透视）
  const HALF = 0.49;              // 小块半边长，留出细缝
  const ST_HALF = 0.41, ST_R = 0.1, ST_K = 3;
  const AMB = 0.86, DIF = 0.17;
  const LIGHT = normalize([-0.3, 0.9, 0.6]);
  const DEF_YAW = -Math.PI / 4, DEF_PITCH = 0.56;

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

  // ---------- 几何：26 个小块，每块 6 个面；朝外的面带一张圆角贴纸 ----------
  function buildCubies() {
    const cubies = [];
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (!x && !y && !z) continue;
          const p = [x, y, z];
          const faces = [];
          for (let a = 0; a < 3; a++) {
            for (const s of [1, -1]) {
              const n = [0, 0, 0];
              n[a] = s;
              const [b, c] = [0, 1, 2].filter(k => k !== a);
              const center = p.slice();
              center[a] += s * HALF;
              const corners = new Float64Array(12);
              [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([su, sv], k) => {
                const q = center.slice();
                q[b] += su * HALF;
                q[c] += sv * HALF;
                corners.set(q, k * 3);
              });
              let sticker = null;
              if (p[a] === s) {
                const pts = new Float64Array(4 * (ST_K + 1) * 3);
                const inner = ST_HALF - ST_R;
                let k = 0;
                [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([su, sv], corner) => {
                  for (let j = 0; j <= ST_K; j++) {
                    const ang = (corner + j / ST_K) * (Math.PI / 2);
                    const q = center.slice();
                    q[a] += s * 0.003;
                    q[b] += su * inner + ST_R * Math.cos(ang);
                    q[c] += sv * inner + ST_R * Math.sin(ang);
                    pts.set(q, k * 3);
                    k++;
                  }
                });
                sticker = { slot: Cube.slotAt(p, n), pts, count: k };
              }
              faces.push({ n, center, corners, sticker });
            }
          }
          cubies.push({ p, faces, M: null, dist: 0, slab: 0 });
        }
      }
    }
    return cubies;
  }

  function createCubeView(canvas) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const cubies = buildCubies();
    const order = cubies.map((_, i) => i);
    const RX = new Float64Array(9), RY = new Float64Array(9), V = new Float64Array(9);
    const A = new Float64Array(9), VA = new Float64Array(9);
    const P = new Float64Array(64);
    const slabRank = [0, 0, 0];
    let dpr = 1, W = 1, H = 1, scale = 1, cx = 0, cy = 0;
    let yaw = DEF_YAW, pitch = DEF_PITCH, tYaw = yaw, tPitch = pitch;
    let drag = null;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      W = Math.max(1, Math.round(rect.width * dpr));
      H = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = W;
      canvas.height = H;
      const availH = Math.max(1, H - 26 * dpr); // 给底部说明文字留位置
      scale = Math.min(W, availH) / 6;
      cx = W / 2;
      cy = availH / 2 - 0.08 * scale;
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

    // 着色后的颜色字符串按亮度量化缓存，避免每帧拼接上百个字符串
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

    function drawCubie(cb, st, hover) {
      const M = cb.M;
      const lit = hover && hover.layers.includes(cb.p[hover.axis]);
      for (const f of cb.faces) {
        const n = f.n, c = f.center;
        const nx = M[0] * n[0] + M[1] * n[1] + M[2] * n[2];
        const ny = M[3] * n[0] + M[4] * n[1] + M[5] * n[2];
        const nz = M[6] * n[0] + M[7] * n[1] + M[8] * n[2];
        const fx = M[0] * c[0] + M[1] * c[1] + M[2] * c[2];
        const fy = M[3] * c[0] + M[4] * c[1] + M[5] * c[2];
        const fz = M[6] * c[0] + M[7] * c[1] + M[8] * c[2];
        if (-nx * fx - ny * fy + nz * (CAM - fz) <= 0) continue; // 背面剔除
        const k = AMB + DIF * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
        const body = shadeRGB(BODY_RGB, k);
        project(M, f.corners, 4);
        ctx.fillStyle = body;
        ctx.fill();
        ctx.strokeStyle = body;
        ctx.lineWidth = 0.8 * dpr;
        ctx.stroke();
        if (f.sticker) {
          project(M, f.sticker.pts, f.sticker.count);
          ctx.fillStyle = shadeRGB(FACE_RGB[Cube.colorOf(st[f.sticker.slot])], k);
          ctx.fill();
          if (lit) {
            ctx.strokeStyle = `rgba(57,52,46,${hover.alpha})`;
            ctx.lineWidth = 2.2 * dpr;
            ctx.stroke();
          }
        }
      }
    }

    /** fs: { stickers, anim: {axis, layers, angle} | null, hover: {axis, layers, alpha} | null } */
    function render(fs) {
      const an = fs.anim;
      rotation(0, pitch, RX);
      rotation(1, yaw, RY);
      mul(RX, RY, V);
      if (an) {
        rotation(an.axis, an.angle, A);
        mul(V, A, VA);
        // 相机在世界坐标中的位置 = CAM × V 的第三行；按与相机的距离给三片排序（远的先画）
        const e = CAM * V[6 + an.axis];
        for (let s = 0; s < 3; s++) {
          const ds = Math.abs(e - (s - 1));
          let r = 0;
          for (let o = 0; o < 3; o++) if (o !== s && Math.abs(e - (o - 1)) > ds) r++;
          slabRank[s] = r;
        }
      }
      for (const cb of cubies) {
        const moving = an && an.layers.includes(cb.p[an.axis]);
        const M = moving ? VA : V;
        cb.M = M;
        const [x, y, z] = cb.p;
        const vx = M[0] * x + M[1] * y + M[2] * z;
        const vy = M[3] * x + M[4] * y + M[5] * z;
        const vz = M[6] * x + M[7] * y + M[8] * z;
        cb.dist = Math.hypot(vx, vy, CAM - vz);
        cb.slab = an ? slabRank[cb.p[an.axis] + 1] : 0;
      }
      order.sort((i, j) => cubies[i].slab - cubies[j].slab || cubies[j].dist - cubies[i].dist);

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
      for (const i of order) drawCubie(cubies[i], fs.stickers, fs.hover);
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
    canvas.addEventListener('dblclick', () => {
      // 保持在最近的等价朝向上复位，避免绕远路
      const TAU = Math.PI * 2;
      tYaw = DEF_YAW + Math.round((yaw - DEF_YAW) / TAU) * TAU;
      tPitch = DEF_PITCH;
    });

    return {
      resize, render, update,
      set onViewChange(fn) { onView = fn; },
    };
  }

  window.createCubeView = createCubeView;
})();
