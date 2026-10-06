// HtmlDialogs — bridge between the canvas game and HTML/CSS dialog overlays.
//
// The dialogs live as hidden <div class="cc-dialog" data-dialog="NAME"> nodes
// inside #ui-layer (see index.html). This module shows/hides them, fills their
// fields, wires their buttons back to game callbacks, and tells the game when a
// modal is open (so the field pauses and canvas clicks are blocked).
//
// HTML contract (authored in index.html, styled in styles/dialogs.css):
//   <div class="cc-dialog" data-dialog="options" hidden> ... </div>
//   - [data-bind="music"]   a field to read/write. <input>=value/checked,
//                           anything else = textContent.
//   - [data-action="close"] a clickable element; click → handlers.close().
//   - [data-list="rows"]    a container whose first [data-template] child is
//                           cloned per item by fillList().
//
// Usage from game code:
//   HtmlDialogs.open('options', {
//     binds:   { music: 0.5, sfx: 0.7, fullscreen: false, hwaccel: true },
//     onBind:  { music: v => SoundManager.setMusicVolume(v), ... },
//     actions: { close: () => {...}, mainmenu: () => {...} },
//     visible: { restart: inGame, mainmenu: inGame },  // show/hide elements
//   });
//   HtmlDialogs.close('options');

let _layer = null;              // #ui-layer element
const _open = new Map();        // name -> { el, cfg }
let _pauseHook = null;          // () => void, called when open-set changes

function layer() {
    if (!_layer) _layer = document.getElementById('ui-layer');
    return _layer;
}

function el(name) {
    const root = layer();
    return root ? root.querySelector(`[data-dialog="${name}"]`) : null;
}

// Screenshots 09/32: a newly opened modal stays above its parent regardless
// of index.html source order (New Player is declared before Change Player).
function syncStack() {
    let order = 0;
    for (const { el } of _open.values()) el.style.zIndex = String(++order);
}

// Read a value into a [data-bind] element.
function _applyBind(node, value) {
    if (node.tagName === 'INPUT') {
        if (node.type === 'checkbox' || node.type === 'radio') node.checked = !!value;
        else node.value = value;
    } else if (node.tagName === 'IMG') {
        node.src = value == null ? '' : String(value);
    } else if (node.hasAttribute('data-bind-width')) {
        node.style.width = (Number(value) || 0) + '%'; // e.g. progress/age bars
    } else {
        node.textContent = value == null ? '' : String(value);
    }
}

// Current value out of a [data-bind] element.
function _readBind(node) {
    if (node.tagName === 'INPUT') {
        if (node.type === 'checkbox' || node.type === 'radio') return node.checked;
        if (node.type === 'range' || node.type === 'number') return parseFloat(node.value);
        return node.value;
    }
    return node.textContent;
}

export const HtmlDialogs = {
    // Register the function the game uses to (un)pause / refresh modal state.
    setPauseHook(fn) { _pauseHook = fn; },

    isOpen() { return _open.size > 0; },
    isDialogOpen(name) { return _open.has(name); },
    openNames() { return Array.from(_open.keys()); },

    // Show a dialog and wire it. cfg = { binds, onBind, actions, visible }.
    open(name, cfg = {}) {
        const node = el(name);
        if (!node) { console.warn('HtmlDialogs: no dialog', name); return null; }

        // Populate fields.
        if (cfg.binds) {
            for (const [key, val] of Object.entries(cfg.binds)) {
                node.querySelectorAll(`[data-bind="${key}"]`).forEach(n => _applyBind(n, val));
            }
        }
        // Show/hide optional elements.
        if (cfg.visible) {
            for (const [key, show] of Object.entries(cfg.visible)) {
                node.querySelectorAll(`[data-visible="${key}"]`).forEach(n => { n.hidden = !show; });
            }
        }

        // Wire via event DELEGATION on the dialog root, so rows added later by
        // fillList() are handled too. (idempotent: replace any prior handlers.)
        const prev = _open.get(name);
        const returnFocus = prev ? prev.returnFocus : document.activeElement;
        if (prev && prev._cleanup) prev._cleanup();
        const listeners = [];
        const add = (target, type, fn) => { target.addEventListener(type, fn); listeners.push([target, type, fn]); };

        add(node, 'click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn || !node.contains(btn)) return;
            e.preventDefault();
            const act = btn.getAttribute('data-action');
            const fn = cfg.actions && cfg.actions[act];
            if (!fn) return;
            const rowEl = btn.closest('[data-index]');
            fn({ el: node, target: btn, dialog: name, index: rowEl ? Number(rowEl.dataset.index) : undefined });
        });
        // Two-way bound inputs notify onBind on change (delegated).
        if (cfg.onBind) {
            add(node, 'input', (e) => {
                const inp = e.target.closest('[data-bind]');
                if (!inp || inp.tagName !== 'INPUT' || !node.contains(inp)) return;
                const key = inp.getAttribute('data-bind');
                if (cfg.onBind[key]) cfg.onBind[key](_readBind(inp), { el: node });
            });
        }

        node.hidden = false;
        node.classList.add('cc-open');
        _open.delete(name); // Reopening a modal brings it to the front.
        _open.set(name, { el: node, cfg, returnFocus, _cleanup: () => listeners.forEach(([t, ty, fn]) => t.removeEventListener(ty, fn)) });
        syncStack();
        if (_pauseHook) _pauseHook();
        // Browser port: each newly shown EditBox receives keyboard focus.
        node.querySelector('[data-autofocus]')?.focus({ preventScroll: true });
        return node;
    },

    // Read current bound values back out (e.g. text input on submit).
    read(name, key) {
        const node = el(name);
        if (!node) return undefined;
        const n = node.querySelector(`[data-bind="${key}"]`);
        return n ? _readBind(n) : undefined;
    },

    // Update a single bound field on an already-open dialog.
    set(name, key, value) {
        const node = el(name);
        if (!node) return;
        node.querySelectorAll(`[data-bind="${key}"]`).forEach(n => _applyBind(n, value));
    },

    // Build a repeating list from a [data-template] child. `render(item, rowEl,
    // index)` populates each clone; clicks inside a row report via data-action
    // with the row index available as rowEl.dataset.index.
    fillList(name, listKey, items, render) {
        const node = el(name);
        if (!node) return;
        const container = node.querySelector(`[data-list="${listKey}"]`);
        if (!container) return;
        const tpl = container.querySelector('[data-template]');
        container.querySelectorAll(':scope > :not([data-template])').forEach(n => n.remove());
        items.forEach((item, i) => {
            const row = tpl.cloneNode(true);
            row.removeAttribute('data-template');
            row.hidden = false;
            row.dataset.index = String(i);
            render(item, row, i);
            container.appendChild(row);
        });
    },

    close(name) {
        const rec = _open.get(name);
        const restoreFocus = rec && rec.el.contains(document.activeElement);
        if (rec) { if (rec._cleanup) rec._cleanup(); _open.delete(name); }
        const node = el(name);
        if (node) { node.hidden = true; node.classList.remove('cc-open'); node.style.removeProperty('z-index'); }
        syncStack();
        if (_pauseHook) _pauseHook();
        if (restoreFocus && rec.returnFocus?.isConnected
            && !rec.returnFocus.closest('[hidden]')) {
            rec.returnFocus.focus({ preventScroll: true });
        }
    },

    closeAll() {
        for (const name of Array.from(_open.keys())) this.close(name);
    },
};

if (typeof window !== 'undefined') window.HtmlDialogs = HtmlDialogs;
