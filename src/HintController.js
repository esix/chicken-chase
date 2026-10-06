// Port of Sexy::HintController (vtable 004dcfd4). The object lives at
// game+0x2c (allocated 0x40 bytes, rwg_functions.c:7621-7635) and has two jobs:
//
//  1. The in-field HINT TEXT BAR with an animated pointer (screenshot 14:
//     "Collect 15 coins to complete the level." under an up-pointer):
//       FUN_0040d39f (rwg_functions.c:16291) setText(text, point, duration)
//       FUN_0040d281 (rwg_functions.c:16241) per-tick update (typewriter,
//                    pointer bob, timeout)
//       FUN_0040d4cc (rwg_functions.c:16423) visible (typed-so-far) substring
//       GameView::Draw asm 0x40b973-0x40ba8f draws it (FONT_HINT, pointer
//                    IMAGE_HINT_POINTER_UP/DOWN).
//  2. The listener of the modal HintDialog:
//       FUN_0040d435 (rwg_functions.c:16346) pause + open HintDialog(text)
//       vtable[0] FUN_0040d4bb (rwg_functions.c:16402) dialog closed -> unpause
//       vtable[1] FUN_0040d27d -> vtable[0]
//
// WHICH hint uses which presentation is decided by the level tutorial
// dispatchers FUN_00421f??..FUN_00422bb1 (rwg_functions.c:41985-42810), not
// by this class. The JS triggers live in GameView.js (out of this file's
// scope); see HINT_PRESENTATION below for the original call-site data.

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

// Original presentation of each hint (asm call sites of FUN_0040d39f /
// FUN_0040d435 / FUN_00422bb1). 'bar' = setText(text, point, duration),
// 'dialog' = modal HintDialog. Points are screen pixels; (0,0) = no pointer;
// null = computed at runtime by the dispatcher (egg / chick rect centre etc).
// duration -1 (0xffffffff) = no timeout. Kept as data for the GameView
// triggers; showHint() below still opens the dialog for every type (the
// existing JS trigger flow), see report.
export const HINT_PRESENTATION = {
    [HintType.FIRST_CHICKENS]:    { kind: 'bar', point: [0, 0], duration: 500 },     // asm 0x4220ab-0x4220cf (point = ebx; value UNKNOWN, assumed 0)
    [HintType.COLLECT_COINS_GOAL]:{ kind: 'bar', point: null, duration: 500 },       // asm 0x42210a-0x42212b
    [HintType.BUY_CHICKEN]:       { kind: 'bar', point: [75, 62], duration: 500 },   // asm 0x4221a7-0x4221d6
    [HintType.COLLECT_EGG]:       { kind: 'bar', point: null, duration: -1 },        // asm 0x4222d6-0x4222fc (egg rect centre +10/-10)
    [HintType.SICK_CHICKEN]:      { kind: 'bar', point: null, duration: -1 },        // asm 0x4223ef-0x422414 (chick rect centre)
    [HintType.COLLECT_EGGS_GOAL]: { kind: 'bar', point: [646, 115], duration: 500 }, // asm 0x4224a4-0x4224d3
    [HintType.HATCH_EGG]:         { kind: 'bar', point: [40, 125], duration: -1 },   // asm 0x4225db-0x422603
    [HintType.HATCH_GOAL]:        { kind: 'bar', point: [646, 115], duration: null },// asm 0x422659-0x422684 (duration = edi, UNKNOWN)
    [HintType.RAVEN_WARNING]:     { kind: 'dialog' },                                 // asm 0x4226e6 FUN_0040d435
    [HintType.BUY_ROOSTER]:       { kind: 'bar', point: [225, 62], duration: 500 },  // asm 0x422714-0x42273f
    [HintType.SELL_CHICKENS]:     { kind: 'bar', point: null, duration: null },       // rwg_functions.c:42424-42436
    [HintType.SELL_BUTTON]:       { kind: 'bar', point: null, duration: null },       // FUN_004227d0 rwg_functions.c:42457
    [HintType.BUY_ROOSTERS_MORE]: { kind: 'bar', point: null, duration: null },       // FUN_00422802 rwg_functions.c:42515
    [HintType.FARM_CROWDED]:      { kind: 'bar', point: [0, 0], duration: 500 },     // asm 0x4228d3-0x422903 (point = ebx, assumed 0)
    [HintType.NEED_MAGIC_EGGS]:   { kind: 'bar', point: [0, 0], duration: 500 },     // same call site
    [HintType.TOO_HUNGRY]:        { kind: 'bar', point: [0, 0], duration: 500 },     // same call site
    [HintType.COLLECT_COINS]:     { kind: 'dialog' },                                 // FUN_00422bb1 (rwg_functions.c:42690)
    [HintType.SELL_FOR_BONUS]:    { kind: 'dialog' },                                 // FUN_00422bb1 (rwg_functions.c:42717)
    [HintType.SURPRISE_OPTION]:   { kind: 'dialog' },                                 // FUN_00422bb1 (rwg_functions.c:42749)
};

