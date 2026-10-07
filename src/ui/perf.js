// Performance readout (Options > Game > Show FPS, or ?fps). Tells CPU-bound from GPU-bound:
//   upd = JS time per frame (player, world, crowd, traffic, systems)   rnd = time to submit the render (CPU side of the draw calls)
//   if fps is low while upd + rnd are small, the GPU is the bottleneck; if upd or rnd is large, the CPU / draw calls are.
export function initPerf(ctx) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:calc(8px + env(safe-area-inset-left));bottom:calc(6px + env(safe-area-inset-bottom));z-index:80;pointer-events:none;display:none;padding:5px 8px;border-radius:6px;background:rgba(0,0,0,.6);color:#9f9;font:600 11px/1.35 monospace;white-space:pre';
  document.body.appendChild(el);
  const forced = new URLSearchParams(location.search).has('fps');
  setInterval(() => {
    const on = forced || window.__sys?.save?.state?.settings?.showFps === true;
    el.style.display = on ? 'block' : 'none'; if (!on) return;
    const P = ctx.perf || { upd: 0, rnd: 0, frame: 0 }, i = ctx.renderer.info;
    el.textContent = `${(1000 / Math.max(1, P.frame)).toFixed(0)} fps  (${P.frame.toFixed(1)} ms)\nupdate ${P.upd.toFixed(1)} ms  render ${P.rnd.toFixed(1)} ms\nplayer ${(P.pl || 0).toFixed(1)}  world ${(P.wo || 0).toFixed(1)}  light ${(P.li || 0).toFixed(1)}  hud ${(P.hu || 0).toFixed(1)}  sys ${(P.sy || 0).toFixed(1)}\ncalls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k\ngeo ${i.memory.geometries}  tex ${i.memory.textures}`;
  }, 500);
}
