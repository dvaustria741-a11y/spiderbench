// Generates src/world/harborlayout.js: the layout data of the "Harbor District" map (an original design, same data
// format as openlayout.js so citylite.js / openmap.js can build it unchanged).
//   node tools/gen-harbor-layout.mjs            (writes src/world/harborlayout.js)
//   node tools/gen-harbor-layout.mjs --png out.ppm   (also dumps a colour preview of the raster)
//
// Everything is axis-aligned rectangles painted in order (later wins). The painted rectangles are cut into an exact
// compressed grid, so the ground meshes, kerb lines and sea-wall lines are exact; the 2.5 m class raster used for queries
// is sampled from the same grid.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CELL = 2.5, NX = 700, NZ = 448, X0 = -875, Z0 = -560, SCALE = 1.25;
const CLS = { OUT: 0, AV: 1, ST: 2, INT: 3, WALK: 4, PARK: 5, LOT: 6, PLAZA: 7 };
const AVENUES = [-600, -400, -200, 0, 200, 400, 600];      // 200 m apart (G.AV_SP)
const STREETS = [-340, -170, 0, 170, 340];                  // 170 m apart (G.ST_SP)
const AVH = 10, STH = 6;                                    // half widths: G.AV_ROAD 20, G.ST_ROAD 12
const RX0 = X0, RX1 = X0 + NX * CELL, RZ0 = Z0, RZ1 = Z0 + NZ * CELL;
const LAND = { x0: -850, x1: 850, z0: -470, z1: 470 };

// deterministic rng (mulberry32), same as the game
const mulberry32 = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

const rects = [];
const paint = (x0, z0, x1, z1, c) => rects.push({ x0, z0, x1, z1, c });
const PARKS = [], LOTS = [], BLOCKS = [];

// ---------------------------------------------------------------- 1. land and water
paint(LAND.x0, LAND.z0, LAND.x1, LAND.z1, CLS.WALK);
paint(-260, 390, 260, LAND.z1 + 10, CLS.OUT);                // south harbour basin (open to the sea)
for (const px of [-175, 0, 175]) paint(px - 15, 390, px + 15, 455, CLS.WALK); // three piers into the basin
paint(660, 150, 820, 300, CLS.OUT);                          // east lagoon
// lagoon promenade ring is just the walk base around it

// ---------------------------------------------------------------- 2. city blocks (6 x 4 between the avenues and streets)
const kindOf = (i, j) => (i === 3 && j === 0) || (i === 1 && j === 2) ? 'park' : (i === 3 && j === 1) ? 'plaza' : 'build';
const subdivide = (x0, z0, x1, z1, nx, nz, gap, rnd) => {
  const w = (x1 - x0 - gap * (nx - 1)) / nx, d = (z1 - z0 - gap * (nz - 1)) / nz, out = [];
  for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
    if (rnd() < 0.06) continue; // the odd empty plot
    out.push([x0 + a * (w + gap), z0 + b * (d + gap), x0 + a * (w + gap) + w, z0 + b * (d + gap) + d]);
  }
  return out;
};
for (let i = 0; i < AVENUES.length - 1; i++) for (let j = 0; j < STREETS.length - 1; j++) {
  const bx0 = AVENUES[i] + AVH + 5, bx1 = AVENUES[i + 1] - AVH - 5, bz0 = STREETS[j] + STH + 4, bz1 = STREETS[j + 1] - STH - 4;
  const k = kindOf(i, j), rnd = mulberry32(0xA11 + i * 97 + j * 31);
  if (k === 'park') { paint(bx0, bz0, bx1, bz1, CLS.PARK); PARKS.push([bx0, bz0, bx1, bz1]); BLOCKS.push({ x0: bx0, x1: bx1, z0: bz0, z1: bz1, rect: true, kind: 'park' }); continue; }
  if (k === 'plaza') { paint(bx0, bz0, bx1, bz1, CLS.PLAZA); BLOCKS.push({ x0: bx0, x1: bx1, z0: bz0, z1: bz1, rect: true, kind: 'plaza' }); continue; }
  paint(bx0, bz0, bx1, bz1, CLS.LOT); BLOCKS.push({ x0: bx0, x1: bx1, z0: bz0, z1: bz1, rect: true, kind: 'build' });
  const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2, downtown = Math.abs(cx) < 400 && Math.abs(cz) < 300;
  const schemes = downtown ? [[2, 2], [3, 2], [2, 3], [2, 2]] : [[3, 3], [4, 2], [3, 2], [3, 3], [2, 3]];
  const [nx, nz] = schemes[Math.floor(rnd() * schemes.length)];
  LOTS.push(...subdivide(bx0, bz0, bx1, bz1, nx, nz, 3, rnd));
}

