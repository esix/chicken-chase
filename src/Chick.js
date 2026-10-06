// Port of Sexy::Chick and subclasses
// Original vtables (rwg_vtables.txt):
//   Chick 004dc894, SimpleChick 004dc8dc, BroodyChick 004dc924,
//   LayerChick 004dc96c, RoosterChick 004dc9b4,
//   MagicChick 004dd62c, HolyChick 004dd11c
// Class tree (ctor calls, asm 0x403ec2-0x403fef): Layer/Broody/Rooster/Holy
// are built through the SimpleChick ctor FUN_0041ff68(type, layFlag) —
// layFlag = 1 only for Layer; Magic calls FUN_004032ca(pos, 0) directly.
//
// Vtable slot meaning (derived from call offsets in FUN_0040344c /
// FUN_00403602 / FUN_0040a3d6):
//   [1] +0x04 Update             FUN_0040344c (Broody FUN_00403de4, Holy FUN_0040d912)
//   [2] +0x08 showHungryIcon     FUN_00403ac8 (Magic FUN_0040e36f → 0)
//   [3] +0x0c canBeSickTarget    FUN_0040e36f → 0 (Layer FUN_00403e3c)
//   [4] +0x10                    FUN_0040325a
//   [5] +0x14 isActive           FUN_0040327c (Broody FUN_00403dec)
//   [6] +0x18 inHurry            FUN_00403ae9 (Broody FUN_00402700)
//   [7] +0x1c decideState        FUN_004037e8 (Broody FUN_00402369)
//   [8] +0x20 startAction        FUN_0040386a (Broody FUN_0040241b, Holy FUN_0040d8b1)
//   [9] +0x24 onArrive           FUN_004037e1 (Broody FUN_004024b1)
//   [10] +0x28 onActionEnd       FUN_0044a036 no-op (Broody FUN_0040258b, Holy FUN_0040d922)
//   [11] +0x2c eatEnd            SimpleChick FUN_0041ff9a (Magic FUN_0040e392)
//   [12] +0x30 walkToFood        SimpleChick FUN_00420069 (Magic FUN_0040e44d)
//   [13] +0x34 seekFood          SimpleChick FUN_0042013e (Magic FUN_0040e51f)
//   [14] +0x38 eggType           FUN_00465f98 returns own type (Layer FUN_0040dba2)
//   [15] +0x3c coinType          FUN_004201a0 (Magic FUN_0040e372 → 2)
//
// Struct (ctor FUN_004032ca rwg_functions.c:3426, asm 0x4032ca):
//   +0x04 type, +0x08 state, +0x0c action, +0x10 action length,
//   +0x14 action elapsed, +0x18 anim/walk speed multiplier,
//   +0x1c age (satiety; -1 per tick, + calories when eating),
//   +0x20..+0x28 field pos x,y,z, +0x2c/+0x30 facing (unit vector),
//   +0x34 food, +0x38 sick counter, +0x3c id, +0x40 lay cooldown,
//   +0x44 hungry flag, +0x48 dig cooldown, +0x4c speed re-roll timer,
//   +0x50 fall speed, +0x54/+0x58 walk target, +0x5c/+0x60 wander target,
//   +0x64 hungry-icon anim, +0x68/+0x6c target (seed / egg).
// State +0x08 (FUN_004037e8 / FUN_0040386a): 0 held by a raven, 1 sick,
//   2 hungry (seek food), 3 go lay, 4 normal, 6 dead, 0x14 broody brooding.
//
// Action ids (+0x0c) and nominal lengths (PTR_004d01f0, read from the binary:
// [0,150,120,50,100,50,70,400,70,100,30,60,100,200]):
//   1 idle(150)  2 dig(120)  3 sick-start(50)  4 sick-idle(100)
//   5 cured(50)  6/7/8 broody sit/on-nest/get-up (70/400/70)
//   9 lay egg(100)  10 peck/eat(30)  11 walk(60)  12 holy spell(100)
//   13 death(200)
// Animation: elapsed += speedMult (x1.3 _DAT_004e9304 while walking in a
// hurry) per tick, clamped to the length (FUN_00403602); the cel is
// ftol(elapsed/length * numCols), clamped to numCols-1 (FUN_00409d5c asm
// 0x409e40-0x409e63) — the whole strip plays once per action.
//
// Sizes: the sprite is drawn at scale FUN_00409d5c (asm 0x409e15-0x409e43):
//   r = FUN_00403a65 (food ratio 0..2); scale = r >= 1.99 ? 1.0 : r*0.25+0.5
// so a new chick (food 0) is drawn at half size (39 px cel) and grows to
// the full 78 px cel as it eats.
//
// Coordinates: the chick lives in FIELD units (x 0..128, y 0..72, z height)
// like the original; mX/mY are screen accessors through FUN_00409567
// (screen = (6x+10, 2.8y-6z+367)) so the rest of the port keeps working.
//
// Constants read from app/chicken_chase.RWG .rdata: _DAT_004e9228=0.05 (d),
// _DAT_004e90c8=0.5 (d), _DAT_004e9350=1.5 (d), _DAT_004e9260=1.1 (d),
// _DAT_004e9304=1.3 (f), _DAT_004e92a8=1.2 (f), _DAT_004dc858=0.5 (f),
// _DAT_004e9148=0.03 (d), _DAT_004e9168=61.0 (d), _DAT_004e9238=0.11 (d),
// _DAT_004e9230=-1.0 (f), _DAT_004e93e0=2.0 (f), _DAT_004e93e8=1.99 (d),
// _DAT_004e92c0=0.25 (d), _DAT_004e92a0=0.8 (d), _DAT_004e93f8=0.7 (d),
// _DAT_004e93f0=510.0 (d), _DAT_004e90d8=10.0 (d), _DAT_004e9150=0.01 (d),
// _DAT_004e9408=0.999 (d), _DAT_004e9400=0.999 (f), _DAT_004e9250=70.0 (f),
// _DAT_004e939c=400.0 (f), _DAT_004e9234=0.001 (f), _DAT_004e9158=1000.0 (d),
// DAT_004fc72c=1 (initial chick id).

import { IMAGES, SOUNDS } from './Res.js';

// Chick types enum - from FUN_00403ec2 switch (rwg_functions.c:4645-4726).
// The type id is also the egg type id the chick lays/hatches from
// (FUN_00465f98 returns chick+0x04 = type).
export const ChickType = {
    LAYER: 0,    // SimpleChick/LayerChick
    BROODY: 1,   // BroodyChick
    ROOSTER: 2,  // RoosterChick
    MAGIC: 3,    // MagicChick
    HOLY: 4,     // HolyChick
};

// JS view of the current state/action for other files (mState getter).
// The original keeps state (+0x08) and action (+0x0c) separately.
export const ChickState = {
    NEWBORN: 0,       // state 0 (held by a raven)
    ADULT: 4,
    DEATH: 6,         // state 6
    BROODING: 0x14,   // broody sit / get-up (actions 6, 8)
    IDLE: 0x100,      // action 1 (and 0)
    WALK: 0x101,      // action 11
    PECK: 0x102,      // action 10
    SICK_START: 0x103, // action 3
    SICK_IDLE: 0x104, // action 4
    LAYING: 0x105,    // action 9
    DIG: 0x106,       // action 2
    BROOD_IDLE: 0x107, // action 7
    CURED: 0x108,     // action 5 (not "sick": FUN_00402342 is 3/4 only)
    HOLY_SPELL: 0x10c, // action 12
};

// Egg types (JS ids, used by Field.hatchEgg / Gem.js tinting). The original
// egg type is the chick type id; mapping chickType → EggType:
//   LAYER→WHITE, BROODY→GOLDEN, ROOSTER→BLACK, MAGIC→BLUE, HOLY→RED.
export const EggType = {
    WHITE: 0,     // layer eggs
    BLUE: 1,      // magic eggs
    RED: 2,       // holy eggs
    BLACK: 3,     // rooster eggs
    GOLDEN: 4,    // broody eggs (drawn blue-violet, FUN_00409fca colour 1)
};

export const CHICK_TO_EGG = [EggType.WHITE, EggType.GOLDEN, EggType.BLACK, EggType.BLUE, EggType.RED];
export const EGG_TO_CHICK = [ChickType.LAYER, ChickType.MAGIC, ChickType.HOLY, ChickType.ROOSTER, ChickType.BROODY];

