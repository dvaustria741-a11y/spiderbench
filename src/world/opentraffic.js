// OWNER: perf / open map. Lightweight street traffic for the Open City grid (citylite.js). The Manhattan traffic network
// needs its road graph; the open map is a plain grid, so cars here are 1-D lane followers on closed loops:
//   - 2 lanes per avenue / street (right-hand traffic), one fixed speed per car, car-following gap control,
//   - one shared signal cycle (avenues green, then streets, all-red gap between), cars stop at the stop lines,
//   - rendering through vehinst.js (real vehicles.glb models, LODs, instancing) only within `farCut` of the camera.
// No collision with the player (cars are visual); density follows Options > Vehicle Density (setDensity) live.
import * as THREE from 'three';
import { createVehicleSet, pickVehicle, paintFor, VTYPES } from './vehinst.js';
import { G, avenues, streets, NCOL, NROW } from './openmap.js';

const MAX_SCALE = 1.2, SPACING = 90;           // metres between cars per lane at density 1
const ACC = 2.6, BRAKE = 4.5, GAP_MIN = 2.2;
const STOP_BACK = 7.6;                          // m before the junction edge: the painted stop line sits ~7 m back (crosswalk 4 m + stop zone)
const CYCLE = 20;                               // s: avenues green 0-8, yellow 8-9.2, all red -10, streets green 10-18, yellow 18-19.2, red -20
const lightOf = (t, avenueAxis) => {
  const u = (t + (avenueAxis ? 0 : 10)) % CYCLE;
  return u < 8 ? 0 : u < 9.2 ? 1 : 2;           // 0 green, 1 yellow, 2 red
};
const lenOf = Object.fromEntries(VTYPES.map(T => [T.t, T.len]));

export function createOpenTraffic({ models, group, scale = 0.12, _V = null }) {
  let rs = 12345; const rnd = () => ((rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296);
  const AVH = G.AV_HALF, STH = G.ST_HALF;
  const zS = streets[0] - STH, zE = streets[NROW] + STH, xS = avenues[0] - AVH, xE = avenues[NCOL] + AVH;
  const lanes = [];
  const mk = (axis, fixed, dir, off, L, junc0, juncStep, juncN, half) => lanes.push({ axis, fixed, dir, off, L, junc0, juncStep, juncN, half, all: [], cars: [] });
  for (const ax of avenues) for (const dir of [1, -1]) mk('av', ax, dir, -dir * G.AV_ROAD / 4, zE - zS, STH, G.ST_SP, NROW, STH);
  for (const sz of streets) for (const dir of [1, -1]) mk('st', sz, dir, dir * G.ST_ROAD / 4, xE - xS, AVH, G.AV_SP, NCOL, AVH);

  // every car that may ever exist (density just activates a subset)
  const counts = {};
  for (const ln of lanes) {
    const n = Math.max(1, Math.floor(ln.L / (SPACING / MAX_SCALE)));
    for (let i = 0; i < n; i++) {
      const T = pickVehicle(rnd());
      const c = { t: T.t, len: lenOf[T.t] ?? 4.8, col: paintFor(T.t, rnd()), seed: rnd(), vmax: (ln.axis === 'av' ? 12 : 9) + rnd() * 4, v: 0, s: 0, r: rnd(), lane: ln };
      ln.all.push(c); counts[T.t] = (counts[T.t] || 0) + 1;
    }
  }
  const V = _V ?? createVehicleSet({ models, group, counts, name: 'openVeh', maxLow: 500, maxFar: 2500 });
  if (!V) return null;

  let density = scale, tAcc = 0, hidden = scale <= 0;
  const reinit = () => {
    const k = Math.min(1, density / MAX_SCALE);
    for (const ln of lanes) {
      ln.cars = ln.all.filter(c => c.r < k);
      const n = ln.cars.length, step = ln.L / Math.max(n, 1), off0 = rnd() * step;
      ln.cars.forEach((c, i) => { c.s = (off0 + i * step + (rnd() - 0.5) * step * 0.3 + ln.L) % ln.L; c.v = c.vmax * 0.6; });
      ln.cars.sort((a, b) => a.s - b.s);
    }
  };
  reinit();

  const stepLane = (ln, dt, st) => {
    const cars = ln.cars, n = cars.length; if (!n) return;
    const lt = st[ln.axis === 'av' ? 0 : 1];
    for (let i = 0; i < n; i++) {
      const c = cars[i];
      let target = c.vmax;
      if (n > 1) { // car-following against the next car on the loop
        const l = cars[(i + 1) % n];
        const d = ((l.s - c.s) % ln.L + ln.L) % ln.L;
        const gap = d - (c.len + l.len) / 2 - GAP_MIN;
        target = Math.min(target, gap <= 0 ? 0 : Math.sqrt(2 * BRAKE * gap) * 0.9);
      }
      if (lt !== 0) { // the next stop line ahead
        const front = c.s + c.len / 2, k = Math.max(0, Math.ceil((front - 1 - (ln.junc0 - ln.half - STOP_BACK)) / ln.juncStep));
        if (k <= ln.juncN) {
          const sl = ln.junc0 + k * ln.juncStep - ln.half - STOP_BACK, dist = sl - front;
          if (dist > -1 && dist < 90 && (lt === 2 || dist > c.v * c.v / 6 + 3)) target = Math.min(target, Math.sqrt(2 * BRAKE * Math.max(dist, 0)) * 0.9);
        }
      }
      c.v = target > c.v ? Math.min(target, c.v + ACC * dt) : Math.max(target, c.v - BRAKE * 1.4 * dt);
      c.s += c.v * dt; if (c.s >= ln.L) c.s -= ln.L;
    }
    // keep the array ordered by s (only the wrap-around car can move out of order)
    if (cars[n - 1].s < cars[0].s) cars.sort((a, b) => a.s - b.s);
  };

  const push = (ln, c) => {
    const hx = ln.axis === 'st' ? ln.dir : 0, hz = ln.axis === 'av' ? ln.dir : 0;
    let x, z;
    if (ln.axis === 'av') { x = ln.fixed + ln.off; z = ln.dir > 0 ? zS + c.s : zE - c.s; }
    else { z = ln.fixed + ln.off; x = ln.dir > 0 ? xS + c.s : xE - c.s; }
    V.push(c.t, x, 0, z, Math.atan2(-hz, hx), 0, c.col, c.seed);
  };

  return {
    cars: () => lanes.reduce((a, l) => a + l.cars.length, 0),
    setDensity(d) { const nd = Math.max(0, d); if (nd === density) return; density = nd; hidden = nd <= 0; if (hidden) V.hide(); else reinit(); },
    update(dt, camera, farCut = 900) {
      if (hidden || !camera) return;
      const d = Math.min(dt, 0.1); tAcc += d;
      const st = [lightOf(tAcc, true), lightOf(tAcc, false)];
      V.begin(camera, farCut);
      for (const ln of lanes) { stepLane(ln, d, st); for (const c of ln.cars) push(ln, c); }
      V.end();
    },
  };
}
