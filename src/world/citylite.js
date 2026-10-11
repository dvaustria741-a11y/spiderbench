// Open City: a big, light world (few buildings, wide gaps, few trees, a handful of draw calls). Same contract as
// city.js: buildCity({scene, renderer}) -> Promise<world>. Layout data lives in openmap.js.
// Everything visible is merged into per-chunk meshes (400 m chunks) so culling is cheap; collision uses the same
// Solids / CollisionGrid / ZipPoints as the Manhattan map, so swinging, wall-running, zipping and combat behave the same.
import * as THREE from 'three';
import { createOpenTraffic } from './opentraffic.js';
import { loadOpenSkin, skinGround, skinRoof, skinTree } from './openskin.js';
import { loadVehicleModels } from './vehicles.js';
import { G, avenues, streets, blocks, generateLots, streetsAt, hash2, mulberry32, KINDS, inPark, GRID, RASTER, CLS, cellAt, PARKS, EXITS, SPAWN } from './openmap.js';
import { MESH, LINES } from './openlayout.js';
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

// the open world has no volumetric clouds (sky art comes from sky textures instead, like the reference game)
globalThis.__OPEN_NO_CLOUDS = true;

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

  skinGround(matGround, skin); skinGround(matPaint, skin);

  // open water: one big plane with low animated waves (normal-only, so it stays cheap). The player can swim in it (world.swimY).
  const SWIM_Y = -3.4, SEABED = SWIM_Y - 2.4; // water surface (was -1.6, then -2.6) and the sea floor the shore slopes down to
  const SLOPE_RUN = 1.4; // shore slope: metres of run per metre of drop (1.4 = ~35 degrees, like Spider Fuser's embankments)
  const waterU = { uWT: { value: 0 } };
  const matWater = new THREE.MeshStandardMaterial({ color: 0x213f58, roughness: 0.16, metalness: 0 });
  matWater.onBeforeCompile = (sh) => {
    sh.uniforms.uWT = waterU.uWT; if (skin) sh.uniforms.uGT = { value: skin.ground.tex };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWT; varying vec3 vWPos;
        ${skin ? 'uniform highp sampler2DArray uGT;' : ''}
        vec2 waveSlope(vec2 p, float t) {
          vec2 g = vec2(0.0);
          g += vec2(0.80, 0.60) * (0.060 * cos(dot(p, vec2(0.80, 0.60)) * 0.45 + t * 1.10));
          g += vec2(-0.50, 0.87) * (0.045 * cos(dot(p, vec2(-0.50, 0.87)) * 0.80 + t * 1.60 + 1.7));
          g += vec2(0.20, -0.98) * (0.028 * cos(dot(p, vec2(0.20, -0.98)) * 1.70 + t * 2.30 + 4.1));
          g += vec2(-0.90, -0.40) * (0.015 * cos(dot(p, vec2(-0.90, -0.40)) * 3.10 + t * 3.10 + 2.2));
          return g;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${skin ? `{ vec2 q = vWPos.xz / 18.0;
          vec3 a = texture(uGT, vec3(q + vec2(uWT * 0.012, uWT * 0.007), 10.0)).rgb;
          vec3 b = texture(uGT, vec3(q * 1.7 + vec2(-uWT * 0.009, uWT * 0.011) + 0.37, 10.0)).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, (a + b) * 0.5, 0.75); }` : ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { float wd = length(vWPos - cameraPosition); float fade = 1.0 - smoothstep(120.0, 700.0, wd);
          vec2 gs = waveSlope(vWPos.xz, uWT) * fade;
          normal = normalize((viewMatrix * vec4(normalize(vec3(-gs.x, 1.0, -gs.y)), 0.0)).xyz); }`);
  };
  matWater.customProgramCacheKey = () => 'openWater1' + (skin ? 's' : 'n'); skinRoof(matFacade, skin); skinRoof(matGlass, skin);

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

  // ---- smooth ground (openlayout.js: triangulated polygons from the layout image, same tile mapping as every other ground quad)
  const b64u8 = (b) => { const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const i16 = (b) => new Int16Array(b64u8(b).buffer), u16 = (b) => new Uint16Array(b64u8(b).buffer);
  const meshLayer = (key, layer, y) => {
    const [vb, ib] = MESH[key]; if (!vb) return;
    const V = i16(vb), I = u16(ib), gb = new GB(), f = W(SC[layer]);
    for (let t = 0; t < I.length; t += 3) {
      let a = I[t], b = I[t + 1], c = I[t + 2];
      const ux = (V[2 * b] - V[2 * a]), uz = (V[2 * b + 1] - V[2 * a + 1]), vx = (V[2 * c] - V[2 * a]), vz = (V[2 * c + 1] - V[2 * a + 1]);
      if (uz * vx - ux * vz < 0) { const k = b; b = c; c = k; } // face up
      for (const i of [a, b, c]) {
        const x = V[2 * i] / 16, z = V[2 * i + 1] / 16; gb.p.push(x, y, z); gb.n.push(0, 1, 0);
        if (TEX) { const q = f(x, z); gb.u.push(layer, 0); gb.c.push(q[0], q[1], 0); } else { gb.u.push(99, 0); gb.c.push(FB[layer][0], FB[layer][1], FB[layer][2]); }
      }
    }
    const m = new THREE.Mesh(gb.build(), matGround); m.receiveShadow = true; m.name = 'ground-' + key; root.add(m);
  };
  meshLayer('asph', LY.ASPH, 0);
  meshLayer('walk', LY.WALK, CH);
  meshLayer('lot', LY.CONC, CH);
  meshLayer('plaza', LY.PAVE, CH);
  meshLayer('park', LY.GRASS, CH + 0.02);
  // ---- rolling park ground (Spider Fuser style mounds): a raster-aligned heightfield over the park cells, always >= the flat park layer, fading
  // to flat toward the park edge so it meets the sidewalk. The same heights drive collision (terrainHeight) and where the trees stand.
  const PARK_Y = CH + 0.02, HILL_LIFT = 0.03, HILL_A = 2.0, HILL_FADE = 18;
  const vnoise = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
  };
  const hillRaw = (x, z) => 0.45 * vnoise(x / 22 + 3.1, z / 22 + 7.7) + 0.35 * vnoise(x / 11 + 11.3, z / 11 + 2.9) + 0.20 * vnoise(x / 6 + 5.5, z / 6 + 13.1);
  const HILLW = NX + 1, HILLV = new Float32Array(HILLW * (NZ + 1));
  { // distance (m) from every park cell to the nearest non-park cell: two-pass chamfer
    const D = new Float32Array(NX * NZ), BIG = 1e6, d1 = CELL, d2 = CELL * Math.SQRT2;
    for (let k = 0; k < D.length; k++) D[k] = GRID[k] === CLS.PARK ? BIG : 0;
    const at = (i, j) => (i < 0 || j < 0 || i >= NX || j >= NZ ? 0 : D[j * NX + i]);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const k = j * NX + i; if (!D[k]) continue; D[k] = Math.min(D[k], at(i - 1, j) + d1, at(i, j - 1) + d1, at(i - 1, j - 1) + d2, at(i + 1, j - 1) + d2); }
    for (let j = NZ - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) { const k = j * NX + i; if (!D[k]) continue; D[k] = Math.min(D[k], at(i + 1, j) + d1, at(i, j + 1) + d1, at(i + 1, j + 1) + d2, at(i - 1, j + 1) + d2); }
    for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
      const c4 = [at(i - 1, j - 1), at(i, j - 1), at(i - 1, j), at(i, j)]; // corner heights: only corners that touch park cells, faded by the nearest non-park cell
      if (!(c4[0] || c4[1] || c4[2] || c4[3])) continue;
      const dm = Math.min(...c4), f = Math.min(1, dm / HILL_FADE), fs = f * f * (3 - 2 * f);
      HILLV[j * HILLW + i] = HILL_A * fs * Math.max(0, hillRaw(X0 + i * CELL, Z0 + j * CELL) - 0.2);
    }
  }
  const hillAt = (x, z) => { // bilinear over the corner heights
    const u = (x - X0) / CELL, v = (z - Z0) / CELL, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return 0;
    const k = j * HILLW + i; return (HILLV[k] * (1 - fu) + HILLV[k + 1] * fu) * (1 - fv) + (HILLV[k + HILLW] * (1 - fu) + HILLV[k + HILLW + 1] * fu) * fv;
  };
  const parkTop = (x, z) => PARK_Y + HILL_LIFT + hillAt(x, z);
  { const gb = new GB(), f = W(14), hv = (i, j) => HILLV[Math.max(0, Math.min(NZ, j)) * HILLW + Math.max(0, Math.min(NX, i))];
    const vtx = (i, j) => {
      const x = X0 + i * CELL, z = Z0 + j * CELL, nx = -(hv(i + 1, j) - hv(i - 1, j)) / (2 * CELL), nz = -(hv(i, j + 1) - hv(i, j - 1)) / (2 * CELL), q = Math.hypot(nx, 1, nz);
      gb.p.push(x, PARK_Y + HILL_LIFT + hv(i, j), z); gb.n.push(nx / q, 1 / q, nz / q);
      if (TEX) { const t = f(x, z); gb.u.push(LY.GRASS, 0); gb.c.push(t[0], t[1], 0); } else { gb.u.push(99, 0); gb.c.push(C.grass[0], C.grass[1], C.grass[2]); }
    };
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      if (GRID[j * NX + i] !== CLS.PARK) continue;
      for (const k of [[i, j + 1], [i + 1, j + 1], [i + 1, j], [i, j + 1], [i + 1, j], [i, j]]) vtx(k[0], k[1]);
    }
    if (!gb.empty) { const m = new THREE.Mesh(gb.build(), matGround); m.receiveShadow = true; m.name = 'park-hills'; root.add(m); }
  }
  // vertical walls along smooth polylines (outside on the right of travel): kerbs between road and block, sea wall between land and water
  // run > 0 turns the vertical wall into a slope: the top edge stays on the land edge (y1), the bottom edge sits `run` metres out into the water (y0)
  const wallLines = (key, y0, y1, layer, sc, run = 0) => {
    const [pb, lens] = LINES[key]; if (!lens.length) return;
    const P = i16(pb), gb = new GB(); let o = 0;
    const H = y1 - y0, slant = run > 0 ? Math.hypot(H, run) / H : 1; // texture v follows the slope length
    const push = (x, y, z, s_, N) => {
      gb.p.push(x, y, z); gb.n.push(N[0], N[1], N[2]);
      if (TEX) { gb.u.push(layer, 0); gb.c.push(s_ / sc, y * slant / sc, 0); } else { gb.u.push(99, 0); gb.c.push(C.curb[0], C.curb[1], C.curb[2]); }
    };
    for (const n of lens) {
      let acc = 0, pnx = 0, pnz = 0, have = false;
      for (let k = 0; k < n - 1; k++) {
        const ax = P[2 * (o + k)] / 16, az = P[2 * (o + k) + 1] / 16, bx = P[2 * (o + k + 1)] / 16, bz = P[2 * (o + k + 1) + 1] / 16;
        const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.05) continue;
        const nx = dz / L, nz = -dx / L, s0 = acc, s1 = acc + L; acc = s1;
        let N = [nx, 0, nz];
        if (run > 0) { const q = Math.hypot(nx * H / run, 1, nz * H / run); N = [nx * H / run / q, 1 / q, nz * H / run / q]; }
        const V = [[bx + nx * run, y0, bz + nz * run, s1], [ax + nx * run, y0, az + nz * run, s0], [ax, y1, az, s0], [bx, y1, bz, s1]];
        for (const i of [0, 1, 2, 0, 2, 3]) { const v = V[i]; push(v[0], v[1], v[2], v[3], N); }
        // convex corner: the two offset slopes fan apart, so close the gap with a wedge (hidden under the other slopes on concave corners)
        if (run > 0 && have && Math.hypot(pnx - nx, pnz - nz) > 1e-3) {
          let A = [ax + pnx * run, y0, az + pnz * run], B = [ax + nx * run, y0, az + nz * run]; const T = [ax, y1, az];
          const ux = A[0] - T[0], uy = A[1] - T[1], uz = A[2] - T[2], vx = B[0] - T[0], vy = B[1] - T[1], vz = B[2] - T[2];
          let cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
          if (cy < 0) { [A, B] = [B, A]; cx = -cx; cy = -cy; cz = -cz; }
          const cl = Math.hypot(cx, cy, cz) || 1, WN = [cx / cl, cy / cl, cz / cl];
          push(T[0], T[1], T[2], s0, WN); push(A[0], A[1], A[2], s0, WN); push(B[0], B[1], B[2], s0, WN);
        }
        pnx = nx; pnz = nz; have = true;
      }
      o += n;
    }
    const m = new THREE.Mesh(gb.build(), matGround); m.receiveShadow = true; m.name = 'walls-' + key; root.add(m);
  };
  wallLines('kerb', 0, CH, LY.KERB, 6);

  // no lane markings: the reference game uses plain asphalt (MARKS in openlayout.js still has the straight bands if they come back)

  // water: one plane at the swim level under everything (land is higher), vertical sea walls wherever land meets water,
  // and the two exit roads as causeways running on to the horizon
  { const U = [[99, 0], [99, 0], [99, 0], [99, 0]], y0 = SEABED, y1 = CH;
    const wm = new THREE.Mesh(new THREE.PlaneGeometry(18000, 18000).rotateX(-Math.PI / 2), matWater);
    wm.position.y = SWIM_Y; wm.frustumCulled = false; wm.receiveShadow = true; wm.name = 'water'; root.add(wm);
    wallLines('sea', y0, y1, LY.KERB, 3, (y1 - y0) * SLOPE_RUN); // sloped shore instead of a vertical sea wall
    const rx0 = X0, rx1 = X0 + NX * CELL;
    for (const [a, b, e] of [[rx0 - 1500, rx0, EXITS.W], [rx1, rx1 + 1500, EXITS.E]]) for (let x = a; x < b; x += 300) {
      const xa = x, xb = Math.min(b, x + 300), zN = e.z - e.half, zS = e.z + e.half, gb = chunkOf((xa + xb) / 2, e.z).gnd;
      tq(xa, zN, xb, zS, LY.ASPH, W(SC[0]));
      // causeway sides slope down into the water too (top edge at road level y = 0)
      const R0 = (0 - y0) * SLOPE_RUN, q0 = Math.hypot(-y0 / R0, 1), sN = [0, 1 / q0, -(-y0 / R0) / q0], sS = [0, 1 / q0, (-y0 / R0) / q0];
      gb.quad([xb, y0, zN - R0], [xa, y0, zN - R0], [xa, 0, zN], [xb, 0, zN], sN, U, C.curb); gb.quad([xa, y0, zS + R0], [xb, y0, zS + R0], [xb, 0, zS], [xa, 0, zS], sS, U, C.curb);
    } }
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
    const ty = cellAt(x, z) === CLS.PARK ? parkTop(x, z) - 0.1 : 0; // park trees stand on the hills
    const ch = chunkOf(x, z); ch.trees.push([x, z, s, hash2(x * 7, z * 3), ty]);
    solids.cyl(x, z, ty, ty + 3.4 * s, 0.3 * s, 0.3 * s, 'trunk');
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
    ch.trees.forEach(([x, z, s, h, ty], i) => {
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h * 6.28); _s.set(s, s * (0.9 + h * 0.3), s); _p.set(x, ty, z);
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
  // shore slope (collision / swim depth): same plane as the visible slope, measured from the sea-wall polylines
  const SEA = (() => {
    const [pb, lens] = LINES.sea, P = i16(pb), HC = 16, map = new Map(), R = (CH - SEABED) * SLOPE_RUN; let o = 0;
    const key = (a, b) => (a + 4096) * 8192 + (b + 4096);
    for (const n of lens) {
      for (let k = 0; k < n - 1; k++) {
        const seg = [P[2 * (o + k)] / 16, P[2 * (o + k) + 1] / 16, P[2 * (o + k + 1)] / 16, P[2 * (o + k + 1) + 1] / 16];
        const i0 = Math.floor((Math.min(seg[0], seg[2]) - R) / HC), i1 = Math.floor((Math.max(seg[0], seg[2]) + R) / HC);
        const j0 = Math.floor((Math.min(seg[1], seg[3]) - R) / HC), j1 = Math.floor((Math.max(seg[1], seg[3]) + R) / HC);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const kk = key(i, j); let l = map.get(kk); if (!l) map.set(kk, l = []); l.push(seg); }
      }
      o += n;
    }
    return { map, HC, key };
  })();
  const seaDist = (x, z) => {
    const l = SEA.map.get(SEA.key(Math.floor(x / SEA.HC), Math.floor(z / SEA.HC))); if (!l) return Infinity;
    let best = Infinity;
    for (const [ax, az, bx, bz] of l) {
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
      const d = Math.hypot(x - (ax + t * dx), z - (az + t * dz)); if (d < best) best = d;
    }
    return best;
  };
  const slopeH = (top, d) => d >= (top - SEABED) * SLOPE_RUN ? SEABED : top - d / SLOPE_RUN;
  const terrainHeight = (x, z) => {
    const c = cellAt(x, z);
    if (c < 0) { const e = x < X0 ? EXITS.W : EXITS.E; if (Math.abs(x) >= 2600) return SEABED; const dz = Math.abs(z - e.z) - e.half; return dz < 0 ? 0 : slopeH(0, dz); }
    if (c >= CLS.AV && c <= CLS.INT) return 0;
    if (c !== CLS.OUT) return c === CLS.PARK ? parkTop(x, z) : CH;
    return slopeH(CH, seaDist(x, z));
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
      land: [...rectsOf((c) => c !== CLS.OUT).map((r) => { const [x0, z0, x1, z1] = toW(r); return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; }),
        ...[EXITS.W, EXITS.E].map((e, k) => { const a = k ? X0 + NX * CELL : X0 - 1500, b = k ? X0 + NX * CELL + 1500 : X0; return [[a, e.z - e.half], [b, e.z - e.half], [b, e.z + e.half], [a, e.z + e.half]]; })],
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
    raycast, groundHeight, surfaceAt, spawn, viewpoints, streetsAt, swimY: SWIM_Y,
    getZipPoints: (center, radius, kinds) => finZ.query(center, radius, kinds),
    bridgeLimit: null, bridgeDeckY: undefined, propAnchors: () => [], grabbables: () => [], grabProp: () => undefined, releaseProp: () => undefined,
    collision: grid, geoDebug, buildings: boxes, footprints, getMapFeatures: mapFeatures, textures: {}, materials: { facade: matFacade, glass: matGlass },
    update(dt, camera) {
      time += dt; waterU.uWT.value = time;
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