// PTR_004d01f0 action length table (read from the binary).
const ACTION_LEN = [0, 150, 120, 50, 100, 50, 70, 400, 70, 100, 30, 60, 100, 200];
const A_IDLE = 1, A_DIG = 2, A_SICK_START = 3, A_SICK_IDLE = 4, A_CURED = 5,
    A_SIT = 6, A_NEST = 7, A_GETUP = 8, A_LAY = 9, A_PECK = 10, A_WALK = 11,
    A_SPELL = 12, A_DEATH = 13;
const S_HELD = 0, S_SICK = 1, S_HUNGRY = 2, S_LAY = 3, S_NORMAL = 4, S_DEAD = 6, S_BROOD = 0x14;

// _DAT_004e9230 = -1.0f "no target".
const NO_TARGET = -1.0;

// Sell base table DAT_0050035c (same values as ShopDialogs.js SELL_BASE).
const SELL_BASE = [500, 800, 400, 3000, 6000];

// DAT_004fc72c chick id counter, initial value 1 (read from .data).
let gNextChickId = 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// FUN_00409567 projection (see Field.js fieldToScreen).
function projX(fx) { return Math.trunc(fx * 6.0 + 0.5) + 10; }
function projY(fy, fz) { return Math.trunc(fy * 2.8 + (fz || 0) * -6.0 + 0.5) + 367; }

// thunk_FUN_00429891: Mersenne twister & 0x7fffffff.
function mtRand() { return Math.floor(Math.random() * 0x80000000); }
// _rand (FUN_004a082c): 0..0x7fff.
function crtRand() { return Math.floor(Math.random() * 0x8000); }

// FUN_00403207 (rwg_functions.c:3308): (base - spread) + 2*mt*2^-31*spread.
function randAround(base, spread) {
    const f = mtRand() * 4.656612873077393e-10 * spread;
    return (base - spread) + f + f;
}

// FUN_00403c97: max(|x|,|y|);  FUN_004050cf: max(|x|,|y|,|z|).
function maxNorm2(x, y) { return Math.max(Math.abs(x), Math.abs(y)); }

function fcOf(field) { return field && field.mFieldController; }
function levelOf(field) {
    const fc = fcOf(field);
    return (fc && fc.mCurrentLevel) || 1;
}
// FUN_00405886 (asm 0x405886): level <= 6.
export function isEarlyLevel(level) { return level <= 6; }
// FUN_00405899 (asm 0x405899): food/calorie unit = level <= 6 ? 500 : 700.
export function foodUnit(level) { return isEarlyLevel(level) ? 500 : 700; }
// FUN_004058af (rwg_functions.c:6789): food cap = unit*33 (level < 10),
// unit*99/2 (level < 20), unit*66.
export function foodCap(level) {
    const u = foodUnit(level);
    if (level < 10) return u * 0x21;
    if (level < 0x14) return Math.trunc((u * 99) / 2);
    return u * 0x42;
}

// ---------------------------------------------------------------------------
// Lay spots — list +0x18 of the egg controller (app+0x24).
// Built by the egg-controller ctor FUN_00406b47 (rwg_functions.c:8320,
// loop 8358-8395): 0x12 spots, spot i (1..18) = {x = (float)i * 7.1111111
// (_DAT_004e9330) - 3.5555556 (_DAT_004e9328), y = 68.0f (_DAT_004e9320),
// +8 reserve timer = 0, +0xc owner chick id = -1, +0x10/+0x14 egg = null}.
// y = 68 > 61 (FUN_00403bbf) — the nest row below the field.
// The JS list lives on the Field object (one egg controller per level).
// ---------------------------------------------------------------------------
function laySpotsOf(field) {
    if (!field) return null;
    if (!field._laySpots) {
        const spots = [];
        for (let i = 0; i < 0x12; i++) {
            const k = i + 1;
            spots.push({
                pos: [Math.fround(Math.fround(k * 7.111111164093018) - 3.555555582046509), 68.0],
                timer: 0,
                owner: -1,
                egg: null,
            });
        }
        field._laySpots = spots;
    }
    return field._laySpots;
}

// FUN_00406ab6 (rwg_functions.c:8243): egg +0x1c (hatch progress) >= 1.0.
// The egg removal FUN_00406c4d (rwg_functions.c:8410) sets +0x1c = 1.0, so
// a collected/eaten/hatched JS egg counts as busy too.
function eggBusy(e) {
    return !e || !e.mIsAlive || e.mCollected || e.mHatchProgress >= 1.0;
}

// FUN_00407550 (rwg_functions.c:9097), run first by the egg-controller
// update FUN_00406c85 (rwg:8454) once per tick, after the chick updates
// (FUN_00405fcf rwg:7466-7470): drop a spot's egg when it is busy; timer
// > 0 → timer--, reaching 0 frees the owner (+0xc = -1).
// Called by Field.update once per tick (start of the egg update).
export function updateLaySpots(field) {
    const spots = laySpotsOf(field);
    if (!spots) return;
    for (const sp of spots) {
        if (sp.egg && eggBusy(sp.egg)) sp.egg = null;
        if (sp.timer > 0) {
            sp.timer--;
            if (sp.timer === 0) sp.owner = -1;
        }
    }
}

// FUN_004075da (rwg_functions.c:9142, asm 0x4075da-0x4077ab): reserve a
// lay spot for chick `id`. A spot already owned by `id` is refreshed
// (timer = 10, asm 0x4076a5); otherwise the free spots (timer <= 0 and no
// egg, asm 0x4076cf-0x4076d9) are collected and one is picked by
// mt % count (asm 0x407728-0x40772e): timer = 10, owner = id. None → null.
function reserveLaySpot(field, id) {
    const spots = laySpotsOf(field);
    if (!spots) return null;
    for (const sp of spots) {
        if (sp.owner === id) {
            sp.timer = 10;
            sp.owner = id;
            return sp;
        }
    }
    const free = spots.filter(sp => !(sp.timer > 0) && !sp.egg);
    if (free.length === 0) return null;
    const sp = free[mtRand() % free.length];
    sp.timer = 10;
    sp.owner = id;
    return sp;
}

// FUN_00407038 tail (asm 0x4070fd-0x407196): the new egg is bound to the
// spot with the smallest |spot.x - egg.x| (FUN_00406b08, strict <, start
// 1e6 _DAT_004e9280): spot egg = egg, owner = -1.
function bindEggToLaySpot(field, egg, ex) {
    const spots = laySpotsOf(field);
    if (!spots || !egg) return;
    let best = null;
    let bestD = 1000000.0;
    for (const sp of spots) {
        const d = Math.abs(sp.pos[0] - ex);
        if (d < bestD) { bestD = d; best = sp; }
    }
    if (best) {
        best.egg = egg;
        best.owner = -1;
    }
}

// FUN_0040c4d9 (rwg_functions.c:15152): the gem factory creates nothing
// when (app+0x28)+0x1c is set (LevelData `noPeckCoins`, set by
// FUN_00423e5a rwg:43969). Applied here because Field.spawnGem does not.
function gemsDisabled(field) {
    const fc = fcOf(field);
    const cfg = fc && fc.mLevelConfig;
    return !!(cfg && cfg.noPeckCoins);
}

// Sexy colorized draw multiplies every pixel by the colour (alpha included).
function colorizedCel(img, sx, sy, w, h, color) {
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.ceil(w));
    off.height = Math.max(1, Math.ceil(h));
    const o = off.getContext('2d');
    o.drawImage(img.img, sx, sy, w, h, 0, 0, w, h);
    o.globalCompositeOperation = 'multiply';
    o.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    o.fillRect(0, 0, w, h);
    o.globalCompositeOperation = 'destination-in';
    o.drawImage(img.img, sx, sy, w, h, 0, 0, w, h);
    return off;
}

