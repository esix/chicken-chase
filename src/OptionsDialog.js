// Sexy::OptionsDialog (FUN_0040f57b:19093). Verified per DECOMPILED_MAP.md
// section 13 + Options research agent (2026-05-06).
//
// Box (FUN_0040fbff:19209-19214):
//   x=0xe3=227, y=(600-h)/2 (centered), w=0x15a=346
//   h = 0x13b=315 normal mode / 0x185=389 in-game (when extra MAIN MENU + RESTART buttons appear)
//
// Widgets (member offsets):
//   this[0x59] (+0x164) Slider — Music         (id=0)
//   this[0x5a] (+0x168) Slider — Sound FX      (id=1)
//   this[0x5b] (+0x16c) Button "MAIN MENU"     (in-game only)
//   this[0x5c] (+0x170) Button "RESTART LEVEL" (in-game only)
//   this[0x5d] (+0x174) Checkbox — HW Accel    (id=5, seeded from FUN_0044abec)
//   this[0x5e] (+0x178) Checkbox — Fullscreen  (id=4, seeded from !*(mApp+0x307))
//
// Slider range: double 0..1 (FUN_00439379 ctor + FUN_00439662 clamp).
// Checkbox toggles +0x8c byte; image cell index 0=unchecked, 1=checked.
// Quit confirm: "QUIT?" + "Your level progress will be lost. Continue?"
// HW Accel error popup: "Hardware acceleration cannot be enabled..." (line 19665)
// Strings confirmed: "OPTIONS" (19122), "CLOSE" (19118), "MAIN MENU" (19174),
//   "RESTART LEVEL" (19178), "Music" (19329), "Sound FX" (19334),
//   "Fullscreen" (19340), "Hardware Acceleration" (19346).

import { IMAGES, SOUNDS } from './Res.js';
import { SoundManager } from './SexyApp.js';
import { drawFitText, wrapText } from './TextUtil.js';

export class OptionsDialog {
    constructor(gameApp, opts = {}) {
        this.mGameApp = gameApp;
        this.mInGame = !!opts.inGame;
        this.mOnClose = opts.onClose || null;
        this.mOnMainMenu = opts.onMainMenu || null;
        this.mOnRestart = opts.onRestart || null;
        this.mIsActive = true;

        // Initial values from app state.
        this.mMusic = (gameApp && gameApp.mCore) ? (gameApp.mCore.mMusicVolume ?? 0.5) : 0.5;
        this.mSfx   = (gameApp && gameApp.mCore) ? (gameApp.mCore.mSoundVolume ?? 0.7) : 0.7;
        this.mFullscreen = !!opts.fullscreen;     // can't actually toggle in browser
        this.mHwAccel = true;                     // canvas always uses GPU compositor

        this._draggingSlider = null; // 'music' | 'sfx' | null
        this._confirmQuit = null;    // 'mainmenu' | 'restart' | null
        // Mouse position for button-hover state — updated in mouseMove.
        // Default to off-screen so hover is inactive until the first move.
        this._mouseX = -1;
        this._mouseY = -1;
    }

    isShown() { return this.mIsActive; }

    _box() {
        // Decompiled-exact rect (FUN_0040fbff rwg:19209/19211/19214):
        //   FUN_0040fbff(this,0xe3,(600-h)/2,0x15a,h) -> x=227, w=346,
        //   h = 0x13b=315 (normal) / 0x185=389 (in-game, +MAIN MENU/RESTART).
        // The previous 420x380/460 box was a deliberate deviation; reverted.
        const h = this.mInGame ? 389 : 315; // rwg:19209 0x13b / rwg:19211 0x185
        const w = 346;                       // rwg:19214 0x15a
        return { x: 227, y: Math.floor((600 - h) / 2), w, h }; // rwg:19214 x=0xe3
    }

