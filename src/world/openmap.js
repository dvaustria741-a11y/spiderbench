// Open map layout (pure data, no three.js). Replaces the Manhattan layout for the lightweight world (citylite.js).
// Axes: +x = east, -z = north, y up, meters. Avenues run N-S (along z), streets run E-W (along x).
// A wide grid of large blocks. Each block holds only a few buildings with generous gaps, some blocks are open plazas,
// parks or low lots, so the whole map is big but cheap to draw.
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

export const NCOL = 14, NROW = 10;
export const G = {
  AV_ROAD: 20, AV_WALK: 5, AV_SP: 200,
  ST_SP: 170, ST_ROAD: 12, ST_WALK: 4,
  CURB_H: 0.15, WATER_Y: -1.6,
  X_MIN: -NCOL * 100 - 10, X_MAX: NCOL * 100 + 10,
  Z_MIN: -NROW * 85 - 6, Z_MAX: NROW * 85 + 6,
  LAND_MARGIN: 600,
  PARK: null, // set below
};
G.AV_HALF = G.AV_ROAD / 2; G.ST_HALF = G.ST_ROAD / 2; G.AV_LANE = 3.6;

// avenues: x = i * 200, i = -7..7 ; streets: z = k * 170, k = -5..5
export const avenues = []; for (let i = -NCOL / 2; i <= NCOL / 2; i++) avenues.push(i * G.AV_SP);
export const streets = []; for (let k = -NROW / 2; k <= NROW / 2; k++) streets.push(k * G.ST_SP);
export const AV_NAMES = avenues.map((_, i) => 'AVENUE ' + String.fromCharCode(65 + i));
export const WIDE_ROADS = [], NARROW_STREETS = [], WIDE_ST_HALF = 9, NARROW_ST_HALF = 3.75;
export const VREG = { x0: 1e9, x1: 1e9, z0: 1e9, z1: 1e9 }, FREG = { z0: 1e9 }; // legacy puddle regions: none
export const stHalfAt = () => G.ST_HALF;

// ------------------------------------------------------------------ blocks
// block (c, r): c = 0..NCOL-1 between avenues c and c+1, r = 0..NROW-1 between streets r and r+1.
// x0..x1 / z0..z1 = the block between the road edges (sidewalk ring included), px0.. = the inner property rect.
export const blocks = [];
const blockGrid = [];
const KIND_BUILD = 'build', KIND_PLAZA = 'plaza', KIND_PARK = 'park', KIND_LOT = 'lot';
for (let r = 0; r < NROW; r++) for (let c = 0; c < NCOL; c++) {
  const ax0 = avenues[c], ax1 = avenues[c + 1], sz0 = streets[r], sz1 = streets[r + 1];
  const x0 = ax0 + G.AV_HALF, x1 = ax1 - G.AV_HALF, z0 = sz0 + G.ST_HALF, z1 = sz1 - G.ST_HALF;
  const px0 = ax0 + G.AV_HALF + G.AV_WALK, px1 = ax1 - G.AV_HALF - G.AV_WALK, pz0 = sz0 + G.ST_HALF + G.ST_WALK, pz1 = sz1 - G.ST_HALF - G.ST_WALK;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, h = hash2(c * 31 + 7, r * 17 + 3);
  const downtown = Math.abs(cx) < 520 && Math.abs(cz) < 360;
  let kind = KIND_BUILD;
  if (h < 0.11) kind = KIND_PLAZA; else if (h < 0.2) kind = KIND_PARK; else if (h < 0.26 && !downtown) kind = KIND_LOT;
  const B = { c, r, x0, x1, z0, z1, px0, px1, pz0, pz1, cx, cz, kind, downtown, h };
  blocks.push(B); blockGrid[r * NCOL + c] = B;
}
// the central park: 2 x 2 blocks of grass in the north-centre, with a plaza block beside it
{
  const set = (c, r, kind) => { const B = blockGrid[r * NCOL + c]; if (B) B.kind = kind; };
  for (const [c, r] of [[6, 2], [7, 2], [6, 3], [7, 3]]) set(c, r, KIND_PARK);
  set(5, 3, KIND_PLAZA); set(8, 5, KIND_PLAZA); set(3, 6, KIND_PLAZA);
  // keep the downtown core solid with towers
  for (const [c, r] of [[6, 5], [7, 5], [6, 6], [7, 6], [5, 5], [5, 6], [8, 6]]) set(c, r, KIND_BUILD);
}
{ const a = blockGrid[2 * NCOL + 6], b = blockGrid[3 * NCOL + 7]; G.PARK = { x0: a.px0, x1: b.px1, z0: a.pz0, z1: b.pz1 }; }
export const parkBlocks = () => blocks.filter(b => b.kind === KIND_PARK);