// Render-list entry executor FUN_0041746a (asm 0x41746a-0x41761b) for an
// image with draw params (FUN_004090cd defaults: colorize off, scale 1.0,
// frame -1, mirror off, reverse off):
//   frame >= 0 && numCols > 1: cel = reverse ? numCols-frame-1 : frame,
//     dest = (x, y, ftol(celW*scale+0.5), ftol(h*scale+0.5)), mirrored when
//     params.mirror (FUN_00466e30) else FUN_00466ddc;
//   otherwise scale == 1: plain draw at (x, y); else stretched to
//     (ftol(w*scale+0.5), ftol(h*scale+0.5)).
// params.color = [r,g,b,a] when colorize is on (FUN_004662cd/FUN_004662b1).
export function drawWithParams(g, img, x, y, params) {
    if (!img || !img.img) return;
    if (g._isReady && !g._isReady(img.img)) return;
    const p = params || {};
    const scale = (p.scale === undefined) ? 1.0 : p.scale;
    const cols = img.mNumCols || 1;
    let sx = 0, sw = img.mWidth, sh = img.mHeight, dw, dh;
    if (p.frame !== undefined && p.frame >= 0 && cols > 1) {
        const celW = Math.trunc(img.mWidth / cols);
        const cel = p.reverse ? cols - p.frame - 1 : p.frame;
        sx = cel * celW;
        sw = celW;
        dw = Math.trunc(celW * scale + 0.5);
        dh = Math.trunc(img.mHeight * scale + 0.5);
    } else if (scale === 1.0) {
        dw = img.mWidth;
        dh = img.mHeight;
    } else {
        dw = Math.trunc(img.mWidth * scale + 0.5);
        dh = Math.trunc(img.mHeight * scale + 0.5);
    }
    const ctx = g.ctx;
    const tx = (g.mTransX || 0) + x, ty = (g.mTransY || 0) + y;
    let src = img.img, srcX = sx, srcY = 0;
    ctx.save();
    if (p.color) {
        src = colorizedCel(img, sx, 0, sw, sh, p.color);
        srcX = 0;
        ctx.globalAlpha = (p.color[3] === undefined ? 255 : p.color[3]) / 255;
    }
    if (p.mirror) {
        ctx.translate(tx + dw, ty);
        ctx.scale(-1, 1);
        ctx.drawImage(src, srcX, srcY, sw, sh, 0, 0, dw, dh);
    } else {
        ctx.drawImage(src, srcX, srcY, sw, sh, tx, ty, dw, dh);
    }
    ctx.restore();
}

export class Chick {
    // Port of Sexy::Chick - vtable at 004dc894
    // Constructor: FUN_004032ca (rwg_functions.c:3426). `layFlag` is the
    // char argument (1 only for LayerChick, asm 0x403fda).
    // x, y are SCREEN coordinates (JS callers); they are converted to field
    // units with FUN_00409533.
    constructor(type, x, y, layFlag = false, level = 1) {
        this.mType = type;                              // +0x04
        this.mSpeedMult = 1.0;                          // +0x18 = 0x3f800000
        this.mAction = A_IDLE;                          // +0x0c = 1
        this.mActionElapsed = 0;                        // +0x14
        this.mActionLen = 150.0;                        // +0x10 = _DAT_004e9174
        this.mPos = [(x - 10) / 6.0, (y - 367) / 2.8, 0];   // +0x20..+0x28
        this.mFacing = [1.0, 0];                        // +0x2c = 1.0, +0x30 = 0
        this.mHunger = 2000;                            // +0x38
        // +0x40 = layFlag ? (FUN_00405886 ? 1500 : 2000) : -1
        this.mLayCooldown = layFlag ? (isEarlyLevel(level) ? 1500 : 2000) : -1;
        this.mVz = 0;                                   // +0x50
        this.mId = gNextChickId++;                      // +0x3c = DAT_004fc72c++
        this.mHungry = false;                           // +0x44
        this.mDigCooldown = 0;                          // +0x48
        this.mSpeedTimer = 0;                           // +0x4c
        this.mTarget = [0, 0];                          // +0x54/+0x58
        this.mWander = [NO_TARGET, NO_TARGET];          // +0x5c/+0x60
        this.mHungryAnim = 0;                           // +0x64
        this.mFoodTarget = null;                        // +0x68/+0x6c
        this.mFoodCounter = 0;                          // +0x34
        this.mAge = (mtRand() % 200) * 2 + 0xce4;       // +0x1c
        this.mLevel = level;
        this.mStateO = S_NORMAL;                        // +0x08 = 4
        this.mRemoved = false;                          // JS: removed from the list
        // FUN_004032ca tail: wander target = FUN_004046aa (random field
        // point); x < 0 → FUN_004039f5, else walk to it (action 11, 60).
        // The world is not reachable from the JS ctor, so this runs on the
        // first update().
        this._ctorPending = true;
    }

    // --- screen accessors (FUN_00409567 / FUN_00409533) -------------------
    get mX() { return projX(this.mPos[0]); }
    set mX(px) { this.mPos[0] = (px - 10) / 6.0; }
    get mY() { return projY(this.mPos[1], 0); }
    set mY(py) { this.mPos[1] = (py - 367) / 2.8; }
    // Facing used by the draw mirror flag (+0x2c > 0, FUN_00409d5c).
    get mDirection() { return this.mFacing[0] > 0 ? 0 : 1; }
    set mDirection(d) { this.mFacing = [d ? -1.0 : 1.0, 0]; }

    // --- JS compatibility views -------------------------------------------
    get mIsAlive() { return this.mStateO !== S_DEAD && !this.mRemoved; }
    // Selling (ShopDialogs) writes false: the original removes the chick
    // from the list (FUN_0040466e) without a death animation.
    set mIsAlive(v) { if (!v) { this.mRemoved = true; this.mStateO = S_DEAD; } }
    // State 0 = held by a raven (set at asm 0x416fe0).
    get mIsCarried() { return this.mStateO === S_HELD; }
    set mIsCarried(v) {
        if (v) {
            // FUN_00416ed4 asm 0x416fd7-0x416ff1: if state != 6: state = 0 and
            // restart the current action (FUN_004032b8) when it is < 14.
            if (this.mStateO === S_DEAD) return;
            this.mStateO = S_HELD;
            if (this.mAction < 14) this._setAction(this.mAction);
        } else if (this.mStateO === S_HELD) {
            // FUN_0040497d (rwg_functions.c:5479): vt[7] + vt[8]; the raven
            // then writes the clamped position (z kept → the chick falls).
            this._decide(this._field);
            this._start(this._field);
        }
    }
    // FUN_00402342 (rwg_functions.c:2063): action 3 or 4 = sick.
    get mIsSick() { return this.mAction === A_SICK_START || this.mAction === A_SICK_IDLE; }
    // Writing true infects like FUN_00404d00 without its sound/flag checks
    // (the caller — e.g. RiskController flu — plays SOUND_SICK itself).
    set mIsSick(v) { if (v) this.infect(); }
    // No juvenile phase exists in the original; other files use mIsAdult as
    // "state != 0" (Pet.js/RiskController mapping).
    get mIsAdult() { return this.mStateO !== S_HELD; }
    set mIsAdult(v) {}
    // Draw scale FUN_00409d5c (see header). Writes are ignored.
    get mScale() {
        const r = this.getFoodRatio();
        return (r >= 1.99) ? 1.0 : r * 0.25 + 0.5;
    }
    set mScale(v) {}
    get mGrowTimer() { return 0; }
    set mGrowTimer(v) {}
    get mState() {
        if (this.mStateO === S_DEAD) return ChickState.DEATH;
        switch (this.mAction) {
            case A_DIG: return ChickState.DIG;
            case A_SICK_START: return ChickState.SICK_START;
            case A_SICK_IDLE: return ChickState.SICK_IDLE;
            case A_CURED: return ChickState.CURED;
            case A_SIT: case A_GETUP: return ChickState.BROODING;
            case A_NEST: return ChickState.BROOD_IDLE;
            case A_LAY: return ChickState.LAYING;
            case A_PECK: return ChickState.PECK;
            case A_WALK: return ChickState.WALK;
            case A_SPELL: return ChickState.HOLY_SPELL;
            case A_DEATH: return ChickState.DEATH;
            default: return ChickState.IDLE;
        }
    }

