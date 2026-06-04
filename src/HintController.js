// Port of Sexy::HintController - vtable at 004dcfd4
// and Sexy::HintDialog - vtable at 004dcffc
//
// Hint system that shows tutorial messages during gameplay
// Hint text strings sourced verbatim from the binary (rwg_functions.c lines
// referenced inline). Original FUN_00422a24 dispatches level-specific hints.

import { IMAGES, SOUNDS } from './Res.js';
import { HtmlDialogs } from './HtmlDialogs.js';

// Hint triggers from decompiled code at lines 41991-42538
export const HintType = {
    FIRST_CHICKENS: 0,
    COLLECT_COINS: 1,
    BUY_CHICKEN: 2,
    COLLECT_COINS_GOAL: 3,
    COLLECT_EGG: 4,
    SICK_CHICKEN: 5,
    COLLECT_EGGS_GOAL: 6,
    HATCH_EGG: 7,
    HATCH_GOAL: 8,
    RAVEN_WARNING: 9,
    BUY_ROOSTER: 10,
    SELL_CHICKENS: 11,
    SELL_BUTTON: 12,
    BUY_ROOSTERS_MORE: 13,
    FARM_CROWDED: 14,
    NEED_MAGIC_EGGS: 15,
    TOO_HUNGRY: 16,
    SURPRISE_OPTION: 17,
    SELL_FOR_BONUS: 18,
};

const hintTexts = {
    [HintType.FIRST_CHICKENS]: "These are your first chickens! Click anywhere to feed them.",
    [HintType.COLLECT_COINS]: "Collect coins as soon as possible. The longer the coin is available, the less valuable it becomes. Collect coins to gain money for buying more chickens.",
    [HintType.BUY_CHICKEN]: "You can buy one new chicken.",
    [HintType.COLLECT_COINS_GOAL]: "Collect 15 coins to complete the level.",
    [HintType.COLLECT_EGG]: "Click on an egg to collect it.",
    [HintType.SICK_CHICKEN]: "Your chicken is sick! Click on your chicken to cure it!",
    [HintType.COLLECT_EGGS_GOAL]: "Collect 10 eggs to complete the level.",
    [HintType.HATCH_EGG]: "Click here to hatch the egg.",
    [HintType.HATCH_GOAL]: "Your task is to hatch or buy 12 chickens.",
    [HintType.RAVEN_WARNING]: "The ravens want to steal your chickens. Force the ravens away by clicking on them whenever they appear on screen.",
    [HintType.BUY_ROOSTER]: "Buy roosters to protect your chickens from the ravens.",
    [HintType.SELL_CHICKENS]: "Click the button to sell chickens",
    [HintType.SELL_BUTTON]: "You can sell chickens here.",
    [HintType.BUY_ROOSTERS_MORE]: "Buy more roosters to protect your chickens from the ravens.",
    [HintType.FARM_CROWDED]: "You farm is too crowded! You should sell some of your chickens.",
    [HintType.NEED_MAGIC_EGGS]: "You need to lay some more eggs to feed the magic chickens. ",
    [HintType.TOO_HUNGRY]: "Your chickens are too hungry. Drop more seeds for them.",
    // L7 surprise-system introduction (rwg_functions.c:42749).
    [HintType.SURPRISE_OPTION]: "Click on the surprise option located beneath the level task bar. Depending on your luck, it can help or hurt you!",
    // L5 sell-chickens-for-bonus hint (FUN_00422a24:42718).
    [HintType.SELL_FOR_BONUS]: "Sell chickens to earn $5,000. For each adult chicken sold, you will be able to buy some younger ones.",
};

export class HintController {
    // Port of Sexy::HintController - vtable at 004dcfd4
    constructor(core = null) {
        this.mShownHints = new Set();       // offset +0x00
        this.mCurrentHint = null;           // offset +0x04
        // mHintTimer / mHintDuration (offsets +0x08, +0x0c) and mEnabled
        // (+0x10) were dead — our hint dialog is modal and stays until the
        // OK click, never auto-dismissed by a timer.
        this.mCore = core;
        // Restore previously-disabled hints from player profile
        if (core && core.mDisabledHints) {
            this.mDisabledTypes = new Set(core.mDisabledHints);
        }
    }

