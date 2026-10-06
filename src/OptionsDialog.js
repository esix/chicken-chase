// Sexy::OptionsDialog — game logic of the HTML 'options' dialog (js/index.html;
// presentation is HTML/CSS on purpose). The former canvas draw/mouse code was
// dead (nothing constructed it; GameApp.openOptions drove the HTML directly)
// and has been removed.
//
// ctor FUN_0040f57b (rwg:19093), vtable 0x4ddd54:
//   [7] AddedToManager FUN_0040fa23 (rwg:19355) — checkbox seeding
//   [9] Update FUN_0040f8c8 (rwg:19298) — Escape → ButtonDepress(1000)
//   [13] Draw FUN_0040f8e9, [25] Resize FUN_0040fbff
//   SliderVal FUN_0040fcdf, ButtonDepress FUN_0040fd44, quit-confirm YES
//   callback FUN_0040fe56, CheckboxChecked FUN_0040febf.
// Opened from the main menu (FUN_0040ea92 asm 0x40eae7: in-game flag 0) and
// from the in-game MENU button (FUN_0040bce7 case 1, rwg:14100-14120, flag 1),
// both as dialog id 6.
//
// Widgets: this[0x59] Music slider (id 0), this[0x5a] Sound FX slider (id 1),
// this[0x5b] "MAIN MENU", this[0x5c] "RESTART LEVEL" (both hidden when the
// in-game flag +0x17c is 0, rwg:19181-19184), this[0x5d] Hardware
// Acceleration checkbox (id 5), this[0x5e] Fullscreen checkbox (id 4),
// footer "CLOSE" (id 1000).

import { IMAGES, SOUNDS } from './Res.js';
import { SoundManager } from './SexyApp.js';
import { HtmlDialogs } from './HtmlDialogs.js';

const ID_CLOSE = 1000;          // dialog footer button id
const SLIDER_MUSIC = 0;         // FUN_00439379(.., 0, ..) rwg:19146
const SLIDER_SFX = 1;           // FUN_00439379(.., 1, ..) rwg:19160

function playClick() {
    // DAT_004fed84 = SOUND_CLICK.
    if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
}

// Slider thumb cel width (Slider +0x98 = DAT_004fffb0, FUN_00439379; width
// via FUN_0047471d). images/slider_thumb.png is 35 px wide.
function thumbWidth() {
    const t = IMAGES.IMAGE_SLIDER_THUMB;
    return (t && t.img) ? t.getCelWidth() : 35;
}

// The live dialog (its slider/keyboard listeners are not HtmlDialogs-managed).
let sActive = null;

export class OptionsDialog {
    // opts: { inGame, onMainMenu, onRestart, onClose }.
    //   onMainMenu = FUN_0040fe56 MAIN MENU branch after KillDialog:
    //     FUN_00408799 (main menu) + FUN_00406389.
    //   onRestart  = FUN_0040fe56 RESTART branch after KillDialog: when a game
    //     state exists, FUN_00406389 + Core::StartLevel FUN_00406069.
    constructor(gameApp, opts = {}) {
        this.mGameApp = gameApp;
        this.mInGame = !!opts.inGame;           // +0x17c (ctor param, rwg:19127)
        this.mRestart = false;                  // +0x17d (rwg:19128)
        this.mOnMainMenu = opts.onMainMenu || null;
        this.mOnRestart = opts.onRestart || null;
        this.mOnClose = opts.onClose || null;
        this.mIsActive = true;
        this._cleanups = [];
    }

    isShown() { return this.mIsActive; }

