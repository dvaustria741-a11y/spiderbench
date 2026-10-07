// On-screen touch controls (Android APK / phones). Left stick = move, right-side drag = camera,
// buttons dispatch the same key / mouse events the keyboard + mouse layout uses (see player/input.js).
const MOUSE = { MouseLeft: 0, MouseMiddle: 1, MouseRight: 2 };
const BUTTONS = [
  // label, code, hold?, css position
  ['SWING', 'MouseRight', true, 'right:calc(24px + env(safe-area-inset-right));bottom:calc(150px + env(safe-area-inset-bottom));width:84px;height:84px'],
  ['JUMP', 'Space', true, 'right:calc(120px + env(safe-area-inset-right));bottom:calc(36px + env(safe-area-inset-bottom));width:84px;height:84px'],
  ['ZIP', 'KeyE', false, 'right:calc(24px + env(safe-area-inset-right));bottom:calc(40px + env(safe-area-inset-bottom));width:66px;height:66px'],
  ['RUN', 'ShiftLeft', true, 'right:calc(220px + env(safe-area-inset-right));bottom:calc(36px + env(safe-area-inset-bottom));width:60px;height:60px'],
  ['DIVE', 'KeyC', false, 'right:calc(120px + env(safe-area-inset-right));bottom:calc(136px + env(safe-area-inset-bottom));width:60px;height:60px'],
  ['BOOST', 'KeyQ', false, 'right:calc(200px + env(safe-area-inset-right));bottom:calc(112px + env(safe-area-inset-bottom));width:60px;height:60px'],
  ['HIT', 'MouseLeft', true, 'right:calc(24px + env(safe-area-inset-right));bottom:calc(240px + env(safe-area-inset-bottom));width:66px;height:66px'],
  ['WEB', 'KeyF', false, 'right:calc(110px + env(safe-area-inset-right));bottom:calc(230px + env(safe-area-inset-bottom));width:52px;height:52px'],
];

export function initTouch(ctx) {
  const input = ctx.input;
  const root = document.createElement('div');
  root.id = 'touch-ui';
  root.style.cssText = 'position:fixed;inset:0;z-index:50;pointer-events:none;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none';
  const css = document.createElement('style');
  css.textContent = `#touch-ui .tb{position:absolute;pointer-events:auto;border-radius:50%;border:2px solid rgba(255,255,255,.55);background:rgba(20,20,30,.38);color:#fff;font:700 11px/1 system-ui,sans-serif;letter-spacing:.04em;display:flex;align-items:center;justify-content:center;touch-action:none}
#touch-ui .tb.on{background:rgba(220,40,50,.6)}
#touch-ui .pad{position:absolute;pointer-events:auto;touch-action:none;left:calc(28px + env(safe-area-inset-left));bottom:calc(36px + env(safe-area-inset-bottom));width:150px;height:150px;border-radius:50%;border:2px solid rgba(255,255,255,.4);background:rgba(20,20,30,.25)}
#touch-ui .knob{position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:rgba(255,255,255,.45)}
#touch-ui .look{position:absolute;pointer-events:auto;touch-action:none;left:38%;right:0;top:0;bottom:0}
#touch-ui .menu{top:calc(12px + env(safe-area-inset-top));right:calc(12px + env(safe-area-inset-right));width:44px;height:44px}`;
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

  // move stick
  const pad = document.createElement('div'); pad.className = 'pad';
  const knob = document.createElement('div'); knob.className = 'knob'; pad.appendChild(knob); root.appendChild(pad);
  let padId = null;
  const setStick = e => {
    const r = pad.getBoundingClientRect(), R = r.width / 2;
    let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R);
    const len = Math.hypot(dx, dy); if (len > R) { dx = dx / len * R; dy = dy / len * R; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    input.touch.mx = dx / R; input.touch.my = -dy / R;
  };
  const resetStick = () => { padId = null; knob.style.transform = ''; input.touch.mx = input.touch.my = 0; };
  pad.addEventListener('pointerdown', e => { if (padId !== null) return; padId = e.pointerId; pad.setPointerCapture(e.pointerId); setStick(e); });
  pad.addEventListener('pointermove', e => { if (e.pointerId === padId) setStick(e); });
  pad.addEventListener('pointerup', e => { if (e.pointerId === padId) resetStick(); });
  pad.addEventListener('pointercancel', e => { if (e.pointerId === padId) resetStick(); });

  // action buttons
  const held = new Set();
  const addBtn = (label, code, hold, pos, extra = '') => {
    const b = document.createElement('div'); b.className = 'tb ' + extra; b.textContent = label; b.style.cssText = pos; root.appendChild(b);
    const id = { v: null };
    b.addEventListener('pointerdown', e => { if (id.v !== null) return; id.v = e.pointerId; b.setPointerCapture(e.pointerId); b.classList.add('on'); fire('down', code); held.add(code); if (navigator.vibrate) navigator.vibrate(8); });
    const end = e => { if (e.pointerId !== id.v) return; id.v = null; b.classList.remove('on'); fire('up', code); held.delete(code); };
    b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
  };
  for (const [l, c, h, p] of BUTTONS) addBtn(l, c, h, p);
  addBtn('II', 'Escape', false, '', 'menu');

  document.body.appendChild(root);
  ['contextmenu', 'gesturestart', 'dblclick'].forEach(t => root.addEventListener(t, e => e.preventDefault()));

  // hide the overlay outside gameplay (menus / photo mode use normal taps)
  setInterval(() => { const playing = ctx.flow ? ctx.flow.isPlaying !== false : true; root.style.display = playing ? '' : 'none'; if (!playing) { for (const c of held) fire('up', c); held.clear(); resetStick(); } }, 250);
}
