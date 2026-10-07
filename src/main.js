// Integration entry. OWNER: orchestrator. Module contracts:
//  render/pipeline.js  createPipeline({renderer, scene, camera}) -> {render(dt), setSize(w,h), setFocus?(dist)}
//  render/lighting.js  createLighting({renderer, scene}) -> {sun, update(camera), timeOfDay}
//  world/city.js       buildCity({scene, renderer}) -> Promise<world>
//                      world = {raycast(origin:Vector3, dir:Vector3, max):{point,normal,distance}|null,
//                               groundHeight(x,z):number, spawn:Vector3, update(dt, camera)}
//  player/player.js    createPlayer({scene, world, camera, input, renderer}) -> Promise<player>
//                      player = {update(dt), object:Object3D, applyShot(name)->boolean}
//  ui/hud.js           createHud({player, world}) -> {update(dt), setVisible(b)}
//  shots.js            SHOTS[name] = {time?, apply(ctx)}  deterministic poses for screenshot/critique
import * as THREE from 'three';
import { createPipeline } from './render/pipeline.js';
import { createLighting } from './render/lighting.js';
import { buildCity } from './world/city.js';
import { createPlayer } from './player/player.js';
import { createInput } from './player/input.js';
import { createHud } from './ui/hud.js';
import { SHOTS } from './shots.js';
import { createWarmup } from './render/warmup.js'; // (perf r3)
import { REFL_LAYER } from './world/water.js';
import { BIG_CASTER_LAYER } from './render/csm.js';

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
// loading screen (index.html): stage labels + progress; it fades out once the first frames and the game systems are up
const boot = window.__boot || { stage: async () => {}, sub() {}, done() {} };

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, reversedDepthBuffer: true });
renderer.setPixelRatio(globalThis.__LITE_R ? 1 : Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // tone mapping done in pipeline
// (zfix) three r186 negates only polygonOffsetFactor for the reversed depth buffer, so every decal's negative
// polygonOffsetUnits ("pull toward the camera") pushed it AWAY: face-on (no depth slope, the factor term ~0) coplanar
// decals lost / flickered against the surface below. Re-issue the offset with both terms negated.
if (renderer.capabilities.reversedDepthBuffer && !params.has('nozfix')) {
  const gl = renderer.getContext(), st = renderer.state, setMat = st.setMaterial;
  st.setMaterial = function (material, frontFaceCW, clip) {
    setMat.call(this, material, frontFaceCW, clip);
    if (material.polygonOffset) gl.polygonOffset(-material.polygonOffsetFactor, -material.polygonOffsetUnits);
  };
}
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// far plane 150 km (foundation agent): the harbour, far shores and distant hinterland run out to the (fogged) true
// horizon instead of being clipped into a hard band at 6 km (reversed float depth keeps precision at this range)
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 150000);

const lighting = createLighting({ renderer, scene });
const world = await buildCity({ scene, renderer });
const input = createInput(renderer.domElement);
await boot.stage('player');
const player = await createPlayer({ scene, world, camera, input, renderer });
await boot.stage('shaders');
const hud = createHud({ player, world, camera });
const pipeline = createPipeline({ renderer, scene, camera, lighting });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); pipeline.setSize(innerWidth, innerHeight);
});

const ctx = { THREE, renderer, scene, camera, lighting, world, player, hud, pipeline, input };
import('./ui/perf.js').then(m => m.initPerf(ctx)).catch(() => {});
ctx.systems = ctx.systems || []; // C5: game systems (src/game/**) push {update(dt)} here
window.__ctx = ctx;
if (matchMedia('(pointer: coarse)').matches || params.has('touch')) import('./ui/touch.js').then(m => m.initTouch(ctx)).catch(e => console.error('[touch] init failed', e));
// (perf r3) queue every shader program the game can draw (main pass + the river mirror's unshadowed variant + the
// post passes) before the first frame: they link in parallel on the driver's threads during the loading frame instead
// of one by one later, each freezing the game for 0.2-6 s the first time its material came into view
// (render/warmup.js). ?nowarm = old behaviour (A/B)
const warmup = !shotName && !params.has('nowarm') ? createWarmup(renderer, scene, camera, { mirrorLayers: [REFL_LAYER, BIG_CASTER_LAYER] }) : null;
// first the state the first frame would set that is part of the program keys: the sky IBL (scene.environment, from the
// first lighting update) and the pipeline's NO_SSR material defines
if (warmup) { lighting.update(camera); pipeline.prepareMaterials?.(); warmup.rescan(); warmup.flush(); await warmup.settle(k => boot.sub(k)); }
await boot.stage('frame');
let framesDrawn = 0;
const systemsReady = shotName ? Promise.resolve() : import('./game/systems/index.js').then(m => m.initSystems(ctx)).catch(e => console.error('[systems] init failed', e)) // open-world systems (C5)
  .then(() => import('./game/combat/index.js')).then(m => m.initCombat(ctx)).catch(e => console.error('[combat] init failed', e)) // combat (C5)
  .then(() => warmup?.rescan()); // (perf r3) + the meshes the systems / combat added (trickled by warmup.step)
