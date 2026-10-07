// Options screen (Overpeak-style): a home grid of five categories (Game, Display, Graphics, Audio, Controls) and one
// page per category. Rows are either a slider (drag) or a button that cycles through its choices (tap). Used by the
// main menu and as an "Options" tab of the pause menu. Values live in the save's settings block; sys.applySettings()
// applies them. Graphics rows that need a rebuild (shadows, AO, reflections, clouds, crowd, world radius) apply after
// "Apply & Restart"; the bar at the bottom of the Graphics page appears as soon as one of them differs from what the
// game booted with. Import / Export copy the settings as JSON.
import './options.css';
import { DEFAULT_GFX, GFX_FIELDS, GFX_PRESETS, presetOf, readGfx } from '../../render/gfxprefs.js';

const pct = v => Math.round(v * 100) + '%';
const LMH = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
const DISPLAY_PRESETS = {
  default: { brightness: 0.5, contrast: 0.5, saturation: 0.5, sharpness: 0.5 },
  movie:   { brightness: 0.42, contrast: 0.64, saturation: 0.38, sharpness: 0.45 },
  vivid:   { brightness: 0.55, contrast: 0.62, saturation: 0.78, sharpness: 0.62 },
  natural: { brightness: 0.5, contrast: 0.42, saturation: 0.44, sharpness: 0.5 },
};
const EXPORT_KEYS = ['displayPreset', 'brightness', 'contrast', 'saturation', 'sharpness', 'renderScale', 'upscaler', 'frameRate', 'gfx',
  'motionBlur', 'dof', 'fovOffset', 'timeOfDay', 'daySun', 'puddles', 'masterVolume', 'musicVolume', 'sfxVolume', 'ambienceVolume', 'uiVolume',
  'mouseSensitivity', 'invertY', 'controlSize', 'hudOpacity', 'hudScale', 'minimalHud', 'subtitles', 'subtitleSize', 'showPins'];

const CATS = [
  ['game', 'Game', 'sliders', 'Gameplay, time of day, interface and help text.'],
  ['display', 'Display', 'monitor', 'Picture look: brightness, contrast, saturation, sharpness, resolution and frame rate.'],
  ['graphics', 'Graphics', 'gpu', 'Sets every graphics option in one go. Change any of them by hand and the preset turns to Custom.'],
  ['audio', 'Audio', 'speaker', 'Volume mix for music, effects, ambience and the interface.'],
  ['controls', 'Controls', 'pad', 'Look sensitivity and the size of the on-screen buttons.'],
];