// ------------------------------------------------------------------ queries
const nearest = (arr, v, sp, o) => arr[Math.max(0, Math.min(arr.length - 1, Math.round((v - o) / sp)))];
const AV0 = avenues[0], ST0 = streets[0];
export function onLand(x, z) { return x > G.X_MIN - G.LAND_MARGIN && x < G.X_MAX + G.LAND_MARGIN && z > G.Z_MIN - G.LAND_MARGIN && z < G.Z_MAX + G.LAND_MARGIN; }
export function inPark(x, z, pad = 0) {
  const c = Math.floor((x - AV0) / G.AV_SP), r = Math.floor((z - ST0) / G.ST_SP);
  if (c < 0 || c >= NCOL || r < 0 || r >= NROW) return false;
  const B = blockGrid[r * NCOL + c];
  return B.kind === KIND_PARK && x > B.px0 - pad && x < B.px1 + pad && z > B.pz0 - pad && z < B.pz1 + pad;
}
export function blockAt(x, z) {
  const c = Math.floor((x - AV0) / G.AV_SP), r = Math.floor((z - ST0) / G.ST_SP);
  return c < 0 || c >= NCOL || r < 0 || r >= NROW ? null : blockGrid[r * NCOL + c];
}
export function streetsAt(x, z) {
  const inGrid = x > avenues[0] - G.AV_HALF - 1 && x < avenues[NCOL] + G.AV_HALF + 1 && z > streets[0] - G.ST_HALF - 1 && z < streets[NROW] + G.ST_HALF + 1;
  if (!inGrid) {
    // the two edge roads continue out past the map (west / east of the middle row)
    const zc = streets[NROW / 2];
    if (Math.abs(z - zc) < G.ST_HALF && (x < avenues[0] || x > avenues[NCOL]) && Math.abs(x) < 2600) return { type: 'street', streetZ: zc };
    return { type: 'sidewalk', fill: true };
  }
  const ax = nearest(avenues, x, G.AV_SP, AV0), sz = nearest(streets, z, G.ST_SP, ST0);
  const dx = Math.abs(x - ax), dz = Math.abs(z - sz);
  const onAv = dx < G.AV_HALF, onSt = dz < G.ST_HALF;
  if (onAv && onSt) return { type: 'intersection', avenueX: ax, streetZ: sz };
  if (onAv) return { type: 'avenue', avenueX: ax, lane: Math.floor((x - ax) / G.AV_LANE) };
  if (onSt) return { type: 'street', streetZ: sz };
  if (dx < G.AV_HALF + G.AV_WALK || dz < G.ST_HALF + G.ST_WALK) return { type: 'sidewalk' };
  if (inPark(x, z)) return { type: 'park' };
  return { type: 'block', block: blockAt(x, z) };
}
export function onRoad(x, z) { const t = streetsAt(x, z).type; return t === 'avenue' || t === 'street' || t === 'intersection'; }

// ------------------------------------------------------------------ lots / buildings (deterministic)
// Each building block is cut into a jittered grid of lots; every lot holds ONE building pulled in from its edges so
// the gaps between buildings stay wide (alleys + yards). Some lots stay empty (small plazas).
export function generateLots() {
  const out = []; // {x0,z0,x1,z1,H,block,tier,glass,seed}
  for (const B of blocks) {
    const rnd = mulberry32(0xB10C + B.c * 131 + B.r * 977);
    if (B.kind === KIND_PLAZA || B.kind === KIND_PARK) continue;
    const W = B.px1 - B.px0, D = B.pz1 - B.pz0;
    const nx = B.kind === KIND_LOT ? 2 : (B.downtown ? 2 + (rnd() < 0.5 ? 1 : 0) : 2), nz = B.kind === KIND_LOT ? 1 + (rnd() < 0.5 ? 1 : 0) : 2;
    const cw = W / nx, cd = D / nz;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      if (B.kind === KIND_BUILD && rnd() < 0.14) continue; // empty lot: pocket plaza
      const gapX = 16 + rnd() * 10, gapZ = 16 + rnd() * 10; // gap kept on each side of the lot
      const lx0 = B.px0 + i * cw + gapX / 2 + rnd() * 6, lx1 = B.px0 + (i + 1) * cw - gapX / 2 - rnd() * 6;
      const lz0 = B.pz0 + j * cd + gapZ / 2 + rnd() * 6, lz1 = B.pz0 + (j + 1) * cd - gapZ / 2 - rnd() * 6;
      if (lx1 - lx0 < 22 || lz1 - lz0 < 22) continue;
      const centre = Math.hypot(B.cx, B.cz * 1.4);
      let H;
      const t = rnd();
      if (B.kind === KIND_LOT) H = 7 + rnd() * 9;
      else if (B.downtown) H = t < 0.2 ? 130 + rnd() * 70 : t < 0.65 ? 70 + rnd() * 55 : 38 + rnd() * 28;
      else H = t < 0.08 ? 80 + rnd() * 40 : t < 0.5 ? 28 + rnd() * 34 : 12 + rnd() * 18;
      out.push({ x0: lx0, z0: lz0, x1: lx1, z1: lz1, H, block: B, centre, glass: rnd() < (B.downtown ? 0.5 : 0.18), seed: (rnd() * 1e9) | 0, tone: rnd() });
    }
  }
  return out;
}
export const KINDS = { KIND_BUILD, KIND_PLAZA, KIND_PARK, KIND_LOT };
