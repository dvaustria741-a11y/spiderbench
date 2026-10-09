// Main menu (title screen), shown once after loading: the live 3D hero slowly turning on the left, big PLAY /
// Profile / Options squares on the right, logo at the bottom. All artwork is optional: every icon and the logo load
// from public/assets/ui/menu/<name>.png and fall back to built-in vector art when the file is missing.
// ?nomenu skips it. Play hands the game back to flow mode 'play'.
import * as THREE from 'three';
import { createOptionsPanel } from './options.js';
import './options.css';

const BASE = (import.meta.env?.BASE_URL || '/') + 'assets/ui/menu/';
const FB = {
  play: '<svg viewBox="0 0 64 64"><path d="M16 8 L56 32 L16 56 Z" fill="#fff"/></svg>',
  profile: '<svg viewBox="0 0 64 64"><g fill="#f00"><circle cx="14" cy="26" r="9"/><circle cx="50" cy="26" r="9"/></g><circle cx="32" cy="22" r="11" fill="#fff"/><path d="M12 56q0-20 20-20t20 20z" fill="#fff"/></svg>',
  options: '<svg viewBox="0 0 64 64"><path d="M26 6h12l2 8 6 3 8-4 6 10-6 6v6l6 6-6 10-8-4-6 3-2 8H26l-2-8-6-3-8 4-6-10 6-6v-6l-6-6 6-10 8 4 6-3z" transform="translate(-4 4) scale(.82)" fill="#fff"/><circle cx="28" cy="34" r="8" fill="#555"/><g transform="translate(40 8)"><circle cx="8" cy="8" r="8" fill="#f00"/><circle cx="8" cy="8" r="3" fill="#555"/></g></svg>',
  photo: '<svg viewBox="0 0 64 64"><rect x="6" y="16" width="52" height="38" rx="6" fill="#fff"/><path d="M22 16l4-8h12l4 8z" fill="#fff"/><circle cx="32" cy="35" r="12" fill="#f00"/><circle cx="32" cy="35" r="6" fill="#fff"/></svg>',
  news: '<svg viewBox="0 0 64 64"><rect x="10" y="8" width="38" height="48" rx="4" fill="#fff"/><path d="M48 18h8v32q0 6-6 6" fill="none" stroke="#fff" stroke-width="5"/><path d="M18 20h22M18 30h22M18 40h14" stroke="#f00" stroke-width="4"/></svg>',
  user: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#e8e8e8"/><circle cx="32" cy="25" r="9" fill="#888"/><path d="M14 52q2-16 18-16t18 16z" fill="#888"/></svg>',
};

