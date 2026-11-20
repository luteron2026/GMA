// Progress is kept in this browser only (localStorage). Everything still works if storage is blocked.

const KEY = 'gma-save-v1';

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { credits: s.credits | 0, completed: Array.isArray(s.completed) ? s.completed : [], deeds: s.deeds | 0, banished: s.banished | 0 };
    }
  } catch { /* ignore */ }
  return { credits: 0, completed: [], deeds: 0, banished: 0 };
}

export function writeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
