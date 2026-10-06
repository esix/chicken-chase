// Port of Sexy::Field (vtable 004dca8c) and the field-object logic that lives
// on Sexy::FieldController (vtable 004dca94) for ravens, seeds and gems.
//
// Vtables (rwg_vtables.txt:929-952): Sexy::Field has a single slot, the
// destructor FUN_004080ea (rwg_functions.c:10241); Sexy::FieldController's
// only slot is its destructor FUN_004081ae (rwg_functions.c:10322). All game
// logic below is non-virtual.
//
// Field coordinates. The original keeps every field object in field units
// (x 0..128, y 0..72, z = height) — clamp FUN_00408149 (rwg_functions.c:10260)
// with _DAT_004e9140 = 128.0 and _DAT_004e9144 = 72.0 — and projects them
// with FUN_00409567 (asm 0x409567-0x4095cc):
//   screenX = ftol(6.0*x + 0*y + 0*z + 0.5)    + 10
//   screenY = ftol(0*x + 2.8*y - 6.0*z + 0.5)  + 367
// (matrix _DAT_004fc3ec..4fc400 = 6,0,0 / 0,2.8,-6, origin _DAT_004fc3e4 = 10,
// _DAT_004fc3e8 = 367, _DAT_004e90c8 = 0.5; values read from the .data/.rdata
// of app/chicken_chase.RWG, the PE the decompilation was produced from).
// The inverse used for mouse input is FUN_00409533 (rwg_functions.c:11965):
//   x = (screenX - 10) / 6.0,  y = (screenY - 367) / 2.8.
// The JS port keeps chickens/gems/pets in screen pixels (their mX/mY), so
// ravens and seed grains below keep field coordinates internally and convert
// with these two functions.
//
// Sources for raven ("Alien" in the assets) logic — rwg_functions.c / asm:
//   FUN_0040123f (rwg_functions.c:313)   spawn one raven
//   FUN_0040178e (rwg_functions.c:798)   random target chick
//   FUN_00401720 (rwg_functions.c:759)   "chick already targeted" test
//   FUN_004015f8 (rwg_functions.c:682)   raven controller tick (per raven:
//                                        flash--, FUN_00416db8, FUN_00416ed4)
//   FUN_00416c26 (rwg_functions.c:29790) Raven ctor
//   FUN_00416cc2 (rwg_functions.c:29854) spawn/exit points
//   FUN_00416d35 (rwg_functions.c:29898) damage
//   FUN_00416db8 (rwg_functions.c:29963) animation state/progress
//   FUN_00416ed4 (rwg_functions.c:30024) movement/catch update
//   FUN_0041705b / FUN_004170ab (rwg_functions.c:30163/30193) move toward
//   FUN_004171b1 (rwg_functions.c:30257) target validity
//   FUN_00417219 (rwg_functions.c:30305) "flee" flag (elephant / roosters)
//   FUN_0040591e (rwg_functions.c:6846)  base speed by level
//   FUN_0040a120 / FUN_00409a2d / FUN_0040a072 draw image / rect / params
// Previous header notes claiming the raven update was "UNKNOWN in decompiled"
// were wrong: the raven is a plain (non-virtual) 0x54-byte struct.

import { ChickType, EggType, createChick } from './Chick.js';
import { CoinSilver, CoinGold, DiamondBlue, DiamondRed, Egg, GemType } from './Gem.js';
import { IMAGES, SOUNDS } from './Res.js';

// ---------------------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------------------

// FUN_00409567 (asm 0x409567-0x4095cc). _ftol truncates toward zero.
export function fieldToScreen(fx, fy, fz) {
    const z = fz || 0;
    return {
        x: Math.trunc(fx * 6.0 + 0.5) + 10,
        y: Math.trunc(fy * 2.8 + z * -6.0 + 0.5) + 367,
    };
}

// FUN_00409533 (rwg_functions.c:11965)
export function screenToField(sx, sy) {
    return { x: (sx - 10) / 6.0, y: (sy - 367) / 2.8 };
}

// FUN_00408149 (rwg_functions.c:10260): z <= 0 -> 0; x,y < 0 -> 0;
// x > 128 -> 128; y > 72 -> 72.
function clampField(p) {
    if (p[2] <= 0) p[2] = 0;
    if (p[0] < 0) p[0] = 0;
    if (p[1] < 0) p[1] = 0;
    if (p[0] > 128.0) p[0] = 128.0;
    if (p[1] > 72.0) p[1] = 72.0;
    return p;
}

// Original RNGs: FUN_0042b85b/FUN_00429891 = Mersenne twister masked with
// 0x7fffffff (asm 0x429891-0x42998c); FUN_004a082c = CRT rand() (0..0x7fff).
function mtRand() { return Math.floor(Math.random() * 0x80000000); }
function crtRand() { return Math.floor(Math.random() * 0x8000); }

