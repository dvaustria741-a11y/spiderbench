// Open City: a big, light world (few buildings, wide gaps, few trees, a handful of draw calls). Same contract as
// city.js: buildCity({scene, renderer}) -> Promise<world>. Layout data lives in openmap.js.
// Everything visible is merged into per-chunk meshes (400 m chunks) so culling is cheap; collision uses the same
// Solids / CollisionGrid / ZipPoints as the Manhattan map, so swinging, wall-running, zipping and combat behave the same.
import * as THREE from 'three';
import { G, avenues, streets, blocks, generateLots, streetsAt, hash2, mulberry32, KINDS, NCOL, NROW, inPark } from './openmap.js';
import { Solids, CollisionGrid, makeQueries, collisionDebugLines } from './collision.js';
import { ZipPoints, createGeoDebug } from './zippoints.js';
import { attachLife } from './npc/life.js';
import { nightK } from '../render/daynight.js';
import { readGfx } from '../render/gfxprefs.js';

const CHUNK = 400;
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

  const tx = { punched: makeWindowTextures(false), glass: makeWindowTextures(true) };
  const matFacade = new THREE.MeshStandardMaterial({ map: tx.punched.map, emissiveMap: tx.punched.emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 0.88, metalness: 0 });
  const matGlass = new THREE.MeshStandardMaterial({ map: tx.glass.map, emissiveMap: tx.glass.emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 0.32, metalness: 0.15 });
  const matGround = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const matPaint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

  // chunk store: one set of builders per 400 m cell
  const chunks = new Map();
  const chunkOf = (x, z) => {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), k = cx * 1000 + cz;
    let c = chunks.get(k); if (!c) chunks.set(k, c = { cx, cz, fac: new GB(), gls: new GB(), gnd: new GB(), pnt: new GB(), trees: [], meshes: [] });
    return c;
  };

  // ---------------------------------------------------------------- ground
  const C = { road: col(0x2b2d31), walk: col(0x9c9b95), curb: col(0x74736f), plaza: col(0xb9b5a8), yard: col(0x8a8c85), lot: col(0x3b3c3f), grass: col(0x4d6a38), dirt: col(0x6b6a5c), yellow: col(0xd9b43a), white: col(0xe8e8e2) };
  const flat = (gb, x0, z0, x1, z1, y, color) => gb.horiz(x0, z0, x1, z1, y, color);
  const AVH = G.AV_HALF, STH = G.ST_HALF, CH = G.CURB_H;
  const xMin = avenues[0], xMax = avenues[NCOL], zMin = streets[0], zMax = streets[NROW];
  // roads: per avenue row segments + intersections + street gaps; chunked by centre
  const roadRect = (x0, z0, x1, z1) => flat(chunkOf((x0 + x1) / 2, (z0 + z1) / 2).gnd, x0, z0, x1, z1, 0, C.road);
  for (const ax of avenues) for (let k = 0; k <= NROW; k++) {
    roadRect(ax - AVH, streets[k] - STH, ax + AVH, streets[k] + STH); // intersection
    if (k < NROW) roadRect(ax - AVH, streets[k] + STH, ax + AVH, streets[k + 1] - STH);
  }
  for (const sz of streets) for (let i = 0; i < NCOL; i++) roadRect(avenues[i] + AVH, sz - STH, avenues[i + 1] - AVH, sz + STH);
  { // the middle street leaves the map east and west (long road to the horizon)
    const zc = streets[NROW / 2];
    for (const [a, b] of [[xMin - AVH - 1500, xMin - AVH], [xMax + AVH, xMax + AVH + 1500]]) for (let x = a; x < b; x += 300) roadRect(x, zc - STH, Math.min(b, x + 300), zc + STH);
  }
  // blocks: sidewalk ring (4 rects, no overlap with the inner surface) raised by the kerb, then the inner property surface.
  // Nothing is stacked on top of anything coplanar-ish: stacked layers a few cm apart z-fight at distance (the 150 km far plane
  // leaves almost no depth precision), which showed the grass through the roads.
  for (const B of blocks) {
    const gb = chunkOf(B.cx, B.cz).gnd, kind = B.kind;
    flat(gb, B.x0, B.z0, B.x1, B.pz0, CH, C.walk); flat(gb, B.x0, B.pz1, B.x1, B.z1, CH, C.walk);
    flat(gb, B.x0, B.pz0, B.px0, B.pz1, CH, C.walk); flat(gb, B.px1, B.pz0, B.x1, B.pz1, CH, C.walk);
    for (const [ax, az, bx, bz, n] of [[B.x0, B.z1, B.x1, B.z1, [0, 0, -1]], [B.x1, B.z0, B.x0, B.z0, [0, 0, 1]], [B.x0, B.z0, B.x0, B.z1, [1, 0, 0]], [B.x1, B.z1, B.x1, B.z0, [-1, 0, 0]]]) {
      gb.quad([ax, 0, az], [bx, 0, bz], [bx, CH, bz], [ax, CH, az], [-n[0], 0, -n[2]], [[0, 0], [0, 0], [0, 0], [0, 0]], C.curb); // kerb face
    }
    const iy = kind === KINDS.KIND_PARK ? CH + 0.02 : CH;
    const ic = kind === KINDS.KIND_PARK ? C.grass : kind === KINDS.KIND_PLAZA ? C.plaza : kind === KINDS.KIND_LOT ? C.lot : (B.h < 0.45 ? C.yard : C.dirt);
    flat(gb, B.px0, B.pz0, B.px1, B.pz1, iy, ic);
  }
  // road paint: avenue centre (double yellow) + dashed lane lines, street centre dashes, zebra crossings
  const pq = (x0, z0, x1, z1, color) => flat(chunkOf((x0 + x1) / 2, (z0 + z1) / 2).pnt, x0, z0, x1, z1, 0.03, color);
  for (const ax of avenues) for (let k = 0; k < NROW; k++) {
    const za = streets[k] + STH + 4, zb = streets[k + 1] - STH - 4;
    pq(ax - 0.28, za, ax - 0.1, zb, C.yellow); pq(ax + 0.1, za, ax + 0.28, zb, C.yellow);
    for (const off of [-AVH * 0.36, AVH * 0.36, -AVH * 0.72, AVH * 0.72]) for (let z = za; z < zb - 3; z += 9) pq(ax + off - 0.08, z, ax + off + 0.08, z + 4, C.white);
  }
  for (const sz of streets) for (let i = 0; i < NCOL; i++) {
    const xa = avenues[i] + AVH + 4, xb = avenues[i + 1] - AVH - 4;
    for (let x = xa; x < xb - 3; x += 9) pq(x, sz - 0.1, x + 4, sz + 0.1, C.yellow);
  }
  for (const ax of avenues) for (const sz of streets) { // zebra crossings on the four sides of every junction
    for (let s = -AVH + 1; s < AVH - 0.5; s += 1.8) { pq(ax + s, sz - STH - 4, ax + s + 0.9, sz - STH - 1.8, C.white); pq(ax + s, sz + STH + 1.8, ax + s + 0.9, sz + STH + 4, C.white); }
    for (let s = -STH + 0.8; s < STH - 0.5; s += 1.8) { pq(ax - AVH - 4, sz + s, ax - AVH - 1.8, sz + s + 0.9, C.white); pq(ax + AVH + 1.8, sz + s, ax + AVH + 4, sz + s + 0.9, C.white); }
  }
  // wide outskirts: a ring AROUND the grid (never under it) so no two ground layers overlap
  { const big = new GB(), R = 9000, g = col(0x56653f), Y = -0.05, zc = streets[NROW / 2];
    const x0 = xMin - AVH, x1 = xMax + AVH, z0 = zMin - STH, z1 = zMax + STH;
    big.horiz(x0, -R, x1, z0, Y, g); big.horiz(x0, z1, x1, R, Y, g); // north / south
    for (const [a, b] of [[-R, x0], [x1, R]]) { big.horiz(a, -R, b, zc - STH, Y, g); big.horiz(a, zc + STH, b, R, Y, g); } // west / east, with a gap for the road
    const m = new THREE.Mesh(big.build(), matGround); m.receiveShadow = true; m.frustumCulled = false; m.name = 'outskirts'; root.add(m); }

  // ---------------------------------------------------------------- buildings
  const solids = new Solids(), zips = new ZipPoints();
  const boxes = [], footprints = [];
  const lots = generateLots();
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
  const inFootprint = (x, z, pad) => footprints.some(f => x > f.x0 - pad && x < f.x1 + pad && z > f.z0 - pad && z < f.z1 + pad);
  const addTree = (x, z, s) => {
    const ch = chunkOf(x, z); ch.trees.push([x, z, s, hash2(x * 7, z * 3)]);
    solids.cyl(x, z, 0, 3.4 * s, 0.3 * s, 0.3 * s, 'trunk');
  };
  for (const B of blocks) {
    const rnd = mulberry32(0x7EE + B.c * 53 + B.r * 191);
    if (B.kind === KINDS.KIND_PARK) { for (let x = B.px0 + 8; x < B.px1 - 6; x += 15) for (let z = B.pz0 + 8; z < B.pz1 - 6; z += 15) if (rnd() < 0.75) addTree(x + (rnd() - 0.5) * 9, z + (rnd() - 0.5) * 9, 0.8 + rnd() * 0.7); }
    else if (B.kind === KINDS.KIND_PLAZA) { for (let i = 0; i < 9; i++) { const x = B.px0 + 10 + rnd() * (B.px1 - B.px0 - 20), z = B.pz0 + 10 + rnd() * (B.pz1 - B.pz0 - 20); addTree(x, z, 0.8 + rnd() * 0.5); } }
    else if (B.h < 0.5) { // street trees on the two avenue sidewalks of some blocks
      for (const x of [B.x0 + G.AV_WALK * 0.5, B.x1 - G.AV_WALK * 0.5]) for (let z = B.pz0 + 12; z < B.pz1 - 8; z += 46) if (rnd() < 0.7) addTree(x, z, 0.75 + rnd() * 0.4);
    }
  }
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
    if (x < xMin - AVH - 1 || x > xMax + AVH + 1 || z < zMin - STH - 1 || z > zMax + STH + 1) {
      const zc = streets[NROW / 2]; return Math.abs(z - zc) < STH && Math.abs(x) < 2600 ? 0 : -0.05;
    }
    const t = streetsAt(x, z).type;
    if (t === 'avenue' || t === 'street' || t === 'intersection') return 0;
    return t === 'park' ? CH + 0.02 : CH;
  };
  const grid = new CollisionGrid(solids, 24);
  const finZ = zips.finalize(grid);
  const { groundHeight, raycast, surfaceAt } = makeQueries(grid, terrainHeight);
  const geoDebug = createGeoDebug(root, grid, finZ, collisionDebugLines);

  const spawn = new THREE.Vector3(0, 0, streets[NROW / 2] + STH + 4);
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

  const mapFeatures = () => ({
    bounds: { x0: xMin - 200, z0: zMin - 200, x1: xMax + 200, z1: zMax + 200 },
    land: [[[xMin - 200, zMin - 200], [xMax + 200, zMin - 200], [xMax + 200, zMax + 200], [xMin - 200, zMax + 200]]],
    farLand: [], blocks: blocks.map(b => ({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 })), buildings: footprints,
    streets: [...avenues.map(x => ({ x0: x - AVH, z0: zMin - STH, x1: x + AVH, z1: zMax + STH, kind: 'avenue' })), ...streets.map(z => ({ x0: xMin - AVH, z0: z - STH, x1: xMax + AVH, z1: z + STH, kind: 'street' }))],
    water: [], parks: blocks.filter(b => b.kind === KINDS.KIND_PARK).map(b => [[b.px0, b.pz0], [b.px1, b.pz0], [b.px1, b.pz1], [b.px0, b.pz1]]),
    parkWater: [], avenueNames: avenues.map((x, i) => ({ x, name: 'AVENUE ' + String.fromCharCode(65 + i) })), inPark,
  });

  let time = 0, nk = -1;
  const camParam = new URLSearchParams(location.search).get('cam');
  // Options > Draw Distance: chunks farther than this are not drawn at all (the haze hides the edge). Live via globalThis.__DRAW_DIST.
  const DD = { low: 500, medium: 1300, high: 2200 };
  const bootDD = (() => { try { return DD[readGfx()?.drawDist] ?? Infinity; } catch (e) { return Infinity; } })();
  const chunkList = [...chunks.values()];
  const applyDrawDist = (cam) => {
    const D = globalThis.__DRAW_DIST ?? bootDD;
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
  console.log(`[citylite] built in ${(performance.now() - t0).toFixed(0)} ms: ${lots.length} buildings (${nMass} masses), ${chunks.size} chunks, ${treeMeshes.reduce((a, m) => a + m.count, 0)} trees, ${grid.n} solids, ${finZ.count} zip points`);
  return world;
}