    // Show a hint if it hasn't been shown before and isn't user-disabled
    showHint(type) {
        if (this.mShownHints.has(type)) return;
        if (this.mCurrentHint !== null) return;
        if (this.mDisabledTypes && this.mDisabledTypes.has(type)) return;

        this.mShownHints.add(type);
        this.mCurrentHint = { type: type, text: hintTexts[type] || '' };
        // Soft chime to draw attention (SOUND_CLICK is the closest match).
        if (SOUNDS && SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
        this._openHtml();
    }

    // Force show a hint (even if already shown)
    forceHint(type) {
        this.mCurrentHint = { type: type, text: hintTexts[type] || '' };
        this._openHtml();
    }

    // Open the HTML hint dialog. OK persists the "Don't show" choice per type.
    _openHtml() {
        const hint = this.mCurrentHint;
        HtmlDialogs.open('hint', {
            binds: { text: hint.text, dontshow: false },
            actions: {
                ok: () => {
                    const dontShow = HtmlDialogs.read('hint', 'dontshow');
                    if (dontShow && this.mCurrentHint) {
                        this.mDisabledTypes = this.mDisabledTypes || new Set();
                        this.mDisabledTypes.add(this.mCurrentHint.type);
                        if (this.mCore) {
                            this.mCore.mDisabledHints = Array.from(this.mDisabledTypes);
                            if (this.mCore.save) this.mCore.save();
                        }
                    }
                    this.dismiss();
                },
            },
        });
    }

    // Original HintDialog is modal — stays until OK clicked. No auto-dismiss.
    update() {
        // Intentionally empty: dialog persists until the OK action dismisses it.
    }

    dismiss() {
        this.mCurrentHint = null;
        HtmlDialogs.close('hint');
    }

    // Sexy::HintDialog (FUN_0040d557:16491). Modal at (200, 100, 400, 400).
    // Title "HINT" (FONT_DLG_HEADER), body text (FONT_DLG_LINES), "Don't show"
    // checkbox at this[0x57], OK button slot 0. DECOMPILED_MAP.md section 13.
    //
    // dialog.png is 250x210 native — when stretched to 400x400, the title-plate
    // band in the image lives roughly at y=20..70 and the body content area
    // roughly at y=80..330 (relative to box top). Keep text inside that band.
    // The hint is now an HTML dialog (see _openHtml); this canvas renderer is
    // unused (kept as reference during the HTML migration). GameView still
    // calls draw(), so the early return makes it a no-op.
    draw(g) {
        return;
        if (!this.mCurrentHint) return;
        const text = this.mCurrentHint.text;
        if (!text) return;

        // Modal scrim
        g.setColor(0, 0, 0, 120);
        g.fillRect(0, 0, 800, 600);

        // Dialog box at (200, 100, 400, 400), 9-sliced so the baked title plate
        // stays a fixed natural size at the top.
        const boxX = 200, boxY = 100, boxW = 400, boxH = 400;
        const plate = g.drawDialogBox(IMAGES.IMAGE_DIALOG_BOX, boxX, boxY, boxW, boxH);

        // Title 'HINT' (string rwg:16515) DARK, centered IN the top plate (no
        // green plate — screenshots 15/20/28 show plain dark text on the plate).
        // FONT_DLG_HEADER = ArialBlack14 (resources.xml:61).
        const titleCx = boxX + boxW / 2;
        g.ctx.fillStyle = '#3a1a05';
        g.ctx.font = 'bold 18px "Arial Black", Arial, sans-serif';
        g.ctx.textAlign = 'center';
        g.ctx.textBaseline = 'middle';
        g.ctx.fillText('HINT', titleCx, plate.plateCenterY);
        g.ctx.textBaseline = 'alphabetic';

        // Body text — wrap inside visible plate body area.
        // Screenshot 15: text starts ~30% down the dialog and uses ~75% of the width.
        // Body text — FONT_DLG_LINES = ArialBlack12 (resources.xml:62), dark.
        g.ctx.fillStyle = '#3a1a05';
        g.ctx.font = 'bold 13px "Arial Black", Arial, sans-serif';
        g.ctx.textAlign = 'center';
        const wrapW = 300;       // ~75% of 400 — keeps text within painted plate
        const lineH = 18;
        const bodyTop = boxY + 110;
        const bodyBottom = boxY + boxH - 110; // leave room for checkbox + OK
        const cx = boxX + boxW / 2;

        // Split into wrapped lines first so we can vertically center if short
        const words = text.split(' ');
        const lines = [];
        let line = '';
        for (const word of words) {
            const testLine = line ? line + ' ' + word : word;
            if (g.ctx.measureText(testLine).width > wrapW && line) {
                lines.push(line);
                line = word;
            } else {
                line = testLine;
            }
        }
        if (line) lines.push(line);

        // Vertically center the block within available space, but cap to fit
        const maxLines = Math.floor((bodyBottom - bodyTop) / lineH);
        const visible = lines.slice(0, maxLines);
        const blockH = visible.length * lineH;
        const startY = bodyTop + Math.max(0, ((bodyBottom - bodyTop) - blockH) / 2);
        for (let i = 0; i < visible.length; i++) {
            g.ctx.fillText(visible[i], cx, startY + i * lineH + 12);
        }

        // "Don't show" checkbox bottom-left of body area (rwg_functions.c:16625)
        // Uses the IMAGE_CHECKBOX sprite (80x40, 2 horizontal cells of 40x40).
        const cbX = boxX + 60, cbY = boxY + boxH - 90;
        const cbSize = 22;
        const cbImg = IMAGES.IMAGE_CHECKBOX;
        if (cbImg && cbImg.img && g._isReady && g._isReady(cbImg.img)) {
            const cw = cbImg.getCelWidth();
            const ch = cbImg.getCelHeight ? cbImg.getCelHeight() : cbImg.mHeight;
            const srcX = this.mDontShow ? cw : 0;
            g.ctx.drawImage(cbImg.img, srcX, 0, cw, ch, cbX, cbY, cbSize, cbSize);
        } else {
            g.ctx.fillStyle = '#fff';
            g.ctx.fillRect(cbX, cbY, cbSize, cbSize);
            g.ctx.strokeStyle = '#3a1a05';
            g.ctx.lineWidth = 2;
            g.ctx.strokeRect(cbX, cbY, cbSize, cbSize);
            if (this.mDontShow) {
                g.ctx.beginPath();
                g.ctx.moveTo(cbX + 4, cbY + 11);
                g.ctx.lineTo(cbX + 9, cbY + 16);
                g.ctx.lineTo(cbX + 18, cbY + 5);
                g.ctx.stroke();
            }
        }
        // "Don't show" (string rwg:16625), FONT_12=ArialBlack12 (resources.xml:55), dark.
        g.ctx.fillStyle = '#3a1a05';
        g.ctx.font = '12px "Arial Black", Arial, sans-serif';
        g.ctx.textAlign = 'left';
        g.ctx.textBaseline = 'middle';
        g.ctx.fillText("Don't show", cbX + cbSize + 8, cbY + cbSize / 2);
        g.ctx.textBaseline = 'alphabetic';
        // Click region covers both checkbox AND label text — standard UX
        // pattern; clicking the label toggles the box, not just the box itself.
        const labelW = g.ctx.measureText("Don't show").width;
        this._cbRect = { x: cbX, y: cbY, w: cbSize + 8 + labelW, h: cbSize };

        // OK button (green dialog_btn). Original size 100x38.
        const btnW = 100, btnH = 38;
        const btnX = boxX + (boxW - btnW) / 2;
        const btnY = boxY + boxH - btnH - 35;
        const btnImg = IMAGES.IMAGE_DIALOG_BUTTON;
        const btnOverImg = IMAGES.IMAGE_DIALOG_BUTTON_OVER;
        // Hover state via stored mouse position (updated in handleMouseMove).
        const mx = (typeof this._mouseX === 'number') ? this._mouseX : -1;
        const my = (typeof this._mouseY === 'number') ? this._mouseY : -1;
        const over = mx >= btnX && mx < btnX + btnW && my >= btnY && my < btnY + btnH;
        const useImg = (over && btnOverImg && btnOverImg.img
            && g._isReady && g._isReady(btnOverImg.img)) ? btnOverImg : btnImg;
        if (useImg && useImg.img && g._isReady && g._isReady(useImg.img)) {
            g.ctx.drawImage(useImg.img, btnX, btnY, btnW, btnH);
        } else {
            g.setColor(80, 160, 40, 255);
            g.fillRect(btnX, btnY, btnW, btnH);
        }
        // 'OK' (string rwg:16513), FONT_DLG_BUTTONS=ArialBlack12 (resources.xml:63),
        // white text CONFIRMED (rwg:40887-40891).
        g.ctx.fillStyle = '#fff';
        g.ctx.font = '12px "Arial Black", Arial, sans-serif';
        g.ctx.textAlign = 'center';
        g.ctx.fillText('OK', btnX + btnW / 2, btnY + btnH / 2 + 4);
        g.ctx.textAlign = 'left';

        this._okRect = { x: btnX, y: btnY, w: btnW, h: btnH };
    }

    // Track mouse position for button hover state in draw().
    handleMouseMove(x, y) {
        this._mouseX = x;
        this._mouseY = y;
    }

    // Click handler — returns true if dialog consumed the click
    handleClick(x, y) {
        if (!this.mCurrentHint) return false;
        // "Don't show" checkbox — toggles flag; if on, future hints of this type
        // are suppressed.
        if (this._cbRect
            && x >= this._cbRect.x && x <= this._cbRect.x + this._cbRect.w
            && y >= this._cbRect.y && y <= this._cbRect.y + this._cbRect.h) {
            this.mDontShow = !this.mDontShow;
            return true;
        }
        if (this._okRect
            && x >= this._okRect.x && x <= this._okRect.x + this._okRect.w
            && y >= this._okRect.y && y <= this._okRect.y + this._okRect.h) {
            // Persist "don't show" preference per hint type — saves to player profile.
            if (this.mDontShow && this.mCurrentHint) {
                this.mDisabledTypes = this.mDisabledTypes || new Set();
                this.mDisabledTypes.add(this.mCurrentHint.type);
                if (this.mCore) {
                    this.mCore.mDisabledHints = Array.from(this.mDisabledTypes);
                    if (this.mCore.save) this.mCore.save();
                }
            }
            this.mDontShow = false;
            this.dismiss();
            return true;
        }
        return true; // consume all clicks while modal
    }

    isShown() {
        return this.mCurrentHint !== null;
    }
}