    // --- action helpers -----------------------------------------------------
    // FUN_004032b8 (rwg_functions.c:3402): action = a, elapsed = 0,
    // length = PTR_004d01f0[a].
    _setAction(a) {
        this.mAction = a;
        this.mActionElapsed = 0;
        this.mActionLen = ACTION_LEN[a] || 0;
    }
    _setActionLen(a, len) {
        this.mAction = a;
        this.mActionElapsed = 0;
        this.mActionLen = len;
    }
    // FUN_00403231 (asm 0x403231): length > 0 && elapsed == length.
    _actionFinished() {
        return this.mActionLen > 0 && this.mActionElapsed === this.mActionLen;
    }
    // FUN_0040918d (rwg_functions.c:11638): elapsed/length (0 if length <= 0).
    getActionProgress() {
        return this.mActionLen <= 0 ? 0 : this.mActionElapsed / this.mActionLen;
    }
    _endAction() { this.mActionElapsed = this.mActionLen; }

    // --- food ---------------------------------------------------------------
    // FUN_00403a3e (asm 0x403a3e): 2 if food >= unit*11, 1 if >= unit*5, else 0.
    getFoodTier() {
        const u = foodUnit(this.mLevel);
        if (this.mFoodCounter >= u * 0xb) return 2;
        return this.mFoodCounter >= u * 5 ? 1 : 0;
    }
    _isFed() { return this.getFoodTier() !== 0; }
    // FUN_00403a65 (asm 0x403a65): food >= unit*11 → 2.0 (_DAT_004e93e0),
    // else 2*food/(unit*11).
    getFoodRatio() {
        const u = foodUnit(this.mLevel);
        if (this.mFoodCounter >= u * 0xb) return 2.0;
        return (this.mFoodCounter + this.mFoodCounter) / (u * 0xb);
    }
    // FUN_00403c75 (asm 0x403c75-0x403c94): fild food(+0x34);
    // fidiv (FUN_00405899()*0x21); fstps → float result.
    getSellRatio() { return Math.fround(this.mFoodCounter / (foodUnit(this.mLevel) * 0x21)); }
    // FUN_00403bd6 (asm 0x403bd6-0x403c72): sell price, base table
    // DAT_0050035c indexed by type (+0x4):
    //   r = (float)FUN_00403c75 (fstps -0x4, asm 0x403be7);
    //   p = ftol(SELL[type] * r)          (fild; fmuls r; FUN_004bed40, asm 0x403c19-0x403c1f)
    //   asm 0x403c24-0x403c31: fld1; fcomps r; test ah,0x41; jne skip —
    //   the second term is added only when 1.0 > r:
    //   asm 0x403c51-0x403c63: fild SELL; fld r; fld1; fsubrp (de e1 =
    //   st1 = 1.0 - r); fmulp; fdivl 10.0 (_DAT_004e90d8); ftol:
    //   p += ftol(SELL[type] * (1.0 - r) / 10.0).
    //   No clamping in the function; callers (rwg:5343, 38938, 40553) use
    //   the value as is. ftol = FUN_004bed40 (truncation).
    getSellPrice() {
        const base = SELL_BASE[this.mType] || 0;
        const r = this.getSellRatio();
        let p = Math.trunc(base * r);
        if (1.0 > r) p += Math.trunc(base * (1.0 - r) / 10.0);
        return p;
    }

    // FUN_00403a9a (asm 0x403a9a): recompute and return the hungry flag +0x44:
    //   hungry: age < (FUN_00405886 ? 4500 : 5000); not hungry: age < 3000.
    _updateHungry() {
        if (this.mHungry) {
            this.mHungry = this.mAge < (isEarlyLevel(this.mLevel) ? 0x1194 : 0x1388);
        } else {
            this.mHungry = this.mAge < 0xbb8;
        }
        return this.mHungry;
    }

    // FUN_00403bbf (asm 0x403bbf): y > 61.0 (_DAT_004e9168) = off the field.
    _offField() { return 61.0 < this.mPos[1]; }

    // --- vtable slots ---------------------------------------------------------
    // vt[2] FUN_00403ac8: hungry flag (recomputed) && seed list empty.
    showsHungryIcon(field) {
        if (!this._updateHungry()) return false;
        return !field || !field.getSeedCount || field.getSeedCount() === 0;
    }
    // vt[3] default FUN_0040e36f → 0 (LayerChick overrides).
    canBeSickTarget() { return false; }
    // vt[5] FUN_0040327c (asm 0x40327c): state != 6 && state != 0 && z == 0.
    isActive() {
        return this.mStateO !== S_DEAD && this.mStateO !== S_HELD && this.mPos[2] === 0;
    }
    // vt[6] FUN_00403ae9: hungry flag.
    inHurry() { return this._updateHungry(); }
    // Only LayerChick lays (lay cooldown != -1).
    canLayEggs() { return false; }

    // vt[7] FUN_004037e8 (rwg_functions.c:3813)
    _decide(field) {
        if (this.mIsSick) { this.mStateO = S_SICK; return; }
        if (this._updateHungry()) { this.mStateO = S_HUNGRY; return; }
        // Lay cooldown 0 and a lay spot reserved by FUN_004075da(id)
        // (asm 0x403825-0x403863) → state 3, else 4.
        let lay = false;
        if (this.mLayCooldown === 0) lay = !!reserveLaySpot(field, this.mId);
        this.mStateO = lay ? S_LAY : S_NORMAL;
    }

    // vt[8] FUN_0040386a (rwg_functions.c:3867)
    _start(field) {
        switch (this.mStateO) {
            case S_SICK:
                // action 3 (50) the first time, then action 4 (100) repeating.
                if (this.mAction === A_SICK_START || this.mAction === A_SICK_IDLE) {
                    this._setActionLen(A_SICK_IDLE, 100.0);   // _DAT_004e9398
                } else {
                    this._setActionLen(A_SICK_START, 50.0);   // _DAT_004e92ac
                }
                return;
            case S_HUNGRY: this._seekFood(field); return;
            case S_LAY: {
                // FUN_004038d1 (rwg_functions.c:3918): no spot → elapsed =
                // length; else target = spot, action 11 (60 _DAT_004e9360).
                const sp = reserveLaySpot(field, this.mId);
                if (!sp) {
                    this._endAction();
                } else {
                    this.mTarget = [sp.pos[0], sp.pos[1]];
                    this._setActionLen(A_WALK, 60.0);
                }
                return;
            }
            case S_NORMAL: this._wander(field); return;
            default:
                this.mAction = 0;
                this.mActionElapsed = 0;
                this.mActionLen = 0;
        }
    }

    // vt[9] FUN_004037e1: elapsed = length.
    _onArrive(field) { this._endAction(); }
    // vt[10] FUN_0044a036: no-op.
    _onActionEnd(field) {}

    // FUN_0040392e (rwg_functions.c:3930): state-4 wander.
    _wander(field) {
        const d = maxNorm2(this.mWander[0] - this.mPos[0], this.mWander[1] - this.mPos[1]);
        if (0.11 <= d) {
            if (this.mWander[0] < 0.0 && (mtRand() & 1) !== 0 && field && field.pickRandomFieldPoint) {
                this.mWander = field.pickRandomFieldPoint();
            }
            // asm 0x4039bc-0x4039c6: walk when wander.x >= 0.0.
            if (this.mWander[0] >= 0.0) {
                this.mTarget = [this.mWander[0], this.mWander[1]];
                this._setActionLen(A_WALK, 60.0);   // _DAT_004e9360
                return;
            }
        } else {
            this.mWander = [NO_TARGET, NO_TARGET];
        }
        this._digOrIdle();
    }

    // FUN_004039f5 (rwg_functions.c:4019): dig when the dig cooldown is 0 and
    // the chick is on the field; else action (mt % 2) + 1 (idle / dig).
    _digOrIdle() {
        if (this.mDigCooldown === 0 && !this._offField()) {
            this._setActionLen(A_DIG, 120.0);       // _DAT_004e9240
            return;
        }
        this._setAction((mtRand() % 2) + 1);
    }

    // vt[13] SimpleChick FUN_0042013e (asm 0x42013e): no seeds →
    // FUN_004039f5; else action 11 (60) toward the nearest seed claimable
    // by this chick (FUN_0041c11f, which claims it).
    _seekFood(field) {
        if (!field || !field.getSeedCount || field.getSeedCount() === 0) {
            this._digOrIdle();
            return;
        }
        this._setActionLen(A_WALK, 60.0);
        this.mFoodTarget = field.claimNearestSeed(this.mPos, this.mId);
    }

