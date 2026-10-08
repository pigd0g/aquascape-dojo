// Saved-layout persistence in localStorage.
//
// Layouts live under `dojo.layout.<name>`, with a small `dojo.layouts` index
// ({ name: { savedAt, bytes } }) so the Open popover can list saves without
// parsing every payload — a layout carries the substrate heightfield and can
// run to a few hundred KB.
//
// The stored payload is exactly the object the Export/Import buttons read and
// write, so a layout moves between browser storage and a file in either
// direction with no conversion.
//
// localStorage is missing in some private-mode contexts and throws
// QuotaExceededError when full; every call reports failure by return value
// instead of throwing so the UI can surface the reason.

const INDEX_KEY = 'dojo.layouts';
const NAME_KEY = 'dojo.layoutName';
const KEY_PREFIX = 'dojo.layout.';
const NAME_MAX = 40;

function readIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const idx = raw ? JSON.parse(raw) : null;
    return idx && typeof idx === 'object' ? idx : {};
  } catch {
    return {};
  }
}

function writeIndex(idx) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
    return true;
  } catch {
    return false;
  }
}

/** Whether this browser will let us persist anything at all. */
export function storageAvailable() {
  try {
    const probe = KEY_PREFIX + '__probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** Trim a user-entered name; '' means "unusable as a key". */
export function cleanName(name) {
  return String(name ?? '').trim().slice(0, NAME_MAX);
}

/** Name the Save box should offer: the last one used, else `tank1`. */
export function preferredName() {
  try {
    return cleanName(localStorage.getItem(NAME_KEY)) || 'tank1';
  } catch {
    return 'tank1';
  }
}

function rememberName(name) {
  try {
    localStorage.setItem(NAME_KEY, cleanName(name));
  } catch {
    /* remembering the name is a convenience — never fatal */
  }
}

/** Saved layouts, newest first: [{ name, savedAt, bytes }]. */
export function listLayouts() {
  const idx = readIndex();
  const out = [];
  let dirty = false;
  for (const name of Object.keys(idx)) {
    // prune entries whose payload is gone (devtools edits, failed clears…)
    let present = true;
    try {
      present = localStorage.getItem(KEY_PREFIX + name) != null;
    } catch {
      present = false;
    }
    if (!present) {
      delete idx[name];
      dirty = true;
      continue;
    }
    out.push({
      name,
      savedAt: Number(idx[name]?.savedAt) || 0,
      bytes: Number(idx[name]?.bytes) || 0,
    });
  }
  if (dirty) writeIndex(idx);
  out.sort((a, b) => b.savedAt - a.savedAt);
  return out;
}

/** Save (or overwrite) a layout. Returns { ok } or { ok: false, reason }. */
export function saveLayout(name, data) {
  const clean = cleanName(name);
  if (!clean) return { ok: false, reason: 'name' };
  if (!storageAvailable()) return { ok: false, reason: 'unavailable' };

  let payload;
  try {
    payload = JSON.stringify(data);
  } catch (err) {
    return { ok: false, reason: 'encode', message: err.message };
  }

  const idx = readIndex();
  const overwrote = Object.prototype.hasOwnProperty.call(idx, clean);
  try {
    localStorage.setItem(KEY_PREFIX + clean, payload);
  } catch {
    // QuotaExceededError under several browser-specific names — every other
    // realistic write failure here is also "no room", so treat them alike.
    return { ok: false, reason: 'quota', bytes: payload.length };
  }
  idx[clean] = { savedAt: Date.now(), bytes: payload.length };
  writeIndex(idx);
  rememberName(clean);
  return { ok: true, name: clean, overwrote };
}

/** Load a layout, or null when it is missing/corrupt. */
export function loadLayout(name) {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + cleanName(name));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function deleteLayout(name) {
  const clean = cleanName(name);
  try {
    localStorage.removeItem(KEY_PREFIX + clean);
  } catch {
    return false;
  }
  const idx = readIndex();
  delete idx[clean];
  writeIndex(idx);
  return true;
}

export const LAYOUT_NAME_MAX = NAME_MAX;