// Global frame divider DAT_005352c0 used by FUN_0040d281 (one typed char
// every 3 update ticks). It is a global in the original, shared by all
// HintController instances.
let _typeTick = 0;

export class HintController {
    // Port of Sexy::HintController - vtable at 004dcfd4. Constructor inline at
    // rwg_functions.c:7621-7635: +4 = 0, string at +8 = "", +0x24..+0x30 = 0,
    // +0x38 = 0, +0x3c = 0.
    constructor(core = null) {
        // --- text bar state (original fields) ---
        this.mVisibleChars = 0;        // +0x04
        this.mText = '';               // +0x08 (length = +0x1c)
        this.mPointerX = 0;            // +0x24 animated pointer position
        this.mPointerY = 0;            // +0x28
        this.mPointX = 0;              // +0x2c target point
        this.mPointY = 0;              // +0x30
        this.mPointDown = false;       // +0x34 (point.y > 200)
        this.mTimer = 0;               // +0x38 remaining ticks (0 = none)
        this.mBob = 0;                 // +0x3c pointer bob phase

        // --- modal HintDialog state (JS) ---
        this.mShownHints = new Set();
        this.mCurrentHint = null;
        this.mCore = core;
        // "Don't show" checkbox: the original only draws the label
        // (FUN_0040d6ac, rwg_functions.c:16606-16625); what it disables is
        // UNKNOWN — not found in decompiled. The JS per-type persistence is
        // kept as is.
        if (core && core.mDisabledHints) {
            this.mDisabledTypes = new Set(core.mDisabledHints);
        }
    }

    // FUN_0040d39f (rwg_functions.c:16291): set the bar text. Same text ->
    // only the timeout is refreshed. Otherwise: text, target point, timeout
    // (0 when the text is empty), pointer = point, bob = 0, typed chars = 0,
    // pointDown = point.y > 200.
    setText(text, x = 0, y = 0, duration = 500) {
        text = text || '';
        if (text === this.mText) {
            this.mTimer = duration;
            return;
        }
        this.mText = text;
        this.mPointX = x;
        this.mPointY = y;
        this.mTimer = duration;
        if (text.length === 0) this.mTimer = 0;
        this.mPointerX = x;
        this.mPointerY = y;
        this.mBob = 0;
        this.mVisibleChars = 0;
        this.mPointDown = 200 < y;
    }

    // FUN_0040d281 (rwg_functions.c:16241, asm 0x40d281). Called from the
    // game tick while not paused (asm 0x406026 / rwg_functions.c:7472).
    update() {
        if (this.mPointX > 0 && this.mPointY > 0) {
            // bob += _DAT_004e9148 (0.03); past 1.0 -> _DAT_004e9230 (-1.0)
            let b = Math.fround(this.mBob + 0.029999999329447746);
            this.mBob = b;
            if (1.0 < b) this.mBob = -1.0;
            const a = Math.abs(this.mBob);                   // FUN_00406b08
            // offset = 30*a + 10*(1-a) (_DAT_004fc3dc=30, _DAT_004fc3d4=10),
            // y negated when the pointer is NOT the "down" one
            // (_DAT_004fc3e0=-30, _DAT_004fc3d8=-10).
            const dx = 10.0 * (1.0 - a) + 30.0 * a;
            let dy = -10.0 * (1.0 - a) + -30.0 * a;
            if (!this.mPointDown) dy = -dy;
            this.mPointerX = this.mPointX + Math.trunc(dx + 0.5);
            this.mPointerY = this.mPointY + Math.trunc(dy + 0.5);
        }
        if (this.mTimer > 0) {
            this.mTimer--;
            if (this.mTimer === 0 && this.mText.length !== 0) this.mText = '';
        }
        _typeTick++;
        if (_typeTick > 2) {
            _typeTick = 0;
            if (this.mVisibleChars < this.mText.length) this.mVisibleChars++;
        }
    }

    // FUN_0040d4cc (rwg_functions.c:16423): typed-so-far part of the text
    getVisibleText() {
        if (this.mText.length === 0) return this.mText;
        return this.mText.substring(0, this.mVisibleChars);
    }