    // vt[12] SimpleChick FUN_00420069 (asm 0x420069): drop the target if
    // its life (+0x28) <= 0; no target → end the walk; else re-claim it
    // (FUN_0041c220) and walk to it; on arrival action 10 (30).
    _walkToFood(field) {
        const s = this.mFoodTarget;
        if (s && !(s.life > 0)) this.mFoodTarget = null;
        if (!this.mFoodTarget) { this._endAction(); return; }
        if (field && field.reclaimSeed) field.reclaimSeed(this.mFoodTarget, this.mId);
        if (!this._step([this.mFoodTarget.pos[0], this.mFoodTarget.pos[1]])) {
            this._setActionLen(A_PECK, 30.0);       // _DAT_004e9410
        }
    }

    // vt[11] SimpleChick FUN_0041ff9a (asm 0x41ff9a): if the seed is alive:
    // age += seed calories (+0x24); food += ftol(cal * mult (+0x2c) + 0.5),
    // capped at FUN_004058af; seed life = 0 (FUN_0041bfbe). Target cleared.
    _eatEnd(field) {
        const s = this.mFoodTarget;
        if (s && s.life > 0) {
            this.mAge += s.calories;
            this.mFoodCounter += Math.trunc(s.calories * s.mult + 0.5);
            const cap = foodCap(this.mLevel);
            if (this.mFoodCounter >= cap) this.mFoodCounter = cap;
            s.life = 0;
        }
        this.mFoodTarget = null;
    }

    // vt[14] FUN_00465f98: own type → JS egg type.
    getEggType(field) { return CHICK_TO_EGG[this.mType]; }
    // vt[15] FUN_004201a0 (rwg_functions.c:39698): FUN_00403a65 > 1.0 →
    // 0 (gold) else 1 (silver).
    getCoinType() { return this.getFoodRatio() > 1.0 ? 0 : 1; }

    // FUN_00403af3 (asm 0x403af3-0x403bbe): one walk step toward t (field).
    //   step = (ratio*0.05*0.5 + 0.05) * speedMult; hurry → *1.5
    //   moving while step*1.1 <= maxNorm(t - pos): facing = normalised d,
    //   pos += facing*step; else pos = t, z = 0. Returns `moving`.
    _step(t) {
        let step = (this.getFoodRatio() * 0.05 * 0.5 + 0.05) * this.mSpeedMult;
        if (this.inHurry()) step = step * 1.5;
        let dx = t[0] - this.mPos[0];
        let dy = t[1] - this.mPos[1];
        const moving = step * 1.100000023841858 <= maxNorm2(dx, dy);
        if (moving) {
            // FUN_00403cdf: normalise (dx, dy) to length 1.0
            const len = Math.sqrt(dx * dx + dy * dy);
            dx = dx * (1.0 / len);
            dy = (1.0 / len) * dy;
            this.mFacing = [dx, dy];
            this.mPos[0] = dx * step + this.mPos[0];
            this.mPos[1] = dy * step + this.mPos[1];
        } else {
            this.mPos = [t[0], t[1], 0];
        }
        return moving;
    }

    // FUN_00403602 (rwg_functions.c:3652): advance/run the current action.
    _tickAction(field) {
        let mult = 1.0;
        if (this.mAction === A_WALK && !this._actionFinished() && this.inHurry()) {
            mult = 1.2999999523162842;               // _DAT_004e9304
        }
        if (this.mActionLen > 0 && !this._actionFinished()) {
            this.mActionElapsed = this.mSpeedMult * mult + this.mActionElapsed;
        }
        if (this.mActionLen <= this.mActionElapsed) this.mActionElapsed = this.mActionLen;

        if (!this._actionFinished()) {
            if (this.mAction !== A_WALK) return;
            if (!this._updateHungry()) {
                if (this.mLayCooldown === 0 && this.mStateO === S_LAY) {
                    if (!this._step(this.mTarget)) {
                        this._setActionLen(A_LAY, 100.0);   // _DAT_004e9398
                    } else {
                        // asm 0x403791-0x4037be: re-reserve the spot each
                        // step; lost → elapsed = length, else target = spot.
                        const sp = reserveLaySpot(field, this.mId);
                        if (!sp) this._endAction();
                        else this.mTarget = [sp.pos[0], sp.pos[1]];
                    }
                } else if (!this._step(this.mTarget)) {
                    this._onArrive(field);
                }
            } else {
                this._walkToFood(field);
            }
            return;
        }
        switch (this.mAction) {
            case A_PECK:
                this._eatEnd(field);
                break;
            case A_LAY:
                // +0x40 = FUN_00405886 ? 1500 : 2000; egg type vt[14];
                // FUN_00407038 spawns the egg at the chick position and plays
                // a random DAT_00500624 sound (SOUND_EGG_LAYERED1/2,
                // rand()%2 — rwg_functions.c:8748-8760).
                this.mLayCooldown = isEarlyLevel(this.mLevel) ? 1500 : 2000;
                if (field && field.spawnEgg) {
                    const egg = field.spawnEgg(this.mX, this.mY, this.getEggType(field));
                    const snd = (crtRand() % 2) === 0
                        ? SOUNDS.SOUND_EGG_LAYERED1 : SOUNDS.SOUND_EGG_LAYERED2;
                    if (snd) snd.play();
                    bindEggToLaySpot(field, egg, this.mPos[0]);
                }
                break;
            case A_DIG:
                // dig cooldown 0 and on the field → gem vt[15] via FUN_0040c4d9
                // at the chick position; cooldown = FUN_00405886 ? 800 : 1000.
                if (this.mDigCooldown === 0 && !this._offField()) {
                    if (field && field.spawnGem && !gemsDisabled(field)) {
                        field.spawnGem(this.getCoinType(), this.mX, this.mY - 20);
                    }
                    this.mDigCooldown = isEarlyLevel(this.mLevel) ? 800 : 1000;
                }
                break;
            default:
                this._onActionEnd(field);
        }
    }

    // FUN_004035c8 (rwg_functions.c:3626): fall: vz += 0.03; z -= vz; z >= 0.
    _fall() {
        this.mVz = this.mVz + 0.029999999329447746;
        this.mPos[2] = this.mPos[2] - this.mVz;
        if (this.mPos[2] <= 0.0) this.mPos[2] = 0;
    }

    _runCtor(field) {
        if (!this._ctorPending) return;
        this._ctorPending = false;
        if (field) this.mLevel = levelOf(field);
        if (this.mLayCooldown !== -1) {
            this.mLayCooldown = isEarlyLevel(this.mLevel) ? 1500 : 2000;
        }
        // FUN_004032ca:3481-3497
        if (field && field.pickRandomFieldPoint) this.mWander = field.pickRandomFieldPoint();
        if (!(this.mWander[0] >= 0)) {
            this._digOrIdle();
        } else {
            this.mTarget = [this.mWander[0], this.mWander[1]];
            this._setActionLen(A_WALK, 60.0);
        }
    }

    // vt[1] FUN_0040344c (rwg_functions.c:3560) Chick::Update. Returns false
    // when the chick must be removed from the list.
    update(field) {
        this._field = field;
        this._runCtor(field);
        if (this.mRemoved) return false;
        if (this.mStateO === S_DEAD) {
            this._tickAction(field);
            if (this._actionFinished()) this.mRemoved = true;
            return !this.mRemoved;
        }
        if (this.mStateO === S_HELD) return true;
        if (0.0 < this.mPos[2]) {
            this._fall();
            if (0.0 < this.mPos[2]) return true;
        }
        this.mVz = 0;
        // +0x64 hungry-icon timer: +0.01 per tick while vt[2], saturating at
        // 0.999; otherwise 0.
        if (this.showsHungryIcon(field)) {
            const v = this.mHungryAnim + 0.009999999776482582;
            this.mHungryAnim = (v < 0.9990000128746033) ? v : 0.9990000128746033;
        } else {
            this.mHungryAnim = 0;
        }
        if (this.mStateO !== S_NORMAL) this.mWander = [NO_TARGET, NO_TARGET];
        if (this.mDigCooldown > 0) this.mDigCooldown--;
        if (this.mLayCooldown > 0 && this.getFoodTier() !== 0) this.mLayCooldown--;
        if (this.mSpeedTimer > 0) this.mSpeedTimer--;
        if (this._actionFinished()) {
            this._decide(field);
            this._start(field);
            if (this.mSpeedTimer < 1) {
                this.mSpeedTimer = 1000;
                // FUN_00403207(_DAT_004e92a8 = 1.2, _DAT_004dc858 = 0.5)
                this.mSpeedMult = Math.fround(randAround(1.2000000476837158, 0.5));
            }
        }
        this._tickAction(field);
        if (this.isActive()) {
            this.mAge--;
            if (this.mIsSick) this.mHunger--;
            if (this.mAge < 1 || this.mHunger < 1) {
                this.die(true);
            }
        }
        return true;
    }

