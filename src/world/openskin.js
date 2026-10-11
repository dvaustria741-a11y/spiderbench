// OWNER: perf / open map. Cheap Manhattan-asset "skin" for the Open City (citylite.js): the flat vertex-coloured materials keep
// their palette and only gain surface DETAIL (luminance ratio tex / average-of-tex), so brightness / hue do not change.
//   ground: 12 low-res tiles (asphalt, road markings, sidewalk, grass, dirt, pavers, water, concrete) in /assets/city/open/ground_tiles.png
//   roofs : gravel / membrane / concrete / patched (roof_col.png tiles, 256 px)
//   trees : leaves.png grain on crowns and trunks
// One array-texture fetch per pixel (ground, roofs) -> practically free on Low. ?noskin disables everything.
import * as THREE from 'three';
import { loadImageRetry } from './textures.js';

const BASE = '/assets/city/open/';
const lum = (d, i) => (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;

async function strip(name, layers) {
  const im = await loadImageRetry(BASE + name);
  const w = im.width, h = Math.round(im.height / layers);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h * layers;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0);
  const data = new Uint8Array(cx.getImageData(0, 0, w, h * layers).data), avg = [];
  for (let L = 0; L < layers; L++) { let s = 0, n = 0; for (let i = L * w * h * 4; i < (L + 1) * w * h * 4; i += 16) { s += lum(data, i); n++; } avg.push(Math.max(0.05, s / n)); }
  const t = new THREE.DataArrayTexture(data, w, h, layers);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.needsUpdate = true;
  return { tex: t, avg };
}

export async function loadOpenSkin() {
  if (typeof document === 'undefined' || new URLSearchParams(location.search).has('noskin')) return null;
  try {
    const [ground, roof, leafIm] = await Promise.all([strip('ground_tiles.png', 12), strip('roof.webp', 4), loadImageRetry(BASE + 'leaf.webp')]);
    ground.tex.colorSpace = THREE.SRGBColorSpace; ground.tex.anisotropy = 8; ground.tex.needsUpdate = true;
    const cv = document.createElement('canvas'); cv.width = leafIm.width; cv.height = leafIm.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(leafIm, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data; let s = 0, n = 0; for (let i = 0; i < d.length; i += 16) { s += lum(d, i); n++; }
    const leaf = new THREE.CanvasTexture(cv); leaf.wrapS = leaf.wrapT = THREE.RepeatWrapping; leaf.anisotropy = 2;
    return { ground, roof, leaf, leafAvg: Math.max(0.05, s / n) };
  } catch (e) { console.warn('[citylite] open skin textures unavailable', e); return null; }
}

// ground: 12 hand-made tiles in a 128 px array texture (ground_tiles.png). Layer ids (vertex uv.x):
//   0 asphalt, 1 double yellow, 2 dashed white, 3 zebra, 4 stop line, 5 sidewalk, 6 kerb strip, 7 grass, 8 dirt, 9 pavers, 10 water, 11 concrete, 99 = untextured (flat vertex colour)
// The tile coordinates are baked per vertex into the vertex colour (r, g) by citylite.js, so every surface chooses its own scale / orientation.
export function skinGround(mat, skin) {
  if (!skin) return;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGT = { value: skin.ground.tex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSurf; varying float vUpN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = uv.x; vUpN = normal.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray uGT; varying float vSurf; varying float vUpN;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  if (vSurf < 50.0) {
    float L = floor(vSurf + 0.5);
    vec3 tc = texture(uGT, vec3(vColor.xy, L)).rgb;
    if (L > 6.5 && L < 7.5) { // grass: steep slopes of the park mounds wear through to dirt
      float sl = smoothstep(0.9985, 0.991, vUpN);
      if (sl > 0.0) tc = mix(tc, texture(uGT, vec3(vColor.xy * 0.83 + 0.31, 8.0)).rgb, sl);
    }
    diffuseColor.rgb = tc;
  }`);
  };
  mat.customProgramCacheKey = () => 'openSkinGround3';
}

// roofs: every upward-facing face of the facade / glass materials; one of 4 roof types per 48 m cell
export function skinRoof(mat, skin) {
  if (!skin) return;
  const a = skin.roof.avg;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRT = { value: skin.roof.tex };
    sh.uniforms.uRAvg = { value: new THREE.Vector4(a[0], a[1], a[2], a[3]) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRUp; varying vec2 vRP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRUp = normal.y; vRP = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray uRT; uniform vec4 uRAvg; varying float vRUp; varying vec2 vRP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  if (vRUp > 0.9) {
    vec2 cell = floor(vRP / 48.0);
    float li = floor(fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453) * 4.0);
    float av = li < 0.5 ? uRAvg.x : (li < 1.5 ? uRAvg.y : (li < 2.5 ? uRAvg.z : uRAvg.w));
    vec3 rt = texture(uRT, vec3(vRP * 0.2, li)).rgb;
    diffuseColor.rgb *= clamp(dot(rt, vec3(0.299, 0.587, 0.114)) / av, 0.5, 1.7);
  }`);
  };
  mat.customProgramCacheKey = () => 'openSkinRoof';
}

// trees: leaf grain from object-space position (works for instanced meshes, no UVs needed)
export function skinTree(mat, skin) {
  if (!skin) return;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLeaf = { value: skin.leaf }; sh.uniforms.uLeafAvg = { value: skin.leafAvg };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position.xz * 0.42 + position.y * 0.37;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uLeaf; uniform float uLeafAvg; varying vec2 vLP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb *= clamp(dot(texture(uLeaf, vLP).rgb, vec3(0.299, 0.587, 0.114)) / uLeafAvg, 0.6, 1.5);`);
  };
  mat.customProgramCacheKey = () => 'openSkinTree';
}