// ---------------------------------------------------------------- 3. outskirts
// west: a big greenbelt, split by the west exit road
for (const [z0, z1] of [[-330, -14], [14, 330]]) { paint(-830, z0, -650, z1, CLS.PARK); PARKS.push([-830, z0, -650, z1]); }
BLOCKS.push({ x0: -830, x1: -650, z0: -330, z1: -14, rect: true, kind: 'park' }, { x0: -830, x1: -650, z0: 14, z1: 330, rect: true, kind: 'park' });
// north: waterfront park between two low-rise districts
paint(-560, -440, 560, -372, CLS.PARK); PARKS.push([-560, -440, 560, -372]);
BLOCKS.push({ x0: -560, x1: 560, z0: -440, z1: -372, rect: true, kind: 'park' });
const lotRow = (x0, x1, z0, z1, n, seed) => { // a row of n lots along x
  const rnd = mulberry32(seed); paint(x0, z0, x1, z1, CLS.LOT); BLOCKS.push({ x0, x1, z0, z1, rect: true, kind: 'build' });
  LOTS.push(...subdivide(x0, z0, x1, z1, n, 1, 3, rnd));
};
lotRow(-840, -580, -440, -372, 3, 0x51); lotRow(580, 840, -440, -372, 3, 0x52);          // north
lotRow(-840, -290, 372, 452, 6, 0x53); lotRow(290, 840, 372, 452, 6, 0x54);              // south (either side of the basin)
// east: warehouse blocks
for (const [z0, z1, n, s] of [[-330, -14, 3, 0x61], [14, 110, 1, 0x62]]) {
  const rnd = mulberry32(s); paint(640, z0, 840, z1, CLS.LOT); BLOCKS.push({ x0: 640, x1: 840, z0, z1, rect: true, kind: 'build' });
  LOTS.push(...subdivide(640, z0, 840, z1, 2, n, 3, rnd));
}
// walk strips along the exit road through the outskirts (4 m, like the streets), then the roads themselves
paint(RX0, -STH - 4, -610, STH + 4, CLS.WALK); paint(610, -STH - 4, RX1, STH + 4, CLS.WALK);

// ---------------------------------------------------------------- 4. roads
const zN = STREETS[0] - STH, zS = STREETS[STREETS.length - 1] + STH, xW = AVENUES[0] - AVH, xE = AVENUES[AVENUES.length - 1] + AVH;
for (const ax of AVENUES) paint(ax - AVH, zN, ax + AVH, zS, CLS.AV);
for (const sz of STREETS) paint(xW, sz - STH, xE, sz + STH, CLS.ST);
for (const ax of AVENUES) for (const sz of STREETS) paint(ax - AVH, sz - STH, ax + AVH, sz + STH, CLS.INT);
paint(RX0, -STH, xW, STH, CLS.ST); paint(xE, -STH, RX1, STH, CLS.ST);                      // the two exit roads run out to the raster edge
const EXITS = { W: { z: 0, half: STH }, E: { z: 0, half: STH } };
const SPAWN = [100, 0];
const PLAZA = [AVENUES[3] + AVH + 5, STREETS[1] + STH + 4, AVENUES[4] - AVH - 5, STREETS[2] - STH - 4];
const BOUNDS = { x0: LAND.x0, x1: LAND.x1, z0: LAND.z0, z1: LAND.z1 };
BLOCKS.unshift({ x0: BOUNDS.x0, x1: BOUNDS.x1, z0: BOUNDS.z0, z1: BOUNDS.z1, rect: false, kind: 'build' }); // catch-all first, like the open map
// PARKS[1] is the park of the 'park' district (G.PARK): the centre-north block
{ const k = PARKS.findIndex(p => p[0] === AVENUES[3] + AVH + 5 && p[1] === STREETS[0] + STH + 4); if (k > 0) { const [p] = PARKS.splice(k, 1); PARKS.splice(1, 0, p); } }

