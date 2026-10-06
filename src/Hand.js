// Port of Sexy::Hand - vtable at 004dcfcc (rwg_vtables.txt:1962).
//
// The Hand vtable has a single slot: [0] FUN_0040cbe4 (rwg_functions.c:15796),
// the destructor. (Slots listed after it in rwg_vtables.txt belong to the next
// class, Sexy::HintController — the 004ea38c RTTI pointer starts its block.)
//
// Hand struct (from FUN_0040cc01 / FUN_0040cc71):
//   +0x04 mode (0 = seeds, 1 = cure, 2 = gun)
//   +0x08 byte: mouse button held
//   +0x0c tick counter (incremented every FUN_0040cc71 call)
//   +0x10 tick of the last accepted (auto-)click
//
// Non-virtual game-logic functions:
//   FUN_0040cc01 (rwg_functions.c:15815, asm 0x40cc01-0x40cc70) SetMode
//   FUN_0040cc71 (rwg_functions.c:15848-16195) Hand::Update — hover/aim, click
//       dispatch (gems, cure, eggs, seeds, shooting). Implemented by
//       GameView.js / FieldController.js in the port (outside this file).
//
// NOTE: the citations previously in this header (FUN_0042623a, FUN_0042641a,
// FUN_00427508, FUN_004292ed, FUN_0042c114, FUN_0042c2ea, FUN_0042c61a) were
// wrong: those are IMAGEHLP/QueryPerformanceCounter/FindFirstFile helpers.

import { IMAGES } from './Res.js';

// JS hand modes. The original stores only 3 modes at +0x04 (0 seeds, 1 cure,
// 2 gun); for mode 2 SetMode picks the gun image from the upgrade flags at
// (FieldController+0x40)+0x10 (area) and +0x11 (power) — see getCursorImage.
// The port encodes that image choice into four gun mode values; GameView.js
// computes them with the same flag logic.
export const HandMode = {
    SEEDS: 0,          // orig mode 0 -> IMAGE_HAND_SEEDS (DAT_004fff4c)
    CURE: 1,           // orig mode 1 -> IMAGE_HAND_CURE (DAT_004fff50)
    GUN: 2,            // orig mode 2, !area && !power -> IMAGE_HAND_GUN (DAT_004fff54)
    GUN_POWER: 3,      // orig mode 2, !area &&  power -> IMAGE_HAND_GUN_POWER (DAT_004fff58)
    GUN_AREA: 4,       // orig mode 2,  area && !power -> IMAGE_HAND_GUN_AREA (DAT_004fff5c)
    GUN_POWER_AREA: 5, // orig mode 2,  area &&  power -> IMAGE_HAND_GUN_POWER_AREA (DAT_004fff60)
};

export class Hand {
    // FUN_0040cbe4 (rwg_functions.c:15796) is only the destructor; the Hand
    // fields are zero-initialised by its owner.
    constructor() {
        this.mMode = HandMode.SEEDS;        // +0x04
        // Mouse position (JS: the original reads the widget mouse position
        // inside FUN_0040cc71; not a Hand field).
        this.mX = 400;
        this.mY = 300;
    }

    // FUN_0040cc01 (rwg_functions.c:15815): *(this+4) = mode, then hands the
    // cursor image to the app (FUN_004422b3 -> app[0xde], vtable +0x30).
    setMode(mode) {
        this.mMode = mode;
    }

    // JS helper: original numeric mode (0 seeds / 1 cure / 2 gun) as a string
    // for FieldController.handleClick.
    getModeString() {
        switch (this.mMode) {
            case HandMode.SEEDS: return 'seeds';
            case HandMode.CURE: return 'cure';
            case HandMode.GUN:
            case HandMode.GUN_POWER:
            case HandMode.GUN_AREA:
            case HandMode.GUN_POWER_AREA:
                return 'gun';
            default: return 'seeds';
        }
    }

    // Image selection of FUN_0040cc01 (asm 0x40cc01-0x40cc70):
    //   mode 0 -> DAT_004fff4c IMAGE_HAND_SEEDS
    //   mode 1 -> DAT_004fff50 IMAGE_HAND_CURE
    //   mode 2 -> area(+0x10) ? (power(+0x11) ? DAT_004fff60 : DAT_004fff5c)
    //                         : (power ? DAT_004fff58 : DAT_004fff54)
    //   any other value -> IMAGE_HAND_SEEDS (falls through to the mode-0 path)
    getCursorImage() {
        switch (this.mMode) {
            case HandMode.SEEDS: return IMAGES.IMAGE_HAND_SEEDS;
            case HandMode.CURE: return IMAGES.IMAGE_HAND_CURE;
            case HandMode.GUN: return IMAGES.IMAGE_HAND_GUN;
            case HandMode.GUN_POWER: return IMAGES.IMAGE_HAND_GUN_POWER;
            case HandMode.GUN_AREA: return IMAGES.IMAGE_HAND_GUN_AREA;
            case HandMode.GUN_POWER_AREA: return IMAGES.IMAGE_HAND_GUN_POWER_AREA;
            default: return IMAGES.IMAGE_HAND_SEEDS;
        }
    }

    // The hand image is installed as the application cursor image
    // (FUN_004422b3: app+0x378, then app vtable +0x30) and drawn by the
    // framework cursor code, not by game code.
    // UNKNOWN — not found in decompiled: the framework's cursor hotspot.
    // Kept centered on the mouse position as before.
    draw(g) {
        const img = this.getCursorImage();
        if (img && img.img) {
            g.drawImage(img, this.mX - img.mWidth / 2, this.mY - img.mHeight / 2);
        }
    }

    // JS helper used by GameView to gate drawing/clicking of the hand.
    // UNKNOWN — not found in decompiled as a single test. The related
    // original thresholds in FUN_0040cc71 are:
    //   mouseY > 0x82 (130)  — raven/wolf aim & chick hover tests run
    //                          (rwg_functions.c:15953)
    //   mouseY >= 0x15f (351) — seed drop allowed (rwg_functions.c:16164,16168)
    // Left unchanged.
    isOverField() {
        return this.mY > 80 && this.mY < 580;
    }

    // JS: mouse move. The original samples the mouse in FUN_0040cc71.
    move(x, y) {
        this.mX = x;
        this.mY = y;
    }
}