    draw(g) {
        if (!this.mIsActive) return;
        // No modal scrim per screenshot 06 — the dialog renders directly
        // over the main menu without dimming the background.

        const { x: bx, y: by, w: bw, h: bh } = this._box();
        // 9-slice so the baked title plate stays a natural fixed size at the top
        // (a plain stretch ballooned it). Returns the plate's center/bottom Y.
        const plate = g.drawDialogBox(IMAGES.IMAGE_DIALOG_BOX, bx, by, bw, bh);

        // Title 'OPTIONS' (string rwg:19122) CENTERED IN the plate. FONT_DLG_HEADER
        // = ArialBlack14 (resources.xml:61); dark color measured from screenshot 06.
        g.ctx.fillStyle = '#524931';
        g.ctx.textAlign = 'center';
        g.ctx.textBaseline = 'middle';
        drawFitText(g.ctx, 'OPTIONS', bx + bw / 2, plate.plateCenterY, bw - 80,
            'bold 18px "Arial Black", Arial, sans-serif');
        g.ctx.textBaseline = 'alphabetic';

        // Widget positions from FUN_0040fbff, relative to box origin (param_1=bx,
        // param_2=by): Music slider x=bx+140 (0x8c), y=by+80 (0x50), w=346-0xaa=176
        // (rwg:19453); Sound FX one row below (screenshot 06); Fullscreen checkbox
        // x=bx+40 (0x28), y=by+155 (0x9b) (rwg:19459/19460); HW Accel one
        // checkbox-height (40, checkbox.png cell) lower (rwg:19462).
        const sliderX = bx + 140;   // rwg:19453 param_1+0x8c
        const sliderW = bw - 170;   // rwg:19453 param_3-0xaa = 176
        const labelX = bx + 16;     // measured from screenshot 06

        let row = by + 80;          // rwg:19453 param_2+0x50
        this._drawSliderRow(g, 'Music', labelX, row, sliderX, sliderW, this.mMusic);
        this._musicRect = { x: sliderX, y: row - 12, w: sliderW, h: 28 };

        row += 40;                  // Sound FX one row below (screenshot 06)
        this._drawSliderRow(g, 'Sound FX', labelX, row, sliderX, sliderW, this.mSfx);
        this._sfxRect = { x: sliderX, y: row - 12, w: sliderW, h: 28 };

        const cbX = bx + 40;        // rwg:19459 param_1+0x28
        this._fullscreenRect = this._drawCheckboxRow(g, 'Fullscreen', cbX, by + 155, this.mFullscreen);     // rwg:19460 param_2+0x9b
        this._hwAccelRect = this._drawCheckboxRow(g, 'Hardware Acceleration', cbX, by + 195, this.mHwAccel); // +40 checkbox cell

        // Buttons. Strings: 'CLOSE' rwg:19118, 'MAIN MENU' rwg:19174,
        // 'RESTART LEVEL' rwg:19178 (in-game only, this+0x5f rwg:19181-19184).
        // Place them directly under the last checkbox (HW accel bottom ≈ by+235)
        // so there is no dead gap; the in-game extras stack above CLOSE.
        const closeImg = IMAGES.IMAGE_DIALOG_BUTTON;
        const btnW = bw - 56, btnH = 34, gap = 8;
        const btnX = bx + (bw - btnW) / 2;
        let btnY = by + 248; // just below HW Acceleration (by+195 + 40 cell)
        if (this.mInGame) {
            this._restartRect = this._drawDialogButton(g, closeImg, 'RESTART LEVEL', btnX, btnY, btnW, btnH);
            btnY += btnH + gap;
            this._mainMenuRect = this._drawDialogButton(g, closeImg, 'MAIN MENU', btnX, btnY, btnW, btnH);
            btnY += btnH + gap;
        } else {
            this._mainMenuRect = null;
            this._restartRect = null;
        }
        this._closeRect = this._drawDialogButton(g, closeImg, 'CLOSE', btnX, btnY, btnW, btnH);

        // Quit confirm overlays the (still-visible) options dialog — screenshot 32.
        if (this._confirmQuit) {
            this._drawQuitConfirm(g);
        }
    }

    _drawSliderRow(g, label, labelX, y, sliderX, sliderW, value) {
        const ctx = g.ctx;
        // Labels are DARK on the dialog's light tan inner panel (screenshot 06;
        // the earlier white was wrong — the panel is light, not dark brown).
        // FONT_DLG_LINES = ArialBlack12 (resources.xml:62).
        ctx.fillStyle = '#3a2410'; // measured from screenshot 06
        ctx.font = 'bold 12px "Arial Black", Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(label, labelX, y + 4);

        // Track — taller per screenshot 06 (~20px vs old 8px).
        const trackImg = IMAGES.IMAGE_SLIDER_TRACK;
        const trackH = 20;
        const trackY = y - trackH / 2 + 4;
        if (trackImg && trackImg.img && g._isReady && g._isReady(trackImg.img)) {
            ctx.drawImage(trackImg.img, sliderX, trackY, sliderW, trackH);
        } else {
            ctx.fillStyle = '#5a3010';
            ctx.fillRect(sliderX, trackY, sliderW, trackH);
        }

        // Thumb at fraction `value`
        const thumbImg = IMAGES.IMAGE_SLIDER_THUMB;
        const thumbW = (thumbImg && thumbImg.img) ? thumbImg.mWidth : 14;
        const thumbH = (thumbImg && thumbImg.img) ? thumbImg.mHeight : 18;
        const thumbX = sliderX + (sliderW - thumbW) * Math.max(0, Math.min(1, value));
        const thumbY = y - thumbH / 2 + 4;
        if (thumbImg && thumbImg.img && g._isReady && g._isReady(thumbImg.img)) {
            ctx.drawImage(thumbImg.img, thumbX, thumbY, thumbW, thumbH);
        } else {
            ctx.fillStyle = '#ddd';
            ctx.fillRect(thumbX, thumbY, thumbW, thumbH);
            ctx.strokeStyle = '#000';
            ctx.strokeRect(thumbX, thumbY, thumbW, thumbH);
        }
    }