// ---------------------------------------------------------------- compressed grid
const uniq = (a) => [...new Set(a)].sort((p, q) => p - q);
const clampX = (v) => Math.max(RX0, Math.min(RX1, v)), clampZ = (v) => Math.max(RZ0, Math.min(RZ1, v));
const gx = uniq([RX0, RX1, ...rects.flatMap(r => [clampX(r.x0), clampX(r.x1)])]), gz = uniq([RZ0, RZ1, ...rects.flatMap(r => [clampZ(r.z0), clampZ(r.z1)])]);
const CX = gx.length - 1, CZ = gz.length - 1;
const grid = new Uint8Array(CX * CZ);
for (const r of rects) {
  const ia = gx.indexOf(clampX(r.x0)), ib = gx.indexOf(clampX(r.x1)), ja = gz.indexOf(clampZ(r.z0)), jb = gz.indexOf(clampZ(r.z1));
  for (let j = ja; j < jb; j++) for (let i = ia; i < ib; i++) grid[j * CX + i] = r.c;
}
const at = (i, j) => (i < 0 || j < 0 || i >= CX || j >= CZ ? -1 : grid[j * CX + i]);

// ---------------------------------------------------------------- raster (2.5 m cells sampled at cell centres) + RLE
const colOf = (x) => { let lo = 0, hi = CX - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (gx[m] <= x) lo = m; else hi = m - 1; } return lo; };
const rowOf = (z) => { let lo = 0, hi = CZ - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (gz[m] <= z) lo = m; else hi = m - 1; } return lo; };
const ci = Array.from({ length: NX }, (_, i) => colOf(X0 + (i + 0.5) * CELL)), cj = Array.from({ length: NZ }, (_, j) => rowOf(Z0 + (j + 0.5) * CELL));
const R = new Uint8Array(NX * NZ);
for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) R[j * NX + i] = grid[cj[j] * CX + ci[i]];
const rle = [];
for (let k = 0; k < R.length;) { let n = 1; while (k + n < R.length && R[k + n] === R[k]) n++; rle.push(R[k]); let L = n; do { let b = L & 0x7f; L >>>= 7; if (L) b |= 0x80; rle.push(b); } while (L); k += n; }
const RLE = Buffer.from(rle).toString('base64');