    // FUN_00404d00 (asm 0x404d00) chick part: if state != 0 → state 1 and
    // vt[8] (action 3, 50).
    infect() {
        if (this.mStateO === S_HELD || this.mStateO === S_DEAD) return;
        this.mStateO = S_SICK;
        this._start(this._field);
    }

    // FUN_0040342b (rwg_functions.c:3530): state 6, action 13 (death, 200).
    // The death sound DAT_004fed94 is played by FUN_0040344c:3637-3638
    // (age/sick death); FUN_00420e2e (holy spell) kills without it.
    die(playSound = true) {
        if (this.mStateO === S_DEAD) return;
        this.mStateO = S_DEAD;
        this.mActionElapsed = 0;
        this.mAction = A_DEATH;
        this.mActionLen = 200.0;                    // _DAT_004e9244
        if (playSound && SOUNDS.SOUND_CHICK_DEATH) SOUNDS.SOUND_CHICK_DEATH.play();
    }

    // FUN_0040466e (rwg_functions.c:5320-5335): FUN_0040342b (state 6,
    // action 13 — no sound; the death sound DAT_004fed94 is only played at
    // rwg:3637) then FUN_00405184 erases the chick from the field list at
    // once (no death animation).
    removeFromField() {
        this.die(false);
        this.mRemoved = true;
    }

    // Raven escape FUN_0040481d (rwg_functions.c:5359): chick != null and
    // state != 6 → FUN_0040466e.
    ravenAttack() {
        if (this.mStateO === S_DEAD) return false;
        this.removeFromField();
        return true;
    }

    // Cure — FUN_0040490a (rwg_functions.c:5432; $50 handled by the caller,
    // SOUND_CURED DAT_004fed6c) → FUN_00403403 (rwg_functions.c:3510): if in
    // action 3/4 → action 5 (50), elapsed 0, sick counter (+0x38) = 2000.
    // The sound is played after FUN_00403403 whether or not it changed
    // anything (rwg:5452-5454).
    cure() {
        if (this.mIsSick) {
            this._setActionLen(A_CURED, 50.0);      // _DAT_004e92ac
            this.mHunger = 2000;
        }
        if (SOUNDS.SOUND_CURED) SOUNDS.SOUND_CURED.play();
    }

    // Kept for API compatibility.
    _endBrooding() {}

    // --- drawing ------------------------------------------------------------
    getImagePrefix() {
        return ['LAYER', 'BROODY', 'ROOSTER', 'MAGIC', 'HOLY'][this.mType] || 'LAYER';
    }

    // FUN_0040a166 (rwg_functions.c:12962): image by action.
    _getActionImage() {
        const p = this.getImagePrefix();
        let img = null;
        switch (this.mAction) {
            case A_DIG: img = IMAGES[`IMAGE_CHICK_IDLE1_${p}`]; break;
            case A_SICK_START: case A_CURED: img = IMAGES[`IMAGE_CHICK_SICK_START_${p}`]; break;
            case A_SICK_IDLE: img = IMAGES[`IMAGE_CHICK_SICK_IDLE_${p}`]; break;
            case A_SIT: case A_GETUP: img = IMAGES[`IMAGE_CHICK_BROOD_START_${p}`]; break;
            case A_NEST: img = IMAGES[`IMAGE_CHICK_BROOD_IDLE_${p}`]; break;
            case A_LAY: img = IMAGES[`IMAGE_CHICK_LAYER_${p}`]; break;
            case A_PECK: img = IMAGES[`IMAGE_CHICK_PECK_${p}`]; break;
            case A_WALK: img = IMAGES[`IMAGE_CHICK_WALK_${p}`]; break;
            case A_SPELL: img = IMAGES.IMAGE_CHICK_HOLY_SPELL; break;
            case A_DEATH: img = IMAGES[`IMAGE_CHICK_DEATH_${p}`]; break;
            default: img = IMAGES[`IMAGE_CHICK_IDLE0_${p}`];
        }
        return img || IMAGES[`IMAGE_CHICK_IDLE0_${p}`];
    }

    // FUN_00409d5c (asm 0x409d5c-0x409e8f) draw params for image `img`.
    _getDrawParams(img) {
        const p = { scale: 1.0, frame: -1, mirror: false, reverse: false, color: null };
        p.mirror = 0.0 < this.mFacing[0];                // +0x14 = 0 < +0x2c
        const old = this.mAge < 0x5dc;
        if (this.mStateO === S_DEAD && this.getActionProgress() > 0.5) {
            // fade out: alpha = ftol((1 - progress) * 510); colour
            // (0xb4,0xfa,0xb4) when age < 1500 else white.
            const a = Math.trunc((1 - this.getActionProgress()) * 510.0);
            p.color = old ? [0xb4, 0xfa, 0xb4, a] : [0xff, 0xff, 0xff, a];
        } else if (old) {
            p.color = [0xb4, 0xfa, 0xb4, 0xff];             // FUN_00450771
        }
        p.scale = this.mScale;                              // +0x18
        const cols = (img && img.mNumCols) || 1;
        let f = Math.trunc(this.getActionProgress() * cols); // +0x1c
        if (f >= cols) f = cols - 1;
        p.frame = f;
        p.reverse = this.mAction === A_CURED || this.mAction === A_GETUP; // +0x20
        return p;
    }

    // Base size = height of FUN_0040bf80(0) → per-type image vector of
    // type 0 (Layer), element [0] = idle0 (asm 0x40978a-0x4097a6) — the same
    // for every chick type (all idle0 images are 78 px high).
    _baseSize() {
        const img = IMAGES.IMAGE_CHICK_IDLE0_LAYER;
        return Math.trunc(((img && img.mHeight) || 0) * this.mScale + 0.5);
    }

    // Chick rect: size = ftol(idle0.height * scale + 0.5);
    //   x = sx - ftol(size*0.5 + 0.5), y = sy - ftol(size*k + 0.5), w = h = size
    // with k = 0.8 (_DAT_004e92a0) in the draw rect FUN_00409779 and
    // k = 0.7 (_DAT_004e93f8) in FUN_00409956 (used by hit tests / hints).
    _rect(k) {
        const size = this._baseSize();
        const sx = projX(this.mPos[0]);
        const sy = projY(this.mPos[1], this.mPos[2]);
        return {
            x: sx - Math.trunc(size * 0.5 + 0.5),
            y: sy - Math.trunc(size * k + 0.5),
            w: size, h: size,
        };
    }
    getDrawRect() { return this._rect(0.800000011920929); }
    getRect() { return this._rect(0.699999988079071); }

    // Sprite (render-list entry; FUN_004090ec with key = field y).
    drawSprite(g) {
        const img = this._getActionImage();
        if (!img || !img.img) return;
        const r = this.getDrawRect();
        drawWithParams(g, img, r.x, r.y, this._getDrawParams(img));
    }

    // Shadow (immediate, asm 0x40a84b-0x40a8c4) when z == 0 and state != 6:
    //   h = ftol(shadow.h*scale), w = ftol(shadow.w*scale),
    //   x = rect.x, y = rect.y + rect.h - shadow.h/2 - ftol(scale*10).
    drawShadow(g) {
        if (this.mPos[2] !== 0.0 || this.mStateO === S_DEAD) return;
        const sh = IMAGES.IMAGE_SHADOW;
        if (!sh || !sh.img) return;
        const scale = this.mScale;
        const r = this.getDrawRect();
        const h = Math.trunc(sh.mHeight * scale);
        const w = Math.trunc(sh.mWidth * scale);
        const y = r.y + r.h - Math.trunc(sh.mHeight / 2) - Math.trunc(scale * 10.0);
        g.ctx.drawImage(sh.img, (g.mTransX || 0) + r.x, (g.mTransY || 0) + y, w, h);
    }