// FUN_004050cf (rwg_functions.c:6203): max(|x|,|y|,|z|)
function maxNorm3(v) {
    return Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]));
}

// FUN_00403c97 (rwg_functions.c:4316): max(|x|,|y|)
function maxNorm2(x, y) {
    return Math.max(Math.abs(x), Math.abs(y));
}

// FUN_0040327c (rwg_functions.c:3368) chick vt[5] "can be caught":
//   state != 6 (dead) && state != 0 && z (+0x28) == 0.
// JS: dead = !mIsAlive; state 0 is the "held by raven" state the raven puts
// the chick into (FUN_00416ed4, asm 0x416fe0) = JS mIsCarried; JS chicks are
// always on the ground unless carried.
function isCatchable(c) {
    return !!c && c.mIsAlive && !c.mIsCarried;
}

// FUN_0040591e (rwg_functions.c:6846): level (**(fc+4)) < 10 -> 0.45
// (_DAT_004e9394), < 0x28 -> 0.5 (_DAT_004dc858), else 0.55 (_DAT_004e9390).
function ravenBaseSpeed(fc) {
    const level = (fc && fc.mCurrentLevel) || 1;
    if (level < 10) return 0.45;
    if (level < 0x28) return 0.5;
    return 0.55;
}

// Cached colorized raven cels (hit flash). Key: `${path}_${frame}`.
const _ravenFlashCache = new Map();

function getFlashCel(img, frame) {
    const key = `${img.mPath || 'alien'}_${frame}`;
    let c = _ravenFlashCache.get(key);
    if (c) return c;
    const celW = img.getCelWidth();
    const celH = img.mHeight;
    const off = document.createElement('canvas');
    off.width = celW;
    off.height = celH;
    const o = off.getContext('2d');
    o.drawImage(img.img, frame * celW, 0, celW, celH, 0, 0, celW, celH);
    // FUN_0040a072 (asm 0x40a0bf-0x40a0de): colorize Color(0xff,0x96,0x96)
    o.globalCompositeOperation = 'multiply';
    o.fillStyle = 'rgb(255,150,150)';
    o.fillRect(0, 0, celW, celH);
    o.globalCompositeOperation = 'destination-in';
    o.drawImage(img.img, frame * celW, 0, celW, celH, 0, 0, celW, celH);
    _ravenFlashCache.set(key, off);
    return off;
}

// Raven animation states (raven +0x00), set by FUN_00416db8 and used by
// FUN_0040a120 (asm 0x40a12c-0x40a14c) to choose the image:
//   0 -> IMAGE_ALIEN_DOWN (DAT_004fff64), 1 -> IMAGE_ALIEN_CATCH (DAT_004fff68),
//   2 -> IMAGE_ALIEN_UP (DAT_004fff6c), anything else -> IMAGE_ALIEN_DOWN.
const RavenState = {
    DOWN: 0,
    CATCH: 1,
    UP: 2,
};

export class Raven {
    // FUN_00416c26 (rwg_functions.c:29790, asm 0x416c26-0x416cbf)
    //   (this, hp, speedMult, chick): zero all fields, +0x44 = hp,
    //   +0x4c = speedMult, FUN_00416cc2(chick), pos(+0x0c) = spawn(+0x24),
    //   +0x50 = FUN_00417219(this).
    constructor(targetChick, hp, speedMult, field) {
        this.mField = field || null;
        this.mState = RavenState.DOWN;          // +0x00
        this.mChick = targetChick || null;      // +0x04/+0x08 chick handle
        this.mPos = [0, 0, 0];                  // +0x0c..+0x14
        this.mExit = [0, 0, 0];                 // +0x18..+0x20
        this.mSpawn = [0, 0, 0];                // +0x24..+0x2c
        this.mCaught = false;                   // +0x30
        this.mProgress = 0;                     // +0x34 animation progress
        this.mLow = [0, 0, 0];                  // +0x38..+0x40 lowest point reached
        this.mHP = hp | 0;                      // +0x44
        this.mFlash = 0;                        // +0x48 hit-flash ticks
        this.mSpeedMult = speedMult;            // +0x4c
        this.mFlee = false;                     // +0x50
        // Field position of the carried chick (chick +0x20..+0x28). JS chicks
        // have no z, so while carried the raven keeps it here.
        this.mChickPos = null;
        this.mIsAlive = true;                   // JS: list membership

        this._initPoints(targetChick);
        this.mPos = this.mSpawn.slice();
        this.mFlee = this._computeFlee();
        this._syncScreen();
    }

    // FUN_00416cc2 (asm 0x416cc2-0x416d32):
    //   off = (rand & 1) ? 40 (_DAT_004e9224) : -40 (_DAT_004e9220)
    //   P = (chick.x + off, chick.y, 80 (_DAT_004dc860))
    //   spawn(+0x24) = exit(+0x18) = low(+0x38) = P; exit.x -= 2*off
    _initPoints(chick) {
        const off = (mtRand() & 1) ? 40.0 : -40.0;
        const c = chick ? screenToField(chick.mX, chick.mY) : { x: 0, y: 0 };
        const p = [c.x + off, c.y, 80.0];
        this.mSpawn = p.slice();
        this.mExit = p.slice();
        this.mLow = p.slice();
        this.mExit[0] = this.mExit[0] - (off + off);
    }