export function createOptionsPanel(sys, { onClose } = {}) {
  const { save, audio } = sys;
  const S = () => save.state.settings;
  const el = document.createElement('div'); el.className = 'op-root';
  el.innerHTML = `<div class="op-head"><h1><i>O</i>PTIONS</h1><div class="op-tools"></div><button class="op-close" aria-label="Back"><svg viewBox="0 0 24 28"><path d="M3 2 L22 14 L3 26 Z" fill="#fff"/></svg></button></div>
    <div class="op-body"></div><div class="op-desc"></div><div class="op-apply"><span>Some graphics changes need a restart.</span><button class="op-btn red">Apply &amp; Restart</button></div>
    <div class="op-modal"><div class="box"><h3></h3><textarea spellcheck="false"></textarea><div class="row"><button class="op-btn go">OK</button><button class="op-btn cancel">Close</button></div></div></div>`;
  const $ = s => el.querySelector(s);
  const body = $('.op-body'), desc = $('.op-desc'), tools = $('.op-tools'), applyBar = $('.op-apply'), modal = $('.op-modal');
  let page = 'home';
  const curQ = new URLSearchParams(location.search).get('q') || 'high';
  const bootGfx = JSON.stringify(GFX_FIELDS.map(k => (readGfx() || baseGfx())[k]));

  function baseGfx() { const n = curQ === 'med' || curQ === 'medium' ? 'medium' : curQ === 'low' ? 'low' : 'high'; return { ...GFX_PRESETS[n] }; }
  const gfx = () => S().gfx || { ...baseGfx() };
  const setGfx = (k, v) => { S().gfx = { ...gfx(), [k]: v }; };
  const restartDirty = () => JSON.stringify(GFX_FIELDS.map(k => gfx()[k])) !== bootGfx;

  // ---- row definitions
  const cho = (key, label, opts, d, extra = {}) => ({ t: 'c', key, label, opts, d, ...extra });
  const sli = (key, label, min, max, step, d, fmt = pct, extra = {}) => ({ t: 's', key, label, min, max, step, d, fmt, ...extra });
  const gcho = (key, label, opts, d) => cho(key, label, opts, d, { g: true });
  const ONOFF = [['on', 'On'], ['off', 'Off']];
  const PAGES = {
    game: [
      cho('timeOfDay', 'Time of Day', [['day', 'Day'], ['morning', 'Morning'], ['sunrise', 'Sunrise'], ['sunset', 'Sunset'], ['dusk', 'Dusk'], ['night', 'Night'], ['overcast', 'Overcast']], 'Hand-tuned lighting for the whole city.'),
      cho('showFps', 'Show FPS', [[false, 'Off'], [true, 'On']], 'Frame rate, update time, render time, draw calls and memory counts in the corner. Useful for finding what is slow.'),
      cho('puddles', 'Puddles', [[true, 'On'], [false, 'Off']], 'Wet patches on the ground in dry weather.'),
      cho('crimes', 'Random Crimes', [[true, 'On'], [false, 'Off']], 'Street crimes are reported while you explore.', { crimes: true }),
      cho('showPins', 'World Markers', [[true, 'On'], [false, 'Off']], 'On-screen icons for towers, crimes and collectibles.'),
      cho('subtitles', 'Subtitles', [[true, 'On'], [false, 'Off']], 'Police scanner and dispatch chatter.'),
      sli('subtitleSize', 'Subtitle Size', 0.8, 1.6, 0.1, 'Text size of subtitles.', v => pct(v)),
      cho('minimalHud', 'Minimal HUD', [[false, 'Off'], [true, 'On']], 'Hide everything except the minimap.'),
      sli('hudScale', 'HUD Scale', 0.8, 1.25, 0.05, 'Minimap, objective, XP and notifications.'),
      { t: 'a', label: 'Reset Progress', btn: 'Reset', d: 'Erase XP, skills, suits, towers and collectibles. Settings are kept.', run(b) { if (b.dataset.armed) { save.reset(); location.reload(); return; } b.dataset.armed = '1'; b.textContent = 'Tap again to confirm'; audio.sfx.deny(); } },
    ],
    display: [
      cho('displayPreset', 'Preset', [['default', 'Default'], ['movie', 'Movie'], ['vivid', 'Vivid'], ['natural', 'Natural'], ['custom', 'Custom']], 'Ready-made looks that set brightness, contrast, saturation and sharpness together. Moving any of those sliders by hand switches this to Custom.', { preset: 'display' }),
      sli('brightness', 'Brightness', 0, 1, 0.01, 'Overall exposure of the picture.', pct, { disp: true }),
      sli('contrast', 'Contrast', 0, 1, 0.01, 'Gap between the darkest and brightest parts.', pct, { disp: true }),
      sli('saturation', 'Saturation', 0, 1, 0.01, 'How strong the colours are.', pct, { disp: true }),
      sli('sharpness', 'Sharpness', 0, 1, 0.01, 'Edge sharpening applied at the end of the frame.', pct, { disp: true }),
      sli('renderScale', 'Resolution', 0.6, 1.25, 0.05, 'Internal render resolution. Lower is faster, higher is crisper.'),
      cho('upscaler', 'Upscaler', [[false, 'Off'], [true, 'On']], 'Renders at 75% resolution and adds a sharpening pass. A cheap way to gain frames on a phone.'),
      cho('frameRate', 'Frame Rate', [['low', 'Low (30)'], ['medium', 'Medium (45)'], ['high', 'High (60)'], ['max', 'Max']], 'Caps how many frames per second are drawn. Max follows the screen refresh rate.'),
      cho('motionBlur', 'Motion Blur', [[0, 'Off'], [0.5, 'Low'], [1, 'Medium'], [1.6, 'High'], [2.4, 'Very High']], 'Speed blur, stronger the faster you move.'),
      cho('dof', 'Depth of Field', [[0, 'Off'], [1, 'On']], 'Cinematic focus blur in menus and cutscenes.'),
      sli('fovOffset', 'Field of View', -10, 20, 1, 'Base chase-camera FOV (speed widens it further).', v => Math.round(58 + v) + '°'),
    ],
    graphics: [
      cho('gfxPreset', 'Preset', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['custom', 'Custom']], 'Sets every graphics option below in one go. Change any of them by hand and the preset turns to Custom.', { preset: 'gfx' }),
      gcho('shadows', 'Shadows', LMH, 'Softness of shadow edges and whether the character casts one.'),
      gcho('shadowRes', 'Shadow Resolution', LMH, 'Detail of the shadow maps.'),
      gcho('shadowDist', 'Shadow Distance', LMH, 'How far from the camera shadows are drawn.'),
      gcho('aa', 'Anti Aliasing', [['on', 'TAA'], ['off', 'Off']], 'Temporal anti-aliasing smooths jagged edges.'),
      gcho('ao', 'Ambient Occlusion', [['off', 'Off'], ['low', 'Low'], ['high', 'High']], 'Soft contact shadows in corners and under objects.'),
      gcho('reflections', 'Reflections', [['off', 'Off'], ['low', 'Low'], ['high', 'High']], 'Screen-space reflections on glass, water and wet streets.'),
      gcho('gi', 'Global Illumination', ONOFF, 'Light bouncing between buildings.'),
      gcho('shafts', 'Light Shafts', ONOFF, 'Sun rays and city light volumes.'),
      gcho('clouds', 'Dynamic Cloud', LMH, 'Cloud detail in the sky.'),
      gcho('bloom', 'Bloom', ONOFF, 'Glow around bright lights. Applies instantly.'),
      gcho('population', 'Population Density', LMH, 'How many pedestrians fill the streets.'),
      gcho('traffic', 'Vehicle Density', [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], 'How many cars are on the road. Applies instantly.'),
      gcho('drawDist', 'Draw Distance', [['low', 'Low (0.75 km)'], ['medium', 'Medium (1.3 km)'], ['high', 'High (2.2 km)'], ['full', 'Full island']], 'How much of the city is built around the start. Smaller loads faster and uses far less memory.'),
    ],
    audio: [
      sli('masterVolume', 'Master Volume', 0, 1, 0.01, 'Everything.'), sli('musicVolume', 'Music', 0, 1, 0.01, 'Ambient score and the swing pulse.'),
      sli('sfxVolume', 'Effects', 0, 1, 0.01, 'Web thwips, landings, footsteps, combat, alarms.'), sli('ambienceVolume', 'City Ambience', 0, 1, 0.01, 'Distant horns and sirens.'),
      sli('uiVolume', 'Interface', 0, 1, 0.01, 'Menus and notifications.'),
    ],
    controls: [
      sli('mouseSensitivity', 'Sensitivity', 0.2, 3, 0.05, 'Camera look speed (touch drag, mouse and right stick).', v => v.toFixed(2) + '×'),
      cho('invertY', 'Invert Y-Axis', [[false, 'Off'], [true, 'On']], 'Flip vertical camera look.'),
      sli('controlSize', 'On-Screen Control Size', 0.7, 1.4, 0.05, 'Scales the on-screen control buttons up or down. Larger buttons are easier to hit with your thumbs.'),
      sli('hudOpacity', 'HUD Opacity', 0.2, 1, 0.05, 'How see-through the on-screen controls are.'),
    ],
  };

  const getVal = r => r.crimes ? sys.crimes.enabled : r.g ? gfx()[r.key] : r.key === 'gfxPreset' ? presetOf(gfx()) : S()[r.key] ?? (r.key === 'displayPreset' ? 'default' : undefined);
  const setDesc = t => { desc.textContent = t; };
  const pageDesc = () => (CATS.find(c => c[0] === page) || [])[3] || '';

  function afterChange(row) {
    save.markDirty(); sys.applySettings();
    if (row?.g || row?.preset === 'gfx') { const q = presetOf(gfx()); if (q !== 'custom') S().quality = q === 'medium' ? 'med' : q; }
    if (page === 'graphics') updateApply();
  }
  function setRow(row, v) {
    if (row.crimes) { sys.crimes.enable(v); S().crimesOn = v; }
    else if (row.g) setGfx(row.key, v);
    else if (row.preset === 'gfx') { if (v === 'custom') return; S().gfx = { ...GFX_PRESETS[v] }; }
    else if (row.preset === 'display') { S().displayPreset = v; if (DISPLAY_PRESETS[v]) Object.assign(S(), DISPLAY_PRESETS[v]); }
    else { S()[row.key] = v; if (row.disp) S().displayPreset = 'custom'; }
    afterChange(row);
  }

  function renderHome() {
    page = 'home'; tools.innerHTML = ''; applyBar.classList.remove('on'); setDesc('');
    body.className = 'op-body home';
    body.innerHTML = CATS.map(([k, n]) => `<button class="op-card" data-k="${k}"><span class="ic"></span><b>${n}</b></button>`).join('');
    // optional artwork: public/assets/ui/menu/opt_<name>.png, vector fallback when missing
    body.querySelectorAll('.op-card').forEach(b => {
      const c = CATS.find(x => x[0] === b.dataset.k), host = b.querySelector('.ic'), im = new Image(); im.alt = ''; im.draggable = false;
      im.src = (import.meta.env?.BASE_URL || '/') + 'assets/ui/menu/opt_' + c[0] + '.png';
      im.onerror = () => { host.innerHTML = glyph(c[2]); }; host.appendChild(im);
    });
    body.querySelectorAll('.op-card').forEach(b => { b.addEventListener('click', () => { audio.sfx.select(); renderPage(b.dataset.k); }); b.addEventListener('mouseenter', () => { audio.sfx.hover(); setDesc((CATS.find(c => c[0] === b.dataset.k) || [])[3]); }); });
  }

  function renderPage(k) {
    page = k; body.className = 'op-body list'; body.scrollTop = 0;
    tools.innerHTML = k === 'graphics' || k === 'display' ? `<button class="op-tool imp">${glyph('import')}Import</button><button class="op-tool exp">${glyph('export')}Export</button>` : '';
    tools.querySelector('.imp')?.addEventListener('click', () => openModal('import'));
    tools.querySelector('.exp')?.addEventListener('click', () => openModal('export'));
    setDesc(pageDesc());
    body.innerHTML = PAGES[k].map((r, i) => {
      if (r.t === 'a') return `<div class="op-row" data-i="${i}"><label>${r.label}</label><div class="ctl"><button class="op-pick act">${r.btn}</button></div></div>`;
      if (r.t === 's') return `<div class="op-row" data-i="${i}"><label>${r.label}</label><div class="ctl"><div class="op-slider" data-i="${i}"><i></i><span></span></div></div></div>`;
      return `<div class="op-row" data-i="${i}"><label>${r.label}</label><div class="ctl"><button class="op-pick" data-i="${i}"></button></div></div>`;
    }).join('');
    body.querySelectorAll('.op-row').forEach(rowEl => {
      const r = PAGES[k][+rowEl.dataset.i];
      rowEl.addEventListener('pointerenter', () => setDesc(r.d)); rowEl.addEventListener('pointerdown', () => setDesc(r.d));
      if (r.t === 'a') rowEl.querySelector('.act').addEventListener('click', e => r.run(e.currentTarget));
      else if (r.t === 'c') rowEl.querySelector('.op-pick').addEventListener('click', () => {
        const opts = r.preset === 'gfx' ? r.opts.filter(o => o[0] !== 'custom') : r.opts;
        const cur = String(getVal(r)); let i = opts.findIndex(o => String(o[0]) === cur);
        const n = opts[(i + 1) % opts.length]; audio.sfx.select(); setRow(r, n[0]); refreshRows();
      });
      else bindSlider(rowEl, r);
    });
    refreshRows(); updateApply();
  }

  let applyRaf = 0;
  const applySoon = row => { cancelAnimationFrame(applyRaf); applyRaf = requestAnimationFrame(() => { try { afterChange(row); } catch (e) { console.warn('[options] apply failed', e); } }); };
  function bindSlider(rowEl, r) {
    const bar = rowEl.querySelector('.op-slider'), ctl = rowEl.querySelector('.ctl'); let id = null;
    const set = e => {
      const b = bar.getBoundingClientRect(); if (!b.width) return;
      let f = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width));
      let v = r.min + f * (r.max - r.min); v = Math.round(v / r.step) * r.step; v = +v.toFixed(4);
      if (v === S()[r.key]) return;
      S()[r.key] = v; if (r.disp) S().displayPreset = 'custom'; // bar + value text update immediately...
      refreshRows(); applySoon(r); // ...the (heavier) setting is applied on the next frame, and a failure there can no longer freeze the slider
    };
    const move = e => { if (e.pointerId === id) { e.preventDefault(); set(e); } };
    const end = e => { if (e.pointerId !== id) return; id = null; removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end); audio.sfx.move(); };
    ctl.style.touchAction = 'none'; // the whole control area is the drag target
    ctl.addEventListener('pointerdown', e => { if (id !== null) return; id = e.pointerId; e.preventDefault(); addEventListener('pointermove', move, { passive: false }); addEventListener('pointerup', end); addEventListener('pointercancel', end); set(e); });
  }

  function refreshRows() {
    if (page === 'home') return;
    body.querySelectorAll('.op-row').forEach(rowEl => {
      const r = PAGES[page][+rowEl.dataset.i];
      if (r.t === 'c') { const cur = String(getVal(r)); const o = r.opts.find(o => String(o[0]) === cur); rowEl.querySelector('.op-pick').textContent = o ? o[1] : (r.opts.find(o => o[0] === 'custom') || [0, 'Custom'])[1]; }
      else if (r.t === 's') { const v = +(S()[r.key] ?? r.min); const f = (v - r.min) / (r.max - r.min); rowEl.querySelector('.op-slider i').style.width = (f * 100) + '%'; rowEl.querySelector('.op-slider span').textContent = r.fmt(v); }
    });
  }
  const updateApply = () => applyBar.classList.toggle('on', page === 'graphics' && restartDirty());
  applyBar.querySelector('button').addEventListener('click', () => { save.flush(); const u = new URL(location.href); if (S().quality && S().quality !== 'high') u.searchParams.set('q', S().quality); else u.searchParams.delete('q'); location.href = u.toString(); });

  // ---- import / export
  function snapshot() { const o = {}; for (const k of EXPORT_KEYS) if (S()[k] !== undefined) o[k] = S()[k]; return JSON.stringify({ spiderbench: 1, settings: o }); }
  function openModal(kind) {
    const ta = modal.querySelector('textarea'), go = modal.querySelector('.go');
    modal.querySelector('h3').textContent = kind === 'export' ? 'Export settings' : 'Import settings';
    ta.value = kind === 'export' ? snapshot() : ''; ta.placeholder = 'Paste exported settings here'; ta.readOnly = kind === 'export';
    go.textContent = kind === 'export' ? 'Copy' : 'Import';
    modal.classList.add('on');
    go.onclick = async () => {
      if (kind === 'export') { try { await navigator.clipboard.writeText(ta.value); go.textContent = 'Copied'; } catch { ta.select(); go.textContent = 'Select all and copy'; } return; }
      try {
        const j = JSON.parse(ta.value); const src = j.settings || j; let n = 0;
        for (const k of EXPORT_KEYS) if (k in src && typeof src[k] === typeof (k === 'gfx' ? {} : S()[k] ?? src[k])) { S()[k] = src[k]; n++; }
        if (S().gfx) { const q = presetOf({ ...DEFAULT_GFX, ...S().gfx }); S().gfx = { ...DEFAULT_GFX, ...S().gfx }; if (q !== 'custom') S().quality = q === 'medium' ? 'med' : q; }
        sys.crimes && S().crimesOn === false && sys.crimes.enable(false);
        save.markDirty(); sys.applySettings(); modal.classList.remove('on'); renderPage(page); audio.sfx.select();
      } catch { go.textContent = 'Not valid settings'; setTimeout(() => { go.textContent = 'Import'; }, 1500); }
    };
  }
  modal.querySelector('.cancel').addEventListener('click', () => modal.classList.remove('on'));

  function back() { if (modal.classList.contains('on')) { modal.classList.remove('on'); return true; } if (page !== 'home') { audio.sfx.close?.(); renderHome(); return true; } return false; }
  $('.op-close').addEventListener('click', () => { if (!back()) onClose?.(); });
  renderHome();
  return { el, back, show() { renderHome(); }, reset: renderHome, get page() { return page; } };
}

