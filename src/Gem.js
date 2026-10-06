// Port of Sexy::Gem and subclasses (coins / diamonds) plus the field egg.
//
// Original vtables (rwg_vtables.txt:1677-1951). Slot layout shared by all
// concrete gems (slot index -> vtable byte offset):
//   [0] +0x00 FUN_0040c311  destructor
//   [1] +0x04 Update        CoinGold/CoinSilver FUN_0040c1c1, Diamonds FUN_0040c278
//   [2] +0x08 FUN_0040c1b8  isCollected (returns byte +0x04)
//   [3] +0x0c FUN_0040c1bc  setCollected (byte +0x04 = 1)
//   [4] +0x10 getValue      Gold FUN_0040c20a, Silver FUN_0040c236,
//                           Blue FUN_0040c2bf, Red FUN_0040c2c5
//   [5] +0x14 getProgress   Coins FUN_0040c2fe (1 - timer), Diamonds FUN_0040c32e (timer)
//   [6] +0x18 playSound     Coins FUN_0040c262, Blue FUN_0040c2d2, Red FUN_0040c2e8
// Base Sexy::Gem has FUN_004a2016 (purecall) in slots 1,4,5,6.
//
// Gem struct (FUN_0040c4d9 rwg_functions.c:15132-15270):
//   +0x04 byte collected, +0x08 type (0=Gold 1=Silver 2=DiamondBlue 3=DiamondRed),
//   +0x0c/+0x10 field x/y (copied from the spawning chick), +0x14 float timer,
//   +0x18 tick counter (diamonds), +0x1c value override (DiamondRed).
//
// Float constants read from the original binary's .rdata (app/chicken_chase.RWG,
// the PE the decompilation was produced from):
//   _DAT_004e9128 (double) = 0.0025  coin timer decrement per tick
//   _DAT_004e9120 (float)  = 0.3     coin low tier threshold
//   _DAT_004dc47c (float)  = 0.6     coin mid tier threshold
//   _DAT_004e90f8 (double) = 0.015   diamond timer increment per tick
//
// Coordinates: the original stores gems in field units and projects them with
// FUN_00409567 (screen = (6*fx + 10, 2.8f*fy - 6*fz + 367)). The JS port keeps
// every ground entity in screen pixels, so mX/mY here are the already
// projected screen point of the gem's field position.

import { IMAGES, SOUNDS } from './Res.js';

// Cached tinted egg-cel offscreen canvases — generated once per (img, frame,
// eggType) and reused. Keyed by `${img.mPath}_${frame}_${type}`.
const _eggTintCache = new Map();

// Field egg colorize table — FUN_00409fca (rwg_functions.c:12914, asm 0x409fca):
// five Color(r,g,b) built in order and indexed by the egg's +0x10 type, which
// in the original is the chick type (0=Layer 1=Broody 2=Rooster 3=Magic 4=Holy):
//   0 (0xff,0xff,0xff)  1 (0x40,0x3d,0xbe)  2 (0x45,0x45,0x45)
//   3 (0x2b,0x9b,0xf2)  4 (0xf5,0x27,0x49)
// The JS EggType enum (Chick.js) numbers eggs differently:
//   0=WHITE(layer) 1=BLUE(magic) 2=RED(holy) 3=BLACK(rooster) 4=GOLDEN(broody)
// so this array is indexed by the JS egg type and holds the original color of
// the corresponding chick type. Index 0 (white) is the identity colorize.
const EGG_TINT_COLORS = [
    null,        // JS 0 WHITE  -> orig 0 Layer   (0xff,0xff,0xff) = no change
    '#2b9bf2',   // JS 1 BLUE   -> orig 3 Magic   (0x2b,0x9b,0xf2)
    '#f52749',   // JS 2 RED    -> orig 4 Holy    (0xf5,0x27,0x49)
    '#454545',   // JS 3 BLACK  -> orig 2 Rooster (0x45,0x45,0x45)
    '#403dbe',   // JS 4 GOLDEN -> orig 1 Broody  (0x40,0x3d,0xbe)
];