    // Hungry icon (asm 0x40a7ca-0x40a833): IMAGE_CHICK_HUNGRY cel
    // ftol(+0x64 * numCols) at x = rect.x + (rect.w - celW)/2 + 0x14,
    // y = rect.y - image height.
    drawHungryIcon(g) {
        const img = IMAGES.IMAGE_CHICK_HUNGRY;
        if (!img || !img.img) return;
        const r = this.getDrawRect();
        const cols = img.mNumCols || 1;
        const celW = Math.trunc(img.mWidth / cols);
        const frame = Math.trunc(cols * this.mHungryAnim);
        drawWithParams(g, img, r.x + Math.trunc((r.w - celW) / 2) + 0x14,
            r.y - img.mHeight, { frame });
    }

    // Plain draw (sprite only) kept for callers outside Field.draw.
    draw(g) { this.drawSprite(g); }
}

// SimpleChick — vtable 004dc8dc, ctor FUN_0041ff68 (rwg_functions.c:39518).
export class SimpleChick extends Chick {
    constructor(type, x, y, layFlag = false) {
        super(type === undefined ? ChickType.LAYER : type, x, y, layFlag);
    }
}

// LayerChick — vtable 004dc96c, FUN_00403ec2 asm 0x403fc3-0x403fe3:
// FUN_0041ff68(type 0, layFlag 1).
export class LayerChick extends SimpleChick {
    constructor(x, y) { super(ChickType.LAYER, x, y, true); }

    canLayEggs() { return true; }

    // vt[3] FUN_00403e3c (rwg_functions.c:4550): not in action 3/4, z == 0,
    // fed (FUN_00403a3e != 0), vt[5] active and on the field.
    canBeSickTarget() {
        return !this.mIsSick && this.mPos[2] === 0.0 && this.getFoodTier() !== 0
            && this.isActive() && !this._offField();
    }

    // vt[14] FUN_0040dba2 (rwg_functions.c:16958): up to 31 tries:
    // r = mt/2147483647.0; subtract {0.35, 0.24, 0.14, 0.15, 1.0}; first index
    // with r <= 0 → chick type. Accept when the level enables that type
    // (FUN_00404a71 = LevelData chickTypeEnabled); Broody (1) additionally
    // needs world+0x274 (Field.mBroodyAllowed). After 31 tries → 0.
    getEggType(field) {
        const weights = [0.35, 0.23999999463558197, 0.14000000059604645, 0.15000000596046448, 1.0];
        const fc = fcOf(field);
        const enabled = fc && fc.mLevelConfig && fc.mLevelConfig.chickTypeEnabled;
        for (let tries = 0; tries <= 0x1e; tries++) {
            let r = mtRand() / 2147483647.0;
            let t = 0;
            for (let i = 0; i < 5; i++) {
                r -= weights[i];
                if (r <= 0) { t = i; break; }
            }
            if (enabled && !enabled[t]) continue;
            if (t !== ChickType.BROODY) return CHICK_TO_EGG[t];
            if (!field || field.mBroodyAllowed !== false) return CHICK_TO_EGG[t];
        }
        return CHICK_TO_EGG[0];
    }
}

// BroodyChick — vtable 004dc924, alloc 0x80 (FUN_00403ec2:4661-4677):
//   +0x70/+0x74 smart pointer to the target egg, +0x78 tick counter
//   (++ every update, FUN_00403de4), +0x7c tick at which it sat down.
// The egg is assigned by the world (Field._assignBroodEggs = FUN_0040412c).
export class BroodyChick extends SimpleChick {
    constructor(x, y) {
        super(ChickType.BROODY, x, y, false);
        this.mBroodingEgg = null;   // +0x74
        this.mTick = 0;             // +0x78
        this.mSitTick = 0;          // +0x7c
    }

    isBroody() { return !!this.mBroodingEgg; }
    get mBroodActive() { return this.mStateO === S_BROOD; }

    // vt[1] FUN_00403de4: +0x78++ then FUN_0040344c.
    update(field) {
        this.mTick++;
        return super.update(field);
    }

    // vt[5] FUN_00403dec: base && state != 0x14.
    isActive() { return super.isActive() && this.mStateO !== S_BROOD; }
    // vt[6] FUN_00402700: hungry || state == 0x14.
    inHurry() { return this._updateHungry() || this.mStateO === S_BROOD; }

    // FUN_004023c6 (asm 0x4023c6): drop the egg target when the egg is busy
    // (FUN_00406ab6: hatch progress >= 1.0) — JS also when it left the field.
    _validateEgg() {
        const e = this.mBroodingEgg;
        if (e && (!e.mIsAlive || e.mCollected || e.mHatchProgress >= 1.0)) {
            if (e._claimedBy === this) e._claimedBy = null;
            this.mBroodingEgg = null;
        }
    }

    // Free for a new egg (FUN_0040412c:4924-4935): not hungry, not sick,
    // fed (tier >= 1), state != 0x14 and no egg target.
    isFreeForEgg() {
        if (this._updateHungry() || this.mIsSick) return false;
        if (this.getFoodTier() < 1 || this.mStateO === S_BROOD) return false;
        this._validateEgg();
        return !this.mBroodingEgg && this.mIsAlive && !this.mIsCarried;
    }

    // vt[7] FUN_00402369
    _decide(field) {
        super._decide(field);
        this._validateEgg();
        if (this.mStateO === S_NORMAL && this.mBroodingEgg) this.mStateO = S_BROOD;
    }

    // vt[8] FUN_0040241b
    _start(field) {
        if (this.mStateO !== S_BROOD) { super._start(field); return; }
        this._validateEgg();
        const e = this.mBroodingEgg;
        if (!e) { this._endAction(); return; }
        // target = egg pos, y + 0.5 (_DAT_004e90c8); action 11 (60).
        this.mTarget = [e.mFieldX, e.mFieldY + 0.5];
        this._setActionLen(A_WALK, 60.0);
    }

    // vt[9] FUN_004024b1: on arrival sit down (action 6, 70 _DAT_004e9250);
    // the first sit starts the egg: +0x20 = 1, +0x18 =
    // ftol(_DAT_004fc3b4 * 1000.0 + 0.5).
    _onArrive(field) {
        if (this.mStateO !== S_BROOD) { this._endAction(); return; }
        this._validateEgg();
        const e = this.mBroodingEgg;
        // asm 0x402516: no egg → nothing (the walk keeps running).
        if (!e) return;
        this._setActionLen(A_SIT, 70.0);
        if (!e.mBroodStarted) {
            e.mBroodStarted = true;
            // asm 0x402551: global _DAT_004fc3b4 read at sit time.
            const slow = (field && typeof field.mHatchSlowdown === 'number')
                ? field.mHatchSlowdown : (e.mHatchSlowdown || 1.0);
            e.mBroodCountdown = Math.trunc(Math.fround(slow) * 1000.0 + 0.5);
        }
    }

    // vt[10] FUN_0040258b (rwg_functions.c:2257)
    _onActionEnd(field) {
        const e = this.mBroodingEgg;
        if (this.mAction === A_SIT) {
            this.mSitTick = this.mTick;
            this._setActionLen(A_NEST, 400.0);      // _DAT_004e939c
        } else if (this.mAction === A_NEST) {
            if (e && !(e.mHatchProgress >= 1.0) && e.mBroodCountdown !== 0) {
                this._setActionLen(A_NEST, 400.0);
            } else {
                this._setActionLen(A_GETUP, 70.0);  // _DAT_004e9250
            }
        } else if (this.mAction === A_GETUP) {
            // target cleared (asm 0x4025d3-0x4025f9)
            this.mBroodingEgg = null;
            if (e) {
                if (e._claimedBy === this) e._claimedBy = null;
                if (!(e.mHatchProgress >= 1.0)) {
                    if (e.mBroodStarted && e.mHatchProgress === 0.0) {
                        e.mHatchProgress = 0.0010000000474974513;   // _DAT_004e9234
                    }
                    // age += (+0x7c - +0x78), at least 0x5db
                    this.mAge = this.mAge + (this.mSitTick - this.mTick);
                    if (this.mAge < 0x5db) this.mAge = 0x5db;
                }
            }
        }
    }

