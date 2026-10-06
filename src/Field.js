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

import { ChickType, EggType, EGG_TO_CHICK, createChick, drawWithParams, foodUnit, updateLaySpots } from './Chick.js';
import { drawFieldBackground } from './CreditsView.js';
import { CoinSilver, CoinGold, DiamondBlue, DiamondRed, Egg, GemType } from './Gem.js';
import { IMAGES, SOUNDS } from './Res.js';

// ---------------------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------------------

const f32 = Math.fround;

// _DAT_004fc3f8 is the float 2.8f = 2.799999952316284 (read from .data),
// not the double 2.8.
const PROJ_YY = f32(2.8);

// FUN_00409567 (asm 0x409567-0x4095cc). _ftol truncates toward zero.
export function fieldToScreen(fx, fy, fz) {
    const z = fz || 0;
    return {
        x: Math.trunc(fx * 6.0 + 0.5) + 10,
        y: Math.trunc(fy * PROJ_YY + z * -6.0 + 0.5) + 367,
    };
}

// FUN_00409533 (asm 0x409533-0x409566): fildl (s - origin), fdivs by the
// float matrix entries 6.0f / 2.8f, fstps (float results).
export function screenToField(sx, sy) {
    return { x: f32((sx - 10) / 6.0), y: f32((sy - 367) / PROJ_YY) };
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
// Field (x, y) of a chick or pet.
function chickXY(c) {
    if (c.mPos) return { x: c.mPos[0], y: c.mPos[1] };
    // Pets keep their field position in mPosX/mPosY (+0x08/+0x0c).
    if (typeof c.mPosX === 'number') return { x: c.mPosX, y: c.mPosY };
    return screenToField(c.mX, c.mY);
}

function isCatchable(c) {
    if (!c) return false;
    if (typeof c.isActive === 'function') return c.isActive();
    return c.mIsAlive && !c.mIsCarried;
}

// FUN_0040591e (rwg_functions.c:6846): level (**(fc+4)) < 10 -> 0.45f
// (_DAT_004e9394), < 0x28 -> 0.5f (_DAT_004dc858), else 0.55f (_DAT_004e9390).
function ravenBaseSpeed(fc) {
    const level = (fc && fc.mCurrentLevel) || 1;
    // flds of float constants (asm 0x40592d/0x405939/0x405940).
    if (level < 10) return f32(0.45);
    if (level < 0x28) return 0.5;
    return f32(0.55);
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

function drawSpell(g, fx) {
    const img = IMAGES.IMAGE_SPELL;
    if (!img || !img.img) return;
    const cols = img.mNumCols || 1;
    const half = Math.trunc(img.mHeight / 2);
    let frame = Math.trunc(fx.t * cols);
    if (frame >= cols) frame = cols - 1;
    const p = fieldToScreen(fx.pos[0], fx.pos[1], fx.pos[2]);
    drawWithParams(g, img, p.x - half, p.y - half, { frame });
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
        this.mSpeedMult = f32(speedMult);       // +0x4c (float)
        this.mFlee = false;                     // +0x50
        // Field position of the carried chick (chick +0x20..+0x28); chicks
        // without a field position (none in the port now) fall back to it.
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
        const c = chick ? chickXY(chick) : { x: 0, y: 0 };
        // fadds/fstps (asm 0x416ce5-0x416cf3): float results.
        const p = [f32(c.x + off), f32(c.y), 80.0];
        this.mSpawn = p.slice();
        this.mExit = p.slice();
        this.mLow = p.slice();
        // asm 0x416d13-0x416d24: exit.x = exit.x - (off + off), fstps.
        this.mExit[0] = f32(this.mExit[0] - (off + off));
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
        const cp = chickXY(chick);
        // FUN_00410409: first type-1 entry of the pet list fc+0x44.
        const elephant = (field.mPetList || field.mPets || []).find(p => p.mType === 1);
        if (elephant) {
            // Elephant field position +0x08/+0x0c (asm 0x41725d-0x41726c).
            const ep = chickXY(elephant);
            const d = maxNorm2(f32(ep.x - cp.x), f32(ep.y - cp.y));
            if (d < 15.0) return true;                     // _DAT_004e9288
            if (d < 24.0 && (crtRand() & 1) !== 0) return true;  // _DAT_004dc7f4
        }
        for (const r of field.mChickens) {
            if (r.mRemoved || r.mType !== ChickType.ROOSTER) continue;
            // 3D difference of the +0x20..+0x28 positions (asm 0x417321-0x417354).
            const rp = r.mPos ? r.mPos : [chickXY(r).x, chickXY(r).y, 0];
            const tp = chick.mPos ? chick.mPos : [cp.x, cp.y, 0];
            const d = maxNorm3([f32(rp[0] - tp[0]), f32(rp[1] - tp[1]), f32(rp[2] - tp[2])]);
            if (d < 10.0) return true;                     // _DAT_004dc7ec
            if (d < 15.0 && (crtRand() & 1) !== 0) return true;
            if (d < 24.0 && (crtRand() & 3) === 0) return true;
        }
        return false;
    }

    // Current field position of the target chick (chick +0x20..+0x28).
    _chickFieldPos(c) {
        if (c.mPos) return c.mPos.slice();
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
        // _DAT_004e9290 is the double 0.019999999552965164 (a widened
        // 0.02f); the differences are stored as floats (fstps -0x4) before
        // FUN_00406b08 (fabs) and the result is stored float into +0x34.
        const K = 0.019999999552965164;
        let p;
        if (state === RavenState.UP) {
            p = f32(Math.abs(f32(A[2] - z)) * K);
        } else {
            p = f32(1 - Math.abs(f32(B[2] + 15.0 - z)) * K);   // _DAT_004e9288 = 15.0
        }
        if (state === RavenState.DOWN && this.mChick && z < 15.0) {
            state = RavenState.CATCH;
            p = f32(1 - Math.abs(f32(B[2] - z)) / 15.0);
        }
        if (!(0 < p)) p = 0;
        if (p >= 1) p = 1;
        this.mState = state;
        this.mProgress = p;
    }

    // FUN_004170ab (asm 0x4170ab-0x4171b0): returns true while moving, false
    // (and snaps to target) when within reach.
    _moveTo(target) {
        // All intermediates are stored as floats (fstps) in the original.
        const base = ravenBaseSpeed(this.mField && this.mField.mFieldController);
        let speed = f32(base * this.mSpeedMult);
        let zr = f32(this.mPos[2] / 40.0);                // _DAT_004e93b8 = 40.0
        if (this.mCaught && this.mState === RavenState.UP && zr < 1) {
            // _DAT_004e93b0 = 0.3999999761581421, _DAT_004e91a8 = 0.6000000238418579
            zr = f32(zr * 0.3999999761581421 + 0.6000000238418579);
            speed = f32(zr * speed);
        }
        if (this.mHP <= 0) speed = f32(speed + speed);
        const d = [f32(target[0] - this.mPos[0]), f32(target[1] - this.mPos[1]),
            f32(target[2] - this.mPos[2])];
        const reach = (speed < base) ? base : speed;
        // _DAT_004e9260 = 1.100000023841858 (double)
        if (!(reach * 1.100000023841858 <= maxNorm3(d))) {
            this.mPos = target.slice();
            return false;
        }
        // FUN_004173ca (asm 0x4173ca-0x417428): len = float(sqrt(float(x²+y²+z²))),
        // k = float(1.0 / len), d *= k (float each).
        const len = f32(Math.sqrt(f32(d[0] * d[0] + d[1] * d[1] + d[2] * d[2])));
        const k = f32(1.0 / len);
        for (let i = 0; i < 3; i++) {
            const n = f32(d[i] * k);
            this.mPos[i] = f32(f32(n * speed) + this.mPos[i]);
        }
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
                if (c.mIsAlive && c.ravenAttack) c.ravenAttack();
                this.mChick = null;
                return false;
            }
            // chick +0x20..+0x28 = raven position
            this.mChickPos = this.mPos.slice();
            if (c.mPos) {
                c.mPos = this.mPos.slice();
            } else {
                const s = fieldToScreen(this.mPos[0], this.mPos[1], this.mPos[2]);
                c.mX = s.x;
                c.mY = s.y;
            }
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
    // Order: vt[7] + vt[8] (Chick mIsCarried = false), then pos = clamped
    // position with z kept — the chick then falls (FUN_004035c8).
    _releaseChick() {
        const c = this.mChick;
        if (!c || !c.mIsAlive || !c.mIsCarried) return;
        const p = clampField(this._chickFieldPos(c));
        c.mIsCarried = false;
        if (c.mPos) {
            c.mPos = p;
        } else {
            const s = fieldToScreen(p[0], p[1], 0);
            c.mX = s.x;
            c.mY = s.y;
        }
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
// (rwg_functions.c:34129). Seed struct (FUN_0041bdcb, asm 0x41bdcb):
//   +0x00 claim countdown, +0x04 claiming chick id, +0x08..+0x10 pos,
//   +0x14..+0x1c velocity, +0x20 calorie level (image), +0x24 calories =
//   FUN_00405899() (500 / 700, asm 0x41c0cc-0x41c0d0), +0x28 life =
//   (mt % 300)*2 + 0x4b0, +0x2c multiplier DAT_0050031c[level] =
//   {1.0, 1.3 (_DAT_004e9304), 1.6 (_DAT_004e9300)} (FUN_00405540 asm
//   0x405570-0x4055b2).
// The JS port groups one drop into a SeedCluster for drawing; every grain
// is a separate seed with the fields above, and chicks target single grains.
const SEED_MULT = [1.0, 1.2999999523162842, 1.600000023841858];

export class SeedCluster {
    // FUN_0041bfe2 (asm 0x41bfe2-0x41c0a2) for each of `count` seeds:
    //   pos = (fieldX, fieldY, 10.0 (_DAT_004dc7ec))
    //   vel = (mt*2^-31 - 0.5, mt*2^-31 - 0.5, 0)  (_DAT_004e9248, _DAT_004e90c8)
    // `calLevel` is the seed calorie upgrade level 0..2 (+0x20).
    constructor(x, y, count, calLevel, calories) {
        const f = screenToField(x, y);
        const p = clampField([f.x, f.y, 0]);
        const s = fieldToScreen(p[0], p[1], 0);
        this.mX = s.x;                // drop point (JS cluster anchor)
        this.mY = s.y;
        this.mCalLevel = calLevel;
        this.mSeeds = [];
        this.mIsAlive = true;
        const mult = SEED_MULT[calLevel] || 1.0;
        for (let i = 0; i < count; i++) {
            const g = {
                claim: 0,                   // +0x00
                claimId: 0,                 // +0x04
                pos: [f.x, f.y, 10.0],      // +0x08
                // fstps -0x10/-0xc (asm 0x41c07a, 0x41c095): float velocity.
                vel: [f32(mtRand() * 4.656612873077393e-10 - 0.5),
                      f32(mtRand() * 4.656612873077393e-10 - 0.5), 0],
                calLevel,                   // +0x20
                calories,                   // +0x24
                life: (mtRand() % 300) * 2 + 0x4b0,  // +0x28
                mult,                       // +0x2c
                x: s.x,
                y: s.y,
            };
            this._syncGrain(g);
            this.mSeeds.push(g);
        }
    }

    _syncGrain(g) {
        const s = fieldToScreen(g.pos[0], g.pos[1], g.pos[2]);
        g.x = s.x;
        g.y = s.y;
    }

    // FUN_0041be18 (rwg_functions.c:34129) per seed:
    //   if (z == 0) { if (claim > 0 && --claim == 0) id = 0; life--;
    //                 alive = life > 0 }
    //   else { vz -= 0.05 (_DAT_004e9228); pos += vel; FUN_00408149 clamp }
    update() {
        if (!this.mIsAlive) return;
        for (const g of this.mSeeds) {
            if (g.pos[2] === 0) {
                if (g.claim > 0 && --g.claim === 0) { g.claim = 0; g.claimId = 0; }
                g.life--;
            } else {
                // Float fields (+0x08..+0x1c); every result is stored float.
                g.vel[2] = f32(g.vel[2] - 0.05000000074505806);   // _DAT_004e9228 (double)
                g.pos[0] = f32(g.vel[0] + g.pos[0]);
                g.pos[1] = f32(g.vel[1] + g.pos[1]);
                g.pos[2] = f32(g.vel[2] + g.pos[2]);
                clampField(g.pos);
                this._syncGrain(g);
            }
        }
        // FUN_0041bec7: seeds whose update returned false are removed.
        this.mSeeds = this.mSeeds.filter(g => g.pos[2] !== 0 || g.life > 0);
        if (this.mSeeds.length === 0) this.mIsAlive = false;
    }

    hasFood() { return this.mIsAlive && this.mSeeds.length > 0; }

    // FUN_0040a0ed (asm 0x40a0ed-0x40a11f): image by seed +0x20 calorie
    // level: 1 -> IMAGE_SEED_CALORIES1, 2 -> IMAGE_SEED_CALORIES2, else
    // IMAGE_SEED.
    _getImage() {
        if (this.mCalLevel === 1) return IMAGES.IMAGE_SEED_CALORIES1;
        if (this.mCalLevel === 2) return IMAGES.IMAGE_SEED_CALORIES2;
        return IMAGES.IMAGE_SEED;
    }

    // FUN_0040a3d6 seed loop (rwg_functions.c:13328-13366): position =
    // projection - (image.w/2, image.h/2); grounded seeds (z == 0) are drawn
    // immediately (FUN_004665cf), airborne ones go to the depth-sorted list.
    drawGrains(g, airborne) {
        if (!this.mIsAlive) return;
        const img = this._getImage();
        if (!img || !img.img) return;
        const hw = Math.trunc((img.mWidth || 0) / 2), hh = Math.trunc((img.mHeight || 0) / 2);
        for (const s of this.mSeeds) {
            if ((s.pos[2] !== 0) !== airborne) continue;
            g.drawImage(img, s.x - hw, s.y - hh);
        }
    }

    // Airborne grains as render-list entries: key = seed field y (+0x0c).
    getAirborneDrawables() {
        const out = [];
        if (!this.mIsAlive) return out;
        const img = this._getImage();
        if (!img || !img.img) return out;
        const hw = Math.trunc((img.mWidth || 0) / 2), hh = Math.trunc((img.mHeight || 0) / 2);
        for (const s of this.mSeeds) {
            if (s.pos[2] === 0) continue;
            out.push({ key: s.pos[1], draw: (g) => g.drawImage(img, s.x - hw, s.y - hh) });
        }
        return out;
    }

    draw(g) {
        this.drawGrains(g, false);
        this.drawGrains(g, true);
    }
}

// Dog idle animation — GameView +0x88 struct {state, ?, progress, timer}
// (ctor FUN_004091f9 asm: +0x88 = 0, +0x8c = 3, +0x90 = 0, +0x94 = 0),
// updated by FUN_004091b8 (rwg_functions.c:11653, asm 0x4091b8-0x4091f8)
// from GameView::Update FUN_00409372 (asm 0x40939f) and drawn right after
// the background by FUN_0041742b(image[state], frame, 0x166, 0xe2)
// (rwg_functions.c:13318-13330). Images DAT_00500654 = {IMAGE_DOG,
// IMAGE_DOG_IDLE0, IMAGE_DOG_IDLE1} with cel width 0x6f (FUN_0041a5b6,
// rwg_functions.c:31716-31739). Durations DAT_004dcd88 = {2000, 200, 150}
// (read from .rdata).
const DOG_DURATION = [2000, 200, 150];

export class Dog {
    constructor() {
        this.mState = 0;        // +0x88
        this.mProgress = 0;     // +0x90 (float)
        this.mTimer = 0;        // +0x94
    }

    // FUN_004091b8: timer--; if timer < 1: state = (state == 0) ? rand() % 3
    // : 0; timer = DAT_004dcd88[state]. progress = 1 - timer/DAT_004dcd88[state].
    update() {
        this.mTimer--;
        if (this.mTimer < 1) {
            this.mState = (this.mState === 0) ? crtRand() % 3 : 0;
            this.mTimer = DOG_DURATION[this.mState];
        }
        this.mProgress = Math.fround(1.0 - this.mTimer / DOG_DURATION[this.mState]);
    }

    // rwg_functions.c:13318-13330: image DAT_00500654[state], cel =
    // ftol(progress * numCols) (FUN_004bed40 of +0x90, clamped by
    // FUN_0041746a's frame path), drawn at (0x166, 0xe2) = (358, 226).
    draw(g) {
        const imgs = [IMAGES.IMAGE_DOG, IMAGES.IMAGE_DOG_IDLE0, IMAGES.IMAGE_DOG_IDLE1];
        const img = imgs[this.mState];
        if (!img || !img.img) return;
        const cols = img.mNumCols || 1;
        let frame = Math.trunc(this.mProgress * cols);
        if (frame >= cols) frame = cols - 1;
        drawWithParams(g, img, 0x166, 0xe2, { frame });
    }
}

export class Field {
    // Port of Sexy::Field — vtable 004dca8c (destructor FUN_004080ea only)
    // plus the chick-list "world" object (FUN_00404022 ctor,
    // rwg_functions.c:4762) whose update is FUN_004043fd.
    // List offsets on the controller (FUN_0040a3d6): chicks +0x14, seeds
    // +0x1c, eggs +0x24, gems +0x28, pets/wolves +0x44, raven controller +0x10.
    constructor() {
        this.mChickens = [];
        this.mGems = [];                // coins, diamonds and (JS) eggs
        this.mRavens = [];
        this.mPets = [];
        this.mWolves = [];
        // Original pet list fc+0x44 holds mice, elephants and wolves in
        // insertion order (FUN_00410116 update, FUN_0040a3d6 draw). mPets /
        // mWolves are kept as views for the other files.
        this.mPetList = [];
        this._ravensDone = false;       // JS: raven tick already ran this tick
        this.mSeeds = [];
        this.mFieldController = null;
        this.mUpgradeLevel = 0;
        this.mDecorations = [];         // set by GameView (core.getUpgradeIds)
        this.mDog = new Dog();
        // World fields (FUN_00404022 asm, rwg_functions.c:4787-4797):
        this.mSoldCount = 0;            // +0x260 (++ per sold chick, rwg:5348)
        this.mSicknessEnabled = true;   // +0x264 = 1 (L1 writes 0, rwg:42997)
        this.mFastSickness = false;     // +0x26c = 0 (L31 writes 1, rwg:43326)
        this.mBroodyCap = -1;           // +0x270 = -1 (L32 writes 4)
        this.mBroodyAllowed = true;     // +0x274 = 1
        // +0x268 = ((mt % 40) + 30) * 100
        this.mSickTimer = ((mtRand() % 0x28) + 0x1e) * 100;
        this.mHatchSlowdown = 1.0;      // _DAT_004fc3b4
        this._configApplied = false;
        // Holy spell effects — world list +0x38 (entries {timer, x, y, z}
        // created by FUN_00420e2e, asm 0x420eeb-0x420f41).
        this.mSpellFx = [];
    }

    // Level flags written by the level setup FUN_00422d10 (LevelData).
    _applyLevelConfig() {
        if (this._configApplied) return;
        const fc = this.mFieldController;
        const cfg = fc && fc.mLevelConfig;
        if (!cfg) return;
        this._configApplied = true;
        if (cfg.field264 === 0) this.mSicknessEnabled = false;
        this.mFastSickness = !!cfg.fastSickness;
        if (typeof cfg.broodyEggCap === 'number') this.mBroodyCap = cfg.broodyEggCap;
        if (typeof cfg.hatchSlowdown === 'number') this.mHatchSlowdown = cfg.hatchSlowdown;
    }

    addChick(chick) {
        this.mChickens.push(chick);
    }

    // FUN_004046aa (rwg_functions.c:5257, asm 0x4046aa-0x4047ac): 48 samples
    // of a random cell (mt%16, mt%9) of the occupancy grid; the minimum is
    // tracked but NOT used — the result uses the last sampled cell:
    //   x = cx*8 + mt%8, y = cy*8 + mt%8; x clamped to [0,128] (_DAT_004e9140);
    //   y < 0 -> 0; y > 57.0 (_DAT_004e9138) -> 57.0 (_DAT_004e9130).
    pickRandomFieldPoint() {
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
        return [x, y];
    }

    // Same point in screen pixels (FUN_00409567 projection, z = 0).
    pickRandomTarget() {
        const p = this.pickRandomFieldPoint();
        return fieldToScreen(p[0], p[1], 0);
    }

    // FUN_0040c4d9 (rwg_functions.c:15132) gem factory:
    //   0 -> CoinGold, 1 -> CoinSilver, 2 -> DiamondBlue, 3 -> DiamondRed
    //   (DiamondRed +0x1c = `value`), any other type -> nothing.
    // Position = the spawning chick's position. JS callers (Chick.js) pass
    // (chick.mX, chick.mY - 20); `groundY` defaults to y + 20, i.e. the chick
    // position. The original has no toss/bounce animation.
    // The factory creates nothing when (app+0x28)+0x1c is set
    // (rwg_functions.c:15152; LevelData `noPeckCoins`, FUN_00423e5a rwg:43969).
    spawnGem(type, x, y, groundY, value) {
        const fc = this.mFieldController;
        if (fc && fc.mLevelConfig && fc.mLevelConfig.noPeckCoins) return null;
        const gy = (typeof groundY === 'number') ? groundY : y + 20;
        let g = null;
        if (type === 0) g = new CoinGold(x, gy);
        else if (type === 1) g = new CoinSilver(x, gy);
        else if (type === 2) g = new DiamondBlue(x, gy);
        else if (type === 3) g = new DiamondRed(x, gy, value || 0);
        if (g) {
            // +0x0c/+0x10 = the chick's exact field x/y (rwg_functions.c:15163).
            g.setFieldPos(this._fieldPosAt(x, gy));
            this.mGems.push(g);   // FUN_0041c449 push_back
        }
        return g;
    }

    // FUN_00407038 (rwg_functions.c:8721): egg at the laying chick's position,
    // type from chick vt[0xe]. The lay sound and the lay-spot binding
    // (asm 0x40711b-0x407196) are done by Chick.js (bindEggToLaySpot).
    spawnEgg(x, y, eggType) {
        const egg = new Egg(eggType, x, y);
        // +0x08/+0x0c = the laying chick's exact field position.
        egg.setFieldPos(this._fieldPosAt(x, y));
        egg.mHatchSlowdown = this.mHatchSlowdown;
        this.mGems.push(egg);   // FUN_00410585 push_back
        return egg;
    }

    // JS: Chick.js passes screen points (chick.mX/mY) to spawnEgg/spawnGem,
    // while the original copies the chick's float field position (+0x20/+0x24).
    // Recover it from the chick being updated (or any listed chick) whose
    // projection is exactly that screen point; otherwise invert FUN_00409533.
    _fieldPosAt(sx, sy) {
        const match = (c) => c && c.mPos && c.mX === sx && c.mY === sy;
        let c = match(this._updatingChick) ? this._updatingChick : null;
        if (!c) c = this.mChickens.find(match) || null;
        if (c) return [c.mPos[0], c.mPos[1]];
        const f = screenToField(sx, sy);
        return [f.x, f.y];
    }

    // Holy spell effect entry (FUN_00420e2e asm 0x420eeb-0x420f41):
    // {timer 0, target x, y, z}, push_back to the world list +0x38.
    addSpellFx(pos) {
        this.mSpellFx.push({ t: 0, pos: [pos[0], pos[1], pos[2] || 0] });
    }

    _eggs() {
        return this.mGems.filter(g => g.mType === GemType.EGG && g.mIsAlive && !g.mCollected);
    }

    // FUN_004077fa (rwg_functions.c:9252): eggs whose +0x20 flag is clear.
    getFreeEggCount() {
        return this._eggs().filter(e => !e.mBroodStarted).length;
    }

    // FUN_004071b2 (rwg_functions.c:8826): eggs with claim (+0x00) < 1 or
    // claimed by this chick id (+0x04 == id) are candidates; nearest by
    // Chebyshev distance (FUN_00403c97) below 1e6 (_DAT_004e9280) with +0x20
    // clear; eggs of chick type 3/4 (Magic/Holy) only when no other egg was
    // found (best distance unchanged). The chosen egg is claimed:
    // +0x00 = id ? 0x32 : 0, +0x04 = id (rwg_functions.c:8873-8877).
    // The egg claim is never counted down by the egg code.
    claimNearestEgg(chick) {
        const id = chick.mId;
        let best = null;
        let bestD = 1000000;
        for (const e of this._eggs()) {
            if (!(e.mClaim < 1 || e.mClaimId === id)) continue;
            const d = maxNorm2(f32(chick.mPos[0] - e.mFieldX), f32(chick.mPos[1] - e.mFieldY));
            if (!(d < bestD) || e.mBroodStarted) continue;
            const special = e.mEggType === EggType.BLUE || e.mEggType === EggType.RED;
            if (!special) { bestD = d; best = e; }
            else if (!best) best = e;   // bestD unchanged (rwg_functions.c:8866-8869)
        }
        if (best) {
            best.mClaim = id ? 0x32 : 0;
            best.mClaimId = id;
        }
        return best;
    }

    // FUN_004072bc (rwg_functions.c:8888): re-claim when unclaimed (+0x04 == 0)
    // or ours: +0x00 = id ? 0x32 : 0, +0x04 = id.
    reclaimEgg(e, id) {
        if (!e || (e.mClaimId !== 0 && e.mClaimId !== id)) return false;
        e.mClaim = id ? 0x32 : 0;
        e.mClaimId = id;
        return true;
    }

    // FUN_004077ae (asm 0x4077ae): remove an egg (sound played by the caller).
    // Removal goes through FUN_00406c4d (+0x1c = 1.0, unlink).
    removeEgg(egg) {
        egg.mIsAlive = false;
        egg.mCollected = true;
        egg.mHatchProgress = 1.0;
    }

    // Hatch: FUN_00406c85 (asm 0x406d39-0x406d74) removes the egg, calls
    // FUN_00404865(type, eggPos) (rwg_functions.c:5400) which creates the
    // chick at the egg position, and plays DAT_004fedb4 SOUND_EGG_BROODED.
    // Task counters below are JS bookkeeping.
    // The chick is placed at the egg's exact field position (FUN_00404865
    // receives egg +0x08 as a float pair, asm 0x406d57-0x406d60).
    // (The former JS hatch statistics counters had no source and were removed.)
    hatchEgg(egg, x, y) {
        const chickType = EGG_TO_CHICK[egg.mEggType] !== undefined
            ? EGG_TO_CHICK[egg.mEggType] : ChickType.LAYER;
        const chick = createChick(chickType, x, y);
        if (chick && chick.mPos) {
            chick.mPos[0] = egg.mFieldX;
            chick.mPos[1] = egg.mFieldY;
        }
        // The chick ctor FUN_00403ff5 -> FUN_004032ca ends with the wander
        // pick / walk start (rwg_functions.c:3481-3497) BEFORE FUN_0040528b
        // links it into the list; Chick.js defers that tail to _runCtor
        // (guarded by _ctorPending, so the first update() skips it).
        if (chick && chick._runCtor) chick._runCtor(this);
        this.addChick(chick);
        if (SOUNDS.SOUND_EGG_BROODED) SOUNDS.SOUND_EGG_BROODED.play();
        return chick;
    }

    // Seed drop — FUN_0041bfe2. `calories` is the JS seed-calorie value of
    // FieldController (30 / 50 / 80 for upgrade level 0 / 1 / 2, the same
    // mapping FieldController uses for the seed image level).
    dropSeeds(x, y, count, calories) {
        const lvl = calories >= 80 ? 2 : calories >= 50 ? 1 : 0;
        const fc = this.mFieldController;
        const unit = foodUnit((fc && fc.mCurrentLevel) || 1);
        const cluster = new SeedCluster(x, y, count, lvl, unit);
        this.mSeeds.push(cluster);
        return cluster;
    }

    // Seed list size (fc+0x1c +8).
    getSeedCount() {
        let n = 0;
        for (const c of this.mSeeds) n += c.mSeeds.length;
        return n;
    }

    // FUN_0041c11f (rwg_functions.c:34388): nearest seed (3D max-norm,
    // FUN_004050cf, below 1e6) that is unclaimed (claim < 1) or claimed by
    // `id`; it is claimed: claim = id ? 50 : 0, claimId = id.
    claimNearestSeed(pos, id) {
        let best = null;
        let bestD = 1000000;
        for (const c of this.mSeeds) {
            for (const s of c.mSeeds) {
                if (!(s.claim < 1 || s.claimId === id)) continue;
                const d = maxNorm3([f32(pos[0] - s.pos[0]), f32(pos[1] - s.pos[1]),
                    f32(pos[2] - s.pos[2])]);
                if (d < bestD) { bestD = d; best = s; }
            }
        }
        if (best) { best.claim = id ? 0x32 : 0; best.claimId = id; }
        return best;
    }

    // FUN_0041c220 (rwg_functions.c:34446): re-claim when free or ours.
    reclaimSeed(s, id) {
        if (!s || (s.claimId !== 0 && s.claimId !== id)) return false;
        s.claim = id ? 0x32 : 0;
        s.claimId = id;
        return true;
    }

    // FUN_0040123f (rwg_functions.c:313, asm 0x40123f-0x401307):
    //   target = FUN_0040178e(controller, allowRooster = 0)
    //   if found: new Raven(hp = controller+0x18, speed = controller+0x40, target),
    //             push to the raven list, play DAT_004fedb8 SOUND_KAR_KAR
    //             (app vtable +0x168), return true.
    // FieldController passes +0x18 / +0x40 from LevelData; defaults when the
    // caller does not pass them:
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
        this.mPetList.push(pet);
    }

    addWolf(wolf) {
        this.mWolves.push(wolf);
        this.mPetList.push(wolf);
    }

    getAliveChickCount() {
        return this.mChickens.filter(c => c.mIsAlive).length;
    }

    getChickCountByType(type) {
        return this.mChickens.filter(c => c.mIsAlive && c.mType === type).length;
    }

    // ------------------------------------------------------------------
    // Sickness — world +0x264/+0x268/+0x26c
    // ------------------------------------------------------------------

    // FUN_00404caf (asm 0x404caf-0x404cff): random period by list size
    // (+0x08): <=10 → [6000,9000), >10 → [4000,7000), >15 → [3000,5000),
    // >20 → [1500,3000), >40 → [1000,2000) via FUN_00403d6c(max, min) =
    // ftol(rand()/32767.0 * (max-min) + 0.5) + min; halved when +0x26c.
    _sickPeriod() {
        // List size +0x08: chicks already unlinked from the original list
        // (sold / carried off, JS mRemoved until the next sweep) not counted.
        const n = this.mChickens.filter(c => !c.mRemoved).length;
        let lo = 0x3c, hi = 0x5a;
        if (n > 10) { lo = 0x28; hi = 0x46; }
        if (n > 0xf) { lo = 0x1e; hi = 0x32; }
        if (n > 0x14) { lo = 0xf; hi = 0x1e; }
        if (n > 0x28) { lo = 10; hi = 0x14; }
        lo *= 100; hi *= 100;
        // FUN_00401148: fstps of rand()/32767.0 (float), then *(max-min)+0.5.
        let v = Math.trunc(f32(crtRand() / 32767.0) * (hi - lo) + 0.5) + lo;
        if (this.mFastSickness) v = Math.trunc(v / 2);
        return v;
    }

    // FUN_004040ec + FUN_00404d00 (asm 0x4040ec, 0x404d00): if sickness is
    // enabled (+0x264) and the chick passes vt[3]: play SOUND_SICK
    // (DAT_004fed9c); if state != 0 → state 1 + vt[8]. Returns true then.
    _makeSick(c) {
        if (!this.mSicknessEnabled || !c.canBeSickTarget()) return false;
        if (SOUNDS.SOUND_SICK) SOUNDS.SOUND_SICK.play();
        c.infect();
        return true;
    }

    // FUN_00404d6d (rwg_functions.c:5870): timer = FUN_00404caf(); the first
    // chick (list order) accepted by FUN_00404d00 becomes sick. Called by the
    // level-2 tutorial (FUN_00422228, rwg_functions.c:42152) and the flu risk.
    startSickEvent() {
        this.mSickTimer = this._sickPeriod();
        for (const c of this.mChickens) {
            if (!c.mIsAlive) continue;
            if (this._makeSick(c)) break;
        }
    }

    // ------------------------------------------------------------------
    // Brooding — FUN_0040412c (rwg_functions.c:4850)
    // ------------------------------------------------------------------
    // Broodies that are free (not hungry, not sick, fed, state != 0x14, no
    // egg) are given, in list order, the brood-requested eggs (egg list
    // +0xc; JS egg.mBrooding) whose brood progress FUN_00406ac9 <= 0
    // (_DAT_004e90b0 = 0.0) and which no broody targets yet.
    _assignBroodEggs() {
        const eggs = this._eggs().filter(e => e.mBrooding)
            .sort((a, b) => (a._broodSeq || 0) - (b._broodSeq || 0));
        if (eggs.length === 0) return;
        const free = this.mChickens.filter(c => c.mType === ChickType.BROODY
            && c.isFreeForEgg && c.isFreeForEgg());
        for (const e of eggs) {
            if (free.length === 0) break;
            if (e.mBroodProgress > 0.0) continue;
            // asm 0x4042d6-0x40432f: searched over the FUN_004049d4 list = every
            // listed chick of type 1 (no state check, dying broodies included).
            const owner = this.mChickens.find(c => !c.mRemoved && c.mType === ChickType.BROODY
                && c.mBroodingEgg === e);
            if (owner) continue;
            const b = free.shift();
            b.startBrooding(e);
        }
    }

    // FUN_00404ad0(1) + FUN_0040785f (asm 0x40440c-0x404438): broody eggs are
    // laid only while broody chicks + broody eggs < cap (+0x270, when >= 0).
    _updateBroodyAllowed() {
        if (!(this.mBroodyCap >= 0)) return;
        // FUN_00404ad0(1): every listed chick of type 1 (no state filter).
        const chicks = this.mChickens.filter(c => !c.mRemoved && c.mType === ChickType.BROODY).length;
        const eggs = this._eggs().filter(e => e.mEggType === EggType.GOLDEN).length;
        this.mBroodyAllowed = chicks + eggs < this.mBroodyCap;
    }

    // ------------------------------------------------------------------
    // Drawing — FUN_0040a3d6 (rwg_functions.c:13092)
    // ------------------------------------------------------------------
    //   1. background FUN_004248b4 (IMAGE_GAME_BACK + decorations, rwg:13310)
    //   2. dog (rwg:13318-13330)
    //   3. seeds (+0x1c): grounded drawn immediately, airborne queued
    //   4. chicks (+0x14): held chicks (state 0) go to the overlay pass
    //      (FUN_0040913d), others queued (key = field y) followed by their
    //      hungry icon (at most 5 per frame, piStack_118 < 5; other chicks
    //      get +0x64 = 0, asm 0x40a7a0-0x40a83f); shadow drawn immediately
    //      when z == 0 and state != 6
    //   5. eggs (+0x24), gems (+0x28), pets (+0x44) queued; egg/diamond
    //      shadows drawn immediately
    //   6. render list sorted by key (FUN_0041763c = std::list::sort, stable)
    //      and entries with flag +0x10 == 0 drawn (rwg:13537-13554)
    //   7. holy spell effects (+0x38, rwg:13570-13602) and ravens
    //      (rwg:13606-13627) appended with FUN_0040913d
    //   8. overlay pass: entries with flag +0x10 != 0 drawn in insertion
    //      order (rwg:13628-13657): held chicks, spells, ravens.
    // FUN_004090ec queues {image, x, y, key, flag 0}; FUN_0040913d queues
    // {image, x, y, key 0, flag 1} (rwg_functions.c:11553/11590).
    // Pet key = pet +0xc, the pet's field y (FUN_00409800 reads the pet
    // position from +0x08/+0x0c); the JS pets keep screen y (z = 0).
    draw(g) {
        drawFieldBackground(g, this.mDecorations || []);
        this.mDog.draw(g);

        for (const seed of this.mSeeds) seed.drawGrains(g, false);

        const list = [];
        for (const seed of this.mSeeds) {
            for (const d of seed.getAirborneDrawables()) list.push(d);
        }
        const overlay = [];
        let hungryShown = 0;
        for (const c of this.mChickens) {
            if (c.mRemoved) continue;
            if (c.mIsCarried) {
                overlay.push((gg) => c.drawSprite(gg));
            } else {
                const key = c.mPos[1];
                list.push({ key, draw: (gg) => c.drawSprite(gg) });
                if (hungryShown < 5 && c.showsHungryIcon(this)) {
                    hungryShown++;
                    list.push({ key, draw: (gg) => c.drawHungryIcon(gg) });
                } else {
                    c.mHungryAnim = 0;
                }
            }
            c.drawShadow(g);
        }
        const eggs = [];
        const gems = [];
        for (const gem of this.mGems) {
            if (!gem.mIsAlive) continue;
            if (gem.mType === GemType.EGG) eggs.push(gem); else gems.push(gem);
        }
        for (const e of eggs) {
            list.push({ key: e.mFieldY, draw: (gg) => e.draw(gg) });
            if (e.drawShadow) e.drawShadow(g);
        }
        for (const gm of gems) {
            list.push({ key: gm.mFieldY, draw: (gg) => gm.draw(gg) });
            if (gm.drawShadow) gm.drawShadow(g);
        }
        // Pet list fc+0x44 (mice, elephants, wolves in insertion order), key =
        // the float field y at pet +0x0c (asm 0x40ac42).
        for (const pet of this.mPetList) {
            const key = (typeof pet.mPosY === 'number') ? pet.mPosY : screenToField(0, pet.mY).y;
            list.push({ key, draw: (gg) => pet.draw(gg) });
        }
        list.sort((a, b) => a.key - b.key);
        for (const e of list) e.draw(g);

        // Spell effects (rwg:13570-13602, asm 0x40ad5e-0x40ae01): IMAGE_SPELL
        // (DAT_0050000c) at FUN_00409567(x, y, z) - height/2 on both axes,
        // cel ftol(timer * numCols) clamped to numCols-1, via FUN_0040913d.
        for (const fx of this.mSpellFx) overlay.push((gg) => drawSpell(gg, fx));
        for (const raven of this.mRavens) {
            overlay.push((gg) => raven.draw(gg));
        }
        for (const d of overlay) d(g);
    }

    // Raven list part of FUN_004015f8 (rwg_functions.c:707-730): per raven
    // flash--, FUN_00416db8, FUN_00416ed4; removed when it returns false.
    // FieldController._updateRavenController calls this at the original
    // point (after the +0x38 delay--, before the spawn rolls), so a raven
    // spawned this tick is first updated next tick. Field.update calls it
    // only as a fallback; _ravensDone prevents a second update per tick.
    updateRavens() {
        if (this._ravensDone) return;
        this._ravensDone = true;
        for (const raven of this.mRavens) raven.update();
        this.mRavens = this.mRavens.filter(r => r.mIsAlive);
    }

    // FUN_004043fd (rwg_functions.c:5052) world update + the other lists.
    // Core::Update FUN_00405fcf (rwg_functions.c:7466-7477) order:
    // raven controller FUN_004015f8 (per-raven update inside it), world
    // FUN_004043fd, seeds FUN_0041bec7, eggs FUN_00406c85, gems FUN_0040c36e,
    // ..., pets FUN_00410116.
    update() {
        this._applyLevelConfig();

        this.updateRavens();

        // +0x274 broody-egg allowance (asm 0x40440c-0x404438).
        this._updateBroodyAllowed();
        // FUN_0040412c: give brood-requested eggs to free broodies.
        this._assignBroodEggs();

        // +0x268 sick timer (rwg_functions.c:5096-5132): when it drops below
        // 0 it is reset to FUN_00404caf() and a random index among the chicks
        // passing vt[3] is chosen (rand() % count).
        let pick = -1;
        this.mSickTimer--;
        if (this.mSickTimer < 0) {
            this.mSickTimer = this._sickPeriod();
            const n = this.mChickens.filter(c => !c.mRemoved && c.canBeSickTarget()).length;
            if (n !== 0) pick = crtRand() % n;
        }
        // Chick updates; removed when vt[1] returns false. After its update a
        // chick passing vt[3] is counted; the picked one gets FUN_00404d00.
        let counter = 0;
        const keep = [];
        for (const c of this.mChickens) {
            this._updatingChick = c;
            const alive = !c.mRemoved && c.update(this);
            this._updatingChick = null;
            if (!alive) continue;
            keep.push(c);
            if (pick !== -1 && c.canBeSickTarget()) {
                if (pick === counter) {
                    this._makeSick(c);
                    pick = -1;
                } else {
                    counter++;
                }
            }
        }
        this.mChickens = keep;

        // Seed list update FUN_0041bec7 (rwg_functions.c:34202).
        for (const seed of this.mSeeds) seed.update();
        this.mSeeds = this.mSeeds.filter(s => s.mIsAlive);

        // Gem list update FUN_0040c36e (rwg_functions.c:14990) and egg
        // controller update FUN_00406c85 (rwg_functions.c:8427): eggs whose
        // hatch progress reached 1.0 hatch. FUN_00406c85 starts with the
        // lay-spot tick FUN_00407550.
        // FUN_00405fcf calls the egg list update FUN_00406c85 (rwg:7470)
        // before the gem list update FUN_0040c36e (rwg:7471); the port keeps
        // both in mGems, so they are walked in two passes.
        updateLaySpots(this);   // Chick.js FUN_00407550 (lay spots on this._laySpots)
        const gemsBefore = this.mGems.slice();
        for (const gem of gemsBefore) {
            if (gem.mType !== GemType.EGG) continue;
            gem.update();
            if (gem.mHatchNow) {
                gem.mHatchNow = false;
                gem.mIsAlive = false;
                this.hatchEgg(gem, gem.mX, gem.mY);
            }
        }
        for (const gem of gemsBefore) {
            if (gem.mType !== GemType.EGG) gem.update();
        }
        this.mGems = this.mGems.filter(g => g.mIsAlive);

        this._ravensDone = false;
        // FUN_00405fcf runs FUN_0040d281 (hint bar), FUN_0041ea9a (inflation)
        // between the gem update and the spell update, and FUN_0040686e (money
        // effects) between the spell and pet updates (rwg:7472-7476:
        // d281, ea9a, 0d2a, 686e, 0116). A caller
        // that ticks those itself sets mDeferLateUpdate and calls
        // updateSpellFx() / updatePets() at those points.
        if (this.mDeferLateUpdate) return;
        this.updateSpellFx();
        this.updatePets();
    }

    updateSpellFx() {
        // FUN_00420d2a (rwg_functions.c:40470, asm 0x420d86-0x420d96), after
        // the gem update in FUN_00405fcf (rwg:7474, after FUN_0040d281/FUN_0041ea9a): timer += 0.015
        // (_DAT_004e90f8, float); entries with timer > 1.0 removed.
        for (const fx of this.mSpellFx) fx.t = Math.fround(fx.t + 0.014999999664723873);
        this.mSpellFx = this.mSpellFx.filter(fx => !(fx.t > 1.0));
    }

    updatePets() {
        // FUN_00410116 (rwg_functions.c): one pet list (mice, elephants,
        // wolves) in insertion order; entries whose vt[1] Update returns
        // false are removed afterwards.
        const dead = [];
        for (const pet of this.mPetList) {
            if (pet.update(this) === false) dead.push(pet);
        }
        if (dead.length) {
            this.mPetList = this.mPetList.filter(p => !dead.includes(p));
            this.mPets = this.mPets.filter(p => !dead.includes(p));
        }
        this.mWolves = this.mWolves.filter(w => w.mIsAlive && !dead.includes(w));
        // Dog FUN_004091b8 is NOT part of the core tick: GameView::Update
        // FUN_00409372 calls it after the controller update (asm 0x4093ac),
        // every frame including paused ones — GameView.js ticks Field.mDog.
    }
}