// Egg collect value table DAT_0050033c, filled at rwg_functions.c:6711-6727:
// orig type 0=50 (0x32), 1=100, 2=200, 3=300, 4=500. Read by the egg click
// handler FUN_004072fa (rwg_functions.c:8920) via the egg's +0x10 type.
// Re-indexed by JS egg type (see mapping above).
// Coin tier thresholds: float constants _DAT_004e9120 (0.3f) and
// _DAT_004dc47c (0.6f) compared with the float timer (asm 0x40c20a-0x40c261).
const COIN_T1 = Math.fround(0.3);
const COIN_T2 = Math.fround(0.6);

const EGG_VALUE_BY_JS_TYPE = [
    50,   // JS 0 WHITE  -> orig 0 Layer
    300,  // JS 1 BLUE   -> orig 3 Magic
    500,  // JS 2 RED    -> orig 4 Holy
    200,  // JS 3 BLACK  -> orig 2 Rooster
    100,  // JS 4 GOLDEN -> orig 1 Broody
];

// Sexy colorized DrawImage multiplies each pixel by the color (white = no-op).
// Implemented with an offscreen 'multiply' + 'destination-in' pass.
export function getTintedEggCel(img, frame, eggType) {
    if (!eggType || eggType < 0 || eggType >= EGG_TINT_COLORS.length) return null;
    const tint = EGG_TINT_COLORS[eggType];
    if (!tint) return null;
    if (!img || !img.img) return null;
    const key = `${img.mPath || 'egg'}_${frame}_${eggType}`;
    let cached = _eggTintCache.get(key);
    if (cached) return cached;
    const celW = img.getCelWidth();
    const celH = img.getCelHeight();
    if (!celW || !celH) return null;
    const cols = img.mNumCols || 1;
    const sx = (frame % cols) * celW;
    const sy = Math.floor(frame / cols) * celH;
    const off = document.createElement('canvas');
    off.width = celW;
    off.height = celH;
    const offCtx = off.getContext('2d');
    offCtx.drawImage(img.img, sx, sy, celW, celH, 0, 0, celW, celH);
    offCtx.globalCompositeOperation = 'multiply';
    offCtx.globalAlpha = 1.0;
    offCtx.fillStyle = tint;
    offCtx.fillRect(0, 0, celW, celH);
    offCtx.globalCompositeOperation = 'destination-in';
    offCtx.drawImage(img.img, sx, sy, celW, celH, 0, 0, celW, celH);
    _eggTintCache.set(key, off);
    return off;
}

// Gem types matching the decompiled Gem struct +0x08 (FUN_0040c4d9:15155-15246).
export const GemType = {
    COIN_GOLD: 0,
    COIN_SILVER: 1,
    DIAMOND_BLUE: 2,
    DIAMOND_RED: 3,
    EGG: 4,   // JS-only tag: eggs live in Field.mGems in the port (original: separate list)
};

// _ftol after +0.5 as used by the projection FUN_00409567 (asm 0x409585-0x4095bc).
function _ftolRound(v) { return Math.trunc(v + 0.5); }

export class Gem {
    // FUN_0040c4d9 (rwg_functions.c:15153-15160) common Gem init:
    //   vtable, +0x04 collected = 0, +0x08 type, +0x0c/+0x10 position.
    // FUN_0040c311 (rwg_functions.c:14926) is the destructor.
    constructor(type, x, y) {
        this.mType = type;              // +0x08
        this.mX = x;                    // +0x0c (projected to screen px)
        this.mY = y;                    // +0x10 (projected to screen px)
        this.mCollected = false;        // +0x04
        this.mTimer = 0;                // +0x14
        this.mIsAlive = true;           // JS: list membership (Update() result)
    }

