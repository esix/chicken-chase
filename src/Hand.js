// Port of Sexy::Hand - vtable at 004dcfcc
//
// Key functions:
//   FUN_0040cbe4 - Hand constructor (10 lines)
//   FUN_0042623a - Hand::updateMode (48 lines)
//   FUN_0042641a - Hand::draw (345 lines)
//   FUN_00427508 - Hand::walk/move (110 lines)
//   FUN_004292ed - Hand::getMode (41 lines)
//   FUN_0042c114 - Hand::setMode (100 lines)
//   FUN_0042c2ea - Hand::getCursorImage (22 lines)
//   FUN_0042c61a - Hand::isOverField (24 lines)

import { IMAGES } from './Res.js';

// Hand modes - from FUN_004292ed and image resources
export const HandMode = {
    SEEDS: 0,      // IMAGE_HAND_SEEDS - default feeding mode
    CURE: 1,       // IMAGE_HAND_CURE - cure sick chickens
    GUN: 2,        // IMAGE_HAND_GUN - basic gun
    GUN_POWER: 3,  // IMAGE_HAND_GUN_POWER - upgraded gun
    GUN_AREA: 4,   // IMAGE_HAND_GUN_AREA - area gun
    GUN_POWER_AREA: 5, // IMAGE_HAND_GUN_POWER_AREA - power + area gun
};

export class Hand {
    // Port of Sexy::Hand - vtable at 004dcfcc
    // Constructor: FUN_0040cbe4
    constructor() {
        this.mMode = HandMode.SEEDS;        // offset +0x00
        this.mX = 400;                      // offset +0x04
        this.mY = 300;                      // offset +0x08
        // mVisible (offset +0x0c) is omitted — GameView gates Hand.draw on
        // modal/over-field state externally, so the field-level flag was
        // always true and the `if (!mVisible) return` check was dead.
    }

    // FUN_0042623a - updateMode
    setMode(mode) {
        this.mMode = mode;
    }

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

    // FUN_0042c2ea - getCursorImage
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

    // FUN_0042641a - draw (345 lines)
    draw(g) {
        const img = this.getCursorImage();
        if (img && img.img) {
            g.drawImage(img, this.mX - img.mWidth / 2, this.mY - img.mHeight / 2);
        }
    }

    // FUN_0042c61a - isOverField
    isOverField() {
        return this.mY > 80 && this.mY < 580;
    }

    // FUN_00427508 - move
    move(x, y) {
        this.mX = x;
        this.mY = y;
    }
}
