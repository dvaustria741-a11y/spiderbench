// Performance readout (Options > Game > Show FPS, or ?fps). Tells CPU-bound from GPU-bound:
//   upd = JS time per frame (player, world, crowd, traffic, systems)   rnd = time to submit the render (CPU side of the draw calls)
//   if fps is low while upd + rnd are small, the GPU is the bottleneck; if upd or rnd is large, the CPU / draw calls are.
export function initPerf(ctx) {
  // BENCH button: runs the same view with parts of the game switched off, one at a time, and prints the average frame
  // time of each. Whatever removes the most time is the bottleneck (CPU sim, city drawing, post-processing, UI, resolution).
  const btn = document.createElement('button'); btn.textContent = 'BENCH';
  btn.style.cssText = 'position:fixed;left:calc(8px + env(safe-area-inset-left));bottom:calc(150px + env(safe-area-inset-bottom));z-index:81;display:none;padding:8px 16px;border:2px solid #9f9;border-radius:8px;background:rgba(0,0,0,.75);color:#9f9;font:700 14px monospace;touch-action:manipulation';
  document.body.appendChild(btn);
  const frames = n => new Promise(res => { let i = 0; const t0 = performance.now(); const step = () => { if (++i >= n) res((performance.now() - t0) / n); else requestAnimationFrame(step); }; requestAnimationFrame(step); });
  let busy = false;
  btn.addEventListener('click', async () => {
    if (busy) return; busy = true; const out = []; const set = t => { ctx._bench = t; };
    const city = ctx.scene.getObjectByName('city'), hudEls = ['sys-root', 'hud', 'touch-ui'].map(id => document.getElementById(id)).filter(Boolean);
    const pr0 = ctx.renderer.getPixelRatio();
    const tests = [
      ['base', () => {}, () => {}],
      ['no city', () => { city._was = city.visible; city.visible = false; }, () => { city.visible = city._was; }],
      ['no sim', () => { ctx.benchNoWorld = true; }, () => { ctx.benchNoWorld = false; }],
      ['no post', () => { ctx.benchDirect = true; }, () => { ctx.benchDirect = false; }],
      ['no UI', () => { for (const e of hudEls) { e._d = e.style.display; e.style.display = 'none'; } }, () => { for (const e of hudEls) e.style.display = e._d || ''; }],
      ['half res', () => { ctx.renderer.setPixelRatio(pr0 * 0.5); ctx.renderer.setSize(innerWidth, innerHeight); ctx.pipeline.setSize?.(innerWidth, innerHeight); }, () => { ctx.renderer.setPixelRatio(pr0); ctx.renderer.setSize(innerWidth, innerHeight); ctx.pipeline.setSize?.(innerWidth, innerHeight); }],
    ];
    for (const [name, on, off] of tests) {
      set(`BENCH running: ${name}...  (${out.join('  ')})  - do not touch`);
      on(); await frames(10); const ms = await frames(24); off();
      out.push(`${name} ${ms.toFixed(0)}ms`); set(`BENCH running... ${out.join('  ')}`);
    }
    set(`BENCH done: ${out.join('  ')}`); busy = false;
  });

  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:calc(8px + env(safe-area-inset-left));bottom:calc(6px + env(safe-area-inset-bottom));z-index:80;pointer-events:none;display:none;padding:5px 8px;border-radius:6px;background:rgba(0,0,0,.6);color:#9f9;font:600 11px/1.35 monospace;white-space:pre';
  document.body.appendChild(el);
  const forced = new URLSearchParams(location.search).has('fps');
  setInterval(() => {
    const on = forced || window.__sys?.save?.state?.settings?.showFps === true;
    el.style.display = on ? 'block' : 'none'; btn.style.display = on ? 'block' : 'none'; ctx.perfGpu = false; if (!on) return;
    const P = ctx.perf || { upd: 0, rnd: 0, frame: 0 }, i = ctx.renderer.info;
    const sz = ctx.renderer.getDrawingBufferSize(new ctx.THREE.Vector2());
    if (!(ctx._tg && performance.now() - ctx._tgT < 4000)) { ctx._tg = topGroups(ctx.scene); ctx._tgT = performance.now(); }
    el.textContent = `buf ${sz.x}x${sz.y}  shadows ${ctx.renderer.shadowMap.enabled ? 'ON' : 'off'}  lod ${globalThis.__LOD_NEAR ?? 650}m\n${(1000 / Math.max(1, P.frame)).toFixed(0)} fps  (${P.frame.toFixed(1)} ms)\nupdate ${P.upd.toFixed(1)} ms  render ${P.rnd.toFixed(1)} ms  gpu-wait ${(P.gpu || 0).toFixed(1)} ms\nplayer ${(P.pl || 0).toFixed(1)}  world ${(P.wo || 0).toFixed(1)}  light ${(P.li || 0).toFixed(1)}  hud ${(P.hu || 0).toFixed(1)}  sys ${(P.sy || 0).toFixed(1)}\ncalls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k\ngeo ${i.memory.geometries}  tex ${i.memory.textures}\n${ctx._tg}\n${xfProbe()}${ctx._bench ? '\n' + ctx._bench : ''}`;
  }, 500);
}