export function createMainMenu(sys, ctx) {
  const { ui, flow, save, audio } = sys;
  const el = document.createElement('div'); el.className = 'mm';
  el.innerHTML = `<div class="tl"><button class="ico" data-a="suits" aria-label="Suits"></button><button class="ico" data-a="photo" aria-label="Photo mode"></button></div>
    <div class="tr"><div class="chip"><span class="av"></span><span><b class="who">Guest</b><small class="sub"></small></span></div><button class="ico" data-a="news" aria-label="About"></button></div>
    <div class="acts"><button class="sq" data-a="profile" aria-label="Profile"></button><button class="sq big" data-a="play" aria-label="Play"></button><button class="sq" data-a="options" aria-label="Options"><i class="badge"></i></button></div>
    <div class="logo"></div><div class="opts"></div><div class="info"><div class="box"></div></div>`;
  ui.root.appendChild(el);
  const $ = s => el.querySelector(s);
  const art = (host, name) => { // png from public/assets/ui/menu, vector fallback
    const im = new Image(); im.alt = ''; im.draggable = false; im.src = BASE + name + '.png';
    im.onerror = () => { const d = document.createElement('div'); d.innerHTML = FB[name] || ''; im.replaceWith(d.firstElementChild || d); };
    host.appendChild(im);
  };
  art($('[data-a=suits]'), 'profile'); art($('[data-a=photo]'), 'photo'); art($('[data-a=news]'), 'news');
  art($('[data-a=profile]'), 'profile'); art($('[data-a=play]'), 'play'); art($('[data-a=options]'), 'options'); art($('.chip .av'), 'user');
  { const lg = $('.logo'); const im = new Image(); im.alt = 'Spiderbench'; im.src = BASE + 'logo.png'; im.onerror = () => { lg.innerHTML = '<b>SPIDERBENCH<i>.</i></b>'; }; lg.appendChild(im); }

  // ---- options (full-screen panel inside the menu)
  const optsHost = $('.opts');
  const options = createOptionsPanel(sys, { onClose: closeOptions });
  optsHost.appendChild(options.el);
  // Suits straight from the title screen: the same page as the pause menu's Suits tab, with the other tabs hidden
  let returnToMenu = false;
  function openSuits() {
    if (!active) return; audio.sfx.select(); returnToMenu = true; active = false; el.classList.remove('on');
    sys.pause.el.classList.add('from-main'); sys.pause.show('suits');
  }
  sys.events.on('pause:closed', () => { if (!returnToMenu) return; returnToMenu = false; sys.pause.el.classList.remove('from-main'); show(); });
  function openOptions() { audio.sfx.select(); options.show(); optsHost.classList.add('on'); ctx.menuStill = true; }
  function closeOptions() { optsHost.classList.remove('on'); ctx.menuStill = false; ctx.pipeline.resetHistory?.(); audio.sfx.close?.(); }

  // ---- info modals
  const info = $('.info'), box = info.querySelector('.box');
  const modal = html => { box.innerHTML = html + '<button class="op-btn red">Close</button>'; info.classList.add('on'); box.querySelector('button').onclick = () => info.classList.remove('on'); };
  const fmtTime = s => { s = Math.floor(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h} h ${m} min` : `${m} min`; };
  function profile() {
    const st = save.state, p = sys.prog;
    modal(`<h3>Profile</h3><p>Level ${p.level} · ${p.xp} / ${p.need} XP · ${p.skillPoints} skill point(s)</p>
      <p>Crimes stopped: ${st.crimes?.stopped ?? 0}<br>Towers activated: ${st.towers?.length ?? 0}<br>Time played: ${fmtTime(st.playTime)}</p>
      <p>${save.persistent ? 'Progress saves automatically on this device.' : 'Test session: progress is not saved.'}</p>`);
  }
  function about() {
    modal(`<h3>Spiderbench</h3><p>A non-commercial browser and Android fan project and technical demo. Not affiliated with or endorsed by Marvel, Disney, Sony or Insomniac Games. Not for sale or redistribution.</p>
      <p>Tip: Options &gt; Graphics &gt; Draw Distance and Display &gt; Upscaler / Frame Rate are the quickest ways to gain frames on a phone.</p>`);
  }

  // ---- hero camera (the live character, front-on, turning slowly; the camera keeps clear of walls)
  const _c = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3();
  let yaw = 0, dist = 3.2, camSave = null, active = false, dragX = null, cityNode = null, hidden = [];
  function cameraHook(dt) {
    const cam = ctx.camera, P = ctx.player;
    yaw += dt * (dragX == null ? 0.1 : 0);
    _c.copy(P.position); _c.y += 0.9;
    const want = 4.1;
    _d.set(Math.sin(yaw), 0.1, Math.cos(yaw)).normalize();
    dist += (want - dist) * (1 - Math.exp(-6 * dt));
    cam.position.copy(_c).addScaledVector(_d, dist);
    _f.copy(_c).sub(cam.position).setY(0).normalize(); _r.set(-_f.z, 0, _f.x);
    _t.copy(_c).addScaledVector(_r, 1.35); _t.y -= 0.02; // look right of the hero so he sits in the left third of the screen
    cam.up.set(0, 1, 0); cam.lookAt(_t);
    if (cam.fov !== 40) { cam.fov = 40; cam.updateProjectionMatrix(); }
    ctx.pipeline.setDof?.({ aperture: 0 }); ctx.pipeline.setMotionBlur?.(0);
  }
  el.addEventListener('pointerdown', e => { if (e.target === el) dragX = e.clientX; });
  addEventListener('pointermove', e => { if (dragX != null) { yaw -= (e.clientX - dragX) * 0.008; dragX = e.clientX; } });
  addEventListener('pointerup', () => { dragX = null; });

  function show() {
    if (active) return; active = true;
    camSave = { p: ctx.camera.position.clone(), q: ctx.camera.quaternion.clone(), fov: ctx.camera.fov };
    const P = ctx.player.position, c = ctx.camera.position; yaw = Math.atan2(c.x - P.x, c.z - P.z) + Math.PI + 0.5; // start on the side opposite the chase camera
    const sub = $('.sub'); sub.textContent = `Level ${sys.prog.level} · ${save.persistent ? 'Local save' : 'Test session'}`;
    flow.setMode('menu'); flow.setCameraHook(cameraHook); ui.setVisible(false);
    cityNode = ctx.scene.getObjectByName('city'); if (cityNode) cityNode.visible = false; // the title screen only needs the hero + sky: no city draw calls
    hidden = ['systems-markers'].map(n => ctx.scene.getObjectByName(n)).filter(o => o && o.visible); for (const o of hidden) o.visible = false; // tower / collectible markers floated in the sky
    ctx.menuActive = true; // main.js caps the frame rate at 30 while the menu is up
    el.classList.remove('fadeout'); el.classList.add('on'); ctx.pipeline.resetHistory?.();
    window.__sysMenu = { open: true, tab: 'main' };
  }
  // ---- Play loading screen (Overpeak style: black, asset names bottom-left, logo filling in bottom-right, red bar): the
  // shader warm-up runs here, behind the screen, instead of at start-up; then the city is switched back on and a few
  // frames are rendered (first streaming happens here instead of as a freeze in the game). Built by window.__ob (index.html)
  function loadingScreen() {
    const L = window.__ob?.create({ id: 'ld' });
    if (!L) return { progress() {}, close() {} };
    L.el.style.zIndex = 2000; L.el.style.opacity = 0; L.el.style.transition = 'opacity .25s';
    requestAnimationFrame(() => { L.el.style.opacity = 1; });
    return { progress: p => L.progress(p), close: () => { L.el.style.transition = 'opacity .4s'; L.el.style.opacity = 0; setTimeout(() => L.el.remove(), 450); } };
  }
  const nextFrame = () => new Promise(r => requestAnimationFrame(r));
  async function play() {
    if (!active) return; active = false; audio.sfx.select(); audio.sfx.open?.();
    const L = loadingScreen(); window.__sysMenu = { open: false };
    await new Promise(r => setTimeout(r, 280)); // let the loading screen fade in over the menu
    el.classList.remove('on', 'fadeout');
    const W = ctx.warmup; // shader programs: queued all at once, the bar follows how many have linked (first Play only; later it is empty)
    if (W) { W.rescan(); W.flush(); await W.settle(k => L.progress(0.04 + k * 0.76)); }
    ctx.camera.position.copy(camSave.p); ctx.camera.quaternion.copy(camSave.q); ctx.camera.fov = camSave.fov; ctx.camera.updateProjectionMatrix();
    if (cityNode) cityNode.visible = true; for (const o of hidden) o.visible = true; hidden = []; ctx.menuActive = false;
    flow.setMode('play'); ctx.pipeline.resetHistory?.(); // the game now renders behind the loading screen
    const t0 = performance.now(), NEED = 8, MIN = 1500, MAX = 25000; let frames = 0;
    while (true) { // wait for a handful of real frames + a minimum time, whichever is slower (hard cap so it can never hang)
      await nextFrame(); frames++; const t = performance.now() - t0;
      L.progress(0.8 + Math.min(1, Math.min(frames / NEED, t / MIN)) * 0.18);
      if ((frames >= NEED && t >= MIN) || t > MAX) break;
    }
    L.progress(1); await new Promise(r => setTimeout(r, 220));
    ui.setVisible(true); L.close();
    if (!matchMedia('(pointer: coarse)').matches) ctx.renderer.domElement.requestPointerLock?.();
  }

  el.addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'play') play(); else if (a === 'options') openOptions(); else if (a === 'profile') openSuits(); else if (a === 'suits') { audio.sfx.select(); profile(); } else if (a === 'news') { audio.sfx.select(); about(); }
    else if (a === 'photo') { audio.sfx.select(); modal(`<h3>${a === 'suits' ? 'Suits' : 'Photo Mode'}</h3><p>Press Play, then open the pause menu (Esc, or the pause button on a phone) to use ${a === 'suits' ? 'the Suits tab' : 'Photo Mode'}.</p>`); }
  });
  for (const b of el.querySelectorAll('[data-a]')) b.addEventListener('mouseenter', () => audio.sfx.hover());

  // keys while the menu is up: Esc closes info / options-subpage / options; Enter or Space plays; everything else is swallowed
  flow.onKey((e, mode) => {
    if (!active || mode !== 'menu') return false;
    if (e.code === 'Escape') { if (info.classList.contains('on')) info.classList.remove('on'); else if (optsHost.classList.contains('on')) { if (!options.back()) closeOptions(); } return true; }
    if ((e.code === 'Enter' || e.code === 'Space') && !optsHost.classList.contains('on') && !info.classList.contains('on')) { play(); return true; }
    return true;
  });
  return { el, show, play, get active() { return active; } };
}
