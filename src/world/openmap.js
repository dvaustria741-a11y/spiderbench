// Open map layout (pure data, no three.js). Replaces the Manhattan layout for the lightweight world (citylite.js).
// Axes: +x = east, -z = north, y up, meters. The layout is a raster of ground classes (openlayout.js, generated from the
// layout image): avenues / streets / junctions, sidewalks, two parks, the centre plaza, lots and the outside.
import { CELL, NX, NZ, X0, Z0, RLE, BOUNDS, PARKS, PLAZA, BLOCKS, LOTS, AVENUES, STREETS, EXITS, SPAWN } from './openlayout.js';
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ------------------------------------------------------------------ ground raster
// classes: 0 outside, 1 avenue, 2 street, 3 junction, 4 sidewalk, 5 park, 6 lot, 7 plaza
export const CLS = { OUT: 0, AV: 1, ST: 2, INT: 3, WALK: 4, PARK: 5, LOT: 6, PLAZA: 7 };
export const GRID = (() => {
  const bin = typeof atob === 'function' ? Uint8Array.from(atob(RLE), c => c.charCodeAt(0)) : new Uint8Array(Buffer.from(RLE, 'base64'));
  const g = new Uint8Array(NX * NZ); let p = 0, o = 0;
  while (p < bin.length) {
    const v = bin[p++]; let L = 0, sh = 0, b;
    do { b = bin[p++]; L |= (b & 0x7f) << sh; sh += 7; } while (b & 0x80);
    g.fill(v, o, o + L); o += L;
  }
  return g;
})();
export const RASTER = { CELL, NX, NZ, X0, Z0 };
export const cellAt = (x, z) => {
  const i = Math.floor((x - X0) / CELL), j = Math.floor((z - Z0) / CELL);
  return i < 0 || j < 0 || i >= NX || j >= NZ ? -1 : GRID[j * NX + i];
};
export { PARKS, PLAZA, LOTS, EXITS, SPAWN };

export const NCOL = AVENUES.length - 1, NROW = STREETS.length - 1;
export const G = {
  AV_ROAD: 20, AV_WALK: 5, AV_SP: 200,
  ST_SP: 170, ST_ROAD: 12, ST_WALK: 4,
  CURB_H: 0.15, WATER_Y: -3.4,
  X_MIN: BOUNDS.x0, X_MAX: BOUNDS.x1,
  Z_MIN: BOUNDS.z0, Z_MAX: BOUNDS.z1,
  LAND_MARGIN: 600,
  PARK: null, // set below
};
G.AV_HALF = G.AV_ROAD / 2; G.ST_HALF = G.ST_ROAD / 2; G.AV_LANE = 3.6;
G.PARK = { x0: PARKS[1][0], z0: PARKS[1][1], x1: PARKS[1][2], z1: PARKS[1][3] };

// long main roads (centre lines), kept for the systems that snap to "the grid" (GPS route, crimes, junction names)
export const avenues = [...AVENUES];
export const streets = [...STREETS];
export const AV_NAMES = avenues.map((_, i) => 'AVENUE ' + String.fromCharCode(65 + i));
export const WIDE_ROADS = [], NARROW_STREETS = [], WIDE_ST_HALF = 9, NARROW_ST_HALF = 3.75;
export const VREG = { x0: 1e9, x1: 1e9, z0: 1e9, z1: 1e9 }, FREG = { z0: 1e9 }; // legacy puddle regions: none
export const stHalfAt = () => G.ST_HALF;

// ------------------------------------------------------------------ blocks
const KIND_BUILD = 'build', KIND_PLAZA = 'plaza', KIND_PARK = 'park', KIND_LOT = 'lot';
export const blocks = BLOCKS.map((b, n) => {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, h = hash2(n * 31 + 7, n * 17 + 3);
  return { c: n, r: 0, x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, px0: b.x0 + 5, px1: b.x1 - 5, pz0: b.z0 + 5, pz1: b.z1 - 5, cx, cz, kind: b.kind, rect: b.rect, downtown: Math.abs(cx) < 400 && Math.abs(cz) < 300, h };
});
export const parkBlocks = () => blocks.filter(b => b.kind === KIND_PARK);

