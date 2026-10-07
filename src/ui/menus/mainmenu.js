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
  { const lg = $('.logo'); const im = new Image(); im.alt = 'Spiderbench'; im.src = BASE + 'logo.png'; im.onerror = () => { lg.innerHTML = '<b>SPIDERBENCH<i>.</i></b><small>MANHATTAN</small>'; }; lg.appendChild(im); }

  // ---- options (full-screen panel inside the menu)
  const optsHost = $('.opts');
  const options = createOptionsPanel(sys, { onClose: closeOptions });
  optsHost.appendChild(options.el);
  function openOptions() { audio.sfx.select(); options.show(); optsHost.classList.add('on'); }
  function closeOptions() { optsHost.classList.remove('on'); audio.sfx.close?.(); }

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
  let yaw = 0, dist = 3.2, camSave = null, active = false, dragX = null;
  function cameraHook(dt) {
    const cam = ctx.camera, P = ctx.player;
    yaw += dt * (dragX == null ? 0.1 : 0);
    _c.copy(P.position); _c.y += 0.9;
    let want = 3.4;
    _d.set(Math.sin(yaw), 0.12, Math.cos(yaw)).normalize();
    const hit = ctx.world.raycast?.(_c, _d, 3.6); if (hit) want = Math.max(1.5, hit.distance - 0.4);
    dist += (want - dist) * (1 - Math.exp(-6 * dt));
    cam.position.copy(_c).addScaledVector(_d, dist);
    _f.copy(_c).sub(cam.position).setY(0).normalize(); _r.set(-_f.z, 0, _f.x);
    _t.copy(_c).addScaledVector(_r, -0.95); _t.y -= 0.05;
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
    el.classList.remove('fadeout'); el.classList.add('on'); ctx.pipeline.resetHistory?.();
    window.__sysMenu = { open: true, tab: 'main' };
  }
  function play() {
    if (!active) return; active = false; audio.sfx.select(); audio.sfx.open?.();
    el.classList.add('fadeout');
    ctx.camera.position.copy(camSave.p); ctx.camera.quaternion.copy(camSave.q); ctx.camera.fov = camSave.fov; ctx.camera.updateProjectionMatrix();
    flow.setMode('play'); ui.setVisible(true); ctx.pipeline.resetHistory?.();
    setTimeout(() => { el.classList.remove('on', 'fadeout'); }, 500);
    if (!matchMedia('(pointer: coarse)').matches) ctx.renderer.domElement.requestPointerLock?.();
    window.__sysMenu = { open: false };
  }

  el.addEventListener('click', e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'play') play(); else if (a === 'options') openOptions(); else if (a === 'profile') { audio.sfx.select(); profile(); } else if (a === 'news') { audio.sfx.select(); about(); }
    else if (a === 'suits' || a === 'photo') { audio.sfx.select(); modal(`<h3>${a === 'suits' ? 'Suits' : 'Photo Mode'}</h3><p>Press Play, then open the pause menu (Esc, or the pause button on a phone) to use ${a === 'suits' ? 'the Suits tab' : 'Photo Mode'}.</p>`); }
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
