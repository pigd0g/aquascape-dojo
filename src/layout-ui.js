// Top-bar layout UI: the Save / Open popovers (browser storage) and the
// file-based Export / Import pair.
//
// All persistence lives in storage.js; this module only shuttles the layout
// object between that store, the file system and the scene via the two
// callbacks handed in by main.js (`getData` / `applyData`). Keeping it here
// rather than in main.js follows the module-per-concern split of the rest of
// the app, and keeps main.js a pure wiring layer.
import {
  listLayouts,
  saveLayout,
  loadLayout,
  deleteLayout,
  preferredName,
  uniqueLayoutName,
  storageAvailable,
  LAYOUT_NAME_MAX,
} from './storage.js';
import { flashButton } from './ui.js';

/** "just now" / "3 min ago" / "2 d ago" / a date, for the saved-layout rows. */
function relTime(ms) {
  if (!ms) return 'unknown age';
  const secs = Math.max(0, (Date.now() - ms) / 1000);
  if (secs < 45) return 'just now';
  const mins = secs / 60;
  if (mins < 60) return `${Math.round(mins)} min ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.round(hours)} h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)} d ago`;
  return new Date(ms).toLocaleDateString();
}

/** Compact byte size for the saved-layout rows (the heightfield is chunky). */
function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export class LayoutUI {
  /**
   * @param {object} opts
   * @param {() => object} opts.getData    current layout → serializable object
   * @param {(data: object) => void} opts.applyData  serializable object → scene
   */
  constructor({ getData, applyData }) {
    this.getData = getData;
    this.applyData = applyData;
    this.currentName = '';

    this.savePop = document.getElementById('save-pop');
    this.openPop = document.getElementById('open-pop');
    this.nameInput = document.getElementById('save-name');
    this.saveMsg = document.getElementById('save-msg');
    this.saveAsBtn = document.getElementById('save-as');
    this.openList = document.getElementById('open-list');
    this.fileInput = document.getElementById('file-load');

    this.saveBtn = document.getElementById('act-save');
    this.openBtn = document.getElementById('act-open');

    this._bindSave();
    this._bindOpen();
    this._bindFileIO();
    this._bindDismiss();
  }

  // ================= save =================
  _bindSave() {
    this.saveBtn.addEventListener('click', () => {
      // clicking Save while Save is open closes it; Open always yields
      if (!this.savePop.classList.contains('hidden')) {
        this.closeSave();
        return;
      }
      this.closeOpen();
      this._openSave();
    });
    document.getElementById('save-cancel').addEventListener('click', () =>
      this.closeSave(),
    );
    document.getElementById('save-confirm').addEventListener('click', () =>
      this._commitSave(),
    );
    this.saveAsBtn.addEventListener('click', () => this._commitSaveAs());
    this.nameInput.addEventListener('input', () => this._refreshSaveHint());
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._commitSave();
      }
    });
  }

  /** Show the Save popover (explaining itself when storage is unusable). */
  _openSave() {
    const usable = storageAvailable();
    this.nameInput.disabled = !usable;
    document.getElementById('save-confirm').disabled = !usable;
    this.saveAsBtn.disabled = !usable;
    this.nameInput.value = this.currentName || preferredName();
    if (usable) this._refreshSaveHint();
    else
      this._setMsg(
        'Browser storage is unavailable here (private mode?). Use Export instead.',
        'warn',
      );
    this.savePop.classList.remove('hidden');
    this.nameInput.focus();
    if (usable) this.nameInput.select();
  }

  closeSave() {
    this.savePop.classList.add('hidden');
    this._setMsg('');
  }

  /** Warn before silently clobbering an existing save. */
  _refreshSaveHint() {
    const name = this.nameInput.value.trim();
    if (!name) {
      this._setMsg('Give the layout a name.', 'warn');
      return;
    }
    if (name.length > LAYOUT_NAME_MAX) {
      this._setMsg(`Names are capped at ${LAYOUT_NAME_MAX} characters.`, 'warn');
      return;
    }
    const existing = listLayouts().find((l) => l.name === name);
    if (existing && name === this.currentName) {
      // re-saving what's open is the expected action — no clobber alarm
      this._setMsg(`Updates "${name}" — saved ${relTime(existing.savedAt)}.`, '');
    } else if (existing) {
      this._setMsg(
        `Overwrites "${name}" saved ${relTime(existing.savedAt)}. Use Save as for a copy.`,
        'warn',
      );
    } else {
      this._setMsg('Saves as a new layout — Export for a file.', '');
    }
  }

  /** Shared commit path for Save and Save as. */
  _commitSave({ asNew = false } = {}) {
    const typed = this.nameInput.value.trim();
    const name = asNew ? uniqueLayoutName(typed) : typed;
    const res = saveLayout(name, this.getData());
    if (!res.ok) {
      const reason =
        res.reason === 'quota'
          ? 'No room left in browser storage — Export the layout instead.'
          : res.reason === 'name'
            ? 'Give the layout a name.'
            : 'Could not save to browser storage.';
      this._setMsg(reason, 'warn');
      return;
    }
    this.currentName = res.name;
    this.nameInput.value = res.name;
    this.closeSave();
    if (asNew) flashButton(this.saveBtn, `✓ ${res.name}`);
    else flashButton(this.saveBtn, res.overwrote ? `✓ ${res.name}` : '✓ Saved');
  }

  /** Save a copy under a free variant of the typed name (never clobbers). */
  _commitSaveAs() {
    this._commitSave({ asNew: true });
  }

  // ================= open =================
  _bindOpen() {
    this.openBtn.addEventListener('click', () => {
      if (!this.savePop.classList.contains('hidden')) this.closeSave();
      if (!this.openPop.classList.contains('hidden')) {
        this.closeOpen();
        return;
      }
      this._renderOpenList();
      this.openPop.classList.remove('hidden');
    });
    document.getElementById('act-export').addEventListener('click', () => {
      this.closeOpen();
      this.exportFile();
    });
    document.getElementById('act-import').addEventListener('click', () => {
      this.closeOpen();
      this.fileInput.click();
    });
  }

  closeOpen() {
    this.openPop.classList.add('hidden');
  }

  _renderOpenList() {
    const rows = listLayouts();
    this.openList.textContent = '';
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'pop-empty';
      empty.textContent = 'No saved layouts yet — hit Save, or Import a file.';
      this.openList.appendChild(empty);
      return;
    }
    for (const row of rows) {
      const item = document.createElement('div');
      item.className = 'save-item';

      const open = document.createElement('button');
      open.className = 'save-open';
      open.type = 'button';
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = row.name;
      const dt = document.createElement('span');
      dt.className = 'dt';
      dt.textContent = `${relTime(row.savedAt)}${row.bytes ? ` · ${fmtBytes(row.bytes)}` : ''}`;
      open.append(nm, dt);
      open.addEventListener('click', () => this._openSaved(row.name));

      const del = document.createElement('button');
      del.className = 'save-del';
      del.type = 'button';
      del.title = `Delete "${row.name}"`;
      del.textContent = '✕';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteLayout(row.name);
        this._renderOpenList();
      });

      item.append(open, del);
      this.openList.appendChild(item);
    }
  }

  _openSaved(name) {
    const data = loadLayout(name);
    if (!data) {
      this._renderOpenList(); // it vanished under us — refresh the list
      return;
    }
    this.closeOpen();
    this.applyData(data);
    this.currentName = name;
    flashButton(this.openBtn, `✓ ${name}`);
  }

  // ================= import / export =================
  _bindFileIO() {
    this.fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const json = JSON.parse(await file.text());
        this.applyData(json);
        // a file carries no name of its own — adopt the filename for Export
        this.currentName = file.name.replace(/\.json$/i, '').slice(0, LAYOUT_NAME_MAX);
        flashButton(this.openBtn, '✓ Imported');
      } catch (err) {
        alert('Could not read layout: ' + err.message);
      }
    });
  }

  /** Download the current layout as a .json file. */
  exportFile() {
    const name = this.currentName || preferredName();
    const blob = new Blob([JSON.stringify(this.getData())], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aquascape-dojo-${name}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ================= shared =================
  _setMsg(text, tone) {
    this.saveMsg.textContent = text || '';
    this.saveMsg.className = 'pop-msg' + (tone ? ' ' + tone : '');
  }

  /** Temporary ✓ confirmation on a top-bar button. */
  _flash(button, text) {
    flashButton(button, text);
  }

  /** Click-away and Escape close whichever popover is open. */
  _bindDismiss() {
    document.addEventListener('pointerdown', (e) => {
      const inSave = this.savePop.contains(e.target);
      const inOpen = this.openPop.contains(e.target);
      const onSaveBtn = this.saveBtn.contains(e.target);
      const onOpenBtn = this.openBtn.contains(e.target);
      if (!inSave && !onSaveBtn) this.closeSave();
      if (!inOpen && !onOpenBtn) this.closeOpen();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeSave();
        this.closeOpen();
      }
    });
  }
}