function glyph(n) {
  const g = {
    sliders: '<svg viewBox="0 0 64 64"><g stroke="#fff" stroke-width="5" stroke-linecap="round"><path d="M10 16h44M10 32h44M10 48h44"/></g><g fill="#f00"><circle cx="22" cy="16" r="7"/><circle cx="42" cy="32" r="7"/><circle cx="28" cy="48" r="7"/></g></svg>',
    monitor: '<svg viewBox="0 0 64 64"><rect x="6" y="9" width="52" height="36" rx="3" fill="#fff"/><rect x="12" y="15" width="40" height="24" fill="#f00"/><path d="M24 55h16M32 45v10" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>',
    gpu: '<svg viewBox="0 0 64 64"><rect x="8" y="16" width="50" height="30" rx="3" fill="#fff"/><g fill="#f00"><circle cx="24" cy="31" r="9"/><circle cx="43" cy="31" r="9"/></g><g fill="#fff"><circle cx="24" cy="31" r="3"/><circle cx="43" cy="31" r="3"/></g><path d="M14 46v6M24 46v6M34 46v6M44 46v6" stroke="#f00" stroke-width="3"/></svg>',
    speaker: '<svg viewBox="0 0 64 64"><path d="M8 26h12l16-14v40L20 38H8z" fill="#fff"/><path d="M44 22q10 10 0 20M50 14q16 18 0 36" stroke="#f00" stroke-width="5" fill="none" stroke-linecap="round"/></svg>',
    pad: '<svg viewBox="0 0 64 64"><path d="M16 20h32q10 0 12 14l2 12q1 8-7 8-6 0-9-6H18q-3 6-9 6-8 0-7-8l2-12q2-14 12-14z" fill="#fff"/><path d="M20 28v10M15 33h10" stroke="#f00" stroke-width="4"/><circle cx="43" cy="30" r="3" fill="#f00"/><circle cx="49" cy="36" r="3" fill="#f00"/></svg>',
    import: '<svg viewBox="0 0 24 24"><path d="M12 3v11m-5-5 5 5 5-5M4 19h16" stroke="#888" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    export: '<svg viewBox="0 0 24 24"><path d="M12 15V4m-5 5 5-5 5 5M4 19h16" stroke="#888" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  return g[n] || '';
}
