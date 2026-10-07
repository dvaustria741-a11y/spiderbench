// On-screen touch controls (Android APK / phones). Icon-only buttons (white pose silhouettes, no circles),
// left side = move stick, drag the right side = camera. Buttons dispatch the same key / mouse events the
// keyboard + mouse layout uses (see player/input.js).
const MOUSE = { MouseLeft: 0, MouseMiddle: 1, MouseRight: 2 };
const BASE = (import.meta.env?.BASE_URL || '/') + 'assets/ui/touch/';
const SA = (side, v, edge) => `calc(${v}px + env(safe-area-inset-${edge}))`;
// icon, key/mouse code, size px, right offset, bottom offset (px, from the safe area)
const BUTTONS = [
  ['swing',   'MouseRight', 104,  22, 118],
  ['jump',    'Space',      112, 136,  18],
  ['zip',     'KeyE',        80,  22,  18],
  ['wallrun', 'ShiftLeft',   84, 262,  20],
  ['dive',    'KeyC',        72, 150, 136],
  ['boost',   'KeyQ',        76, 236, 118],
  ['punch',   'MouseLeft',   84,  22, 232],
  ['web',     'KeyF',        72, 120, 244],
];

export function initTouch(ctx) {
  const input = ctx.input;
  const root = document.createElement('div');
  root.id = 'touch-ui';
  root.style.cssText = 'position:fixed;inset:0;z-index:50;pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none';
  const css = document.createElement('style');
  css.textContent = `#touch-ui .tb{position:absolute;pointer-events:auto;touch-action:none;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}
#touch-ui .tb img{width:100%;height:100%;object-fit:contain;opacity:.82;pointer-events:none;filter:drop-shadow(0 0 3px rgba(0,0,0,.75));transition:transform .06s,opacity .06s}
#touch-ui .tb.on img{opacity:1;transform:scale(.88);filter:drop-shadow(0 0 3px rgba(0,0,0,.75)) drop-shadow(0 0 8px rgba(255,255,255,.9))}
#touch-ui .pad{position:absolute;pointer-events:auto;touch-action:none;left:calc(28px + env(safe-area-inset-left));bottom:calc(30px + env(safe-area-inset-bottom));width:160px;height:160px}
#touch-ui .ring{position:absolute;inset:18px;border-radius:50%;border:1.5px solid rgba(255,255,255,.18)}
#touch-ui .knob{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,255,255,.28)}
#touch-ui .look{position:absolute;pointer-events:auto;touch-action:none;left:38%;right:0;top:0;bottom:0}
#touch-ui .menu{left:calc(14px + env(safe-area-inset-left));top:calc(10px + env(safe-area-inset-top));width:46px;height:46px}`;
  document.head.appendChild(css);

  const fire = (type, code) => {
    const init = { bubbles: true, cancelable: true };
    if (code in MOUSE) document.dispatchEvent(new MouseEvent(type === 'down' ? 'mousedown' : 'mouseup', { ...init, button: MOUSE[code] }));
    else document.dispatchEvent(new KeyboardEvent(type === 'down' ? 'keydown' : 'keyup', { ...init, code, key: code }));
  };

  // camera drag (right side, under the buttons)
  const look = document.createElement('div'); look.className = 'look'; root.appendChild(look);
  let lookId = null, lx = 0, ly = 0;
  look.addEventListener('pointerdown', e => { if (lookId !== null) return; lookId = e.pointerId; lx = e.clientX; ly = e.clientY; look.setPointerCapture(e.pointerId); });
  look.addEventListener('pointermove', e => { if (e.pointerId !== lookId) return; input.touchLook((e.clientX - lx) * 1.6, (e.clientY - ly) * 1.6); lx = e.clientX; ly = e.clientY; });
  const lookEnd = e => { if (e.pointerId === lookId) lookId = null; };
  look.addEventListener('pointerup', lookEnd); look.addEventListener('pointercancel', lookEnd);

  // move stick (nearly invisible: faint ring + soft knob)
  const pad = document.createElement('div'); pad.className = 'pad';
  const ring = document.createElement('div'); ring.className = 'ring'; pad.appendChild(ring);
  const knob = document.createElement('div'); knob.className = 'knob'; pad.appendChild(knob); root.appendChild(pad);
  let padId = null;
  const setStick = e => {
    const r = pad.getBoundingClientRect(), R = r.width / 2 - 18;
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy); if (len > R) { dx = dx / len * R; dy = dy / len * R; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    input.touch.mx = dx / R; input.touch.my = -dy / R;
  };
  const resetStick = () => { padId = null; knob.style.transform = ''; input.touch.mx = input.touch.my = 0; };
  pad.addEventListener('pointerdown', e => { if (padId !== null) return; padId = e.pointerId; pad.setPointerCapture(e.pointerId); setStick(e); });
  pad.addEventListener('pointermove', e => { if (e.pointerId === padId) setStick(e); });
  pad.addEventListener('pointerup', e => { if (e.pointerId === padId) resetStick(); });
  pad.addEventListener('pointercancel', e => { if (e.pointerId === padId) resetStick(); });

  // icon buttons
  const held = new Set();
  const addBtn = (icon, code, size, right, bottom, extra = '') => {
    const b = document.createElement('div'); b.className = 'tb ' + extra;
    if (!extra) b.style.cssText = `width:calc(${size}px * var(--tbs,1));height:calc(${size}px * var(--tbs,1));right:${SA(0, right, 'right')};bottom:${SA(0, bottom, 'bottom')}`;
    const im = document.createElement('img'); im.src = BASE + icon + '.png'; im.draggable = false; b.appendChild(im); root.appendChild(b);
    let id = null;
    b.addEventListener('pointerdown', e => { if (id !== null) return; id = e.pointerId; b.setPointerCapture(e.pointerId); b.classList.add('on'); fire('down', code); held.add(code); if (navigator.vibrate) navigator.vibrate(8); });
    const end = e => { if (e.pointerId !== id) return; id = null; b.classList.remove('on'); fire('up', code); held.delete(code); };
    b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
  };
  for (const [icon, code, size, r, b] of BUTTONS) addBtn(icon, code, size, r, b);
  addBtn('pause', 'Escape', 46, 0, 0, 'menu');

  document.body.appendChild(root);
  ['contextmenu', 'gesturestart', 'dblclick'].forEach(t => root.addEventListener(t, e => e.preventDefault()));

  // hide the overlay outside gameplay (menus / photo mode use normal taps)
  setInterval(() => { const playing = ctx.flow ? ctx.flow.isPlaying !== false : true; root.style.display = playing ? '' : 'none'; if (!playing) { for (const c of held) fire('up', c); held.clear(); resetStick(); } }, 250);
}