    // FUN_00417219 (asm 0x417219-0x4173c8): true if an Elephant (pet type 1,
    // first found by FUN_00410409 in the pet list fc+0x44) is near the target
    // chick, or a rooster (chick type 2) is near it:
    //   elephant: d = maxNorm2(pet - chick); d < 15 -> true;
    //             d < 24 -> (rand & 1) ? true : check roosters
    //   rooster:  d = maxNorm3(rooster - chick);
    //             d < 10 -> true; d < 15 && (rand & 1) -> true;
    //             d < 24 && (rand & 3) == 0 -> true
    _computeFlee() {
        const chick = this.mChick;
        const field = this.mField;
        if (!chick || !field) return false;
        const cp = screenToField(chick.mX, chick.mY);
        const elephant = (field.mPets || []).find(p => p.mType === 1);
        if (elephant) {
            const ep = screenToField(elephant.mX, elephant.mY);
            const d = maxNorm2(ep.x - cp.x, ep.y - cp.y);
            if (d < 15.0) return true;                     // _DAT_004e9288
            if (d < 24.0 && (crtRand() & 1) !== 0) return true;  // _DAT_004dc7f4
        }
        for (const r of field.mChickens) {
            if (r.mType !== ChickType.ROOSTER) continue;
            const rp = screenToField(r.mX, r.mY);
            const d = maxNorm3([rp.x - cp.x, rp.y - cp.y, 0]);
            if (d < 10.0) return true;                     // _DAT_004dc7ec
            if (d < 15.0 && (crtRand() & 1) !== 0) return true;
            if (d < 24.0 && (crtRand() & 3) === 0) return true;
        }
        return false;
    }

    // Current field position of the target chick (chick +0x20..+0x28).
    _chickFieldPos(c) {
        if (this.mCaught && this.mChickPos) return this.mChickPos.slice();
        const p = screenToField(c.mX, c.mY);
        return [p.x, p.y, 0];
    }

    // Raven controller per-raven tick — FUN_004015f8 (rwg_functions.c:716-724):
    //   if (+0x48 > 0) +0x48--; FUN_00416db8 (anim); if (!FUN_00416ed4) remove.
    // The argument is ignored (kept for the old call signature).
    update() {
        if (!this.mIsAlive) return;
        if (this.mFlash > 0) this.mFlash--;
        this._updateAnim();
        if (!this._step()) this.mIsAlive = false;
        this._syncScreen();
    }

    // FUN_00416db8 (asm 0x416db8-0x416ed3)
    _updateAnim() {
        let A = this.mSpawn.slice();
        let B = this.mExit.slice();
        if (this.mChick) B = this._chickFieldPos(this.mChick);
        const z = this.mPos[2];
        if (z > this.mLow[2]) {
            A = this.mLow.slice();
            B = this.mExit.slice();
        }
        let state = (B[2] < z) ? RavenState.DOWN : RavenState.UP;
        let p;
        if (state === RavenState.UP) {
            p = Math.abs(A[2] - z) * 0.02;                // _DAT_004e9290
        } else {
            p = 1 - Math.abs(B[2] + 15.0 - z) * 0.02;     // _DAT_004e9288 = 15
        }
        if (state === RavenState.DOWN && this.mChick && z < 15.0) {
            state = RavenState.CATCH;
            p = 1 - Math.abs(B[2] - z) / 15.0;
        }
        if (!(0 < p)) p = 0;
        if (p >= 1) p = 1;
        this.mState = state;
        this.mProgress = p;
    }

    // FUN_004170ab (asm 0x4170ab-0x4171b0): returns true while moving, false
    // (and snaps to target) when within reach.
    _moveTo(target) {
        const base = ravenBaseSpeed(this.mField && this.mField.mFieldController);
        let speed = base * this.mSpeedMult;
        let zr = this.mPos[2] / 40.0;                     // _DAT_004e93b8
        if (this.mCaught && this.mState === RavenState.UP && zr < 1) {
            zr = zr * 0.4 + 0.6;                          // _DAT_004e93b0 / _DAT_004e91a8
            speed = zr * speed;
        }
        if (this.mHP <= 0) speed = speed + speed;
        const d = [target[0] - this.mPos[0], target[1] - this.mPos[1], target[2] - this.mPos[2]];
        const reach = (speed < base) ? base : speed;
        if (!(reach * 1.1 <= maxNorm3(d))) {              // _DAT_004e9260 = 1.1
            this.mPos = target.slice();
            return false;
        }
        // FUN_004173ca: normalise to length 1.0
        const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
        const k = 1.0 / len;
        this.mPos[0] += d[0] * k * speed;
        this.mPos[1] += d[1] * k * speed;
        this.mPos[2] += d[2] * k * speed;
        return true;
    }