    // Field position (+0x0c/+0x10). Field.spawnGem/spawnEgg store the exact
    // float position of the spawning chick (setFieldPos); otherwise the
    // inverse projection FUN_00409533 (float results; _DAT_004fc3f8 = 2.8f).
    setFieldPos(p) { this._fieldPos = p ? [p[0], p[1]] : null; }
    get mFieldX() {
        return this._fieldPos ? this._fieldPos[0] : Math.fround((this.mX - 10) / 6.0);
    }
    get mFieldY() {
        return this._fieldPos ? this._fieldPos[1] : Math.fround((this.mY - 367) / Math.fround(2.8));
    }

    // Base Sexy::Gem slot [1] is FUN_004a2016 (purecall) — subclasses override.
    update() {}

    // FUN_0040c1b8 (rwg_functions.c:14679) isCollected
    isCollected() { return this.mCollected; }

    // FUN_0040c1bc (rwg_functions.c:14693) setCollected
    setCollected() { this.mCollected = true; }

    // Slot [4] getValue — purecall in base.
    getValue() { return 0; }

    // Slot [5] getProgress — purecall in base.
    getProgress() { return 0; }

    // Slot [6] playSound — purecall in base.
    _playCollectSound() {}

    getImage() { return null; }

    // FUN_0040c75b (rwg_functions.c:15342) gem pickup:
    //   if (!vt[2] isCollected) { money += vt[4] getValue (FUN_00406b22);
    //     counter++ (FUN_0041fb98); vt[6] playSound; FUN_0040c49d -> vt[3]
    //     setCollected + remove from list (FUN_0040c8cc) }
    // Money/counters are applied by the JS caller with the returned value.
    collect() {
        if (!this.mIsAlive || this.mCollected) return 0;
        const value = this.getValue();
        this._playCollectSound();
        this.setCollected();
        this.mIsAlive = false;
        return value;
    }

    // FUN_00409652 (rwg_functions.c:12041, asm 0x409652-0x409778) gem rect:
    //   x = screenX + width / (cols * -2)   (integer division)
    //   y = screenY + (0x10 - height)
    //   w = h = image height
    getRect() {
        const img = this.getImage();
        if (!img) return null;
        const width = img.mWidth || 0;
        const height = img.mHeight || 0;
        const cols = img.mNumCols || 1;
        const sx = _ftolRound(this.mX);
        const sy = _ftolRound(this.mY);
        return {
            x: sx + Math.trunc(width / (cols * -2)),
            y: sy + (0x10 - height),
            w: height,
            h: height,
        };
    }

    // FUN_00409e90 (rwg_functions.c:12728, asm 0x409e90-0x409f03) gem cel:
    //   frame = ftol(vt[5] getProgress() * numCols); if (frame >= numCols) frame = numCols-1
    getFrame() {
        const img = this.getImage();
        const cols = (img && img.mNumCols) || 1;
        let frame = Math.trunc(this.getProgress() * cols);
        if (frame >= cols) frame = cols - 1;
        return frame;
    }

    // Gem shadow — FUN_0040a3d6 gem loop (asm 0x40ab31-0x40ab6f): diamonds
    // only (type != 0 && type != 1) draw IMAGE_SHADOW (DAT_00500010) with
    // FUN_00466895 (DrawImage into rect) at (x, y + h - shadow.h/2, w, h).
    // It is an immediate draw issued while the gem itself is only queued in
    // the depth-sorted list, so Field.draw calls this before the sorted pass.
    drawShadow(g) {
        if (!this.mIsAlive) return;
        if (this.mType === GemType.COIN_GOLD || this.mType === GemType.COIN_SILVER) return;
        const sh = IMAGES.IMAGE_SHADOW;
        const r = this.getRect();
        if (!r || !sh || !sh.img) return;
        const tx = g.mTransX || 0, ty = g.mTransY || 0;
        const shH = sh.mHeight || 0;
        g.ctx.drawImage(sh.img, tx + r.x, ty + r.y + r.h - Math.trunc(shH / 2), r.w, r.h);
    }

