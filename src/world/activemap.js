// Which map is loaded ('classic' = Manhattan, 'open' = open fast city). Chosen on the main menu (Play) and kept in
// localStorage; ?map=open|classic overrides it. Game systems import the layout API from here so they follow the map.
import * as classic from './layout.js';
import * as open from './openmap.js';

function pick() {
  try {
    const p = new URLSearchParams(location.search).get('map');
    if (p === 'open' || p === 'classic') return p;
    const s = localStorage.getItem('sb_map');
    if (s === 'open' || s === 'classic') return s;
  } catch (e) { /* non-browser */ }
  return 'classic';
}
export const MAP = pick();
export function chooseMap(name) { try { localStorage.setItem('sb_map', name); } catch (e) { /* ignore */ } }
const L = MAP === 'open' ? open : classic;
export const { G, avenues, streets, streetsAt, mulberry32, inPark, stHalfAt, onLand, WIDE_ROADS, NARROW_STREETS, WIDE_ST_HALF, NARROW_ST_HALF, VREG, FREG } = L;
