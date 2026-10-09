// Graphics options shared by the boot code (quality.js, crowd.js, index.html) and the Options screen.
// The Options screen stores them in the save's settings block (settings.gfx). Everything that needs a rebuild
// (shadow maps, AO, SSR, clouds, crowd size, world radius) is read here at boot straight from localStorage, so the
// change takes effect after "Apply" (reload). Live options (bloom, motion blur, DoF, traffic) bypass this file.
export const SAVE_KEY = 'spiderbench.save.v1';

export const GFX_FIELDS = ['shadows', 'shadowRes', 'shadowDist', 'aa', 'ao', 'reflections', 'gi', 'shafts', 'clouds', 'population', 'drawDist'];
export const LIVE_FIELDS = ['bloom', 'traffic', 'lod'];
export const LOD_NEAR = { low: 100, medium: 240, high: 650 }; // metres: beyond this, buildings are drawn as simple blocks

// per-preset values for every field (Low / Medium / High); a settings.gfx that matches none of them is "Custom"
export const GFX_PRESETS = {
  low:    { shadows: 'off',    shadowRes: 'low',    shadowDist: 'low',    aa: 'off', ao: 'off',  reflections: 'off',  gi: 'off', shafts: 'off', clouds: 'low',    population: 'low',    drawDist: 'low', lod: 'low',    bloom: 'on', traffic: 'low' },
  medium: { shadows: 'medium', shadowRes: 'medium', shadowDist: 'medium', aa: 'on', ao: 'low',  reflections: 'low',  gi: 'on',  shafts: 'on',  clouds: 'medium', population: 'medium', drawDist: 'medium', lod: 'medium', bloom: 'on', traffic: 'medium' },
  high:   { shadows: 'high',   shadowRes: 'high',   shadowDist: 'high',   aa: 'on', ao: 'high', reflections: 'high', gi: 'on',  shafts: 'on',  clouds: 'high',   population: 'high',   drawDist: 'full', lod: 'high',   bloom: 'on', traffic: 'high' },
};
export const DEFAULT_GFX = { ...GFX_PRESETS.high };

const SHADOW_DIST = {
  low:    { cascades: 2, shadowFar: 300,  splits: [0.1, 30, 300] },
  medium: { cascades: 3, shadowFar: 900,  splits: [0.1, 18, 90, 900] },
  high:   { cascades: 5, shadowFar: 3000, splits: [0.1, 14, 50, 200, 800, 3000] },
};
export const POP_SCALE = { off: 0.001, low: 0.35, medium: 0.8, high: 1 };
export const LITE_RADIUS = { low: 500, medium: 1300, high: 2200, full: 0 }; // metres around the spawn; 0 = whole island

export function readSettings() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return s && s.settings ? s.settings : {}; } catch { return {}; }
}
export function readGfx() {
  const g = readSettings().gfx;
  return g && typeof g === 'object' ? g : null; // null = never touched: the old URL / preset behaviour stays exactly as it was
}
export function presetOf(g) {
  for (const [name, p] of Object.entries(GFX_PRESETS)) if (GFX_FIELDS.concat(LIVE_FIELDS).every(k => g[k] === p[k])) return name;
  return 'custom';
}

/** apply the saved overrides on top of a quality preset object (mutates and returns q) */
export function applyGfxToQuality(q, g) {
  if (!g) return q;
  const pick = (map, v) => map[v] ?? null;
  const sd = pick(SHADOW_DIST, g.shadowDist); if (sd) Object.assign(q, { cascades: sd.cascades, shadowFar: sd.shadowFar, splits: sd.splits.slice() });
  q.shadowMapSize = { low: 512, medium: 1024, high: 2048 }[g.shadowRes] ?? q.shadowMapSize;
  const sh = { off: [1, 0], low: [5, 0], medium: [8, 1024], high: [10, 2048], ultra: [14, 2048] }[g.shadows]; if (sh) { q.shadowTaps = sh[0]; q.charShadow = sh[1]; }
  q.shadowsOn = g.shadows !== 'off'; // Off: no shadow passes at all (lighting.js turns the shadow map off)
  if (g.aa) q.taa = g.aa !== 'off';
  if (g.ao === 'off') q.ao = false;
  else if (g.ao === 'low') Object.assign(q, { ao: true, aoHalfRes: true, aoQuality: 'Low' });
  else if (g.ao === 'high') Object.assign(q, { ao: true, aoHalfRes: false, aoQuality: 'Medium' });
  if (g.reflections === 'off') q.ssr = false;
  else if (g.reflections) Object.assign(q, { ssr: true, ssrSteps: g.reflections === 'low' ? 14 : 28 });
  if (g.gi) { q.ssgi = g.gi !== 'off'; if (q.ssgi) { q.ssgiDirs = q.ssgiDirs || 4; q.ssgiSteps = q.ssgiSteps || 4; } }
  if (g.shafts) { q.shafts = g.shafts !== 'off'; if (q.shafts) q.shaftSteps = q.shaftSteps || 12; }
  const cl = { low: [10, 2], medium: [16, 3], high: [22, 3] }[g.clouds]; if (cl) { q.cloudSteps = cl[0]; q.cloudLightSteps = cl[1]; }
  return q;
}