    // Gem draw — FUN_0040a3d6 gem loop (rwg_functions.c:13492-13529):
    //   rect FUN_00409652, cel FUN_00409e90, image DAT_005005f4[type],
    //   queued with depth key = gem field y (FUN_004090ec 4th arg, piVar13[4]).
    draw(g) {
        const img = this.getImage();
        if (!this.mIsAlive || !img || !img.img) return;
        const r = this.getRect();
        const tx = g.mTransX || 0, ty = g.mTransY || 0;
        const celW = img.getCelWidth();
        const frame = this.getFrame();
        const cols = img.mNumCols || 1;
        const srcX = (frame % cols) * celW;
        g.ctx.drawImage(img.img, srcX, 0, celW, img.mHeight, tx + r.x, ty + r.y, r.w, r.h);
    }

    // Hit test used by the hand: FUN_0040c6a5 (rwg_functions.c:15277) builds
    // the gem rect with FUN_00409652 and tests the click with FUN_00407ad4
    // (rwg_functions.c:9520): x >= rx && x < rx+w && y >= ry && y < ry+h.
    contains(x, y) {
        const r = this.getRect();
        if (!r) return false;
        return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    }
}

// FUN_0040c1c1 (rwg_functions.c:14710) Coin Update (CoinGold & CoinSilver slot [1]):
//   if (isCollected) return false;
//   timer -= _DAT_004e9128 (0.0025); if (timer < 0) timer = 0;
//   return timer > 0;
// The timer is a float field (+0x14): fsubl then fstps (asm 0x40c1d5-0x40c1e4).
function coinUpdate(gem) {
    if (gem.isCollected()) { gem.mIsAlive = false; return false; }
    gem.mTimer = Math.fround(gem.mTimer - 0.0024999999441206455);   // _DAT_004e9128
    if (gem.mTimer < 0) gem.mTimer = 0;
    const alive = gem.mTimer > 0;
    gem.mIsAlive = alive;
    return alive;
}

// FUN_0040c278 (rwg_functions.c:14810) Diamond Update (DiamondBlue & DiamondRed slot [1]):
//   if (isCollected) return false;
//   timer += _DAT_004e90f8 (0.015); if (timer > 1.0) timer = 0;
//   counter(+0x18)++; return counter < 0x7d1 (2001);
function diamondUpdate(gem) {
    if (gem.isCollected()) { gem.mIsAlive = false; return false; }
    // faddl _DAT_004e90f8 then fstps into the float +0x14 (asm 0x40c28c-0x40c29b).
    gem.mTimer = Math.fround(gem.mTimer + 0.014999999664723873);
    if (gem.mTimer > 1.0) gem.mTimer = 0;
    gem.mCounter++;
    const alive = gem.mCounter < 0x7d1;
    gem.mIsAlive = alive;
    return alive;
}

export class CoinSilver extends Gem {
    // vtable 004dcf6c. FUN_0040c4d9:15183-15192: alloc 0x18, type 1,
    // +0x14 timer = 0x3f800000 (1.0).
    constructor(x, y) {
        super(GemType.COIN_SILVER, x, y);
        this.mTimer = 1.0;
    }

    // FUN_0040c1c1 (rwg_functions.c:14710)
    update() { return coinUpdate(this); }

    // FUN_0040c236 (rwg_functions.c:14770): timer < 0.3 -> 5, < 0.6 -> 10, else 0x14 (20)
    getValue() {
        if (this.mTimer < COIN_T1) return 5;
        if (this.mTimer < COIN_T2) return 10;
        return 0x14;
    }

    // FUN_0040c2fe (rwg_functions.c:14912, asm 0x40c2fe): fstps(1.0 - timer)
    getProgress() { return Math.fround(1.0 - this.mTimer); }

    getImage() { return IMAGES.IMAGE_COIN_SILVER; }

    // FUN_0040c262 (rwg_functions.c:14790): play DAT_004fed74 = SOUND_COLLECT_COIN
    _playCollectSound() {
        if (SOUNDS.SOUND_COLLECT_COIN) SOUNDS.SOUND_COLLECT_COIN.play();
    }
}