// the loading screen goes once the game systems (HUD, save position) are in and a few frames have been drawn
systemsReady.then(async () => { boot.sub(0.8); while (framesDrawn < 4) await new Promise(r => requestAnimationFrame(r)); boot.done(); });
ctx.timeScale = 1; // global game-time scale (combat hit-stop / slow-mo); ctx.realDt = unscaled frame time

if (shotName) {
  const shot = SHOTS[shotName];
  if (!shot) throw new Error('unknown shot ' + shotName);
  shot.apply(ctx);
  // Warm up: let shadows, TAA/accumulation, streaming settle.
  const dt = 1 / 60;
  for (let i = 0; i < (shot.frames ?? 90); i++) {
    shot.tick?.(ctx, dt, i);
    world.update(dt, camera); lighting.update(camera); hud.update(dt);
    pipeline.render(dt);
    await new Promise(r => requestAnimationFrame(r));
  }
  window.__shotInfo = `${renderer.info.render.calls} calls, ${renderer.info.render.triangles} tris`;
  window.__shotReady = true;
} else {
  const clock = new THREE.Clock();
  function frame(realDt) {
    ctx.realDt = realDt;
    const fl = ctx.flow;
    if (fl && fl.mode === 'menu' && (ctx.menuStill || (!ctx.menuActive && !fl.hasCameraHook && !document.querySelector('.sys-menu.open.see-through')))) {
      // pause menu pages / main-menu Options: nothing to see behind the UI, so skip the whole 3D frame
      for (const s of ctx.systems) s.update?.(realDt);
      return;
    }
    const dt = ctx.realDt * (ctx.timeScale ?? 1);
    const n = performance.now, a = n.call(performance);
    player.update(dt); const b = n.call(performance);
    world.update(dt, camera); const c = n.call(performance);
    lighting.update(camera); const d2 = n.call(performance);
    hud.update(dt); const e = n.call(performance);
    for (const s of ctx.systems) s.update?.(dt);
    const t1 = n.call(performance);
    pipeline.render(dt);
    const t2 = n.call(performance); const P = ctx.perf || (ctx.perf = { upd: 0, rnd: 0, frame: 0, pl: 0, wo: 0, li: 0, hu: 0, sy: 0 });
    const k = 0.1, sm = (key, v) => { P[key] += (v - P[key]) * k; };
    sm('upd', t1 - a); sm('rnd', t2 - t1); sm('frame', (ctx.rawDt ?? realDt) * 1000); sm('pl', b - a); sm('wo', c - b); sm('li', d2 - c); sm('hu', e - d2); sm('sy', t1 - e);
    warmup?.step(); // (perf r3)
    if (++framesDrawn === 1) boot.sub(0.4); // the first frame (remaining uploads / links) is in
  }
  // tools (tools/film.mjs): ctx.manualStep = true pauses the real-time loop; ctx.stepFrame(dt) then advances exactly one
  // frame of dt seconds (deterministic frame-by-frame captures of fast motion)
  ctx.stepFrame = dt => frame(dt);
  let lastDraw = 0;
  renderer.setAnimationLoop(() => {
    // Options > Display > Frame Rate: ctx.fpsCap (0 = every display refresh)
    const cap = ctx.menuActive ? 20 : ctx.fpsCap; // title screen: 20 fps is plenty for a slowly turning hero
    if (cap) { const now = performance.now(); if (now - lastDraw < 1000 / cap - 2) return; lastDraw = now; }
    const raw = clock.getDelta(); ctx.rawDt = raw; // unclamped, for the FPS readout
    const d = Math.min(raw, 1 / 20);
    if (!ctx.manualStep) frame(d);
  });
}
