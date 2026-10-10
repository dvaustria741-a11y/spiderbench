// OWNER: perf / open map. Cheap Manhattan-asset "skin" for the Open City (citylite.js): the flat vertex-coloured materials keep
// their palette and only gain surface DETAIL (luminance ratio tex / average-of-tex), so brightness / hue do not change.
//   ground: asphalt / sidewalk / grass (public/assets/city/tex/*, shrunk to 512 px in /assets/city/open/ground.webp)
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
    const [ground, roof, leafIm] = await Promise.all([strip('ground.webp', 3), strip('roof.webp', 4), loadImageRetry(BASE + 'leaf.webp')]);
    const cv = document.createElement('canvas'); cv.width = leafIm.width; cv.height = leafIm.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(leafIm, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data; let s = 0, n = 0; for (let i = 0; i < d.length; i += 16) { s += lum(d, i); n++; }
    const leaf = new THREE.CanvasTexture(cv); leaf.wrapS = leaf.wrapT = THREE.RepeatWrapping; leaf.anisotropy = 2;
    return { ground, roof, leaf, leafAvg: Math.max(0.05, s / n) };
  } catch (e) { console.warn('[citylite] open skin textures unavailable', e); return null; }
}

// ground: vertex uv.x carries the surface id (0 asphalt, 1 sidewalk, 2 grass, >= 3 none: kerb faces); planar world-xz mapping
export function skinGround(mat, skin) {
  if (!skin) return;
  const a = skin.ground.avg;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGT = { value: skin.ground.tex };
    sh.uniforms.uGAvg = { value: new THREE.Vector3(a[0], a[1], a[2]) };
    sh.uniforms.uGScale = { value: new THREE.Vector3(1 / 14, 1 / 6, 1 / 9) }; // texture repeats per metre: asphalt 14 m, sidewalk 6 m, grass 9 m
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vSurf; varying vec2 vGP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = uv.x; vGP = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray uGT; uniform vec3 uGAvg; uniform vec3 uGScale; varying float vSurf; varying vec2 vGP;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  if (vSurf < 2.5) {
    float li = floor(vSurf + 0.5);
    float sc = li < 0.5 ? uGScale.x : (li < 1.5 ? uGScale.y : uGScale.z);
    float av = li < 0.5 ? uGAvg.x : (li < 1.5 ? uGAvg.y : uGAvg.z);
    vec3 gt = texture(uGT, vec3(vGP * sc, li)).rgb;
    diffuseColor.rgb *= clamp(dot(gt, vec3(0.299, 0.587, 0.114)) / av, 0.5, 1.7);
  }`);
  };
  mat.customProgramCacheKey = () => 'openSkinGround';
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