    // FUN_00416ed4 (asm 0x416ed4-0x41705a)
    _step() {
        // FUN_004171b1: keep the chick only if alive (state != 6) and either
        // already caught or still catchable (vt[5]).
        let c = this.mChick;
        if (!c || !c.mIsAlive || (!this.mCaught && !isCatchable(c))) c = null;
        this.mChick = c;
        if (!c) {
            this.mChickPos = null;
            return this._moveTo(this.mExit);
        }
        if (this.mCaught) {
            if (!this._moveTo(this.mExit)) {
                // FUN_0040481d -> FUN_0040466e: chick removed from the field
                // (FUN_0040342b sets it dead). JS: Chick.ravenAttack().
                c.mIsCarried = false;
                if (c.mIsAlive && c.ravenAttack) c.ravenAttack();
                this.mChick = null;
                return false;
            }
            // chick +0x20..+0x28 = raven position
            this.mChickPos = this.mPos.slice();
            const s = fieldToScreen(this.mPos[0], this.mPos[1], this.mPos[2]);
            c.mX = s.x;
            c.mY = s.y;
        } else {
            const cp = this._chickFieldPos(c);
            // FUN_0041705b: move toward (chick.x, chick.y, 0)
            if (!this._moveTo([cp[0], cp[1], 0])) {
                this.mCaught = true;
                // chick +0x08 state = 0 (held) unless dead; JS mIsCarried.
                c.mIsCarried = true;
                this.mChickPos = this.mPos.slice();
            }
        }
        if (this.mPos[2] < this.mLow[2]) this.mLow = this.mPos.slice();
        if (this.mFlee && this.mPos[2] < 15.0 && this.mHP > 0) {
            this.mChick = null;
        }
        return true;
    }

    // FUN_0040497d (rwg_functions.c:5479): drop a held chick: restore it and
    // set its position to the clamped current position (FUN_00408149).
    // JS chicks have no height, so the chick is placed on the ground under
    // that position (the original keeps z and lets the chick fall).
    _releaseChick() {
        const c = this.mChick;
        if (!c || !c.mIsAlive || !c.mIsCarried) return;
        const p = clampField(this._chickFieldPos(c));
        const s = fieldToScreen(p[0], p[1], 0);
        c.mX = s.x;
        c.mY = s.y;
        c.mIsCarried = false;
    }

    // FUN_00416d35 (asm 0x416d35-0x416db5) damage, with the caller guard from
    // the hand update (asm 0x40d0df: only when +0x44 > 0).
    //   if (hp > 0) flash = 0xf; hp -= power;
    //   if (hp < 1) { hp = 0; if (caught && chick) FUN_0040497d(chick);
    //                 chick = null; caught = 0; }
    // Returns true when the shot applied. The caller plays SOUND_SHOOT
    // (asm 0x40d0f0) and, when hp dropped to 0, awards $50 via FUN_00424b5d
    // (asm 0x40d113).
    hit(power) {
        if (!this.mIsAlive || this.mHP <= 0) return false;
        if (this.mHP > 0) this.mFlash = 0xf;
        this.mHP -= (power || 1);
        if (this.mHP < 1) {
            this.mHP = 0;
            if (this.mCaught && this.mChick) this._releaseChick();
            this.mChick = null;
            this.mChickPos = null;
            this.mCaught = false;
        }
        return true;
    }

    // JS compatibility entry point used by FieldController/Pet/RiskController.
    // The original has no "scare" for ravens: the only way to make a raven
    // let go is the gun hit above (power 1 = gun without the power upgrade).
    scare() {
        this.hit(1);
    }

    isDead() { return this.mHP <= 0; }

    _syncScreen() {
        const s = fieldToScreen(this.mPos[0], this.mPos[1], this.mPos[2]);
        this.mX = s.x;
        this.mY = s.y;
    }

    // FUN_0040a120 (asm 0x40a12c-0x40a14c)
    getImage() {
        switch (this.mState) {
            case RavenState.CATCH: return IMAGES.IMAGE_ALIEN_CATCH;
            case RavenState.UP: return IMAGES.IMAGE_ALIEN_UP;
            default: return IMAGES.IMAGE_ALIEN_DOWN;
        }
    }

    // FUN_00409a2d (asm 0x409a2d-0x409ab1):
    //   size = ftol(image.height * 1.0 + 0.5)
    //   x = screenX - size/2, y = screenY - size + 0x14, w = h = size
    getRect() {
        const img = this.getImage();
        const size = Math.trunc(((img && img.mHeight) || 0) * 1.0 + 0.5);
        const s = fieldToScreen(this.mPos[0], this.mPos[1], this.mPos[2]);
        return { x: s.x - Math.trunc(size / 2), y: s.y - size + 0x14, w: size, h: size };
    }

