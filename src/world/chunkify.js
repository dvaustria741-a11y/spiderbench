// (perf) Low preset, Manhattan map: several big city-wide static meshes (road markings, tree pits, roof clutter ...) are ONE
// draw each, so the GPU draws the whole island even when only a few hundred metres are on screen (4.4M triangles on a
// phone). This splits every such mesh into ~200 m cells that SHARE the original vertex buffers (only a new index buffer
// per cell), so three's frustum culling drops the cells behind you and update() hides the ones past the Draw Distance.
import * as THREE from 'three';

const CELL = 200, MIN_TRIS = 25000, MIN_SIZE = 500;

export function chunkifyCity(root, { shadowsOn = false } = {}) {
  const jobs = [];
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material)) return;
    if (/^(facade|detail)/.test(o.name) || o.userData.noChunk) return; // per-tile meshes are already culled by city.js
    const g = o.geometry; if (!g?.attributes?.position || g.groups.length > 1) return;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (tris < MIN_TRIS) return;
    g.computeBoundingBox(); const s = g.boundingBox.getSize(new THREE.Vector3());
    if (Math.max(s.x, s.z) < MIN_SIZE) return;
    jobs.push(o);
  });
  const cells = []; let from = 0, to = 0;
  const v = new THREE.Vector3(), box = new THREE.Box3();
  for (const m of jobs) {
    const g = m.geometry, pos = g.attributes.position, idx = g.index ? g.index.array : null;
    const n = (idx ? idx.length : pos.count) / 3, buckets = new Map();
    m.updateWorldMatrix(true, false);
    for (let t = 0; t < n; t++) {
      const a = idx ? idx[t * 3] : t * 3;
      v.fromBufferAttribute(pos, a).applyMatrix4(m.matrixWorld);
      const k = Math.floor(v.x / CELL) + ',' + Math.floor(v.z / CELL);
      let b = buckets.get(k); if (!b) buckets.set(k, b = []); b.push(t);
    }
    for (const tl of buckets.values()) {
      const arr = new Uint32Array(tl.length * 3); box.makeEmpty();
      for (let i = 0; i < tl.length; i++) for (let j = 0; j < 3; j++) {
        const vi = idx ? idx[tl[i] * 3 + j] : tl[i] * 3 + j; arr[i * 3 + j] = vi;
        box.expandByPoint(v.fromBufferAttribute(pos, vi));
      }
      const cg = new THREE.BufferGeometry();
      for (const k of Object.keys(g.attributes)) cg.setAttribute(k, g.attributes[k]); // shared GPU buffers
      cg.setIndex(new THREE.BufferAttribute(arr, 1));
      cg.boundingBox = box.clone(); cg.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      const c = new THREE.Mesh(cg, m.material);
      c.name = m.name; c.userData = { ...m.userData }; c.renderOrder = m.renderOrder; c.castShadow = m.castShadow; c.receiveShadow = m.receiveShadow;
      c.matrixAutoUpdate = false; c.matrix.copy(m.matrix); c.matrixWorld.copy(m.matrixWorld);
      m.parent.add(c);
      const wb = cg.boundingBox.clone().applyMatrix4(m.matrixWorld), ctr = wb.getCenter(new THREE.Vector3());
      cells.push({ mesh: c, x: ctr.x, z: ctr.z, r: Math.hypot(wb.max.x - wb.min.x, wb.max.z - wb.min.z) / 2 });
    }
    m.parent.remove(m); // geometry is NOT disposed: the cells share its buffers
    from += n; to += buckets.size;
  }
  console.log(`[chunkify] ${jobs.length} city-wide meshes (${Math.round(from / 1000)}k tris) -> ${cells.length} cells`);
  return {
    count: cells.length,
    update(cam) {
      const D = shadowsOn ? Infinity : (globalThis.__DRAW_DIST ?? Infinity), cx = cam.position.x, cz = cam.position.z;
      for (const c of cells) { const vis = Math.hypot(c.x - cx, c.z - cz) - c.r < D; if (c.mesh.visible !== vis) c.mesh.visible = vis; }
    },
  };
}
