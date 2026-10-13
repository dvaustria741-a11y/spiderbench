// Which map is loaded ('classic' = Manhattan, 'open' = Open City, 'harbor' = Harbor District). Chosen on the main menu (Play)
// and kept in localStorage; ?map=open|classic|harbor overrides it (see mapid.js). Game systems import the layout API from here
// so they follow the map.
import * as classic from './layout.js';
import * as open from './openmap.js';
import { MAP_ID, saveMapId } from './mapid.js';

export const MAP = MAP_ID;
export function chooseMap(name) { saveMapId(name); }
const L = MAP === 'classic' ? classic : open; // Open City and Harbor District share openmap.js (it reads the active layout data)
export const { G, avenues, streets, streetsAt, mulberry32, inPark, stHalfAt, onLand, WIDE_ROADS, NARROW_STREETS, WIDE_ST_HALF, NARROW_ST_HALF, VREG, FREG } = L;