// ---------------------------------------------------------------- ground meshes: greedy-merged rectangles per class (Int16 x 1/16 m, Uint16 indices)
const q16 = (v) => Math.round(v * 16);
function meshFor(pred) {
  const done = new Uint8Array(CX * CZ), V = [], I = [];
  for (let j = 0; j < CZ; j++) for (let i = 0; i < CX; i++) {
    if (done[j * CX + i] || !pred(grid[j * CX + i])) continue;
    const c = grid[j * CX + i]; let i1 = i; while (i1 + 1 < CX && !done[j * CX + i1 + 1] && grid[j * CX + i1 + 1] === c) i1++;
    let j1 = j; grow: while (j1 + 1 < CZ) { for (let a = i; a <= i1; a++) if (done[(j1 + 1) * CX + a] || grid[(j1 + 1) * CX + a] !== c) break grow; j1++; }
    for (let b = j; b <= j1; b++) for (let a = i; a <= i1; a++) done[b * CX + a] = 1;
    const o = V.length / 2; V.push(q16(gx[i]), q16(gz[j]), q16(gx[i1 + 1]), q16(gz[j]), q16(gx[i1 + 1]), q16(gz[j1 + 1]), q16(gx[i]), q16(gz[j1 + 1]));
    I.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  if (V.length / 2 > 65535) throw new Error('mesh too large for Uint16 indices');
  if (!V.length) return ['', ''];
  return [Buffer.from(new Int16Array(V).buffer).toString('base64'), Buffer.from(new Uint16Array(I).buffer).toString('base64')];
}
const MESH = {
  asph: meshFor(c => c === CLS.AV || c === CLS.ST || c === CLS.INT),
  walk: meshFor(c => c === CLS.WALK), lot: meshFor(c => c === CLS.LOT), plaza: meshFor(c => c === CLS.PLAZA),
  park: ['', ''], // the park ground comes from the raster-aligned hill mesh in citylite.js
};

// ---------------------------------------------------------------- boundary polylines (outside on the right of travel: n = (dz, -dx) / L)
const isRoadC = (c) => c === CLS.AV || c === CLS.ST || c === CLS.INT;
const isLandC = (c) => c > 0;
const isBlockC = (c) => c === CLS.WALK || c === CLS.PARK || c === CLS.LOT || c === CLS.PLAZA;
function boundary(inside, outside, offset) {
  const segs = [];
  const add = (ax, az, bx, bz) => segs.push({ ax, az, bx, bz });
  for (let j = 0; j < CZ; j++) for (let i = 0; i < CX; i++) {
    const c = grid[j * CX + i]; if (!inside(c)) continue;
    // east neighbour is outside: edge at x = gx[i+1], travel +z  (n = (dz, -dx) = (1, 0))
    if (outside(at(i + 1, j))) add(gx[i + 1], gz[j], gx[i + 1], gz[j + 1]);
    // west neighbour: n = (-1, 0) -> travel -z
    if (outside(at(i - 1, j))) add(gx[i], gz[j + 1], gx[i], gz[j]);
    // south neighbour (+z): n = (0, 1) -> dx = -1 -> travel -x
    if (outside(at(i, j + 1))) add(gx[i + 1], gz[j + 1], gx[i], gz[j + 1]);
    // north neighbour (-z): n = (0, -1) -> dx = +1 -> travel +x
    if (outside(at(i, j - 1))) add(gx[i], gz[j], gx[i + 1], gz[j]);
  }
  const key = (x, z) => x + ',' + z, out = new Map(), ends = new Set();
  for (const s of segs) { const k = key(s.ax, s.az); if (!out.has(k)) out.set(k, []); out.get(k).push(s); ends.add(key(s.bx, s.bz)); }
  const used = new Set(), chains = [];
  const walk = (s0, closedStart) => {
    const pts = [[s0.ax, s0.az]]; let s = s0;
    for (;;) {
      used.add(s); pts.push([s.bx, s.bz]);
      const nexts = (out.get(key(s.bx, s.bz)) || []).filter(n => !used.has(n));
      if (!nexts.length) break;
      if (nexts.length > 1) { // ambiguous vertex: take the sharpest turn that keeps the inside on the left
        const d = [s.bx - s.ax, s.bz - s.az]; nexts.sort((p, q) => { const f = (n) => (d[0] * (n.bz - n.az) - d[1] * (n.bx - n.ax)); return f(q) - f(p); });
      }
      s = nexts[0];
      if (closedStart && s === s0) break;
    }
    return pts;
  };
  for (const s of segs) if (!used.has(s) && !ends.has(key(s.ax, s.az))) chains.push({ pts: walk(s, false), closed: false }); // open chains first (they end at the raster edge)
  for (const s of segs) if (!used.has(s)) { const pts = walk(s, true); chains.push({ pts, closed: pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] }); }
  // drop collinear vertices, then offset (miter) by `offset` metres to the right of travel
  return chains.map(({ pts, closed }) => {
    let P = pts.slice(); if (closed) P.pop();
    const keep = (p, k, a) => { const q = a[(k + a.length - 1) % a.length], n = a[(k + 1) % a.length]; return (p[0] - q[0]) * (n[1] - p[1]) - (p[1] - q[1]) * (n[0] - p[0]) !== 0; };
    P = P.filter((p, k, a) => (!closed && (k === 0 || k === a.length - 1)) || keep(p, k, a));
    const N = P.length, seg = (k) => { const a = P[k], b = P[(k + 1) % N], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; return [dz / L, -dx / L]; };
    const res = P.map((p, k) => {
      if (!offset) return [p[0], p[1]];
      const prev = closed || k > 0 ? seg((k + N - 1) % N) : null, next = closed || k < N - 1 ? seg(k) : null, n1 = prev || next, n2 = next || prev;
      const dot = n1[0] * n2[0] + n1[1] * n2[1], f = offset / (1 + dot);
      return [p[0] + (n1[0] + n2[0]) * f, p[1] + (n1[1] + n2[1]) * f];
    });
    if (closed) res.push(res[0].slice());
    return res;
  });
}
const pack = (chains) => {
  const flat = [], lens = [];
  for (const c of chains) { lens.push(c.length); for (const p of c) flat.push(q16(p[0]), q16(p[1])); }
  return [flat.length ? Buffer.from(new Int16Array(flat).buffer).toString('base64') : '', lens];
};
const LINES = { sea: pack(boundary(isLandC, c => c === CLS.OUT, 0)), kerb: pack(boundary(isBlockC, isRoadC, 0.5)) };