export class CoinGold extends Gem {
    // vtable 004dcf4c. FUN_0040c4d9:15160-15169: alloc 0x18, type 0,
    // +0x14 timer = 0x3f800000 (1.0).
    constructor(x, y) {
        super(GemType.COIN_GOLD, x, y);
        this.mTimer = 1.0;
    }

    // FUN_0040c1c1 (rwg_functions.c:14710)
    update() { return coinUpdate(this); }

    // FUN_0040c20a (rwg_functions.c:14748): timer < 0.3 -> 10, < 0.6 -> 0x14 (20), else 0x1e (30)
    getValue() {
        if (this.mTimer < COIN_T1) return 10;
        if (this.mTimer < COIN_T2) return 0x14;
        return 0x1e;
    }

    // FUN_0040c2fe (rwg_functions.c:14912, asm 0x40c2fe): fstps(1.0 - timer)
    getProgress() { return Math.fround(1.0 - this.mTimer); }

    getImage() { return IMAGES.IMAGE_COIN_GOLD; }

    // FUN_0040c262 (rwg_functions.c:14790): play DAT_004fed74 = SOUND_COLLECT_COIN
    _playCollectSound() {
        if (SOUNDS.SOUND_COLLECT_COIN) SOUNDS.SOUND_COLLECT_COIN.play();
    }
}

export class DiamondBlue extends Gem {
    // vtable 004dcf8c. FUN_0040c4d9:15206-15216: alloc 0x1c, type 2,
    // +0x14 timer = 0, +0x18 counter = 0.
    constructor(x, y) {
        super(GemType.DIAMOND_BLUE, x, y);
        this.mTimer = 0;
        this.mCounter = 0;
    }

    // FUN_0040c278 (rwg_functions.c:14810)
    update() { return diamondUpdate(this); }

    // FUN_0040c2bf (rwg_functions.c:14842): return 300
    getValue() { return 300; }

    // FUN_0040c32e (rwg_functions.c:14945): return timer
    getProgress() { return this.mTimer; }

    getImage() { return IMAGES.IMAGE_DIAMOND_BLUE; }

    // FUN_0040c2d2 (rwg_functions.c:14876): play DAT_004fed98 = SOUND_COLLECT_BLUE_DIAMOND
    _playCollectSound() {
        if (SOUNDS.SOUND_COLLECT_BLUE_DIAMOND) SOUNDS.SOUND_COLLECT_BLUE_DIAMOND.play();
    }
}

export class DiamondRed extends Gem {
    // vtable 004dcfac. FUN_0040c4d9:15228-15240: alloc 0x20, type 3,
    // +0x14 timer = 0, +0x18 counter = 0, +0x1c = value argument of the
    // spawn call (FUN_0040c4d9 param at [ebp+0xc]).
    constructor(x, y, value) {
        super(GemType.DIAMOND_RED, x, y);
        this.mTimer = 0;
        this.mCounter = 0;
        this.mValueOverride = value | 0;   // +0x1c
    }

    // FUN_0040c278 (rwg_functions.c:14810)
    update() { return diamondUpdate(this); }

    // FUN_0040c2c5 (rwg_functions.c:14856): v = +0x1c; if (v < 1) v = 2000;
    getValue() {
        let v = this.mValueOverride;
        if (v < 1) v = 2000;
        return v;
    }

    // FUN_0040c32e (rwg_functions.c:14945): return timer
    getProgress() { return this.mTimer; }

    getImage() { return IMAGES.IMAGE_DIAMOND_RED; }

    // FUN_0040c2e8 (rwg_functions.c:14894): play DAT_004fedb0 = SOUND_COLLECT_RED_DIAMOND
    _playCollectSound() {
        if (SOUNDS.SOUND_COLLECT_RED_DIAMOND) SOUNDS.SOUND_COLLECT_RED_DIAMOND.play();
    }
}