    // Raven draw — FUN_0040a3d6 raven loop (rwg_functions.c:13606-13627),
    // drawn immediately (FUN_0040913d) after the depth-sorted entities:
    //   image FUN_0040a120, rect FUN_00409a2d, params FUN_0040a072:
    //     mirror = pos.x < exit.x (asm 0x40a086-0x40a09c)
    //     cel = ftol(progress * numCols), clamp numCols-1
    //     if flash (+0x48) > 0: colorize (0xff,0x96,0x96)
    draw(g) {
        if (!this.mIsAlive) return;
        const img = this.getImage();
        if (!img || !img.img) return;
        const cols = img.mNumCols || 1;
        let frame = Math.trunc(this.mProgress * cols);
        if (frame >= cols) frame = cols - 1;
        const r = this.getRect();
        const tx = (g.mTransX || 0) + r.x, ty = (g.mTransY || 0) + r.y;
        const celW = img.getCelWidth();
        const mirror = this.mPos[0] < this.mExit[0];
        const ctx = g.ctx;
        ctx.save();
        if (mirror) {
            ctx.translate(tx + r.w, ty);
            ctx.scale(-1, 1);
        } else {
            ctx.translate(tx, ty);
        }
        if (this.mFlash > 0) {
            ctx.drawImage(getFlashCel(img, frame), 0, 0, celW, img.mHeight, 0, 0, r.w, r.h);
        } else {
            ctx.drawImage(img.img, frame * celW, 0, celW, img.mHeight, 0, 0, r.w, r.h);
        }
        ctx.restore();
    }

    // Aim test of FUN_0040cc71 (rwg_functions.c:15931-15981): aim rect
    // (mouseX - size/2, mouseY - size/2, size, size) with size 8, or 0x14 when
    // the area-gun flag ((fc+0x40)+0x10) is set, overlapped (FUN_0040d241,
    // rwg_functions.c:16200) with the raven rect FUN_00409a2d.
    contains(x, y, aimSize) {
        if (!this.mIsAlive) return false;
        const size = aimSize || 8;
        const a = { x: x - (size >> 1), y: y - Math.trunc(size / 2), w: size, h: size };
        const r = this.getRect();
        return a.x < r.x + r.w && a.y < r.y + r.h && r.x < a.x + a.w && r.y < a.y + a.h;
    }
}

// Seeds. Original: each seed is its own 0x30-byte object in the seed list
// (fc+0x1c), created by FUN_0041bfe2 / FUN_0041c0a8 / FUN_0041bdcb
// (rwg_functions.c:34292/34339/34089) and updated by FUN_0041be18
// (rwg_functions.c:34129). The JS port groups one drop into a SeedCluster
// (Chick.js eats through getNearestSeeds/eatOne/hasFood); each grain below
// follows the original per-seed behavior.
export class SeedCluster {
    // FUN_0041bfe2 (asm 0x41bfe2-0x41c0a2) for each of `count` seeds:
    //   pos = (fieldX, fieldY, 10.0 (_DAT_004dc7ec))
    //   vel = (mt*2^-31 - 0.5, mt*2^-31 - 0.5, 0)  (_DAT_004e9248, _DAT_004e90c8)
    // FUN_0041bdcb: +0x28 lifetime = (rand % 300) * 2 + 0x4b0.
    // The seed count/cost (DAT_0050034c = 5/9/12 seeds, cost round(n*0.4))
    // is decided by the caller.
    constructor(x, y, count, calories) {
        const f = screenToField(x, y);
        const p = clampField([f.x, f.y, 0]);
        const s = fieldToScreen(p[0], p[1], 0);
        this.mX = s.x;                // drop point (cluster anchor for Chick.js)
        this.mY = s.y;
        this.mCount = count;
        this.mCalories = calories;    // JS food value passed to Chick.feed
        this.mSeeds = [];
        this.mConsumed = 0;
        this.mIsAlive = true;
        for (let i = 0; i < count; i++) {
            this.mSeeds.push({
                pos: [f.x, f.y, 10.0],
                vel: [mtRand() * 4.656612873077393e-10 - 0.5,
                      mtRand() * 4.656612873077393e-10 - 0.5, 0],
                life: (mtRand() % 300) * 2 + 0x4b0,
                eaten: false,
                x: s.x,
                y: s.y,
            });
        }
        for (const g of this.mSeeds) this._syncGrain(g);
    }

    _syncGrain(g) {
        const s = fieldToScreen(g.pos[0], g.pos[1], g.pos[2]);
        g.x = s.x;
        g.y = s.y;
    }

    _grainGone(g) { return g.eaten || g.life <= 0; }