// ---------------------------------------------------------------- checks
const stat = {}; for (const c of R) stat[c] = (stat[c] || 0) + 1;
const here = path.dirname(fileURLToPath(import.meta.url));
console.log('raster classes', JSON.stringify(stat), '| lots', LOTS.length, '| parks', PARKS.length, '| sea loops', LINES.sea[1].length, '| kerb loops', LINES.kerb[1].length, '| RLE', RLE.length, 'B');
for (const [k, v] of Object.entries(MESH)) console.log('mesh', k, v[0].length, v[1].length);
if (LINES.sea[1].some(n => n < 3)) console.warn('warning: degenerate sea polyline');

const r1 = (a) => a.map(v => Math.round(v * 100) / 100);
const out = `// Harbor District layout - generated by tools/gen-harbor-layout.mjs (an original design; same format as openlayout.js). Pure data.
// RLE: raster of ground classes for queries, 1 cell = CELL m (0 outside, 1 avenue, 2 street, 3 junction, 4 sidewalk, 5 park, 6 lot, 7 plaza).
// MESH: triangulated ground layers (Int16 x,z * 1/16 m ; Uint16 indices). LINES: sea wall / kerb polylines, outside on the right of travel.
export const CELL = ${CELL}, NX = ${NX}, NZ = ${NZ}, X0 = ${X0}, Z0 = ${Z0}, SCALE = ${SCALE};
export const RLE = '${RLE}';
export const MESH = ${JSON.stringify(MESH)};
export const LINES = ${JSON.stringify(LINES)};
export const MARKS = [];
export const BOUNDS = ${JSON.stringify(BOUNDS)};
export const PARKS = ${JSON.stringify(PARKS.map(r1))};
export const PLAZA = ${JSON.stringify(r1(PLAZA))};
export const BLOCKS = ${JSON.stringify(BLOCKS.map(b => ({ ...b, x0: r1([b.x0])[0], x1: r1([b.x1])[0], z0: r1([b.z0])[0], z1: r1([b.z1])[0] })))};
export const LOTS = ${JSON.stringify(LOTS.map(r1))};
export const AVENUES = ${JSON.stringify(AVENUES)}, STREETS = ${JSON.stringify(STREETS)};
export const EXITS = ${JSON.stringify(EXITS)};
export const SPAWN = ${JSON.stringify(SPAWN)};
export const LOT_INSET = [3, 2]; // buildings stand 3-5 m inside their lot (tighter street frontage than Open City's 6-10 m)
`;
fs.writeFileSync(path.join(here, '..', 'src', 'world', 'harborlayout.js'), out);
console.log('wrote src/world/harborlayout.js', (out.length / 1024).toFixed(1), 'KB');

const pi = process.argv.indexOf('--png');
if (pi > 0) { // PPM preview of the raster (convert with PIL)
  const PAL = [[40, 90, 140], [90, 90, 96], [70, 70, 76], [110, 110, 116], [186, 178, 160], [92, 140, 70], [150, 140, 128], [214, 196, 150]];
  const buf = Buffer.alloc(NX * NZ * 3); for (let k = 0; k < R.length; k++) { const c = PAL[R[k]]; buf[3 * k] = c[0]; buf[3 * k + 1] = c[1]; buf[3 * k + 2] = c[2]; }
  fs.writeFileSync(process.argv[pi + 1], Buffer.concat([Buffer.from(`P6 ${NX} ${NZ} 255\n`), buf]));
}