    // FUN_00404b3b (rwg_functions.c:5653): the player cancelled this egg:
    // clear the target; sitting (action 6/7) → get up (action 8, 70), else
    // vt[7] + vt[8]. (Called by FieldController / ShopDialogs.)
    // (rwg:5690-5705: no state check before vt[7]/vt[8].)
    _endBrooding() {
        const e = this.mBroodingEgg;
        if (!e) return;
        if (this.mAction === A_GETUP) return;
        if (e._claimedBy === this) e._claimedBy = null;
        this.mBroodingEgg = null;
        if (this.mAction === A_NEST || this.mAction === A_SIT) {
            this._setActionLen(A_GETUP, 70.0);
        } else {
            this._decide(this._field);
            this._start(this._field);
        }
    }

    // Assignment by FUN_0040412c (FUN_0040271b into +0x70).
    startBrooding(egg) {
        this.mBroodingEgg = egg;
        if (egg) egg._claimedBy = this;
    }
}

// RoosterChick — vtable 004dc9b4, FUN_00403ec2 asm 0x403f60-0x403f82.
// No overrides besides the destructor.
export class RoosterChick extends SimpleChick {
    constructor(x, y) { super(ChickType.ROOSTER, x, y, false); }
}

// MagicChick — vtable 004dd62c, FUN_00403ec2 asm 0x403f29-0x403f59:
// FUN_004032ca(pos, 0) (never lays), +0x68/+0x6c = 0.
export class MagicChick extends Chick {
    constructor(x, y) { super(ChickType.MAGIC, x, y, false); }

    // vt[2] = FUN_0040e36f → 0.
    showsHungryIcon() { return false; }
    // vt[15] FUN_0040e372 → 2 (DiamondBlue).
    getCoinType() { return 2; }

    // vt[13] FUN_0040e51f (asm 0x40e51f): no egg with +0x20 clear
    // (FUN_004077fa) → FUN_004039f5; else action 11 (60) toward the egg chosen
    // (and claimed) by FUN_004071b2.
    _seekFood(field) {
        if (!field || !field.getFreeEggCount || field.getFreeEggCount() === 0) {
            this._digOrIdle();
            return;
        }
        this._setActionLen(A_WALK, 60.0);
        this.mFoodTarget = field.claimNearestEgg ? field.claimNearestEgg(this) : null;
    }

    // vt[12] FUN_0040e44d (asm 0x40e44d): egg present and not busy → re-claim
    // (FUN_004072bc), walk to the egg; on arrival action 10 (30). Otherwise
    // clear the target and end the walk.
    _walkToFood(field) {
        const e = this.mFoodTarget;
        if (!e || !e.mIsAlive || e.mCollected || e.mHatchProgress >= 1.0) {
            this.mFoodTarget = null;
            this._endAction();
            return;
        }
        // FUN_004072bc (rwg_functions.c:8888) re-claim for this chick's id.
        if (field && field.reclaimEgg) field.reclaimEgg(e, this.mId);
        if (!this._step([e.mFieldX, e.mFieldY])) {
            this._setActionLen(A_PECK, 30.0);
        }
    }

    // vt[11] FUN_0040e392 (asm 0x40e392): egg present and not busy:
    // age += egg+0x14 (4000); food += egg+0x14 * 3 / 2, capped at
    // FUN_004058af; egg removed by FUN_004077ae, which plays DAT_004feda8
    // SOUND_EAT_EGG (asm 0x4077c3). Target cleared.
    _eatEnd(field) {
        const e = this.mFoodTarget;
        if (e && e.mIsAlive && !e.mCollected && !(e.mHatchProgress >= 1.0)) {
            const cal = e.mBroodDuration;
            this.mAge += cal;
            this.mFoodCounter += Math.trunc((cal * 3) / 2);
            const cap = foodCap(this.mLevel);
            if (this.mFoodCounter >= cap) this.mFoodCounter = cap;
            if (field && field.removeEgg) field.removeEgg(e);
            else { e.mIsAlive = false; e.mCollected = true; }
            if (SOUNDS.SOUND_EAT_EGG) SOUNDS.SOUND_EAT_EGG.play();
        }
        this.mFoodTarget = null;
    }
}

// HolyChick — vtable 004dd11c, alloc 0x74, +0x70 spell cooldown = 6000
// (asm 0x403f1d).
export class HolyChick extends SimpleChick {
    constructor(x, y) {
        super(ChickType.HOLY, x, y, false);
        this.mSpellCooldown = 6000; // +0x70
    }

    // vt[1] FUN_0040d912: +0x70-- (if > 0), then FUN_0040344c.
    update(field) {
        if (this.mSpellCooldown > 0) this.mSpellCooldown--;
        return super.update(field);
    }

    // vt[8] FUN_0040d8b1 (asm 0x40d8b1): state 4, cooldown 0 and a target
    // (FUN_00420f72) → cooldown 6000, action 12 (100). Else FUN_0040386a.
    _start(field) {
        if (this.mStateO === S_NORMAL && this.mSpellCooldown === 0 && this._pickSpellTarget(field)) {
            this.mSpellCooldown = 0x1770;
            this._setActionLen(A_SPELL, 100.0);     // _DAT_004e9398
            return;
        }
        super._start(field);
    }

    // FUN_00420f72 (rwg_functions.c:40611): Magic (type 3) chicks that are
    // fed (FUN_00403a3e != 0), active (vt[5]) and on the field; stop once
    // more than 10 are collected; random one (thunk_FUN_00429891 % count).
    _pickSpellTarget(field) {
        if (!field || !field.mChickens) return null;
        const list = [];
        for (const c of field.mChickens) {
            if (c.mRemoved || c.mType !== ChickType.MAGIC) continue;
            if (c.getFoodTier() === 0 || !c.isActive() || c._offField()) continue;
            list.push(c);
            if (list.length > 10) break;
        }
        if (list.length === 0) return null;
        return list[mtRand() % list.length];
    }

    // vt[10] FUN_0040d922: action 12 → FUN_00420e2e (asm 0x420e2e):
    // target = FUN_00420f72; value = 2*FUN_00403bd6(target) if > 2000 else
    // 2000; red diamond (FUN_0040c4d9 type 3, value) at the target position;
    // kill it (FUN_0040342b, no death sound); SOUND_CHICK_TO_RED_DIAMOND
    // (DAT_004fed70); spell effect {0, target x, y, z}.
    _onActionEnd(field) {
        if (this.mAction !== A_SPELL) return;
        const target = this._pickSpellTarget(field);
        if (!target) return;
        let value = 2000;
        if (target.getSellPrice() * 2 > 2000) value = target.getSellPrice() * 2;
        const tx = target.mX, ty = target.mY;
        if (field.spawnGem && !gemsDisabled(field)) {
            field.spawnGem(3 /* DIAMOND_RED */, tx, ty - 20, ty, value);
        }
        target.die(false);
        if (SOUNDS.SOUND_CHICK_TO_RED_DIAMOND) SOUNDS.SOUND_CHICK_TO_RED_DIAMOND.play();
        // Spell effect entry pushed to the world list (Field FUN_00420e2e
        // asm 0x420eeb-0x420f41); updated by Field FUN_00420d2a.
        if (field && field.addSpellFx) field.addSpellFx(target.mPos);
    }
}

// FUN_00403ec2 (rwg_functions.c:4623) — chick factory: type 0 Layer (0x70),
// 1 Broody (0x80), 2 Rooster (0x70), 3 Magic (0x70), 4 Holy (0x74).
export function createChick(type, x, y) {
    switch (type) {
        case ChickType.LAYER:   return new LayerChick(x, y);
        case ChickType.BROODY:  return new BroodyChick(x, y);
        case ChickType.ROOSTER: return new RoosterChick(x, y);
        case ChickType.MAGIC:   return new MagicChick(x, y);
        case ChickType.HOLY:    return new HolyChick(x, y);
        default:                return null;   // other types: nothing created
    }
}