    // FUN_0041be18 (rwg_functions.c:34129) per seed:
    //   if (z == 0) { claim countdown; life--; alive = life > 0 }
    //   else { vz -= 0.05 (_DAT_004e9228); pos += vel; FUN_00408149 clamp }
    update() {
        if (!this.mIsAlive) return;
        for (const g of this.mSeeds) {
            if (this._grainGone(g)) continue;
            if (g.pos[2] === 0) {
                g.life--;
            } else {
                g.vel[2] = g.vel[2] - 0.05;
                g.pos[0] = g.vel[0] + g.pos[0];
                g.pos[1] = g.vel[1] + g.pos[1];
                g.pos[2] = g.vel[2] + g.pos[2];
                clampField(g.pos);
                this._syncGrain(g);
            }
        }
        if (!this.hasFood()) this.mIsAlive = false;
    }

    // JS: a chicken eats one grain, returns calories gained
    eatOne() {
        for (const s of this.mSeeds) {
            if (!this._grainGone(s)) {
                s.eaten = true;
                this.mConsumed++;
                return this.mCalories;
            }
        }
        return 0;
    }

    hasFood() {
        if (!this.mIsAlive) return false;
        for (const s of this.mSeeds) if (!this._grainGone(s)) return true;
        return false;
    }

    // FUN_0040a0ed (asm 0x40a0ed-0x40a11f): image by seed +0x20 calorie
    // level: 1 -> IMAGE_SEED_CALORIES1, 2 -> IMAGE_SEED_CALORIES2, else
    // IMAGE_SEED. The JS port passes calories 30/50/80 (GameView seeds_1 /
    // seeds_2 upgrades) instead of the level index 0/1/2.
    _getImage() {
        const lvl = this.mCalories >= 80 ? 2 : this.mCalories >= 50 ? 1 : 0;
        if (lvl === 1) return IMAGES.IMAGE_SEED_CALORIES1;
        if (lvl === 2) return IMAGES.IMAGE_SEED_CALORIES2;
        return IMAGES.IMAGE_SEED;
    }

    // FUN_0040a3d6 seed loop (rwg_functions.c:13328-13366): position =
    // projection - (image.w/2, image.h/2); grounded seeds (z == 0) are drawn
    // immediately (FUN_004665cf), airborne ones go to the depth-sorted list.
    // drawGrains(g, airborne) draws one of the two groups.
    drawGrains(g, airborne) {
        if (!this.mIsAlive) return;
        const img = this._getImage();
        if (!img || !img.img) return;
        const hw = Math.trunc((img.mWidth || 0) / 2), hh = Math.trunc((img.mHeight || 0) / 2);
        for (const s of this.mSeeds) {
            if (this._grainGone(s)) continue;
            if ((s.pos[2] !== 0) !== airborne) continue;
            g.drawImage(img, s.x - hw, s.y - hh);
        }
    }

    // Airborne grains as render-list entries: key = seed field y (+0x0c,
    // FUN_004090ec 4th argument), expressed as its z = 0 screen y.
    getAirborneDrawables() {
        const out = [];
        if (!this.mIsAlive) return out;
        const img = this._getImage();
        if (!img || !img.img) return out;
        const hw = Math.trunc((img.mWidth || 0) / 2), hh = Math.trunc((img.mHeight || 0) / 2);
        for (const s of this.mSeeds) {
            if (this._grainGone(s) || s.pos[2] === 0) continue;
            out.push({
                mY: fieldToScreen(s.pos[0], s.pos[1], 0).y,
                draw: (g) => g.drawImage(img, s.x - hw, s.y - hh),
            });
        }
        return out;
    }

    draw(g) {
        this.drawGrains(g, false);
        this.drawGrains(g, true);
    }
}

export class Field {
    // Port of Sexy::Field — vtable 004dca8c (destructor FUN_004080ea only).
    // List offsets on the controller (FUN_0040a3d6): chicks +0x14, seeds
    // +0x1c, eggs +0x24, gems +0x28, pets/wolves +0x44, raven controller +0x10.
    constructor() {
        this.mChickens = [];
        this.mGems = [];                // coins, diamonds and (JS) eggs
        this.mRavens = [];
        this.mPets = [];
        this.mWolves = [];
        this.mSeeds = [];
        this.mFieldController = null;
        this.mUpgradeLevel = 0;
    }

    addChick(chick) {
        this.mChickens.push(chick);
    }

    // FUN_004046aa (rwg_functions.c:5257, asm 0x4046aa-0x4047ac): 48 samples
    // of a random cell (mt%16, mt%9) of the occupancy grid; the minimum is
    // tracked but NOT used — the result uses the last sampled cell:
    //   x = cx*8 + mt%8, y = cy*8 + mt%8; x clamped to [0,128] (_DAT_004e9140);
    //   y < 0 -> 0; y > 57.0 (_DAT_004e9138) -> 57.0 (_DAT_004e9130).
    // Returned in screen pixels (FUN_00409567 projection, z = 0).
    pickRandomTarget(fromX, fromY) {
        let cx = 0, cy = 0;
        for (let i = 0; i < 0x30; i++) {
            cx = mtRand() % 16;
            cy = mtRand() % 9;
        }
        let x = (mtRand() % 8) + cx * 8;
        let y = (mtRand() % 8) + cy * 8;
        if (x < 0) x = 0;
        if (y < 0) y = 0;
        if (128.0 < x) x = 128.0;
        if (y > 57.0) y = 57.0;
        return fieldToScreen(x, y, 0);
    }