// Order in which eggs entered the egg controller's brood list (+0xc).
// The add path FUN_00410585 is a std::list push_back (asm 0x410594-0x41059b),
// and FUN_0040412c walks that list front to back.
let _broodSeq = 0;

// Field egg. In the original eggs are NOT Sexy::Gem objects: they are 0x24-byte
// structs created by FUN_00407038 (rwg_functions.c:8721) and kept in their own
// list (field controller +0x24). The port stores them in Field.mGems tagged
// GemType.EGG; only the game-visible behavior below is mirrored.
//   +0x00 claim countdown, +0x04 claiming chick id (Magic chicks,
//   FUN_004071b2 / FUN_004072bc; never counted down — no egg code
//   decrements +0x00),
//   +0x08/+0x0c position (copied from the laying chick), +0x10 type,
//   +0x14 = 4000 (brood duration), +0x18 = -1 brood countdown,
//   +0x1c = 0 hatch-anim progress, +0x20 = 0 flag.
export class Egg extends Gem {
    constructor(eggType, x, y) {
        super(GemType.EGG, x, y);
        this.mEggType = eggType;
        this.mClaim = 0;                // +0x00
        this.mClaimId = 0;              // +0x04
        // Collect value DAT_0050033c[type] (rwg_functions.c:6711-6727) via FUN_004072fa.
        this.mEggSellValue = EGG_VALUE_BY_JS_TYPE[eggType] || EGG_VALUE_BY_JS_TYPE[0];
        this.mBroodDuration = 4000;     // +0x14 (FUN_00407038:8775)
        this.mBroodCountdown = -1;      // +0x18
        // +0x1c hatch-animation progress (FUN_00407038 sets 0); set to 0.001
        // when the broody gets up (FUN_0040258b) and then grows by 0.01 per
        // tick (FUN_00406c85); at 1.0 the egg hatches.
        this.mHatchProgress = 0;
        this.mBroodStarted = false;     // +0x20 (set on the first sit-down)
        this.mHatchSlowdown = 1.0;      // _DAT_004fc3b4 (Field sets it)
        this.mHatchNow = false;         // JS: signal to Field.update
        // JS: egg is in the brood-request list (egg controller +0xc).
        this._brooding = false;
    }

    get mBrooding() { return this._brooding; }
    // Cancel (FieldController, rwg_functions.c:8584-8586): +0x18 = -1,
    // +0x20 = 0, removed from the brood list.
    set mBrooding(v) {
        if (v && !this._brooding) this._broodSeq = ++_broodSeq;   // push_back
        this._brooding = !!v;
        if (!v) {
            this.mBroodCountdown = -1;
            this.mBroodStarted = false;
        }
    }

    // FUN_00406ac9 (asm 0x406ac9-0x406b07): 0 when +0x18 == -1, else
    // 1 - countdown / ftol(_DAT_004fc3b4 * 1000.0 + 0.5).
    get mBroodProgress() {
        if (this.mBroodCountdown === -1) return 0;
        const total = Math.trunc(this.mHatchSlowdown * 1000.0 + 0.5);
        return Math.fround(1 - this.mBroodCountdown / total);
    }
    set mBroodProgress(v) {}

    // Egg controller update FUN_00406c85 (rwg_functions.c:8427) per egg:
    //   if hatch progress < 1.0 (FUN_00406ab6): countdown (+0x18) > 0 → --;
    //     hatch (+0x1c) > 0 → += 0.01 (_DAT_004e9150); >= 1.0 → 1.0, hatch.
    // Hatching (chick + SOUND_EGG_BROODED) is done by Field.update.
    update() {
        if (!this.mIsAlive || this.mCollected) return false;
        if (!(this.mHatchProgress >= 1.0)) {
            if (this.mBroodCountdown > 0) this.mBroodCountdown--;
            if (this.mHatchProgress > 0.0) {
                this.mHatchProgress = Math.fround(this.mHatchProgress + 0.009999999776482582);
            }
            if (!(this.mHatchProgress >= 1.0)) return true;
            this.mHatchProgress = 1.0;
        }
        this.mHatchNow = true;
        return true;
    }