// ------------------------------------------------------------------ queries
export function onLand(x, z) { return x > G.X_MIN - G.LAND_MARGIN && x < G.X_MAX + G.LAND_MARGIN && z > G.Z_MIN - G.LAND_MARGIN && z < G.Z_MAX + G.LAND_MARGIN; }
export function inPark(x, z, pad = 0) {
  for (const p of PARKS) if (x > p[0] - pad && x < p[2] + pad && z > p[1] - pad && z < p[3] + pad) return true;
  return false;
}
export function blockAt(x, z) {
  for (const b of blocks) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
  return null;
}
const nearestOf = (arr, v) => arr.reduce((b, a) => (Math.abs(a - v) < Math.abs(b - v) ? a : b), arr[0]);
export function streetsAt(x, z) {
  const c = cellAt(x, z);
  if (c < 0) { // beyond the raster: the two exit roads run on to the horizon, everything else is open ground
    const e = x < X0 ? EXITS.W : EXITS.E;
    if (Math.abs(z - e.z) < e.half && Math.abs(x) < 2600) return { type: 'street', streetZ: e.z };
    return { type: 'sidewalk', fill: true };
  }
  switch (c) {
    case CLS.AV: { const ax = nearestOf(avenues, x); return { type: 'avenue', avenueX: ax, lane: Math.floor((x - ax) / G.AV_LANE) }; }
    case CLS.ST: return { type: 'street', streetZ: nearestOf(streets, z) };
    case CLS.INT: return { type: 'intersection', avenueX: nearestOf(avenues, x), streetZ: nearestOf(streets, z) };
    case CLS.WALK: return { type: 'sidewalk' };
    case CLS.PARK: return { type: 'park' };
    case CLS.LOT: case CLS.PLAZA: return { type: 'block', block: blockAt(x, z) };
    default: return { type: 'sidewalk', fill: true };
  }
}
export function onRoad(x, z) { const t = streetsAt(x, z).type; return t === 'avenue' || t === 'street' || t === 'intersection'; }

// ------------------------------------------------------------------ lots / buildings (deterministic)
// One building per rectangular sub-lot (the white outlines of the layout image), pulled in from the edges.
export function generateLots() {
  const out = [];
  LOTS.forEach((L, n) => {
    const rnd = mulberry32(0xB10C + n * 131), B = blockAt((L[0] + L[2]) / 2, (L[1] + L[3]) / 2) ?? { kind: KIND_BUILD, downtown: false };
    const m = 6 + rnd() * 4, lx0 = L[0] + m, lx1 = L[2] - m, lz0 = L[1] + m, lz1 = L[3] - m;
    if (lx1 - lx0 < 22 || lz1 - lz0 < 22) return;
    const downtown = Math.abs((L[0] + L[2]) / 2) < 400 && Math.abs((L[1] + L[3]) / 2) < 300, t = rnd();
    const H = downtown ? (t < 0.2 ? 130 + rnd() * 70 : t < 0.65 ? 70 + rnd() * 55 : 38 + rnd() * 28) : (t < 0.08 ? 80 + rnd() * 40 : t < 0.5 ? 28 + rnd() * 34 : 12 + rnd() * 18);
    out.push({ x0: lx0, z0: lz0, x1: lx1, z1: lz1, H, block: B, centre: Math.hypot((lx0 + lx1) / 2, (lz0 + lz1) / 1.4), glass: rnd() < (downtown ? 0.5 : 0.18), seed: (rnd() * 1e9) | 0, tone: rnd() });
  });
  return out;
}
export const KINDS = { KIND_BUILD, KIND_PLAZA, KIND_PARK, KIND_LOT };
