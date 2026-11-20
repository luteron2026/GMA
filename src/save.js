// Progress is kept in this browser (localStorage), so it survives closing the tab,
// restarting the browser, and coming back days later. Everything still works if
// storage is blocked (for example in some private-browsing modes); it just won't persist.

const KEY = 'gma-save-v1';
// Bump when the map layout changes so a saved position from an older map isn't reused.
// Version 2: real campus layout from OpenStreetMap.
const MAP_VERSION = 2;

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function fresh() {
  return {
    credits: 0, completed: [], deeds: 0, banished: 0,
    // World state (null = start at the default spawn)
    map: MAP_VERSION, pos: null, heading: Math.PI, vehicle: null,
    time: 8 * 3600, heat: 0, joy: 100,
    playTime: 0, savedAt: 0,
  };
}

export function storageAvailable() {
  try {
    const k = '__gma_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function loadSave() {
  const s = fresh();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return s;
    const d = JSON.parse(raw);
    s.credits = Math.max(0, num(d.credits, 0) | 0);
    s.completed = Array.isArray(d.completed) ? d.completed.filter((x) => typeof x === 'string') : [];
    s.deeds = Math.max(0, num(d.deeds, 0) | 0);
    s.banished = Math.max(0, num(d.banished, 0) | 0);
    // Where you were standing only makes sense on the same map; credits and missions carry over
    if (d.map === MAP_VERSION) {
      if (Array.isArray(d.pos) && d.pos.length === 2 && d.pos.every((v) => Number.isFinite(v))) s.pos = d.pos;
      s.heading = num(d.heading, Math.PI);
      if (d.vehicle && typeof d.vehicle.type === 'string') s.vehicle = { type: d.vehicle.type };
    }
    s.time = num(d.time, 8 * 3600);
    s.heat = Math.min(5.99, Math.max(0, num(d.heat, 0)));
    s.joy = Math.min(100, Math.max(10, num(d.joy, 100)));
    s.playTime = Math.max(0, num(d.playTime, 0));
    s.savedAt = num(d.savedAt, 0);
  } catch { /* corrupted or blocked: start fresh */ }
  return s;
}

export function hasProgress(s) {
  return s.credits > 0 || s.completed.length > 0 || s.deeds > 0 || s.banished > 0 || !!s.pos;
}

export function writeSave(s) {
  try {
    s.savedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export { fresh as freshSave };