    getValue() { return this.mEggSellValue; }

    // FUN_00406c4d (rwg_functions.c:8411): every egg removal (click
    // FUN_004072fa, eaten FUN_004077ae, hatch FUN_00406c85) sets +0x1c = 1.0
    // before unlinking the egg; the lay-spot tick FUN_00407550 then frees the
    // spot holding it (Chick.js updateLaySpots).
    setCollected() {
        super.setCollected();
        this.mHatchProgress = 1.0;
    }

    getImage() { return IMAGES.IMAGE_EGG; }

    // FUN_004095cd (rwg_functions.c:12006, asm 0x4095cd-0x409651) egg rect:
    //   size = ftol(IMAGE_EGG.height * scale(1.0) + 0.5)
    //   x = screenX - size/2, y = screenY - size/2, w = h = size
    getRect() {
        const img = this.getImage();
        if (!img) return null;
        const size = _ftolRound((img.mHeight || 0) * 1.0);
        const sx = _ftolRound(this.mX);
        const sy = _ftolRound(this.mY);
        const half = Math.trunc(size / 2);
        return { x: sx - half, y: sy - half, w: size, h: size };
    }

    // FUN_00409fca (asm 0x40a044-0x40a061): frame = ftol(+0x1c * numCols), clamp numCols-1
    getFrame() {
        const img = this.getImage();
        const cols = (img && img.mNumCols) || 1;
        let frame = Math.trunc(this.mHatchProgress * cols);
        if (frame >= cols) frame = cols - 1;
        return frame;
    }

    // Egg shadow — FUN_0040a3d6 egg loop (asm 0x40a9ce-0x40aa25): IMAGE_SHADOW
    // (DAT_00500010) drawn immediately (not depth-sorted) into
    //   (x + w/4 + 5, y + h - shadow.h/2 - 0x19, w/2, h/2).
    drawShadow(g) {
        if (!this.mIsAlive) return;
        const sh = IMAGES.IMAGE_SHADOW;
        const r = this.getRect();
        if (!r || !sh || !sh.img) return;
        const tx = g.mTransX || 0, ty = g.mTransY || 0;
        const shH = sh.mHeight || 0;
        g.ctx.drawImage(sh.img,
            tx + r.x + Math.trunc(r.w / 4) + 5,
            ty + r.y + r.h - Math.trunc(shH / 2) - 0x19,
            Math.trunc(r.w / 2), Math.trunc(r.h / 2));
    }

    // Egg draw — FUN_0040a3d6 egg loop (rwg_functions.c:13463-13487):
    //   rect FUN_004095cd, colorize with FUN_00409fca's table, cel from +0x1c,
    //   queued with depth key = egg field y (local_104[3]).
    draw(g) {
        const img = this.getImage();
        if (!this.mIsAlive || !img || !img.img) return;
        const r = this.getRect();
        const tx = g.mTransX || 0, ty = g.mTransY || 0;
        const frame = this.getFrame();
        const celW = img.getCelWidth();
        const celH = img.getCelHeight();
        const tinted = getTintedEggCel(img, frame, this.mEggType);
        if (tinted) {
            g.ctx.drawImage(tinted, 0, 0, celW, celH, tx + r.x, ty + r.y, r.w, r.h);
        } else {
            const cols = img.mNumCols || 1;
            g.ctx.drawImage(img.img, (frame % cols) * celW, 0, celW, celH,
                tx + r.x, ty + r.y, r.w, r.h);
        }
    }

    // Egg click sound: FUN_004072fa ends with vt+0xc4 play; the only read of
    // DAT_004feda4 (SOUND_COLLECT_EGG) in the binary is inside it (asm 0x407486).
    _playCollectSound() {
        if (SOUNDS.SOUND_COLLECT_EGG) SOUNDS.SOUND_COLLECT_EGG.play();
    }
}