    // GameView::Draw hint block (rwg_functions.c:13934-13965, asm
    // 0x40b973-0x40ba8f): only when the text is non-empty. Font FONT_HINT
    // (ArialBlack14_hint), colour DAT_005012a0 (white, see GameView.js).
    //   no point: text at (10, 0x252 = 594)
    //   point:    x = point.x, pulled left to (800 - width - 5) when it would
    //             overflow; pointDown -> IMAGE_HINT_POINTER_DOWN (DAT_004fff80)
    //             centred on the pointer, text y = point.y - 45; else
    //             IMAGE_HINT_POINTER_UP (DAT_004fff84), text y = point.y + 45.
    draw(g) {
        if (this.mText.length === 0) return;
        const ctx = g.ctx;
        const text = this.getVisibleText();
        // Bitmap font approximated with canvas text; the _hint font art has a
        // dark outline around white glyphs (app/fonts/ArialBlack14_hint.png,
        // screenshot 14).
        ctx.save();
        ctx.font = '14px "Arial Black", Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        let tx = 10, ty = 0x252;
        if (this.mPointX >= 1 && this.mPointY >= 1) {
            tx = this.mPointX;
            ty = this.mPointY;
            // StringWidth of the FULL text (+8), not the typed part.
            const w = ctx.measureText(this.mText).width;
            if (800 < tx + w) tx = (800 - w) - 5;
            const img = this.mPointDown ? IMAGES.IMAGE_HINT_POINTER_DOWN
                : IMAGES.IMAGE_HINT_POINTER_UP;
            if (img && img.img && (!g._isReady || g._isReady(img.img))) {
                const px = this.mPointerX - Math.trunc(img.mWidth / 2);
                const py = this.mPointerY - Math.trunc(img.mHeight / 2);
                ctx.drawImage(img.img, (g.mTransX || 0) + px, (g.mTransY || 0) + py);
            }
            ty = this.mPointDown ? ty - 0x2d : ty + 0x2d;
        }
        const x = (g.mTransX || 0) + tx;
        const y = (g.mTransY || 0) + ty;
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        ctx.strokeText(text, x, y);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, x, y);
        ctx.restore();
    }

    // Modal hint (FUN_0040d435 path). JS keeps a once-per-type gate and the
    // per-type "Don't show" persistence; in the original the once-only gating
    // is done by the dispatcher flags (e.g. this+0x44 in FUN_00422690).
    // No sound is played when the dialog opens (FUN_0040d435 plays none).
    showHint(type) {
        if (this.mShownHints.has(type)) return;
        if (this.mCurrentHint !== null) return;
        if (this.mDisabledTypes && this.mDisabledTypes.has(type)) return;

        this.mShownHints.add(type);
        this.mCurrentHint = { type: type, text: hintTexts[type] || '' };
        this._openHtml();
    }

    // Force show a hint (even if already shown) — used by the dialog preview.
    forceHint(type) {
        this.mCurrentHint = { type: type, text: hintTexts[type] || '' };
        this._openHtml();
    }

    // FUN_0040d435 (rwg_functions.c:16346): pause (GameView pauses while
    // isShown()) and open the HintDialog with `text`.
    showDialog(text) {
        if (this.mCurrentHint !== null) return;
        this.mCurrentHint = { type: -1, text: text || '' };
        this._openHtml();
    }

    // Open the HTML hint dialog. OK persists the "Don't show" choice per type.
    _openHtml() {
        const hint = this.mCurrentHint;
        HtmlDialogs.open('hint', {
            binds: { text: hint.text, dontshow: false },
            actions: {
                ok: () => {
                    // FUN_0040d821 (rwg_functions.c:16701): button press plays
                    // SOUND_CLICK (DAT_004fed84); id 1000 (OK) unpauses.
                    if (SOUNDS && SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
                    const dontShow = HtmlDialogs.read('hint', 'dontshow');
                    if (dontShow && this.mCurrentHint && this.mCurrentHint.type >= 0) {
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

    // vtable[0] FUN_0040d4bb (rwg_functions.c:16402): dialog closed ->
    // game+4 = 0, +0xd = 0 (unpause). GameView unpauses when !isShown().
    dismiss() {
        this.mCurrentHint = null;
        HtmlDialogs.close('hint');
    }

    // Kept for GameView's API; the HTML dialog handles its own pointer input.
    handleMouseMove(x, y) {
        this._mouseX = x;
        this._mouseY = y;
    }

    // Click while the modal hint is open: consumed (the HTML dialog handles
    // its own buttons).
    handleClick(x, y) {
        return !!this.mCurrentHint;
    }

    isShown() {
        return this.mCurrentHint !== null;
    }
}