    // FUN_0040c4d9 (rwg_functions.c:15132) gem factory:
    //   0 -> CoinGold, 1 -> CoinSilver, 2 -> DiamondBlue, 3 -> DiamondRed
    //   (DiamondRed +0x1c = `value`), any other type -> nothing.
    // Position = the spawning chick's position. JS callers (Chick.js) pass
    // (chick.mX, chick.mY - 20); `groundY` defaults to y + 20, i.e. the chick
    // position. The original has no toss/bounce animation.
    // UNKNOWN — not found in decompiled: meaning of the guard byte
    // *(field + 0x1c) that skips spawning (rwg_functions.c:15152); not ported.
    spawnGem(type, x, y, groundY, value) {
        const gy = (typeof groundY === 'number') ? groundY : y + 20;
        let g = null;
        if (type === 0) g = new CoinGold(x, gy);
        else if (type === 1) g = new CoinSilver(x, gy);
        else if (type === 2) g = new DiamondBlue(x, gy);
        else if (type === 3) g = new DiamondRed(x, gy, value || 0);
        if (g) this.mGems.push(g);   // FUN_0041c449 push_back
        return g;
    }

    // FUN_00407038 (rwg_functions.c:8721): egg at the laying chick's position
    // (+0x08/+0x0c = chick pos), type from chick vt[0xe]. The lay sound
    // (DAT_00500624 random SOUND_EGG_LAYERED1/2) is played by Chick.js.
    spawnEgg(x, y, eggType) {
        const egg = new Egg(eggType, x, y);
        this.mGems.push(egg);
        return egg;
    }

    // Hatch: FUN_00406c85 (rwg_functions.c:8434) removes the egg and calls
    // FUN_00404865(type, eggPos) (rwg_functions.c:5400) which creates the chick
    // at the egg position (random position via FUN_00408107 only when x < 0).
    // The hatch sound (DAT_004fedb4 SOUND_EGG_BROODED, asm 0x406d6a) is
    // played by Chick.js. Task counters below are JS bookkeeping.
    hatchEgg(egg, x, y) {
        let chickType;
        switch (egg.mEggType) {
            case EggType.WHITE: chickType = ChickType.LAYER; break;
            case EggType.BLUE: chickType = ChickType.MAGIC; break;
            case EggType.RED: chickType = ChickType.HOLY; break;
            case EggType.BLACK: chickType = ChickType.ROOSTER; break;
            case EggType.GOLDEN: chickType = ChickType.BROODY; break;
            default: chickType = ChickType.LAYER;
        }
        const chick = createChick(chickType, x, y);
        this.addChick(chick);
        const fc = this.mFieldController;
        if (fc) {
            fc.mTotalRaisedChicks++;
            if (chickType === ChickType.MAGIC) fc.mHatchedMagic++;
            else if (chickType === ChickType.HOLY) fc.mHatchedHoly++;
            else if (chickType === ChickType.ROOSTER) {
                fc.mHatchedRooster = (fc.mHatchedRooster || 0) + 1;
            }
        }
        return chick;
    }

    // Seed drop — FUN_0041bfe2 (see SeedCluster).
    dropSeeds(x, y, count, calories) {
        const cluster = new SeedCluster(x, y, count, calories);
        cluster.mFieldController = this.mFieldController;
        this.mSeeds.push(cluster);
        return cluster;
    }

    // JS helper for Chick.js: nearest seed cluster with food remaining.
    getNearestSeeds(x, y) {
        let best = null;
        let bestDist = Infinity;
        for (const s of this.mSeeds) {
            if (!s.hasFood()) continue;
            const dx = s.mX - x;
            const dy = s.mY - y;
            const dist = dx * dx + dy * dy;
            if (dist < bestDist) {
                bestDist = dist;
                best = s;
            }
        }
        return best;
    }

    // FUN_0040123f (rwg_functions.c:313, asm 0x40123f-0x401307):
    //   target = FUN_0040178e(controller, allowRooster = 0)
    //   if found: new Raven(hp = controller+0x18, speed = controller+0x40, target),
    //             push to the raven list, play DAT_004fedb8 SOUND_KAR_KAR
    //             (app vtable +0x168), return true.
    // Defaults when the caller does not pass them:
    //   hp    — FUN_00422c01 (asm 0x422c73-0x422cf5): 1, or 2 when level > 0x28
    //   speed — FUN_00401202 (rwg_functions.c:301): +0x40 = 1.0
    spawnRaven(hp, speedMult) {
        const target = this._pickRavenTarget(false);
        if (!target) return false;
        const fc = this.mFieldController;
        const level = (fc && fc.mCurrentLevel) || 1;
        const h = (typeof hp === 'number') ? hp : (level > 0x28 ? 2 : 1);
        const sp = (typeof speedMult === 'number') ? speedMult : 1.0;
        const raven = new Raven(target, h, sp, this);
        this.mRavens.push(raven);
        if (SOUNDS.SOUND_KAR_KAR) SOUNDS.SOUND_KAR_KAR.play();
        return true;
    }

