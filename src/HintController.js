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
// dispatchers (level object fields +0x18..+0x54), ported below as
// LevelTutorial: FUN_00422036 (rwg_functions.c:41919) -> FUN_00422a24 modal
// texts + per-level FUN_0042207d / FUN_00422228 / FUN_004224e0 /
// FUN_00422690 / FUN_00422749 / FUN_00422802. GameView ticks it.

import { IMAGES, SOUNDS } from './Res.js';
import { HtmlDialogs } from './HtmlDialogs.js';
import { ChickType, ChickState } from './Chick.js';

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
// duration -1 (0xffffffff) = no timeout. Reference data; the live dispatch
// is LevelTutorial below.
export const HINT_PRESENTATION = {
    [HintType.FIRST_CHICKENS]:    { kind: 'bar', point: [0, 0], duration: 500 },     // asm 0x4220ab-0x4220cf (point [ebp-0x10] = ebx = 0)
    [HintType.COLLECT_COINS_GOAL]:{ kind: 'bar', point: null, duration: 500 },       // asm 0x42210a-0x42212b
    [HintType.BUY_CHICKEN]:       { kind: 'bar', point: [75, 62], duration: 500 },   // asm 0x4221a7-0x4221d6
    [HintType.COLLECT_EGG]:       { kind: 'bar', point: null, duration: -1 },        // asm 0x4222d6-0x4222fc (egg rect centre +10/-10)
    [HintType.SICK_CHICKEN]:      { kind: 'bar', point: null, duration: -1 },        // asm 0x4223ef-0x422414 (chick rect centre)
    [HintType.COLLECT_EGGS_GOAL]: { kind: 'bar', point: [646, 115], duration: 500 }, // asm 0x4224a4-0x4224d3
    [HintType.HATCH_EGG]:         { kind: 'bar', point: [40, 125], duration: -1 },   // asm 0x4225db-0x422603
    [HintType.HATCH_GOAL]:        { kind: 'bar', point: [646, 115], duration: 500 }, // asm 0x422659-0x422684 (duration = edi = 0x1f4, set at 0x42260f)
    [HintType.RAVEN_WARNING]:     { kind: 'dialog' },                                 // asm 0x4226e6 FUN_0040d435
    [HintType.BUY_ROOSTER]:       { kind: 'bar', point: [225, 62], duration: 500 },  // asm 0x422714-0x42273f
    [HintType.SELL_CHICKENS]:     { kind: 'bar', point: [575, 75], duration: 1000 }, // asm 0x422771-0x4227c7
    [HintType.SELL_BUTTON]:       { kind: 'shop' },                                   // FUN_004227d0: SELL dialog text (caller 0x41e9c2), not the bar
    [HintType.BUY_ROOSTERS_MORE]: { kind: 'bar', point: [0, 0], duration: 500 },     // asm 0x422869-0x422903
    [HintType.FARM_CROWDED]:      { kind: 'bar', point: [0, 0], duration: 500 },     // asm 0x4228d3-0x422903 (point [ebp-0x10] = ebx = 0)
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
        this.mCurrentHint = null;
        this.mCore = core;
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

    // Modal hint opened from the PREVIEW / legacy API. In the game the modal
    // texts come from LevelTutorial below (FUN_00422bb1 / FUN_00422690).
    showHint(type) {
        this.showDialog(hintTexts[type] || '');
    }

    // Force show a hint (even if already shown) — used by the dialog preview.
    forceHint(type) {
        this.mCurrentHint = { type: type, text: hintTexts[type] || '' };
        this._openHtml();
    }

    // FUN_0040d435 (rwg_functions.c:16346): pause (state +4 = 1, +0xd = 0;
    // GameView pauses while isShown()) and open the HintDialog with `text`.
    showDialog(text) {
        if (this.mCurrentHint !== null) return;
        this.mCurrentHint = { type: -1, text: text || '' };
        this._openHtml();
    }

    // Open the HTML hint dialog.
    _openHtml() {
        HtmlDialogs.open('hint', {
            binds: { text: this.mCurrentHint.text, dontshow: false },
            actions: {
                ok: () => {
                    // FUN_0040d821 (rwg_functions.c:16701): button press plays
                    // SOUND_CLICK (DAT_004fed84); id 1000 (OK) unpauses.
                    if (SOUNDS && SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
                    // "Don't show" checkbox listener FUN_0040d875
                    // (rwg_functions.c:16741): player +0x1c = !checked, then
                    // save (FUN_00410f28). player +0x1c gates only the tutorial
                    // modals of FUN_00422a24 (asm 0x422a52-0x422a5b). Applied
                    // on OK here (the HTML checkbox has no change listener);
                    // the initial checkbox state is UNKNOWN — not found in
                    // decompiled (unchecked).
                    const dontShow = !!HtmlDialogs.read('hint', 'dontshow');
                    if (this.mCore && this.mCore.mShowHints !== !dontShow) {
                        this.mCore.mShowHints = !dontShow;
                        if (this.mCore.save) this.mCore.save();
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

// ---------------------------------------------------------------------------
// Level tutorial — the hint fields of the level object (game+0x34), zeroed by
// FUN_0042166f (rwg_functions.c:41196-41221) at every level start:
//   +0x18..+0x1c L1 flags, +0x20 L1 chick count, +0x24/+0x25/+0x26 L2 flags,
//   +0x28/+0x2c L2 sick chick (smart ptr), +0x30/+0x34 L2 egg (smart ptr),
//   +0x38/+0x39 L3 flags, +0x3c/+0x40 L3 egg, +0x44/+0x45 L4 flags,
//   +0x46 L5 flag, +0x47 "modal tutorial shown", +0x4c delay ticks,
//   +0x54 L1 layer-slot unlock flag.
// tick() is called from the level update FUN_00421b21 (rwg_functions.c:41489)
// when a task is still open and the level is not lost, i.e. every unpaused
// tick of a running level (game update FUN_00405fcf:7479).
//
// `ctx` = { fc, hint, core, riskReady, specialShopAvailable }
export class LevelTutorial {
    constructor(level) {
        this.mLevel = level;          // +0x10
        this.f18 = false; this.f19 = false; this.f1a = false;
        this.f1b = false; this.f1c = false;
        this.mChickCount = 0;         // +0x20
        this.f24 = false; this.f25 = false; this.f26 = false;
        this.mSickChick = null;       // +0x2c
        this.mEgg = null;             // +0x34
        this.f38 = false; this.f39 = false;
        this.mHatchEgg = null;        // +0x40
        this.f44 = false; this.f45 = false; this.f46 = false;
        this.f47 = false;
        this.mDelay = 0;              // +0x4c
        this.f54 = false;
    }

    // FUN_00421b21:41522-41530 then FUN_00422036 (rwg_functions.c:41919).
    tick(ctx) {
        const fc = ctx.fc;
        // Level 1: once a chicken is fed (FUN_00421e54) the layer shop slot
        // (store +8 vector, index 0, asm 0x421bab-0x421bb8) becomes -1
        // (unlimited).
        if (this.mLevel === 1 && !this.f54 && anyFedChick(fc)) {
            this.f54 = true;
            if (Array.isArray(fc.mBuySlots)) fc.mBuySlots[0] = -1;
        }
        // FUN_00422036 (asm 0x422036-0x42207c): FUN_00422a24 first, then by
        // level 1..5, everything else -> FUN_00422802.
        this._modal(ctx);
        switch (this.mLevel) {
            case 1: this._level1(ctx); break;
            case 2: this._level2(ctx); break;
            case 3: this._level3(ctx); break;
            case 4: this._level4(ctx); break;
            case 5: this._level5(ctx); break;
            default: this._generic(ctx); break;
        }
    }

    // FUN_00422a24 (rwg_functions.c:42648, asm 0x422a24-0x422bae): one modal
    // tutorial text per level (levels <= 10, once: +0x47), only while the
    // player's show-hints flag (FUN_0043fb14 +0x1c) is set.
    _modal(ctx) {
        const fc = ctx.fc;
        if (this.mLevel > 10 || this.f47) return;
        if (!(ctx.core ? ctx.core.mShowHints !== false : true)) return;
        const secs = Math.trunc(elapsedTicks(fc) / 100);   // state +8 / 100
        const money = fc.mMoney;                            // money obj +4
        let text = null;
        switch (this.mLevel) {
            case 1:   // secs > 0x1e
                if (secs > 0x1e) text = 'Collect coins as soon as possible. The longer the coin is available, the less valuable it becomes. Collect coins to gain money for buying more chickens.';
                break;
            case 2:   // money > 0x1f4
                if (money > 0x1f4) text = 'Buy more chickens to collect 10 eggs faster.';
                break;
            case 3:   // money > 0x1f4 && store slot[0] > 0
                if (money > 0x1f4 && slotValue(fc, 0) > 0) text = 'Collect eggs to get money for buying chickens. Hatch chickens from eggs with the help of broody hen.';
                break;
            case 5:   // FUN_00404f23(world)
                if (anyChickRatioAtLeast5(fc)) text = 'Sell chickens to earn $5,000. For each adult chicken sold, you will be able to buy some younger ones.';
                break;
            case 6:   // secs > 0x3c && money > store +0 (0xfa, FUN_0041e7f2) &&
                      // FUN_0041eae5(0) (special-shop item list) not empty
                if (secs > 0x3c && money > 0xfa && ctx.specialShopAvailable && ctx.specialShopAvailable()) {
                    // DAT_004dfd20 (string read from app/chicken_chase.RWG; \x92 = ’)
                    text = 'To make playing easier, buy upgrades in the specialty shop. When it’s available, look for the BUY button located above the SELL button.';
                }
                break;
            case 7:   // risk +9 (ready)
                if (ctx.riskReady) text = 'Click on the surprise option located beneath the level task bar. Depending on your luck, it can help or hurt you!';
                break;
            case 9:   // money > 1000
                if (money > 0x3e8) text = 'Buy or hatch as many layer chickens as possible. These chickens produce the most eggs. The more eggs you have the faster you will find light blue eggs.';
                break;
        }
        if (text === null) return;
        // FUN_00422bb1 (rwg_functions.c:42774): +0x47 = 1, FUN_0040d435(text).
        this.f47 = true;
        ctx.hint.showDialog(text);
    }

    // +0x4c countdown shared by the level 1-3 dispatchers.
    _delayed() {
        if (this.mDelay > 0) this.mDelay--;
        return this.mDelay > 0;
    }

    // FUN_0042207d (rwg_functions.c:41956, asm 0x42207d-0x422227)
    _level1(ctx) {
        const fc = ctx.fc, hint = ctx.hint;
        if (this._delayed()) return;
        if (!this.f18) {
            this.f18 = true;
            hint.setText('These are your first chickens! Click anywhere to feed them.', 0, 0, 500);
            return;
        }
        // FUN_0040c448(1) + FUN_0040c448(0): coins (gem types 1/0) on the field.
        if (!this.f19 && coinsOnField(fc) > 0) {
            this.f19 = true;
            hint.setText('Collect coins for extra money.', 0, 0, 500);
            this.mDelay = 800;
            return;
        }
        if (!this.f1a && this.f19 && hint.mText.length === 0) {
            this.f1a = true;
            hint.setText('Collect 15 coins to complete the level.', 0x286, 0x73, 500);
            this.mDelay = 800;
            return;
        }
        const count = fc.mField.getAliveChickCount();   // world +8
        if (this.f1c && count < this.mChickCount) this.mChickCount = count;
        if (!this.f1b && anyFedChick(fc)) {
            this.f1b = true;
            hint.setText('You can buy one new chicken.', 0x4b, 0x3e, 500);
            this.mDelay = 800;
            this.f1c = true;
            this.mChickCount = count;
            return;
        }
        if (this.f1c && count > this.mChickCount) {
            hint.setText('', 0, 0, 500);
            this.f1c = false;
        }
    }

    // FUN_00422228 (rwg_functions.c:42050, asm 0x422228-0x4224dd)
    _level2(ctx) {
        const fc = ctx.fc, hint = ctx.hint;
        if (this._delayed()) return;
        // Egg hint (+0x25): first egg (FUN_00421f58) -> pointer at its rect
        // FUN_004095cd: (x + w/2 + 10, y + h/2 - 10), no timeout.
        const egg = !this.f25 ? firstEgg(fc) : null;
        if (egg) {
            this.f25 = true;
            this.mEgg = egg;
            const r = egg.getRect ? egg.getRect() : null;
            const px = r ? Math.trunc(r.w / 2) + 10 + r.x : 0;
            const py = r ? Math.trunc(r.h / 2) - 10 + r.y : 0;
            hint.setText('Click on an egg to collect it.', px, py, -1);
        } else if (this.mEgg && eggGone(this.mEgg)) {
            // FUN_00406ab6: egg +0x1c >= 1.0 (set when collected,
            // FUN_00406c4d, or hatched). Clear, enable sickness (world
            // +0x264 = 1) and start a sickness event (FUN_00404d6d).
            this.mEgg = null;
            hint.setText('', 0, 0, 500);
            const field = fc.mField;
            field.mSicknessEnabled = true;
            if (typeof field.startSickEvent === 'function') field.startSickEvent();
        }
        // Sick hint (+0x24): first chick in action 3/4 (FUN_00421ec4 /
        // FUN_00402342) -> pointer at the centre of its rect FUN_00409956.
        const sick = !this.f24 ? firstSickChick(fc) : null;
        if (sick) {
            this.f24 = true;
            this.mSickChick = sick;
            const p = chickRectCentre(sick);
            hint.setText('Your chicken is sick! Click on your chicken to cure it!', p.x, p.y, -1);
        } else if (this.mSickChick) {
            const c = this.mSickChick;
            // state +8 == 6 (dead) or no longer in action 3/4 -> clear.
            if (!c.mIsAlive || c.mState === ChickState.DEATH || !isSickAction(c)) {
                this.mSickChick = null;
                hint.setText('', 0, 0, 500);
                this.mDelay = 800;
            }
        }
        if (!this.f26 && this.f25 && hint.mText.length === 0) {
            this.f26 = true;
            hint.setText('Collect 10 eggs to complete the level.', 0x286, 0x73, 500);
        }
    }

    // FUN_004224e0 (rwg_functions.c:42262, asm 0x4224e0-0x42268d)
    _level3(ctx) {
        const fc = ctx.fc, hint = ctx.hint;
        if (this._delayed()) return;
        if (!this.f38) {
            const egg = firstEgg(fc);
            this.mHatchEgg = egg;               // +0x3c/+0x40 (copied either way)
            if (egg) {
                // FUN_00406e0d: egg is in the brood list.
                if (egg.mBrooding) {
                    this.f38 = true;
                    this.mHatchEgg = null;
                    hint.setText('', 0, 0, 500);
                    this.mDelay = 800;
                    return;
                }
                if (hint.mText.length === 0) {
                    hint.setText('Click here to hatch the egg.', 0x28, 0x7d, -1);
                }
            }
        }
        if (!this.f38 && !this.mHatchEgg) hint.setText('', 0, 0, 500);
        if (!this.f39 && this.f38 && hint.mText.length === 0) {
            this.f39 = true;
            hint.setText('Your task is to hatch or buy 12 chickens.', 0x286, 0x73, 500);
        }
    }

    // FUN_00422690 (rwg_functions.c:42349, asm 0x422690-0x422748)
    _level4(ctx) {
        const fc = ctx.fc, hint = ctx.hint;
        if (!this.f44) {
            // raven controller +8 != 0 (ravens present)
            if (fc.mField.mRavens.some(r => r.mIsAlive)) {
                this.f44 = true;
                hint.showDialog('The ravens want to steal your chickens. Force the ravens away by clicking on them whenever they appear on screen.');
            }
            return;
        }
        if (!this.f45) {
            this.f45 = true;
            // FUN_00404aa8(2, 1): rooster type enabled in the world bitset
            // (+0x24c); store slot[2] = -1 (unlimited).
            // The world bitset lives in LevelData chickTypeEnabled (copied
            // per level by getLevelConfig); the slot vector in fc.mBuySlots.
            const cfg = fc.mLevelConfig;
            if (cfg && Array.isArray(cfg.chickTypeEnabled)) cfg.chickTypeEnabled[2] = true;
            if (Array.isArray(fc.mBuySlots)) fc.mBuySlots[2] = -1;
            hint.setText('Buy roosters to protect your chickens from the ravens.', 0xe1, 0x3e, 500);
        }
    }

    // FUN_00422749 (rwg_functions.c:42398, asm 0x422749-0x4227cf)
    _level5(ctx) {
        const fc = ctx.fc, hint = ctx.hint;
        if (!this.f46) {
            if (!(elapsedTicks(fc) > 0xbb8)) return;
            this.f46 = true;
            hint.setText('Click the button to sell chickens', 0x23f, 0x4b, 1000);
            return;
        }
        // world +0x260 = chickens sold (incremented by the sell path,
        // rwg_functions.c:5348). JS field name: see report.
        if ((fc.mField.mSoldCount || 0) > 0) hint.setText('', 0, 0, 500);
    }

    // FUN_00422802 (rwg_functions.c:42469, asm 0x422802-0x42290c), every
    // tick, all texts at point (0,0) for 500 ticks.
    _generic(ctx) {
        const fc = ctx.fc, hint = ctx.hint;
        const field = fc.mField;
        const cfg = fc.mLevelConfig || {};
        const roosters = field.getChickCountByType(ChickType.ROOSTER);     // FUN_00404ad0(2)
        const needed = fc._roostersNeeded ? fc._roostersNeeded() : 0;      // FUN_00401308
        const roosterEnabled = Array.isArray(cfg.chickTypeEnabled)
            ? !!cfg.chickTypeEnabled[2] : true;                            // FUN_00404a71(2)
        if (roosters + 1 < needed && roosterEnabled && slotValue(fc, 2) !== 0) {
            hint.setText('Buy more roosters to protect your chickens from the ravens.', 0, 0, 500);
            return;
        }
        let text = '';
        if (anyHungry(fc, false)) {                                        // FUN_0042290d
            text = 'Your chickens are too hungry. Drop more seeds for them.';
        } else if (availableEggs(fc) < 1 && anyHungry(fc, true)) {          // FUN_00422990
            text = 'You need to lay some more eggs to feed the magic chickens. ';
        } else if (field.getAliveChickCount() > 0x96) {
            text = 'You farm is too crowded! You should sell some of your chickens.';
        }
        hint.setText(text, 0, 0, 500);
    }
}

// --- helpers (original predicate -> JS state) -------------------------------

// state +8 tick counter; FieldController keeps it in ms (x10).
function elapsedTicks(fc) {
    return Math.trunc((fc.mTimeElapsed || 0) / 10);
}

// store +8 slot vector value (-1 unlimited, 0 closed, N remaining).
function slotValue(fc, type) {
    return Array.isArray(fc.mBuySlots) ? (fc.mBuySlots[type] | 0) : 0;
}

// FUN_00421e54 (rwg_functions.c:41686): any chick with FUN_00403a3e != 0
// (food +0x34 >= FUN_00405899()*5) = Chick._isFed().
function anyFedChick(fc) {
    return fc.mField.mChickens.some(c => c.mIsAlive && typeof c._isFed === 'function' && c._isFed());
}

// FUN_00404f23 (rwg_functions.c:6054, asm 0x404f63-0x404fa4): any chick with
// vt[4] FUN_0040325a (not in action 3/4 via FUN_00402342, and vt[5]
// FUN_0040327c active) and ftol(FUN_00403c75() + 0.5 (_DAT_004e90c8)) >= 5,
// FUN_00403c75 = food / (FUN_00405899()*33) (Chick.getSellRatio).
function anyChickRatioAtLeast5(fc) {
    return fc.mField.mChickens.some(c => {
        if (!c.mIsAlive || isSickAction(c)) return false;
        if (typeof c.isActive === 'function' && !c.isActive()) return false;
        return Math.trunc(c.getSellRatio() + 0.5) >= 5;
    });
}

// FUN_0040c448(type) on the gem list (game+0x28): coins are gem types 0/1.
function coinsOnField(fc) {
    return fc.mField.mGems.filter(g => g.mIsAlive && !g.mCollected
        && (g.mType === 0 || g.mType === 1)).length;
}

// FUN_00421f58 (rwg_functions.c:41788): first egg of the egg list (game+0x24).
function firstEgg(fc) {
    return fc.mField.mGems.find(g => g.mType === 4 && g.mIsAlive && !g.mCollected) || null;
}

// FUN_00406ab6 (rwg_functions.c:8237): egg +0x1c >= 1.0 — set to 1.0 when the
// egg is collected (FUN_00406c4d:8414) or hatched (FUN_00406c85:8512).
function eggGone(egg) {
    return !egg.mIsAlive || !!egg.mCollected || (egg.mHatchProgress || 0) >= 1.0;
}

// FUN_00402342 (rwg_functions.c:2063): action +0xc is 3 or 4 (sick).
function isSickAction(c) {
    return c.mState === ChickState.SICK_START || c.mState === ChickState.SICK_IDLE;
}

// FUN_00421ec4 (rwg_functions.c:41741): first chick of the world list in a
// sick action.
function firstSickChick(fc) {
    return fc.mField.mChickens.find(c => c.mIsAlive && !c.mIsCarried && isSickAction(c)) || null;
}

// Centre of the chick rect FUN_00409956 / Chick.getRect (asm
// 0x4223d9-0x4223f6, rwg_functions.c:42232-42234: x + w/2, y + h/2).
function chickRectCentre(c) {
    const r = c.getRect();
    return { x: Math.trunc(r.w / 2) + r.x, y: Math.trunc(r.h / 2) + r.y };
}

// FUN_0042290d / FUN_00422990: a chick (magic = type 3 or not) whose +0x1c
// (Chick.mAge) < 0x5dc.
function anyHungry(fc, magic) {
    return fc.mField.mChickens.some(c => c.mIsAlive
        && ((c.mType === ChickType.MAGIC) === magic) && c.mAge < 0x5dc);
}

// FUN_004077fa (rwg_functions.c:9252): eggs whose +0x20 flag is clear.
function availableEggs(fc) {
    return fc.mField.mGems.filter(g => g.mType === 4 && g.mIsAlive && !g.mCollected).length;
}