    openHtml() {
        if (sActive && sActive !== this) sActive._detach();
        sActive = this;
        HtmlDialogs.open('options', {
            binds: {
                // Sliders seeded from app GetMusicVolume (vt+0xcc) /
                // GetSfxVolume (vt+0xd0) via Slider::SetValue (vt+0xd8),
                // rwg:19150-19151 / 19164-19165.
                music: SoundManager.mMusicVolume,
                sfx: SoundManager.mSfxVolume,
                // AddedToManager FUN_0040fa23: Fullscreen checked = !app+0x307
                // (windowed) — the browser's fullscreen state.
                fullscreen: !!(typeof document !== 'undefined' && document.fullscreenElement),
                // HW checkbox = FUN_0044abec (3D acceleration on). A browser
                // has no D3D mode; the checkbox stays checked and inert.
                hwaccel: true,
            },
            // MAIN MENU / RESTART LEVEL hidden unless in-game (rwg:19181-19184).
            // Fullscreen checkbox is hidden when *(app+8) == 0 (FUN_0040fa23
            // rwg:19393-19395). UNKNOWN — app+8 not identified in decompiled;
            // kept visible.
            visible: { ingame: this.mInGame },
            onBind: {
                fullscreen: (v) => this._checkboxChecked(4, v),
                hwaccel: (v) => this._checkboxChecked(5, v),
            },
            actions: {
                close: () => this._buttonDepress(ID_CLOSE),
                mainmenu: () => this._buttonDepress('mainmenu'),
                restart: () => this._buttonDepress('restart'),
            },
        });
        this._attach();
    }

    // FUN_0040fd44 (rwg:19497) ButtonDepress.
    _buttonDepress(id) {
        if (!this.mIsActive) return;
        // asm 0x40fd5b-0x40fd6a: SOUND_CLICK for every button, before the id test.
        playClick();
        if (id === ID_CLOSE) {
            // asm 0x40fd78-0x40fda1: app SwitchScreenMode (vt+0xf8)(windowed =
            // !Fullscreen checked, 3D = HW checked, 0) — the screen mode is
            // applied on CLOSE, not when the checkbox is toggled.
            this._applyFullscreen(!!HtmlDialogs.read('options', 'fullscreen'));
            // asm 0x40fda7-0x40fdbc: if a game state exists, +4 = 0 / +0xd = 0
            // (unpause) — GameView's modal tracking unpauses once the dialog
            // is gone. asm 0x40fdce: KillDialog.
            this._close();
            // Browser port: the original keeps the volumes in the app and
            // writes them to the registry at shutdown; a page has no
            // shutdown, so persist here.
            const core = this.mGameApp && this.mGameApp.mCore;
            if (core && core.save) core.save();
            if (this.mOnClose) this.mOnClose();
            return;
        }
        if (id === 'mainmenu' || id === 'restart') {
            // asm 0x40fdf2-0x40fe0e: +0x17d = (id == RESTART); YES/NO dialog
            // FUN_0040279c (mode 1, asm 0x4027a8-0x4027b6) "QUIT?" (0x4ddb5c) /
            // "Your level progress will be lost. Continue?" (0x4ddb64), callback
            // object this+0x160: YES (72000) → vt[0] FUN_0040fe56, NO (73000)
            // → vt[1] FUN_0044a036; FUN_004211e9 kills dialog 70000 first.
            this.mRestart = id === 'restart';
            HtmlDialogs.open('quit-confirm', {
                actions: {
                    yes: () => { HtmlDialogs.close('quit-confirm'); this._quitConfirmed(); },
                    no: () => HtmlDialogs.close('quit-confirm'),
                },
            });
        }
    }

    // FUN_0040fe56 (rwg:19586): KillDialog(options) (vt+0x118), then
    //   +0x17d == 0: FUN_00408799 + FUN_00406389 (back to the main menu);
    //   else: if game state (app+4) != 0 → FUN_00406389 + FUN_00406069.
    // Runs even if the options dialog was already closed (Escape while the
    // QUIT? dialog is up).
    _quitConfirmed() {
        this._close();
        if (!this.mRestart) { if (this.mOnMainMenu) this.mOnMainMenu(); }
        else if (this.mOnRestart) this.mOnRestart();
    }

    // FUN_0040fcdf (rwg:19476) SliderVal: id 0 → app SetMusicVolume
    // (vt+0xdc); id 1 → app SetSfxVolume (vt+0xe0) and, when the Sound FX
    // slider is not dragging (+0x9c == 0, i.e. the call from MouseUp
    // FUN_0043970c), SOUND_CLICK.
    _sliderVal(id, value, dragging) {
        const core = this.mGameApp && this.mGameApp.mCore;
        if (id === SLIDER_MUSIC) {
            SoundManager.setMusicVolume(value);
            if (core) core.mMusicVolume = value;
        } else if (id === SLIDER_SFX) {
            SoundManager.setSfxVolume(value);
            if (core) core.mSoundVolume = value;
            if (!dragging) playClick();
        }
    }

