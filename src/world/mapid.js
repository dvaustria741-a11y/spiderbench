// Which map is loaded: 'classic' (Manhattan), 'open' (Open City) or 'harbor' (Harbor District). Chosen on the main menu
// (Play) and kept in localStorage ('sb_map'); ?map=<id> overrides it. No imports, so any module can read it.
export const MAP_IDS = ['classic', 'open', 'harbor'];

function pick() {
  try {
    const p = new URLSearchParams(location.search).get('map');
    if (MAP_IDS.includes(p)) return p;
    const s = localStorage.getItem('sb_map');
    if (MAP_IDS.includes(s)) return s;
  } catch (e) { /* non-browser */ }
  return 'classic';
}
export const MAP_ID = pick();
// every map except Manhattan is built by world/citylite.js from a raster layout (openlayout.js / harborlayout.js)
export const IS_OPEN_STYLE = MAP_ID !== 'classic';
export function saveMapId(id) { try { localStorage.setItem('sb_map', id); } catch (e) { /* ignore */ } }
