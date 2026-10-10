// Open City: a big, light world (few buildings, wide gaps, few trees, a handful of draw calls). Same contract as
// city.js: buildCity({scene, renderer}) -> Promise<world>. Layout data lives in openmap.js.
// Everything visible is merged into per-chunk meshes (400 m chunks) so culling is cheap; collision uses the same
// Solids / CollisionGrid / ZipPoints as the Manhattan map, so swinging, wall-running, zipping and combat behave the same.
import * as THREE from 'three';
import { createOpenTraffic } from './opentraffic.js';
import { loadOpenSkin, skinGround, skinRoof, skinTree } from './openskin.js';
import { loadVehicleModels } from './vehicles.js';
import { G, avenues, streets, blocks, generateLots, streetsAt, hash2, mulberry32, KINDS, inPark, GRID, RASTER, CLS, cellAt, PARKS, EXITS, SPAWN } from './openmap.js';
import { Solids, CollisionGrid, makeQueries, collisionDebugLines } from './collision.js';
import { ZipPoints, createGeoDebug } from './zippoints.js';
import { attachLife } from './npc/life.js';
import { nightK } from '../render/daynight.js';
import { readGfx } from '../render/gfxprefs.js';

const CHUNK = 200; // smaller chunks = Draw Distance cuts closer to the exact radius (400 let buildings up to ~400 m past it stay drawn)
const BAY = 3.2, FLOOR = 3.6;
const col = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// ------------------------------------------------------------------ geometry accumulator
class GB {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }
  // quad given CCW seen from the outside; uv per vertex
  quad(a, b, c, d, n, uv, color) {
    const V = [a, b, c, d];
    for (const k of [0, 1, 2, 0, 2, 3]) { this.p.push(V[k][0], V[k][1], V[k][2]); this.n.push(n[0], n[1], n[2]); this.u.push(uv[k][0], uv[k][1]); this.c.push(color[0], color[1], color[2]); }
  }
  // flat colour horizontal rect (uv pinned to a plain-wall texel when textured)
  horiz(x0, z0, x1, z1, y, color, up = true, uv = [0.01, 0.01]) {
    const U = [uv, uv, uv, uv];
    if (up) this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], U, color);
    else this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0], U, color);
  }
  // four walls of a box with window-cell UVs; colourLow tints the ground-floor band (y < yLow)
  walls(x0, y0, z0, x1, y1, z1, color, uOff, vOff, colorLow = null, yLow = 0) {
    const faces = [
      [[1, 0, 0], [x1, z1], [x1, z0], z1 - z0], [[-1, 0, 0], [x0, z0], [x0, z1], z1 - z0],
      [[0, 0, 1], [x0, z1], [x1, z1], x1 - x0], [[0, 0, -1], [x1, z0], [x0, z0], x1 - x0],
    ];
    for (const [n, A, B, len] of faces) {
      const bands = colorLow && yLow > y0 && yLow < y1 ? [[y0, yLow, colorLow], [yLow, y1, color]] : [[y0, y1, color]];
      const uu = len / BAY / 4, off = uOff + (n[0] + 2 * n[2]) * 0.37;
      for (const [ya, yb, cc] of bands) {
        const va = (ya - y0) / FLOOR / 4 + vOff, vb = (yb - y0) / FLOOR / 4 + vOff;
        this.quad([A[0], ya, A[1]], [B[0], ya, B[1]], [B[0], yb, B[1]], [A[0], yb, A[1]], n, [[off, va], [off + uu, va], [off + uu, vb], [off, vb]], cc);
      }
    }
  }
  box(x0, y0, z0, x1, y1, z1, color, top = null) {
    this.walls(x0, y0, z0, x1, y1, z1, color, 0.003, 0.003);
    this.horiz(x0, z0, x1, z1, y1, top || color);
  }
  get empty() { return this.p.length === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// ------------------------------------------------------------------ materials
function makeWindowTextures(glass) {
  if (typeof document === 'undefined') return { map: null, emissive: null };
  const N = 4, S = 128, cv = document.createElement('canvas'), ev = document.createElement('canvas');
  cv.width = cv.height = ev.width = ev.height = N * S;
  const c = cv.getContext('2d'), e = ev.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, N * S, N * S); e.fillStyle = '#000'; e.fillRect(0, 0, N * S, N * S);
  const r = mulberry32(glass ? 77 : 33);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i * S, y = j * S;
    const ix = glass ? 4 : 26, iy = glass ? 10 : 24, w = S - ix * 2, h = glass ? S - 34 : S - 46;
    c.fillStyle = glass ? '#28384a' : '#2a3442'; c.fillRect(x + ix, y + iy, w, h);
    c.fillStyle = glass ? '#3a5068' : '#46586e'; c.fillRect(x + ix, y + iy, w, Math.round(h * 0.38)); // sky reflection on the upper part
    if (!glass) { c.fillStyle = '#d9d6cf'; c.fillRect(x + ix - 3, y + iy + h, w + 6, 5); } // sill
    if (r() < 0.45) { e.fillStyle = r() < 0.5 ? '#ffd89a' : '#cfe3ff'; e.fillRect(x + ix, y + iy, w, h); }
  }
  const mk = (cnv, srgb) => {
    const t = new THREE.CanvasTexture(cnv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  return { map: mk(cv, true), emissive: mk(ev, true) };
}

export async function buildCity({ scene, renderer }) {
  const t0 = performance.now();
  const boot = globalThis.__boot; await boot?.stage('gen');
  const root = new THREE.Group(); root.name = 'city'; scene.add(root);

  const skin = await loadOpenSkin(); // (Manhattan ground / roof / leaf detail, null with ?noskin or when the textures are missing)
  const tx = { punched: makeWindowTextures(false), glass: makeWindowTextures(true) };
  const matFacade = new THREE.MeshStandardMaterial({ map: tx.punched.map, emissiveMap: tx.punched.emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 0.88, metalness: 0 });
  const matGlass = new THREE.MeshStandardMaterial({ map: tx.glass.map, emissiveMap: tx.glass.emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 0.32, metalness: 0.15 });
  const matGround = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const matPaint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

  skinGround(matGround, skin); skinGround(matPaint, skin); skinRoof(matFacade, skin); skinRoof(matGlass, skin);

  // chunk store: one set of builders per 400 m cell
  const chunks = new Map();
  const chunkOf = (x, z) => {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), k = cx * 1000 + cz;
    let c = chunks.get(k); if (!c) chunks.set(k, c = { cx, cz, fac: new GB(), gls: new GB(), gnd: new GB(), pnt: new GB(), trees: [], props: [], meshes: [] });
    return c;
  };

  // ---------------------------------------------------------------- ground
  // Every ground quad samples one of 12 low-res tiles (ground_tiles.png, see openskin.js for the layer ids). The tile coordinates are
  // baked per vertex (vertex colour r, g), so markings, crosswalks and stop lines are just quads with their own tile mapping.
  // Without the skin (?noskin) the same quads fall back to flat colours.
  const C = { road: col(0x2b2d31), walk: col(0x9c9b95), curb: col(0x74736f), plaza: col(0xb9b5a8), lot: col(0x8f8f8a), grass: col(0x4d6a38), dirt: col(0x7a6446) };
  const TEX = !!skin;
  const LY = { ASPH: 0, DBL: 1, DASH: 2, ZEB: 3, STOP: 4, WALK: 5, KERB: 6, GRASS: 7, DIRT: 8, PAVE: 9, WATER: 10, CONC: 11 };
  const FB = [C.road, C.road, C.road, C.road, C.road, C.walk, C.curb, C.grass, C.dirt, C.plaza, C.road, C.lot];
  const SC = [12, 3.6, 36, 10, 3.75, 6, 6, 12, 10, 6, 10, 10]; // metres per tile repeat for the tiling surfaces
  const W = (sc) => (x, z) => [x / sc, z / sc];
  // horizontal quad at height y; f(x, z) -> [u, v] in tile units
  const texq = (gb, x0, z0, x1, z1, y, layer, f) => {
    const P = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const [x, z] = P[k]; gb.p.push(x, y, z); gb.n.push(0, 1, 0);
      if (TEX) { const t = f(x, z); gb.u.push(layer, 0); gb.c.push(t[0], t[1], 0); }
      else { gb.u.push(99, 0); gb.c.push(FB[layer][0], FB[layer][1], FB[layer][2]); }
    }
  };
  const CH = G.CURB_H, { CELL, NX, NZ, X0, Z0 } = RASTER, PAINT_Y = 0.02;
  const isRoad = (c) => c >= CLS.AV && c <= CLS.INT, isRaised = (c) => c >= CLS.WALK;
  const gc = (i, j) => (i < 0 || j < 0 || i >= NX || j >= NZ ? 0 : GRID[j * NX + i]);
  // greedy rectangles (cell units) of every cell matching pred: rows are merged downwards while the run stays identical
  const rectsOf = (pred) => {
    const out = []; let prev = new Map();
    for (let j = 0; j < NZ; j++) {
      const cur = new Map();
      for (let i = 0; i < NX;) {
        if (!pred(GRID[j * NX + i])) { i++; continue; }
        let k = i; while (k < NX && pred(GRID[j * NX + k])) k++;
        const key = i * 4096 + k, r = prev.get(key);
        if (r) { r[3] = j + 1; cur.set(key, r); } else { const nr = [i, j, k, j + 1]; cur.set(key, nr); out.push(nr); }
        i = k;
      }
      prev = cur;
    }
    return out;
  };
  const toW = (r) => [X0 + r[0] * CELL, Z0 + r[1] * CELL, X0 + r[2] * CELL, Z0 + r[3] * CELL];
  // every quad is split on the chunk grid so Draw Distance culls it with the chunk it really lies in
  const splitChunks = (x0, z0, x1, z1, fn) => {
    for (let a = Math.floor(x0 / CHUNK); a <= Math.floor((x1 - 1e-6) / CHUNK); a++) for (let b = Math.floor(z0 / CHUNK); b <= Math.floor((z1 - 1e-6) / CHUNK); b++)
      fn(Math.max(x0, a * CHUNK), Math.max(z0, b * CHUNK), Math.min(x1, (a + 1) * CHUNK), Math.min(z1, (b + 1) * CHUNK));
  };
  const flat = (pred, layer, y) => {
    for (const r of rectsOf(pred)) { const [x0, z0, x1, z1] = toW(r); splitChunks(x0, z0, x1, z1, (a, b, c, d) => texq(chunkOf((a + c) / 2, (b + d) / 2).gnd, a, b, c, d, y, layer, W(SC[layer]))); }
  };
  const paint = (x0, z0, x1, z1, layer, f) => splitChunks(x0, z0, x1, z1, (a, b, c, d) => texq(chunkOf((a + c) / 2, (b + d) / 2).pnt, a, b, c, d, PAINT_Y, layer, f));

  // roads (asphalt), sidewalks, lots, plaza, parks; the outside is low grass
  flat(isRoad, LY.ASPH, 0);
  flat((c) => c === CLS.WALK, LY.WALK, CH);
  flat((c) => c === CLS.LOT, LY.CONC, CH);
  flat((c) => c === CLS.PLAZA, LY.PAVE, CH);
  flat((c) => c === CLS.PARK, LY.GRASS, CH + 0.02);
  flat((c) => c === CLS.OUT, LY.GRASS, -0.35);

  // kerb faces: every raised cell that touches a road cell
  { const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of D) {
      const m = new Uint8Array(NX * NZ);
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) if (isRaised(GRID[j * NX + i]) && isRoad(gc(i + dx, j + dz))) m[j * NX + i] = 1;
      // merge along the edge direction
      const alongZ = dx !== 0;
      const outer = alongZ ? NX : NZ, inner = alongZ ? NZ : NX;
      for (let o = 0; o < outer; o++) for (let n = 0; n < inner;) {
        const i = alongZ ? o : n, j = alongZ ? n : o;
        if (!m[j * NX + i]) { n++; continue; }
        let k = n; while (k < inner && m[(alongZ ? k : o) * NX + (alongZ ? o : k)]) k++;
        if (alongZ) {
          const X = X0 + (dx > 0 ? i + 1 : i) * CELL, za = Z0 + n * CELL, zb = Z0 + k * CELL;
          splitChunks(X, za, X + 1e-3, zb, (a, b, c, d) => {
            const gb = chunkOf(X, (b + d) / 2).gnd; const U = [[99, 0], [99, 0], [99, 0], [99, 0]];
            if (dx > 0) gb.quad([X, 0, d], [X, 0, b], [X, CH, b], [X, CH, d], [1, 0, 0], U, C.curb); else gb.quad([X, 0, b], [X, 0, d], [X, CH, d], [X, CH, b], [-1, 0, 0], U, C.curb);
          });
        } else {
          const Z = Z0 + (dz > 0 ? j + 1 : j) * CELL, xa = X0 + n * CELL, xb = X0 + k * CELL;
          splitChunks(xa, Z, xb, Z + 1e-3, (a, b, c, d) => {
            const gb = chunkOf((a + c) / 2, Z).gnd; const U = [[99, 0], [99, 0], [99, 0], [99, 0]];
            if (dz > 0) gb.quad([a, 0, Z], [c, 0, Z], [c, CH, Z], [a, CH, Z], [0, 0, 1], U, C.curb); else gb.quad([c, 0, Z], [a, 0, Z], [a, CH, Z], [c, CH, Z], [0, 0, -1], U, C.curb);
          });
        }
        n = k;
      }
    } }

  // road markings (paint layer): double yellow down the middle of every road run wide enough, dashed lane lines on the wide ones.
  // Avenues are scanned row by row, streets column by column; identical strips on consecutive lines merge into one quad.
  { const LANE = 3.6, merge = (lines, emit) => {
      let prev = new Map();
      lines.forEach((strips, n) => {
        const cur = new Map();
        for (const st of strips) { const key = st.k + '|' + st.a + '|' + st.b, r = prev.get(key); if (r) { r.n1 = n + 1; cur.set(key, r); } else { const nr = { ...st, n0: n, n1: n + 1 }; cur.set(key, nr); emit.push(nr); } }
        prev = cur;
      });
    };
    const strips = (lo, hi) => { // lo / hi: road edges (m) across the road; returns the paint strips (across-range) for one run
      const w = hi - lo; if (w < 14) return []; const c = (lo + hi) / 2, out = [{ k: 'D', a: +(c - 1.8).toFixed(2), b: +(c + 1.8).toFixed(2) }];
      for (let k = 1; k * LANE < w / 2 - 2.5; k++) for (const sg of [-1, 1]) out.push({ k: 'L', a: +(c + sg * k * LANE - 1.8).toFixed(2), b: +(c + sg * k * LANE + 1.8).toFixed(2) });
      return out;
    };
    const av = [], st = [], avE = [], stE = [];
    for (let j = 0; j < NZ; j++) { const row = []; for (let i = 0; i < NX;) { if (GRID[j * NX + i] !== CLS.AV) { i++; continue; } let k = i; while (k < NX && GRID[j * NX + k] === CLS.AV) k++; row.push(...strips(X0 + i * CELL, X0 + k * CELL)); i = k; } av.push(row); }
    for (let i = 0; i < NX; i++) { const col = []; for (let j = 0; j < NZ;) { if (GRID[j * NX + i] !== CLS.ST) { j++; continue; } let k = j; while (k < NZ && GRID[k * NX + i] === CLS.ST) k++; col.push(...strips(Z0 + j * CELL, Z0 + k * CELL)); j = k; } st.push(col); }
    merge(av, avE); merge(st, stE);
    for (const r of avE) { const za = Z0 + r.n0 * CELL, zb = Z0 + r.n1 * CELL; if (zb - za < 6) continue;
      paint(r.a, za, r.b, zb, r.k === 'D' ? LY.DBL : LY.DASH, r.k === 'D' ? (x, z) => [(x - r.a) / 3.6, z / 3.6] : (x, z) => [(x - r.a) / 3.6, z / 36]); }
    for (const r of stE) { const xa = X0 + r.n0 * CELL, xb = X0 + r.n1 * CELL; if (xb - xa < 6) continue;
      paint(xa, r.a, xb, r.b, r.k === 'D' ? LY.DBL : LY.DASH, r.k === 'D' ? (x, z) => [(z - r.a) / 3.6, x / 3.6] : (x, z) => [(z - r.a) / 3.6, x / 36]); }
  }

  // outskirts beyond the raster (never under it), plus the two exit roads running on to the horizon
  { const big = new GB(), R = 9000, Y = -0.35, gf = W(SC[LY.GRASS]), rx0 = X0, rx1 = X0 + NX * CELL, rz0 = Z0, rz1 = Z0 + NZ * CELL;
    texq(big, rx0, -R, rx1, rz0, Y, LY.GRASS, gf); texq(big, rx0, rz1, rx1, R, Y, LY.GRASS, gf); // north / south
    for (const [a, b, e] of [[-R, rx0, EXITS.W], [rx1, R, EXITS.E]]) { texq(big, a, -R, b, e.z - e.half, Y, LY.GRASS, gf); texq(big, a, e.z + e.half, b, R, Y, LY.GRASS, gf); } // west / east, with a gap for the road
    const m = new THREE.Mesh(big.build(), matGround); m.receiveShadow = true; m.frustumCulled = false; m.name = 'outskirts'; root.add(m);
    for (const [a, b, e] of [[rx0 - 1500, rx0, EXITS.W], [rx1, rx1 + 1500, EXITS.E]]) for (let x = a; x < b; x += 300) tq(x, e.z - e.half, Math.min(b, x + 300), e.z + e.half, LY.ASPH, W(SC[0])); }
  function tq(x0, z0, x1, z1, layer, f) { texq(chunkOf((x0 + x1) / 2, (z0 + z1) / 2).gnd, x0, z0, x1, z1, 0, layer, f); }

  // ---------------------------------------------------------------- buildings
  const solids = new Solids(), zips = new ZipPoints();
  const boxes = [], footprints = [];
  const lots = new URLSearchParams(location.search).has('buildings') ? generateLots() : []; // buildings are off while the ground is reworked (?buildings brings them back)
  const WALL = [0xd8cfc0, 0xc9b9a6, 0xb5a191, 0xa9a9a2, 0xd6d0c6, 0x9a8f86, 0xc4c8c8, 0xb08c78, 0x8f9aa3].map(col);
  const GLASS = [0x6f8aa3, 0x5d7f96, 0x7d94a6, 0x4f6b82].map(col);
  const ROOF = col(0x5d5b58), HV = col(0x8d8f90), BASE = col(0x565551);
  let nMass = 0;
  for (const L of lots) {
    const rnd = mulberry32(L.seed), cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2, ch = chunkOf(cx, cz);
    const gb = L.glass ? ch.gls : ch.fac, base = L.glass ? GLASS[(rnd() * GLASS.length) | 0] : WALL[(rnd() * WALL.length) | 0];
    const uOff = ((rnd() * 4) | 0) * 0.25 + 0.003, vOff = ((rnd() * 4) | 0) * 0.25 + 0.003;
    const masses = [{ x0: L.x0, z0: L.z0, x1: L.x1, z1: L.z1, y0: 0, y1: L.H }];
    if (L.H > 55 && rnd() < 0.75) { // set-back tower on a podium
      const podH = Math.max(16, L.H * (0.3 + rnd() * 0.15)), inset = 4 + rnd() * 5, w = L.x1 - L.x0, d = L.z1 - L.z0;
      const ix = Math.min(inset, w * 0.3), iz = Math.min(inset + rnd() * 3, d * 0.3);
      masses[0].y1 = podH;
      masses.push({ x0: L.x0 + ix, z0: L.z0 + iz, x1: L.x1 - ix, z1: L.z1 - iz, y0: podH, y1: L.H });
    }
    for (const m of masses) {
      const hh = m.y1 - m.y0;
      gb.walls(m.x0, m.y0, m.z0, m.x1, m.y1, m.z1, base, uOff, vOff, m.y0 === 0 && hh > 14 ? BASE : null, 4.6);
      gb.horiz(m.x0, m.z0, m.x1, m.z1, m.y1, ROOF);
      solids.box(m.x0, m.y0, m.z0, m.x1, m.y1, m.z1, 'wall');
      boxes.push({ min: [m.x0, m.y0, m.z0], max: [m.x1, m.y1, m.z1] });
      // roof edge + corner zip points
      const e = 0.12;
      zips.edge(m.x0, m.z0 + e, m.x1, m.z0 + e, m.y1, 0, -1); zips.edge(m.x0, m.z1 - e, m.x1, m.z1 - e, m.y1, 0, 1);
      zips.edge(m.x0 + e, m.z0, m.x0 + e, m.z1, m.y1, -1, 0); zips.edge(m.x1 - e, m.z0, m.x1 - e, m.z1, m.y1, 1, 0);
      for (const [px, pz, nx, nz] of [[m.x0, m.z0, -1, -1], [m.x1, m.z0, 1, -1], [m.x0, m.z1, -1, 1], [m.x1, m.z1, 1, 1]]) zips.add(px - nx * 0.15, m.y1, pz - nz * 0.15, nx * Math.SQRT1_2, 0, nz * Math.SQRT1_2, 'roofCorner');
      nMass++;
    }
    // roof clutter on the top mass: 1-3 HVAC boxes (+ an antenna on the tallest towers)
    const top = masses[masses.length - 1], tw = top.x1 - top.x0, td = top.z1 - top.z0;
    const nH = 1 + ((rnd() * 3) | 0);
    for (let i = 0; i < nH; i++) {
      const bw = 2.5 + rnd() * 3, bd = 2 + rnd() * 2.5, bh = 1.6 + rnd() * 1.4;
      const hx = top.x0 + 3 + rnd() * Math.max(0.1, tw - 6 - bw), hz = top.z0 + 3 + rnd() * Math.max(0.1, td - 6 - bd);
      gb.box(hx, top.y1, hz, hx + bw, top.y1 + bh, hz + bd, HV);
      solids.box(hx, top.y1, hz, hx + bw, top.y1 + bh, hz + bd, 'equipment');
    }
    if (L.H > 110 && rnd() < 0.6) {
      const ax = cx + (rnd() - 0.5) * tw * 0.3, az = cz + (rnd() - 0.5) * td * 0.3, ah = 14 + rnd() * 14;
      gb.box(ax - 0.3, top.y1, az - 0.3, ax + 0.3, top.y1 + ah, az + 0.3, HV);
      solids.box(ax - 0.3, top.y1, az - 0.3, ax + 0.3, top.y1 + ah, az + 0.3, 'antenna');
      zips.add(ax, top.y1 + ah, az, 0, 1, 0, 'antenna');
    }
    footprints.push({ x0: L.x0, z0: L.z0, x1: L.x1, z1: L.z1, h: L.H, kind: L.glass ? 'glass' : 'loft' });
  }
  await boot?.stage('build');

  // ---------------------------------------------------------------- trees (instanced, one mesh per chunk)
  const treeGeo = (() => {
    const trunk = new THREE.CylinderGeometry(0.22, 0.32, 3.2, 6); trunk.translate(0, 1.6, 0);
    const crown = new THREE.IcosahedronGeometry(2.4, 0); crown.scale(1, 1.2, 1); crown.translate(0, 5.1, 0);
    const crown2 = new THREE.IcosahedronGeometry(1.7, 0); crown2.translate(0.5, 6.9, 0.2);
    const paint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    const parts = [paint(trunk.toNonIndexed(), col(0x4b3a2a)), paint(crown, col(0x5e8a3c)), paint(crown2, col(0x6b9a45))];
    const P = [], N = [], Cc = [];
    for (const g of parts) { P.push(...g.attributes.position.array); N.push(...g.attributes.normal.array); Cc.push(...g.attributes.color.array); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    return g;
  })();
  const matTree = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  skinTree(matTree, skin);
  const inFootprint = (x, z, pad) => footprints.some(f => x > f.x0 - pad && x < f.x1 + pad && z > f.z0 - pad && z < f.z1 + pad);
  const addTree = (x, z, s) => {
    const ch = chunkOf(x, z); ch.trees.push([x, z, s, hash2(x * 7, z * 3)]);
    solids.cyl(x, z, 0, 3.4 * s, 0.3 * s, 0.3 * s, 'trunk');
  };
  { const rnd = mulberry32(0x7EE);
    for (const P of PARKS) for (let x = P[0] + 8; x < P[2] - 6; x += 15) for (let z = P[1] + 8; z < P[3] - 6; z += 15) if (rnd() < 0.75) addTree(x + (rnd() - 0.5) * 9, z + (rnd() - 0.5) * 9, 0.8 + rnd() * 0.7);
    // street trees on the sidewalk next to the kerb, sparse
    for (let j = 1; j < NZ - 1; j++) for (let i = 1; i < NX - 1; i++) {
      if (GRID[j * NX + i] !== CLS.WALK || (i + j) % 7 !== 0) continue;
      if (!(isRoad(gc(i + 1, j)) || isRoad(gc(i - 1, j)) || isRoad(gc(i, j + 1)) || isRoad(gc(i, j - 1)))) continue;
      if (hash2(i * 7 + 3, j * 13 + 5) < 0.22) addTree(X0 + (i + 0.5) * CELL, Z0 + (j + 0.5) * CELL, 0.75 + rnd() * 0.4);
    } }
  const treeMeshes = [];
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
  for (const ch of chunks.values()) {
    const n = ch.trees.length; if (!n) continue;
    const im = new THREE.InstancedMesh(treeGeo, matTree, n); im.name = 'trees-open-' + ch.cx + '_' + ch.cz;
    ch.trees.forEach(([x, z, s, h], i) => {
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h * 6.28); _s.set(s, s * (0.9 + h * 0.3), s); _p.set(x, 0, z);
      im.setMatrixAt(i, _m.compose(_p, _q, _s)); im.setColorAt(i, _c.setRGB(0.85 + h * 0.3, 0.9 + (h * 7 % 1) * 0.2, 0.85 + h * 0.2));
    });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); root.add(im); treeMeshes.push(im); ch.meshes.push(im);
  }

  // ---------------------------------------------------------------- props (Manhattan props.glb): street furniture + roof extras, merged per chunk (1 draw call)
  const PG = skin ? await (async () => {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync('/assets/city/props.glb'); gltf.scene.updateMatrixWorld(true);
      const geos = {};
      gltf.scene.traverse((o) => { if (!o.isMesh) return; const g = o.geometry.clone().toNonIndexed(); g.applyMatrix4(o.matrixWorld); geos[o.name] = g; });
      return geos;
    } catch (e) { console.warn('[citylite] props.glb unavailable', e); return null; }
  })() : null;
  if (PG) {
    const rp = mulberry32(0xB0B5), put = (name, x, y, z, yaw, sc = 1) => { if (PG[name]) chunkOf(x, z).props.push([name, x, y, z, yaw, sc]); };
    for (let j = 1; j < NZ - 1; j++) for (let i = 1; i < NX - 1; i++) { // street furniture on the sidewalk, next to the kerb
      if (GRID[j * NX + i] !== CLS.WALK) continue;
      if (!(isRoad(gc(i + 1, j)) || isRoad(gc(i - 1, j)) || isRoad(gc(i, j + 1)) || isRoad(gc(i, j - 1)))) continue;
      const r = hash2(i * 13 + 5, j * 7 + 1); if (r > 0.014) continue;
      const x = X0 + (i + 0.5) * CELL, z = Z0 + (j + 0.5) * CELL;
      if (r < 0.002) put('payphone', x, CH, z, rp() * 6.28); else put('signpole', x, CH, z, rp() * 6.28);
    }
    for (const B of blocks) {
      if (!B.rect || B.kind !== KINDS.KIND_BUILD || rp() > 0.3) continue;
      const x = B.x0 + 6 + rp() * (B.x1 - B.x0 - 12), z = B.z0 + 1.4;
      put('dumpster', x, CH, z, 0); solids.box(x - 1, CH, z - 0.6, x + 1, CH + 1.3, z + 0.6, 'equipment');
      if (rp() < 0.7) put('drum', x + 2.2, CH, z, rp() * 6.28);
    }
    for (const L of lots) { // roof extras on top of the tallest mass (decor only; the HVAC boxes keep the collision)
      const r = rp(); if (r > 0.35) continue;
      const mg = L.H > 55 ? 11 : 4; if (L.x1 - L.x0 < 2 * mg + 3 || L.z1 - L.z0 < 2 * mg + 3) continue;
      put(r < 0.1 ? 'shed' : r < 0.22 ? 'vents' : 'dish', L.x0 + mg + rp() * (L.x1 - L.x0 - 2 * mg), L.H, L.z0 + mg + rp() * (L.z1 - L.z0 - 2 * mg), rp() * 6.28);
    }
    const matProp = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 });
    const _pm = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _pn = new THREE.Matrix3(), _pv = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    for (const ch of chunks.values()) {
      if (!ch.props.length) continue;
      const P = [], N = [], Cc = [];
      for (const [name, x, y, z, yaw, sc] of ch.props) {
        const g = PG[name], pa = g.attributes.position, na = g.attributes.normal, ca = g.attributes.color;
        _pm.compose(_pv.set(x, y, z), _pq.setFromAxisAngle(UP, yaw), new THREE.Vector3(sc, sc, sc)); _pn.getNormalMatrix(_pm);
        for (let i = 0; i < pa.count; i++) {
          _pv.fromBufferAttribute(pa, i).applyMatrix4(_pm); P.push(_pv.x, _pv.y, _pv.z);
          _pv.fromBufferAttribute(na, i).applyMatrix3(_pn).normalize(); N.push(_pv.x, _pv.y, _pv.z);
          if (ca) Cc.push(ca.getX(i), ca.getY(i), ca.getZ(i)); else Cc.push(0.6, 0.6, 0.6);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, matProp); m.name = 'props-open-' + ch.cx + '_' + ch.cz; m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; root.add(m); ch.meshes.push(m);
    }
  }

  // ---------------------------------------------------------------- chunk meshes
  const mk = (gb, mat, name, shadow, ch) => { if (gb.empty) return; const m = new THREE.Mesh(gb.build(), mat); m.name = name; m.castShadow = shadow; m.receiveShadow = true; m.matrixAutoUpdate = false; root.add(m); ch.meshes.push(m); };
  for (const ch of chunks.values()) {
    const id = ch.cx + '_' + ch.cz;
    mk(ch.fac, matFacade, 'facade-' + id, true, ch); mk(ch.gls, matGlass, 'glass-' + id, true, ch);
    mk(ch.gnd, matGround, 'ground-' + id, false, ch); mk(ch.pnt, matPaint, 'paint-' + id, false, ch);
  }
  await boot?.stage('coll');

  // ---------------------------------------------------------------- queries
  const terrainHeight = (x, z) => {
    const c = cellAt(x, z);
    if (c < 0) { const e = x < X0 ? EXITS.W : EXITS.E; return Math.abs(z - e.z) < e.half && Math.abs(x) < 2600 ? 0 : -0.05; }
    if (c >= CLS.AV && c <= CLS.INT) return 0;
    return c === CLS.OUT ? -0.05 : c === CLS.PARK ? CH + 0.02 : CH;
  };
  const grid = new CollisionGrid(solids, 24);
  const finZ = zips.finalize(grid);
  const { groundHeight, raycast, surfaceAt } = makeQueries(grid, terrainHeight);
  const geoDebug = createGeoDebug(root, grid, finZ, collisionDebugLines);

  const spawn = new THREE.Vector3(SPAWN[0], 0, SPAWN[1]);
  // viewpoints for the screenshot tool / camera shots
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const viewpoints = {
    street: { pos: V(spawn.x, 1.7, spawn.z + 4.2), target: V(spawn.x - 1, 6, spawn.z - 200), subject: spawn.clone() },
    swing: { pos: V(spawn.x - 40, 15, spawn.z), target: V(spawn.x + 30, 12, spawn.z - 60), subject: V(spawn.x - 30, 14, spawn.z - 8) },
    swingBack: { pos: V(spawn.x + 3, 14.5, spawn.z + 60), target: V(spawn.x + 4, 4, spawn.z - 60), subject: V(spawn.x + 3, 11, spawn.z + 50) },
  };
  { let tall = null; for (const L of lots) if (!tall || L.H > tall.H) tall = L;
    if (tall) { const zc = (tall.z0 + tall.z1) / 2, m = boxes.filter(b => Math.abs(b.min[0] - tall.x0) < 12 && Math.abs((b.min[2] + b.max[2]) / 2 - zc) < 40).sort((a, b) => b.max[1] - a.max[1])[0];
      const wx = m ? m.min[0] : tall.x0, a = V(wx, Math.min(60, tall.H - 8), zc);
      viewpoints.wall = { pos: V(a.x - 3.2, a.y + 1, a.z + 2), target: V(a.x, a.y - 4, a.z - 30), anchor: a, normal: V(-1, 0, 0) };
      viewpoints.climb = { pos: V(a.x - 3.2, a.y + 1.2, a.z + 2.2), target: V(a.x, a.y + 1.5, a.z - 3), anchor: a, normal: V(-1, 0, 0) }; } }

  let MF = null;
  const mapFeatures = () => MF ??= (() => {
    const rr = (pred, kind) => rectsOf(pred).map((r) => { const [x0, z0, x1, z1] = toW(r); return kind ? { x0, z0, x1, z1, kind } : { x0, z0, x1, z1 }; });
    return {
      bounds: { x0: G.X_MIN - 200, z0: G.Z_MIN - 200, x1: G.X_MAX + 200, z1: G.Z_MAX + 200 },
      land: [[[G.X_MIN - 200, G.Z_MIN - 200], [G.X_MAX + 200, G.Z_MIN - 200], [G.X_MAX + 200, G.Z_MAX + 200], [G.X_MIN - 200, G.Z_MAX + 200]]],
      farLand: [], blocks: rr((c) => c >= CLS.WALK && c !== CLS.PARK), buildings: footprints,
      streets: [...rr((c) => c === CLS.AV, 'avenue'), ...rr((c) => c === CLS.ST || c === CLS.INT, 'street')],
      water: [], parks: PARKS.map((p) => [[p[0], p[1]], [p[2], p[1]], [p[2], p[3]], [p[0], p[3]]]),
      parkWater: [], avenueNames: avenues.map((x, i) => ({ x, name: 'AVENUE ' + String.fromCharCode(65 + i) })), inPark,
    };
  })();

  let time = 0, nk = -1;
  const camParam = new URLSearchParams(location.search).get('cam');
  // Options > Draw Distance: chunks farther than this are not drawn at all (the haze hides the edge). Live via globalThis.__DRAW_DIST.
  const DD = { low: 500, medium: 1300, high: 2200 };
  const bootDD = (() => { try { return DD[readGfx()?.drawDist] ?? Infinity; } catch (e) { return Infinity; } })();
  const chunkList = [...chunks.values()];
  const applyDrawDist = (cam) => {
    const D = globalThis.__DRAW_DIST ?? bootDD;
    globalThis.__FOG_END = Number.isFinite(D) ? D : 0; // pipeline fades everything into fog before the cut
    for (const ch of chunkList) {
      const x0 = ch.cx * CHUNK, z0 = ch.cz * CHUNK;
      const dx = Math.max(0, x0 - cam.x, cam.x - (x0 + CHUNK)), dz = Math.max(0, z0 - cam.z, cam.z - (z0 + CHUNK));
      const vis = Math.hypot(dx, dz) < D;
      if (ch.vis !== vis) { ch.vis = vis; for (const m of ch.meshes) m.visible = vis; }
    }
  };
  const world = {
    raycast, groundHeight, surfaceAt, spawn, viewpoints, streetsAt,
    getZipPoints: (center, radius, kinds) => finZ.query(center, radius, kinds),
    bridgeLimit: null, bridgeDeckY: undefined, propAnchors: () => [], grabbables: () => [], grabProp: () => undefined, releaseProp: () => undefined,
    collision: grid, geoDebug, buildings: boxes, footprints, getMapFeatures: mapFeatures, textures: {}, materials: { facade: matFacade, glass: matGlass },
    update(dt, camera) {
      time += dt;
      const k = nightK.value;
      if (Math.abs(k - nk) > 0.005) { nk = k; matFacade.emissiveIntensity = k * 1.1; matGlass.emissiveIntensity = k * 1.4; }
      if (camera) {
        if (camParam) { const f = camParam.split(',').map(Number); camera.position.set(f[0], f[1], f[2]); camera.lookAt(f[3], f[4], f[5]); }
        geoDebug.update(camera);
        applyDrawDist(camera.position);
      }
    },
  };
  attachLife(world, { traffic: null, crowd: null, pigeons: null });
  // street traffic is off for now: opentraffic.js follows the old straight avenue / street grid, the new layout has no such grid
  console.log(`[citylite] built in ${(performance.now() - t0).toFixed(0)} ms: ${lots.length} buildings (${nMass} masses), ${chunks.size} chunks, ${treeMeshes.reduce((a, m) => a + m.count, 0)} trees, ${grid.n} solids, ${finZ.count} zip points`);
  return world;
}
