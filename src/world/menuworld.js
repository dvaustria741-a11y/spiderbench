// Menu-only world: the stand-in `world` for the first start of the game. The title screen only needs the hero, the sky and
// the menus (the city is hidden behind it anyway), so the first launch builds NO city: no textures, no models, no
// collision grid, none of the ~50 city assets. Play reloads into the full boot (world/city.js), which builds the real
// world behind the loading screen (see ui/menus/mainmenu.js play(), index.html ?go and main.js).
// Same contract as buildCity() (see main.js): every query is valid, the answers are just empty.
import * as THREE from 'three';
import { G, streetsAt } from './layout.js';

export function buildMenuWorld() {
  const spawn = new THREE.Vector3(250, 0, 160 + G.ST_HALF + 2.3); // same spot as world/city.js: on the centre line, in the south crosswalk
  const none = () => null;
  const world = {
    menuOnly: true,
    raycast: none, groundHeight: () => 0, surfaceAt: none, spawn, viewpoints: {}, streetsAt,
    getZipPoints: () => [], bridgeLimit: null, bridgeDeckY: () => 0, bridgeLimits: [],
    propAnchors: () => [], grabbables: () => [], grabProp: none, releaseProp: none,
    collision: null, geoDebug: { update() {}, setVisible() {} },
    buildings: [], footprints: [], getMapFeatures: () => null, textures: {}, materials: {},
    update(dt, camera) {
      // same as the real world: retire the sky's procedural distant-skyline band (clean horizon behind the hero)
      if (!world._skylineOff) { const lg = window.__ctx?.lighting; if (lg?.sky?.params) { lg.sky.params.skylineVisible = 0; lg.refresh?.(); world._skylineOff = true; } }
    },
  };
  return world;
}