    _drawCheckboxRow(g, label, x, y, checked) {
        const ctx = g.ctx;
        const cbImg = IMAGES.IMAGE_CHECKBOX;
        // checkbox.png is 80x40 — two 40x40 cells side-by-side
        // (col 0 = unchecked blue circle, col 1 = checked with white check).
        // Per screenshot 06, checkboxes display at near-native 32x32 size
        // rather than the small 22x22 we had before.
        const drawW = 32, drawH = 32;
        if (cbImg && cbImg.img && g._isReady && g._isReady(cbImg.img)) {
            const cbW = cbImg.getCelWidth();
            const cbH = cbImg.getCelHeight ? cbImg.getCelHeight() : cbImg.mHeight;
            const srcX = checked ? cbW : 0;
            ctx.drawImage(cbImg.img, srcX, 0, cbW, cbH, x, y, drawW, drawH);
        } else {
            ctx.fillStyle = '#fff';
            ctx.fillRect(x, y, drawW, drawH);
            ctx.strokeStyle = '#3a1a05';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, drawW, drawH);
            if (checked) {
                ctx.beginPath();
                ctx.moveTo(x + 4, y + 11);
                ctx.lineTo(x + 9, y + 16);
                ctx.lineTo(x + 18, y + 5);
                ctx.stroke();
            }
        }
        // Labels DARK on the light tan panel (screenshot 06), same as sliders.
        // FONT_DLG_LINES = ArialBlack12 (resources.xml:62).
        ctx.fillStyle = '#3a2410'; // measured from screenshot 06
        ctx.font = 'bold 12px "Arial Black", Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + drawW + 10, y + drawH / 2);
        ctx.textBaseline = 'alphabetic';
        // Click region covers the checkbox AND its label — clicking the
        // text should toggle the option, matching standard checkbox UX.
        const labelW = ctx.measureText(label).width;
        return { x, y, w: drawW + 10 + labelW, h: drawH };
    }

    _drawDialogButton(g, img, label, x, y, w, h) {
        const ctx = g.ctx;
        // Swap to OVER variant if mouse is hovering this button. Uses the
        // tracked mouse position from mouseMove — defaults to off-screen so
        // pre-move state shows the base button (no false hover).
        const hover = this._mouseX >= x && this._mouseX < x + w
            && this._mouseY >= y && this._mouseY < y + h;
        const overImg = hover ? IMAGES.IMAGE_DIALOG_BUTTON_OVER : null;
        const useImg = (overImg && overImg.img && g._isReady && g._isReady(overImg.img))
            ? overImg : img;
        if (useImg && useImg.img && g._isReady && g._isReady(useImg.img)) {
            ctx.drawImage(useImg.img, x, y, w, h);
        } else {
            ctx.fillStyle = '#5cb830';
            ctx.fillRect(x, y, w, h);
        }
        // Button labels white (rwg:40887-40891) on the green dialog button.
        // FONT_DLG_BUTTONS = ArialBlack12 (resources.xml:63).
        ctx.fillStyle = '#fff';
        ctx.font = '12px "Arial Black", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, x + w / 2, y + h / 2 + 4);
        return { x, y, w, h };
    }

    _drawQuitConfirm(g) {
        // QUIT confirm built by FUN_0040279c (rwg:19569). Box size is framework-
        // laid (no literal); ~346x180 + layout measured from screenshot 32.
        const ctx = g.ctx;
        const cw = 346, ch = 180;
        const cx = Math.round((800 - cw) / 2), cy = Math.round((600 - ch) / 2);
        const dlgImg = IMAGES.IMAGE_DIALOG_BOX;
        if (dlgImg && dlgImg.img && g._isReady && g._isReady(dlgImg.img)) {
            ctx.drawImage(dlgImg.img, cx, cy, cw, ch);
        } else {
            ctx.fillStyle = 'rgba(80, 50, 20, 0.95)';
            ctx.fillRect(cx, cy, cw, ch);
        }
        // 'QUIT?' (string rwg:19564), FONT_DLG_HEADER=ArialBlack14 (resources.xml:61),
        // white text measured from screenshot 32.
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        drawFitText(ctx, 'QUIT?', cx + cw / 2, cy + 44, cw - 40,
            'bold 16px "Arial Black", Arial, sans-serif');
        // Body (string rwg:19567), FONT_DLG_LINES=ArialBlack12, white, wrapped.
        ctx.font = '13px "Arial Black", Arial, sans-serif';
        const lines = wrapText(ctx, 'Your level progress will be lost. Continue?', cw - 50);
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], cx + cw / 2, cy + 82 + i * 20);
        }

        // YES / NO buttons side by side (screenshot 32 ~120 wide each).
        const btnImg = IMAGES.IMAGE_DIALOG_BUTTON;
        const btnW = 120, btnH = 34;
        const gap = 16;
        const yesX = cx + (cw - btnW * 2 - gap) / 2;
        const noX = yesX + btnW + gap;
        const btnY = cy + ch - btnH - 18;
        this._yesRect = this._drawDialogButton(g, btnImg, 'YES', yesX, btnY, btnW, btnH);
        this._noRect = this._drawDialogButton(g, btnImg, 'NO', noX, btnY, btnW, btnH);
    }

    mouseDown(x, y, btn) {
        if (!this.mIsActive || btn !== 0) return true;

        // Quit confirm dispatch
        if (this._confirmQuit) {
            if (this._inside(x, y, this._yesRect)) {
                const action = this._confirmQuit;
                this._confirmQuit = null;
                this._dismiss();
                if (action === 'mainmenu' && this.mOnMainMenu) this.mOnMainMenu();
                else if (action === 'restart' && this.mOnRestart) this.mOnRestart();
                return true;
            }
            if (this._inside(x, y, this._noRect)) {
                this._confirmQuit = null;
                return true;
            }
            return true;
        }

        // CLOSE
        if (this._inside(x, y, this._closeRect)) {
            this._dismiss();
            return true;
        }

        // In-game extras → confirm
        if (this._mainMenuRect && this._inside(x, y, this._mainMenuRect)) {
            this._confirmQuit = 'mainmenu';
            return true;
        }
        if (this._restartRect && this._inside(x, y, this._restartRect)) {
            this._confirmQuit = 'restart';
            return true;
        }

        // Sliders — start drag
        if (this._inside(x, y, this._musicRect)) {
            this._draggingSlider = 'music';
            this._setSliderFromX('music', x);
            return true;
        }
        if (this._inside(x, y, this._sfxRect)) {
            this._draggingSlider = 'sfx';
            this._setSliderFromX('sfx', x);
            return true;
        }

        // Checkboxes
        if (this._inside(x, y, this._fullscreenRect)) {
            this.mFullscreen = !this.mFullscreen;
            this._applyFullscreen();
            return true;
        }
        if (this._inside(x, y, this._hwAccelRect)) {
            this.mHwAccel = !this.mHwAccel;
            return true;
        }

        return true; // consume all clicks while modal
    }

    mouseMove(x, y) {
        if (!this.mIsActive) return false;
        // Track for button hover state regardless of drag.
        this._mouseX = x;
        this._mouseY = y;
        if (!this._draggingSlider) return false;
        this._setSliderFromX(this._draggingSlider, x);
        return true;
    }

    mouseUp(x, y, btn) {
        this._draggingSlider = null;
    }

    keyDown(key) {
        if (!this.mIsActive) return false;
        if (this._confirmQuit) {
            if (key === 'Escape') { this._confirmQuit = null; return true; }
            if (key === 'Enter')  {
                const action = this._confirmQuit;
                this._confirmQuit = null;
                this._dismiss();
                if (action === 'mainmenu' && this.mOnMainMenu) this.mOnMainMenu();
                else if (action === 'restart' && this.mOnRestart) this.mOnRestart();
                return true;
            }
        }
        if (key === 'Escape') { this._dismiss(); return true; }
        return true;
    }

    _inside(x, y, r) {
        return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    }

    _setSliderFromX(which, x) {
        const r = which === 'music' ? this._musicRect : this._sfxRect;
        if (!r) return;
        const t = Math.max(0, Math.min(1, (x - r.x) / r.w));
        if (which === 'music') {
            this.mMusic = t;
            if (this.mGameApp && this.mGameApp.mCore) {
                this.mGameApp.mCore.mMusicVolume = t;
            }
            SoundManager.setMusicVolume(t);
        } else {
            this.mSfx = t;
            if (this.mGameApp && this.mGameApp.mCore) {
                this.mGameApp.mCore.mSoundVolume = t;
            }
            SoundManager.setSfxVolume(t);
        }
    }

    _applyFullscreen() {
        // Browser fullscreen API
        try {
            if (this.mFullscreen) {
                document.documentElement.requestFullscreen?.();
            } else if (document.fullscreenElement) {
                document.exitFullscreen?.();
            }
        } catch (e) { /* ignore */ }
    }

    _dismiss() {
        this.mIsActive = false;
        // Persist
        if (this.mGameApp && this.mGameApp.mCore && this.mGameApp.mCore.save) {
            this.mGameApp.mCore.save();
        }
        if (this.mOnClose) this.mOnClose();
        if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
    }
}