    // FUN_0040febf (rwg:19620) CheckboxChecked. The HW (id 5) path checks D3D
    // support (FUN_0044abf6 / FUN_0044ac14 → "Not Supported" / "Warning"
    // messages) and the Fullscreen (id 4) path checks app+0x30a (desktop
    // colour depth → "No Windowed Mode"); neither condition exists in a
    // browser, so toggling only changes the checkbox. Nothing is applied
    // until CLOSE (FUN_0040fd44).
    _checkboxChecked(id, checked) {}

    _applyFullscreen(fullscreen) {
        try {
            if (fullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen?.();
            else if (!fullscreen && document.fullscreenElement) document.exitFullscreen?.();
        } catch (e) { /* not allowed without a user gesture */ }
    }

    _close() {
        this.mIsActive = false;
        this._detach();
        if (sActive === this) sActive = null;
        HtmlDialogs.close('options');
    }

    // Sexy::Slider input (vtable 0x4e431c) on the two <input type="range">:
    //   MouseDown FUN_004395a1: thumbX = ftol((w - thumbW) * val); only a press
    //     on the thumb [thumbX, thumbX + thumbW) starts dragging (+0x9c = 1,
    //     relX +0xa0 = x - thumbX); a press on the track does nothing.
    //   MouseDrag FUN_00439662: while dragging, val = (x - relX) / (w - thumbW)
    //     clamped to [0, 1]; SliderVal only when the value changed.
    //   MouseUp FUN_0043970c: dragging = 0, SliderVal(id, val) always.
    // The native range behaviour (track jump, keyboard steps) is suppressed.
    _attach() {
        const node = document.querySelector('[data-dialog="options"]');
        if (!node) return;
        const on = (target, type, fn, o) => {
            target.addEventListener(type, fn, o);
            this._cleanups.push(() => target.removeEventListener(type, fn, o));
        };
        const wire = (input, id) => {
            if (!input) return;
            let dragging = false, relX = 0, pressed = false;
            const geom = (e) => {
                const rect = input.getBoundingClientRect();
                const w = input.offsetWidth || rect.width;
                const scale = w ? rect.width / w : 1;
                return { x: Math.floor((e.clientX - rect.left) / scale), w };
            };
            on(input, 'pointerdown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                pressed = true;
                input.setPointerCapture?.(e.pointerId);
                const { x, w } = geom(e);
                const tw = thumbWidth();
                const thumbX = Math.trunc((w - tw) * parseFloat(input.value));
                if (x >= thumbX && x < thumbX + tw) {
                    dragging = true;
                    relX = x - thumbX;
                }
            });
            on(input, 'pointermove', (e) => {
                if (!dragging) return;
                const { x, w } = geom(e);
                const old = parseFloat(input.value);
                let v = (x - relX) / (w - thumbWidth());
                if (v < 0) v = 0;
                if (v > 1) v = 1;
                if (v !== old) {
                    input.value = String(v);
                    this._sliderVal(id, v, true);
                }
            });
            const up = () => {
                if (!pressed) return;
                pressed = false;
                dragging = false;
                this._sliderVal(id, parseFloat(input.value), false);
            };
            on(input, 'pointerup', up);
            on(input, 'pointercancel', up);
            on(input, 'mousedown', (e) => e.preventDefault());
            on(input, 'keydown', (e) => { if (e.key !== 'Escape' && e.key !== 'Tab') e.preventDefault(); });
        };
        wire(node.querySelector('[data-bind="music"]'), SLIDER_MUSIC);
        wire(node.querySelector('[data-bind="sfx"]'), SLIDER_SFX);

        // Update FUN_0040f8c8: WidgetManager mKeyDown[VK_ESCAPE] (+0xd0 + 0x1b
        // = +0xeb; mKeyDown at +0xd0, rwg:68190) → clear it and ButtonDepress(
        // 1000). The Options widget keeps updating under the QUIT? dialog.
        // Capture phase so the game view does not also see this Escape.
        on(window, 'keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!this.mIsActive || !HtmlDialogs.isDialogOpen('options')) {
                // Closed from elsewhere (e.g. HtmlDialogs.closeAll).
                this.mIsActive = false;
                this._detach();
                return;
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            this._buttonDepress(ID_CLOSE);
        }, true);
    }

    _detach() {
        for (const fn of this._cleanups) fn();
        this._cleanups = [];
    }
}