// heaviest top-level scene groups by static triangle count (every visible mesh x instances, no frustum culling) -> where the 13M triangles live
function topGroups(scene) {
  const out = [];
  for (const g of scene.children) {
    if (!g.visible) continue; let tris = 0, draws = 0;
    g.traverse(o => {
      if (!o.visible || !(o.isMesh || o.isInstancedMesh)) return;
      const geo = o.geometry; if (!geo) return;
      const t = ((geo.index ? geo.index.count : geo.attributes.position?.count || 0) / 3) * (o.isInstancedMesh ? o.count : 1);
      tris += t; draws++;
    });
    if (tris > 0) out.push([g.name || g.type, tris, draws]);
  }
  out.sort((a, b) => b[1] - a[1]);
  const lines = out.slice(0, 4).map(([n, t, d]) => `${String(n).slice(0, 14)} ${(t / 1e6).toFixed(1)}M/${d}`).join('  ');
  const big = scene.children.find(g => (g.name || g.type) === out[0]?.[0]);
  if (!big) return lines;
  const kids = big.children.filter(c => c.visible).map(c => { let t = 0, d = 0; c.traverse(o => { if (!o.visible || !(o.isMesh || o.isInstancedMesh) || !o.geometry) return; t += ((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position?.count || 0) / 3) * (o.isInstancedMesh ? o.count : 1); d++; }); return [c.name || c.type, t, d]; }).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return lines + '\n  in ' + (out[0][0]) + ': ' + kids.map(([n, t, d]) => `${String(n).slice(0, 14)} ${(t / 1e6).toFixed(1)}M/${d}`).join('  ');
}

// which element (if any) carries a CSS transform / zoom -> explains a tilted or shifted UI
function xfProbe() {
  const t = e => { if (!e) return '-'; const c = getComputedStyle(e); return (c.transform !== 'none' ? c.transform.slice(0, 26) : 'none') + (c.rotate && c.rotate !== 'none' ? ' rot ' + c.rotate : ''); };
  const vv = window.visualViewport;
  const chip = document.querySelector('.mm .chip'); let box = '';
  if (chip) { const r = chip.getBoundingClientRect(); box = ` chip rect ${r.width.toFixed(1)}x${r.height.toFixed(1)} vs layout ${chip.offsetWidth}x${chip.offsetHeight}  anims ${document.getAnimations().length}`; }
  let chain = ''; for (let e = chip; e && e !== document.documentElement; e = e.parentElement) { const c = getComputedStyle(e); const bits = []; for (const k of ['transform', 'rotate', 'scale', 'translate', 'perspective', 'zoom', 'filter', 'willChange']) { const v = c[k]; if (v && v !== 'none' && v !== 'auto' && v !== '1' && v !== 'normal') bits.push(k + '=' + String(v).slice(0, 22)); } if (bits.length) chain += ` [${e.tagName.toLowerCase()}${e.className ? '.' + String(e.className).split(' ')[0] : ''} ${bits.join(' ')}]`; }
  box += '\n' + 'chain:' + (chain || ' none');
  return box + '\n' + `xf html:${t(document.documentElement)} body:${t(document.body)} sys:${t(document.getElementById('sys-root'))} mm:${t(document.querySelector('.mm'))} vv:${vv ? vv.scale.toFixed(2) + '@' + vv.offsetLeft.toFixed(0) + ',' + vv.offsetTop.toFixed(0) : '-'}`;
}