    // FUN_0040178e (asm 0x40178e-0x4018ec): candidates = chicks with
    // vt[5] FUN_0040327c true, (allowRooster || type != 2) and not already a
    // raven target (FUN_00401720); pick candidates[mt % count].
    _pickRavenTarget(allowRooster) {
        const candidates = this.mChickens.filter(c =>
            isCatchable(c)
            && (allowRooster || c.mType !== ChickType.ROOSTER)
            && !this.mRavens.some(r => r.mIsAlive && r.mChick === c));
        if (candidates.length === 0) return null;
        return candidates[mtRand() % candidates.length];
    }

    addPet(pet) {
        this.mPets.push(pet);
    }

    addWolf(wolf) {
        this.mWolves.push(wolf);
    }

    getAliveChickCount() {
        return this.mChickens.filter(c => c.mIsAlive).length;
    }

    getChickCountByType(type) {
        return this.mChickens.filter(c => c.mIsAlive && c.mType === type).length;
    }

    // Field rendering — FUN_0040a3d6 (rwg_functions.c:13092):
    //   1. background FUN_004248b4 (IMAGE_GAME_BACK) and decorations
    //   2. seeds (+0x1c): grounded drawn immediately, airborne queued
    //   3. chicks (+0x14), eggs (+0x24), gems (+0x28), pets (+0x44) queued in
    //      the render list with key = field y; egg/diamond shadows are drawn
    //      immediately while queuing
    //   4. render list sorted by key (FUN_0041763c = std::list::sort, stable)
    //      and drawn
    //   5. ravens (raven controller list) drawn immediately on top
    // Field y is monotonic with screen y at z = 0, so sorting on mY matches.
    // UNKNOWN — not found in decompiled: depth key used for pets/wolves in the
    // port (their struct offset +0xc is read at asm 0x40ac0b; JS uses mY).
    draw(g) {
        const bg = IMAGES.IMAGE_GAME_BACK;
        if (bg) g.drawImage(bg, 0, 0);

        for (const seed of this.mSeeds) seed.drawGrains(g, false);

        const eggs = [];
        const gems = [];
        for (const gem of this.mGems) {
            if (!gem.mIsAlive) continue;
            if (gem.mType === GemType.EGG) eggs.push(gem); else gems.push(gem);
        }
        for (const e of eggs) if (e.drawShadow) e.drawShadow(g);
        for (const gm of gems) if (gm.drawShadow) gm.drawShadow(g);

        // Insertion order of the render list: chicks, eggs, gems, pets.
        const ground = [];
        for (const seed of this.mSeeds) {
            for (const d of seed.getAirborneDrawables()) ground.push(d);
        }
        for (const chick of this.mChickens) ground.push(chick);
        for (const e of eggs) ground.push(e);
        for (const gm of gems) ground.push(gm);
        for (const pet of this.mPets) ground.push(pet);
        for (const wolf of this.mWolves) ground.push(wolf);
        ground.sort((a, b) => a.mY - b.mY);
        for (const e of ground) {
            if (e.draw) e.draw(g);
        }

        for (const raven of this.mRavens) {
            raven.draw(g);
        }
    }

    update() {
        for (const c of this.mChickens) {
            c.update(this);
        }

        // Seed list update FUN_0041bec7 (rwg_functions.c:34202): FUN_0041be18
        // per seed, dead seeds removed.
        for (const seed of this.mSeeds) {
            seed.update();
        }
        this.mSeeds = this.mSeeds.filter(s => s.mIsAlive);

        // Gem list update FUN_0040c36e (rwg_functions.c:14990): vt[1] Update
        // per gem; gems returning false are removed.
        for (const gem of this.mGems) {
            gem.update();
        }
        this.mGems = this.mGems.filter(g => g.mIsAlive);

        // JS: drop dead chickens after their death animation.
        this.mChickens = this.mChickens.filter(c => c.mIsAlive || c.mDeathTimer < 90);

        // Raven list part of FUN_004015f8 (rwg_functions.c:707-730).
        for (const raven of this.mRavens) {
            raven.update();
        }
        this.mRavens = this.mRavens.filter(r => r.mIsAlive);

        for (const pet of this.mPets) {
            pet.update(this);
        }

        for (const wolf of this.mWolves) {
            wolf.update(this);
        }
        this.mWolves = this.mWolves.filter(w => w.mIsAlive);
    }
}
