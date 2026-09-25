/**
 * TearTicket — vanilla port of reactbits TearTicket (tear-off stub).
 * Geometry + bridge physics adapted from the React + motion original.
 */

const TILT_SPRING = { stiffness: 220, damping: 24, mass: 0.6 };
const GRAVITY = 2400;
const ART_INSET = 8;
const ART_SPAN = 0.78;
const RETRACT = 0.17;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rad = (deg) => (deg * Math.PI) / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const noise = (seed) => {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const f = (n) => n.toFixed(2);

function buildGeometry(W, H, S, R, holes, hole, notch, rough) {
  const main = W;
  const cross = H;
  const x = main - S;
  const hr = hole / 2;
  const n = Math.max(1, Math.round(holes));
  const span = cross - 2 * notch;
  const bridge = Math.max(2, (span - n * hole) / (n + 1));
  const random = noise(n * 7919 + Math.round(cross));
  const at = (u, v) => ({ x: u, y: v });
  const pt = (u, v) => `${f(u)},${f(v)}`;
  const arc = (r, sweep, u, v) => `A${f(r)},${f(r)} 0 0 ${sweep} ${pt(u, v)}`;
  const bridges = [];
  for (let i = 0; i <= n; i += 1) {
    const y0 = notch + i * (bridge + hole);
    const y1 = y0 + bridge;
    const steps = Math.max(2, Math.round(bridge / 2.2));
    const pts = [];
    for (let k = 1; k < steps; k += 1) {
      pts.push([x + (random() - 0.5) * 2 * rough, y0 + (bridge * k) / steps]);
    }
    bridges.push({ y0, y1, mid: (y0 + y1) / 2, pts, ...at(x, (y0 + y1) / 2) });
  }
  let body = `M${pt(R, 0)}L${pt(x - notch, 0)}${arc(notch, 0, x, notch)}`;
  bridges.forEach((b, i) => {
    b.pts.forEach((p) => {
      body += `L${pt(p[0], p[1])}`;
    });
    body += `L${pt(x, b.y1)}`;
    if (i < n) body += arc(hr, 0, x, b.y1 + hole);
  });
  body += `${arc(notch, 0, x - notch, cross)}L${pt(R, cross)}${arc(R, 1, 0, cross - R)}L${pt(0, R)}${arc(R, 1, R, 0)}Z`;

  let stub = `M${pt(x + notch, 0)}L${pt(main - R, 0)}${arc(R, 1, main, R)}L${pt(main, cross - R)}${arc(R, 1, main - R, cross)}L${pt(x + notch, cross)}${arc(notch, 0, x, cross - notch)}`;
  for (let i = n; i >= 0; i -= 1) {
    const b = bridges[i];
    for (let k = b.pts.length - 1; k >= 0; k -= 1) stub += `L${pt(b.pts[k][0], b.pts[k][1])}`;
    stub += `L${pt(x, b.y0)}`;
    if (i > 0) stub += arc(hr, 0, x, b.y0 - hole);
  }
  stub += `${arc(notch, 0, x + notch, 0)}Z`;

  const ends = [
    { ...at(x, notch), v: notch },
    { ...at(x, cross - notch), v: cross - notch },
  ];

  const bodyOutline = `M${pt(x, cross - notch)}${arc(notch, 0, x - notch, cross)}L${pt(R, cross)}${arc(R, 1, 0, cross - R)}L${pt(0, R)}${arc(R, 1, R, 0)}L${pt(x - notch, 0)}${arc(notch, 0, x, notch)}`;
  const stubOutline = `M${pt(x, notch)}${arc(notch, 0, x + notch, 0)}L${pt(main - R, 0)}${arc(R, 1, main, R)}L${pt(main, cross - R)}${arc(R, 1, main - R, cross)}L${pt(x + notch, cross)}${arc(notch, 0, x, cross - notch)}`;
  return { cross, body, stub, bridges, ends, bodyOutline, stubOutline };
}

/**
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {string} opts.image
 * @param {string} opts.imageAlt
 * @param {string|HTMLElement} opts.bodyHtml
 * @param {string|HTMLElement} opts.stubHtml
 * @param {() => void} opts.onTear
 */
export function mountTearTicket(root, opts = {}) {
  const {
    image = '',
    imageAlt = '',
    bodyHtml = '',
    stubHtml = '',
    onTear,
    width = 460,
    height = 250,
    stubSize = 150,
    radius = 16,
    holes = 12,
    holeSize = 6,
    notch = 3,
    roughness = 0,
    tearAngle = 30,
    stretch = 30,
    resistance = 0.45,
    rotate = 3,
    background = '#27272a',
    color = '#f5f5f5',
    border = true,
    ariaLabel = 'Tear off the stub',
  } = opts;

  const geo = buildGeometry(width, height, stubSize, radius, holes, holeSize, notch, roughness);
  root.className = `tear-ticket${root.className ? ` ${root.className}` : ''}`;
  root.style.setProperty('--tt-w', `${width}px`);
  root.style.setProperty('--tt-h', `${height}px`);
  root.style.setProperty('--tt-stub', `${stubSize}px`);
  root.style.setProperty('--tt-bg', background);
  root.style.setProperty('--tt-stub-bg', background);
  root.style.setProperty('--tt-ink', color);
  root.style.setProperty('--tt-edge', `color-mix(in srgb, ${color} 16%, transparent)`);
  root.style.setProperty('--tt-edge-w', '1');
  root.style.setProperty('--tt-body-w', `${width - stubSize}px`);
  root.style.setProperty('--tt-body-h', `${height}px`);
  root.style.setProperty('--tt-inset', `${ART_INSET}px`);
  root.style.setProperty('--tt-span', String(ART_SPAN));
  root.style.setProperty('--tt-art-radius', '8px');
  root.style.setProperty('--tt-fit', '1');
  root.style.height = `${height}px`;

  root.innerHTML = `
    <div class="tear-ticket__stage">
      <div class="tear-ticket__plane" style="transform: perspective(1000px) rotate(${rotate}deg)">
        <div class="tear-ticket__piece tear-ticket__body">
          ${border ? `<svg class="tear-ticket__edge" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${geo.bodyOutline}"/></svg>` : ''}
          <div class="tear-ticket__paper" style="clip-path: path('${geo.body}')">
            ${image ? `<div class="tear-ticket__art"><img class="tear-ticket__image" src="${image}" alt="${imageAlt}" draggable="false"/><div class="tear-ticket__scrim"></div></div>` : ''}
            <div class="tear-ticket__content"></div>
          </div>
        </div>
        <svg class="tear-ticket__fibres" aria-hidden="true">
          ${geo.bridges
            .map(
              (b, i) =>
                `<g><path data-f="n${i}"/><path data-f="f${i}"/></g>`,
            )
            .join('')}
        </svg>
        <div class="tear-ticket__piece tear-ticket__piece--stub" role="button" tabindex="0" aria-label="${ariaLabel}">
          ${border ? `<svg class="tear-ticket__edge" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${geo.stubOutline}"/></svg>` : ''}
          <div class="tear-ticket__paper tear-ticket__paper--stub" style="clip-path: path('${geo.stub}')">
            <div class="tear-ticket__stub"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  const contentEl = root.querySelector('.tear-ticket__content');
  const stubEl = root.querySelector('.tear-ticket__stub');
  const bodyPiece = root.querySelector('.tear-ticket__body');
  const stubPiece = root.querySelector('.tear-ticket__piece--stub');
  const stage = root.querySelector('.tear-ticket__stage');
  const plane = root.querySelector('.tear-ticket__plane');
  const fibres = [...root.querySelectorAll('.tear-ticket__fibres path')];

  if (typeof bodyHtml === 'string') contentEl.innerHTML = bodyHtml;
  else if (bodyHtml) contentEl.appendChild(bodyHtml);
  if (typeof stubHtml === 'string') stubEl.innerHTML = stubHtml;
  else if (stubHtml) stubEl.appendChild(stubHtml);

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sim = {
    raf: 0,
    last: 0,
    phase: 'idle',
    id: null,
    sign: 1,
    hinge: { x: 0, y: 0 },
    hingeV: 0,
    grab: { x: 0, y: 0 },
    start: { x: 0, y: 0 },
    point: { x: 0, y: 0 },
    a0: 0,
    theta: 0,
    thetaV: 0,
    sx: 0,
    sy: 0,
    vx: 0,
    vy: 0,
    spin: 0,
    pvx: 0,
    pvy: 0,
    pt: 0,
    fade: 1,
    age: 0,
    bx: 0,
    bv: 0,
    snapped: geo.bridges.map(() => false),
    snapAt: geo.bridges.map(() => 0),
    span: geo.bridges.map(() => 0),
    grabbing: false,
  };

  function paint(now) {
    stubPiece.style.transform = `translate(${sim.sx.toFixed(2)}px, ${sim.sy.toFixed(2)}px) rotate(${((sim.theta * sim.sign * 180) / Math.PI).toFixed(3)}deg)`;
    stubPiece.style.opacity = sim.fade.toFixed(3);
    bodyPiece.style.transform = `translateX(${sim.bx.toFixed(2)}px)`;
    const cos = Math.cos(sim.theta * sim.sign);
    const sin = Math.sin(sim.theta * sim.sign);
    const lx = 0;
    const ly = 1.6;
    let busy = false;
    geo.bridges.forEach((b, i) => {
      const near = fibres[i * 2];
      const far = fibres[i * 2 + 1];
      if (!near || !far) return;
      const dx = b.x - sim.hinge.x;
      const dy = b.y - sim.hinge.y;
      const tx = sim.hinge.x + dx * cos - dy * sin + sim.sx;
      const ty = sim.hinge.y + dx * sin + dy * cos + sim.sy;
      const ox = b.x + sim.bx;
      const oy = b.y;
      const gx = tx - ox;
      const gy = ty - oy;
      const gap = Math.hypot(gx, gy);
      const live = sim.phase !== 'idle' && !reduce;
      if (!sim.snapped[i]) {
        if (!live || gap < 0.35) {
          near.style.opacity = '0';
          far.style.opacity = '0';
          return;
        }
        const k = clamp(gap / stretch, 0, 1);
        const sag = gap * 0.18;
        const w = (1.7 - 1.15 * k).toFixed(2);
        const sx = sag + gx / 2;
        const sy = gy / 2;
        near.setAttribute('d', `M${f(ox - lx)},${f(oy - ly)}Q${f(ox - lx + sx)},${f(oy - ly + sy)} ${f(tx - lx)},${f(ty - ly)}`);
        far.setAttribute('d', `M${f(ox + lx)},${f(oy + ly)}Q${f(ox + lx + gx - sx)},${f(oy + ly + gy - sy)} ${f(tx + lx)},${f(ty + ly)}`);
        near.style.strokeWidth = w;
        far.style.strokeWidth = w;
        near.style.opacity = '1';
        far.style.opacity = '1';
        sim.span[i] = gap;
        return;
      }
      const t = (now - sim.snapAt[i]) / 1000 / RETRACT;
      if (!live || t >= 1 || !sim.snapAt[i]) {
        near.style.opacity = '0';
        far.style.opacity = '0';
        return;
      }
      busy = true;
      const left = (1 - t) * (1 - t);
      const len = (sim.span[i] || stretch) * 0.5 * left;
      const ux = gap > 0.01 ? gx / gap : 1;
      const uy = gap > 0.01 ? gy / gap : 0;
      near.setAttribute('d', `M${f(ox)},${f(oy)}L${f(ox + ux * len)},${f(oy + uy * len)}`);
      far.setAttribute('d', `M${f(tx)},${f(ty)}L${f(tx - ux * len)},${f(ty - uy * len)}`);
      near.style.strokeWidth = '0.9';
      far.style.strokeWidth = '0.9';
      near.style.opacity = left.toFixed(2);
      far.style.opacity = left.toFixed(2);
    });
    return busy;
  }

  function finish() {
    stubPiece.style.visibility = 'hidden';
    root.setAttribute('data-used', '');
    onTear?.();
  }

  function step(now) {
    const dt = clamp((now - sim.last) / 1000, 0.001, 0.034);
    sim.last = now;
    const limit = rad(tearAngle);
    if (sim.phase === 'held') {
      let intact = 0;
      for (let i = 0; i < geo.bridges.length; i += 1) if (!sim.snapped[i]) intact += 1;
      const hold = geo.bridges.length ? intact / geo.bridges.length : 0;
      const follow = 0.92 * (1 - clamp(resistance, 0, 0.95) * hold);
      const a = Math.atan2(sim.point.y - sim.hinge.y, sim.point.x - sim.hinge.x);
      const want = clamp(wrap(a - sim.a0) * sim.sign * follow, 0, limit + 0.1);
      sim.theta += (want - sim.theta) * (1 - Math.exp(-dt / 0.035));
      const away = clamp((sim.point.x - sim.start.x || 0) * 0.05, -2, 4);
      const side = clamp((sim.point.y - sim.start.y || 0) * 0.05, -3, 3);
      sim.sx += (away - sim.sx) * (1 - Math.exp(-dt / 0.05));
      sim.sy += (side - sim.sy) * (1 - Math.exp(-dt / 0.05));
      const slack = Math.hypot(sim.sx, sim.sy);
      let left = 0;
      geo.bridges.forEach((b, i) => {
        if (sim.snapped[i]) return;
        const d = Math.abs(b.mid - sim.hingeV);
        if (2 * d * Math.sin(sim.theta / 2) + slack > stretch || sim.theta >= limit) {
          sim.snapped[i] = true;
          sim.snapAt[i] = now;
          sim.bv -= 560 / geo.bridges.length;
        } else left += 1;
      });
      if (left === 0) {
        sim.phase = 'free';
        sim.bv -= 150;
      }
    } else if (sim.phase === 'free') {
      const cos = Math.cos(sim.theta * sim.sign);
      const sin = Math.sin(sim.theta * sim.sign);
      const gx = sim.grab.x - sim.hinge.x;
      const gy = sim.grab.y - sim.hinge.y;
      const wx = sim.point.x - sim.hinge.x - (gx * cos - gy * sin);
      const wy = sim.point.y - sim.hinge.y - (gx * sin + gy * cos);
      sim.sx += (wx - sim.sx) * (1 - Math.exp(-dt / 0.045));
      sim.sy += (wy - sim.sy) * (1 - Math.exp(-dt / 0.045));
      const hang = limit * 0.55 + clamp(sim.pvx * 0.0009 * sim.sign, -0.3, 0.3);
      sim.theta += (hang - sim.theta) * (1 - Math.exp(-dt / 0.12));
    } else if (sim.phase === 'drop') {
      sim.age += dt;
      sim.vy += GRAVITY * dt;
      sim.sx += sim.vx * dt;
      sim.sy += sim.vy * dt;
      sim.theta += sim.spin * dt;
      if (sim.age > 0.16) sim.fade = clamp(1 - (sim.age - 0.16) / 0.42, 0, 1);
      if (sim.fade <= 0) {
        sim.phase = 'idle';
        finish();
      }
    } else if (sim.phase === 'return') {
      sim.thetaV += (-300 * sim.theta - 24 * sim.thetaV) * dt;
      sim.theta += sim.thetaV * dt;
      sim.sx += (0 - sim.sx) * (1 - Math.exp(-dt / 0.07));
      sim.sy += (0 - sim.sy) * (1 - Math.exp(-dt / 0.07));
      if (Math.abs(sim.theta) < 0.0008 && Math.abs(sim.thetaV) < 0.01 && Math.hypot(sim.sx, sim.sy) < 0.05) {
        sim.theta = 0;
        sim.thetaV = 0;
        sim.sx = 0;
        sim.sy = 0;
        sim.phase = 'idle';
      }
    }
    sim.bv += (-520 * sim.bx - 30 * sim.bv) * dt;
    sim.bx += sim.bv * dt;
    const busy = paint(now);
    const moving = Math.abs(sim.bx) > 0.02 || Math.abs(sim.bv) > 0.5;
    if (sim.phase !== 'idle' || moving || busy) sim.raf = requestAnimationFrame(step);
    else {
      sim.bx = 0;
      sim.bv = 0;
      paint(now);
      sim.raf = 0;
    }
  }

  function run() {
    if (sim.raf) return;
    sim.last = performance.now();
    sim.raf = requestAnimationFrame(step);
  }

  function tearNow() {
    cancelAnimationFrame(sim.raf);
    sim.raf = 0;
    sim.phase = 'idle';
    root.setAttribute('data-instant', '');
    finish();
  }

  function local(e) {
    const r = stage.getBoundingClientRect();
    const k = r.width / width || 1;
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  }

  function onStubDown(e) {
    if (e.button !== 0 || sim.id !== null || sim.phase === 'drop') return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = local(e);
    sim.id = e.pointerId;
    sim.start = p;
    sim.point = p;
    sim.pt = performance.now();
    sim.pvx = 0;
    sim.pvy = 0;
    if (sim.theta < 0.01) {
      const far = p.y < geo.cross / 2;
      const end = geo.ends[far ? 1 : 0];
      sim.sign = far ? 1 : -1;
      sim.hinge = { x: end.x, y: end.y };
      sim.hingeV = end.v;
      stubPiece.style.transformOrigin = `${sim.hinge.x}px ${sim.hinge.y}px`;
    }
    const cos = Math.cos(-sim.theta * sim.sign);
    const sin = Math.sin(-sim.theta * sim.sign);
    const ux = p.x - sim.sx - sim.hinge.x;
    const uy = p.y - sim.sy - sim.hinge.y;
    sim.grab = { x: sim.hinge.x + ux * cos - uy * sin, y: sim.hinge.y + ux * sin + uy * cos };
    sim.a0 = Math.atan2(sim.grab.y - sim.hinge.y, sim.grab.x - sim.hinge.x) - (sim.theta * sim.sign) / 0.92;
    sim.phase = 'held';
    sim.thetaV = 0;
    sim.grabbing = true;
    root.setAttribute('data-grabbing', '');
    run();
  }

  function onStubMove(e) {
    if (sim.id !== e.pointerId) return;
    const p = local(e);
    const now = performance.now();
    const dt = Math.max(0.004, (now - sim.pt) / 1000);
    sim.pvx += ((p.x - sim.point.x) / dt - sim.pvx) * 0.35;
    sim.pvy += ((p.y - sim.point.y) / dt - sim.pvy) * 0.35;
    sim.pt = now;
    sim.point = p;
    if (reduce && Math.hypot(p.x - sim.start.x, p.y - sim.start.y) > 28) {
      sim.id = null;
      sim.grabbing = false;
      root.removeAttribute('data-grabbing');
      tearNow();
    }
  }

  function onStubUp(e) {
    if (sim.id !== e.pointerId) return;
    sim.id = null;
    sim.grabbing = false;
    root.removeAttribute('data-grabbing');
    if (sim.phase === 'free') {
      const still = performance.now() - sim.pt > 80;
      sim.vx = still ? 0 : clamp(sim.pvx, -1600, 1600);
      sim.vy = still ? 0 : clamp(sim.pvy, -1600, 1200);
      sim.spin = clamp(sim.vx * 0.004, -6, 6) + 1.2 * sim.sign;
      sim.age = 0;
      sim.phase = 'drop';
    } else if (sim.phase === 'held') {
      sim.phase = 'return';
    }
    run();
  }

  function onStubKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (!e.repeat) tearNow();
  }

  stubPiece.addEventListener('pointerdown', onStubDown);
  stubPiece.addEventListener('pointermove', onStubMove);
  stubPiece.addEventListener('pointerup', onStubUp);
  stubPiece.addEventListener('pointercancel', onStubUp);
  stubPiece.addEventListener('keydown', onStubKey);

  // gentle tilt (skip on touch / reduced motion)
  const onMove = (e) => {
    if (reduce || e.pointerType === 'touch' || sim.id !== null) return;
    const r = root.getBoundingClientRect();
    const nx = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2 + 200), -1, 1);
    const ny = clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2 + 200), -1, 1);
    plane.style.transform = `perspective(1000px) rotate(${rotate}deg) rotateX(${(-ny * 7).toFixed(2)}deg) rotateY(${(nx * 7).toFixed(2)}deg)`;
  };
  window.addEventListener('pointermove', onMove);

  paint(performance.now());

  return {
    tear: tearNow,
    destroy() {
      cancelAnimationFrame(sim.raf);
      window.removeEventListener('pointermove', onMove);
      stubPiece.removeEventListener('pointerdown', onStubDown);
      stubPiece.removeEventListener('pointermove', onStubMove);
      stubPiece.removeEventListener('pointerup', onStubUp);
      stubPiece.removeEventListener('pointercancel', onStubUp);
      stubPiece.removeEventListener('keydown', onStubKey);
    },
  };
}

void TILT_SPRING;
