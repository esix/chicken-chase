// Port of Sexy::Pet and subclasses (Mouse, Elephant, Wolf).
// Original vtables (rwg_vtables.txt):
//   Sexy::Pet       004dca0c   Sexy::Elephant 004dca48   Sexy::Mouse 004dd7a4
//   Sexy::Wolf      004e191c
//   Sexy::Elephant::Action 004dca84, Sexy::Mouse::Action 004dd7e0,
//   Sexy::Wolf::Action 004e1958 (action-length tables)
//
// Shared vtable slot meaning (derived from the Elephant/Mouse/Wolf tables):
//   [0] dtor            [1] Update            [2] getAction (this+0x20 / +0x1c)
//   [3] hit (Pet: FUN_0040d554 = no-op, Wolf: FUN_00424f19)
//   [4] isDead (Pet: FUN_0040e36f = false)  [5] isStunned (Pet: false)
//   [6] moveTowards FUN_00410081 (Wolf FUN_00424fa0)
//   [7] isNear FUN_00410037   [8] getRadius   [9] getSpeed
//   [10] onActionEnd  [11] chooseNextAction  [12] tickAction  [13] rerandomRate
//
// The original simulates pets in FIELD units (x 0..128, y 0..72 — clamp
// constants _DAT_004e9140=128.0 / _DAT_004e9144=72.0 in FUN_00408149) and maps
// to the screen with FUN_00409567 (rwg_functions.c:11987, asm 0x409567):
//   sx = (int)(x*6.0 + 0.5) + 10,  sy = (int)(y*2.8 - 6.0*z + 0.5) + 367
// (matrix _DAT_004fc3ec=6.0, _DAT_004fc3f8=2.8, _DAT_004fc400=-6.0, offsets
// _DAT_004fc3e4=10, _DAT_004fc3e8=367, rounding _DAT_004e90c8=0.5).
// The inverse is FUN_00409533 (rwg_functions.c:11965). The JS port keeps the
// field position in mPosX/mPosY and exposes pixel mX/mY accessors so the rest
// of the port (Field y-sort, click tests, spawn code) keeps working.

import { IMAGES } from './Res.js';
import { fieldToScreen, screenToField } from './Field.js';
import { drawWithParams } from './Chick.js';

// Pet types — this+0x04 (Mouse ctor FUN_0040ebe7 sets 0, Elephant FUN_00407ebf
// sets 1, Wolf FUN_00424be6 sets 2).
export const PetType = {
    MOUSE: 0,
    ELEPHANT: 1,
    WOLF: 2,
};

// Action ids (this+0x30 for Mouse/Elephant, +0x2c for Wolf). The id also
// selects the sprite in FUN_0040a32a (rwg_functions.c:13046): 0 = idle image
// (DAT_00500664), 1 = walk image (DAT_00500584), 2 = special (DAT_005005a4).
const ACTION_IDLE = 0;
const ACTION_WALK = 1;
const ACTION_SPECIAL = 2;

// Action lengths, read from the binary (Action vtable[0] lookups):
//   Elephant FUN_00407ea4 -> DAT_004dc9fc = {160, 80, 0}
//   Mouse    FUN_0040ebcc -> DAT_004dd794 = {50, 30, 0}
//   Wolf     FUN_00424bcb -> PTR_004e190c = {0, 60, 60}
const ACTION_LENGTHS = {
    [PetType.MOUSE]: [50, 30, 0],
    [PetType.ELEPHANT]: [160, 80, 0],
    [PetType.WOLF]: [0, 60, 60],
};

// Sprite cel widths (FUN_0041a5b6, asm 0x41973b-0x419749: 0x46, 0x64, 0x87)
// are applied at load by Res.js; numCols = image.mNumCols.

// _DAT_004e9230 = -1.0f: "no target" marker.
const NO_TARGET = -1.0;
// _DAT_004e9280 = 1000000.0f: initial "best distance" in nearest searches.
const BIG_DIST = 1000000.0;

// ---------------------------------------------------------------------------
// Field <-> screen mapping
// ---------------------------------------------------------------------------
// FUN_00409567 / FUN_00409533 — the single implementation lives in Field.js
// (fieldToScreen / screenToField, asm 0x409533-0x4095cc); these wrappers only
// split the components. (Round 5: the old local screenToFieldX lacked the
// fstps float rounding of asm 0x409557.)
export function fieldToScreenX(x) { return fieldToScreen(x, 0, 0).x; }
export function fieldToScreenY(y, z = 0) { return fieldToScreen(0, y, z).y; }
export function screenToFieldX(px) { return screenToField(px, 367).x; }
export function screenToFieldY(py) { return screenToField(10, py).y; }

// ---------------------------------------------------------------------------
// Random helpers
// ---------------------------------------------------------------------------
// thunk_FUN_00429891 (rwg_functions.c:49178): Mersenne Twister, 31-bit result.
function mtRand() { return Math.floor(Math.random() * 2147483648); }
// FUN_00403207 (rwg_functions.c:3308, asm 0x403207-0x403230):
//   fildl rand; fmull _DAT_004e9248 (1/2^31); fmuls spread; fadd st,st (x2);
//   (base - spread) faddp; fstps -> float.
function randAround(base, spread) {
    const f = mtRand() * 4.656612873077393e-10 * spread;
    return Math.fround((base - spread) + (f + f));
}
// FUN_00410471 (rwg_functions.c:20113): random wander point (rand%128, rand%57)
function randomWanderPoint() { return [mtRand() % 128, mtRand() % 57]; }
// FUN_00408107 (rwg_functions.c:10260): random spawn point (rand%128, rand%72)
export function randomSpawnPoint() { return [mtRand() % 128, mtRand() % 72]; }

// FUN_00403c97 (rwg_functions.c:4316): Chebyshev length max(|dx|,|dy|)
function chebyshev(dx, dy) {
    const ax = Math.abs(dx), ay = Math.abs(dy);
    return ay < ax ? ax : ay;
}

// All pet fields are float32 and every intermediate is stored through a
// float (fstps) in the asm, so the port rounds with Math.fround at the
// same points.
const f32 = Math.fround;

// FUN_00403cdf (asm 0x403cdf-0x403d29): normalize (x, y) to length 1.0:
//   sq = (float)(x*x + y*y); s = (float)sqrt(sq); k = (float)(1.0 / s)
//   (fdivrl); x = (float)(x*k); y = (float)(k*y).
function normalize(x, y) {
    const sq = f32(x * x + y * y);
    const s = f32(Math.sqrt(sq));
    const k = f32(1.0 / s);
    return [f32(x * k), f32(k * y)];
}

// Chick vtable[5] isActive — FUN_0040327c (rwg_functions.c:3368):
//   state(+0x08) != 6 (death) && state != 0 (held) && z(+0x28) == 0;
// BroodyChick overrides it (FUN_00403dec). Chick.isActive() ports both.
function chickIsActive(c) {
    return !!c && c.isActive();
}
// Chick field position +0x20/+0x24 (read by FUN_00404fb1 and asm 0x424ed3-
// 0x424ee2) — Chick.mPos keeps the unrounded field floats.
function chickFieldPos(c) {
    return [c.mPos[0], c.mPos[1]];
}

// Gem field position (gem +0x0c/+0x10 in the original) — Gem.mFieldX/mFieldY.
function gemFieldPos(gem) {
    return [gem.mFieldX, gem.mFieldY];
}

// Original gem list (global+0x28) only holds live coins/diamonds; eggs are a
// separate list. JS Field.mGems mixes eggs (type 4) and dead gems.
function liveFieldGems(field) {
    if (!field || !field.mGems) return [];
    return field.mGems.filter(g => g.mIsAlive && !g.mCollected && g.mType !== 4);
}

export class Pet {
    // Base of Sexy::Pet (vtable 004dca0c). Field layout shared by subclasses:
    //   +0x04 type, +0x08/+0x0c pos, +0x10/+0x14 direction, +0x18 mode,
    //   action object: max / cur / rate / id.
    constructor(type, fx = 0, fy = 0) {
        this.mType = type;               // +0x04
        this.mPosX = fx;                 // +0x08 (field units)
        this.mPosY = fy;                 // +0x0c
        this.mDirX = 1.0;                // +0x10 (all ctors store 1.0)
        this.mDirY = 0.0;                // +0x14
        this.mMode = 0;                  // +0x18
        this.mActionMax = 0;             // action +4
        this.mActionCur = 0;             // action +8
        this.mActionRate = 1.0;          // action +0xc (0x3f800000 in every ctor)
        this.mActionId = ACTION_IDLE;    // action +0x10
        // Pets live in the FieldController's pet list (global+0x44) and are
        // removed when vtable[1] Update returns false (FUN_00410116,
        // asm 0x41016d-0x41017d). Field.js filters wolves by mIsAlive.
        this.mIsAlive = true;
        // The original constructors call vtable[10] and vtable[11] at the end
        // (FUN_0040ebe7 asm 0x40ec7f-0x40ec88, FUN_00407ebf asm 0x407f50-
        // 0x407f59, FUN_00424be6 asm 0x424c69-0x424c72). Subclass constructors
        // run them at once when given the field (initActions); otherwise
        // they run at the start of the first update().
        this._needsCtorActions = true;
    }

    // Pixel accessors (FUN_00409567 / FUN_00409533) so external code that
    // reads/writes mX/mY in screen space keeps working.
    get mX() { return fieldToScreenX(this.mPosX); }
    set mX(px) { this.mPosX = screenToFieldX(px); }
    get mY() { return fieldToScreenY(this.mPosY); }
    set mY(py) { this.mPosY = screenToFieldY(py); }
    // Facing: the draw flag is (dirX > 0) — FUN_00409f04 asm 0x409f1b-0x409f33.
    get mDirection() { return this.mDirX > 0 ? 1 : 0; }
    set mDirection(d) { this.mDirX = d ? 1.0 : -1.0; this.mDirY = 0.0; }

    // Action vtable[0] length lookup (FUN_00407ea4 / FUN_0040ebcc / FUN_00424bcb)
    _actionLength(id) {
        const t = ACTION_LENGTHS[this.mType];
        if (!t || id < 0 || id > 2) return 0;
        return t[id];
    }

    // FUN_0040ffe3 (rwg_functions.c:19729): start action `id`
    _startAction(id) {
        this.mActionCur = 0;
        this.mActionId = id;
        this.mActionMax = this._actionLength(id);
    }

    // FUN_00407e39 (rwg_functions.c:9865): finished = max > 0 && cur == max
    _actionFinished() {
        return this.mActionMax > 0 && this.mActionCur === this.mActionMax;
    }

    // FUN_00407e59 (rwg_functions.c:9882): cur += rate*f, clamped to max
    // (asm 0x407e6f-0x407e79: flds rate, fmuls f, fadds cur, fstps cur;
    // clamp when max <= cur, asm 0x407e7c-0x407e8c).
    _advanceAction(f) {
        if (this.mActionMax > 0 && !this._actionFinished()) {
            this.mActionCur = f32(this.mActionRate * f + this.mActionCur);
        }
        if (this.mActionCur > this.mActionMax) this.mActionCur = this.mActionMax;
    }

    // vtable[4] isDead — FUN_0040e36f returns 0 for Pet/Mouse/Elephant
    isDead() { return false; }
    // vtable[5] isStunned — FUN_0040e36f returns 0 for Pet/Mouse/Elephant
    isStunned() { return false; }
    // vtable[3] hit — FUN_0040d554 (`ret 8`, no-op) for Pet/Mouse/Elephant
    hit() {}

    // vtable[7] FUN_00410037 (rwg_functions.c:19778):
    //   chebyshev(target - pos) < getRadius() * _DAT_004e9260 (1.1)
    //   (diffs stored as float, asm 0x41003f-0x410053; 1.1 is a double)
    _isNear(tx, ty) {
        return chebyshev(f32(tx - this.mPosX), f32(ty - this.mPosY))
            < this._getRadius() * 1.100000023841858;
    }

    // vtable[6] FUN_00410081 (rwg_functions.c:19802): step toward target.
    // Returns true while still moving, false when it snapped onto the target.
    // (asm 0x410081-0x410113; every intermediate stored as float)
    _moveTowards(tx, ty) {
        const step = f32(this._getSpeed());
        let dx = f32(tx - this.mPosX);
        let dy = f32(ty - this.mPosY);
        const moving = step * 1.100000023841858 <= chebyshev(dx, dy);
        if (moving) {
            // FUN_00403cdf (rwg_functions.c:4344): normalize to length 1.0
            [dx, dy] = normalize(dx, dy);
            this.mDirX = dx;
            this.mDirY = dy;
            this.mPosX = f32(dx * step + this.mPosX);
            this.mPosY = f32(dy * step + this.mPosY);
        } else {
            this.mPosX = tx;
            this.mPosY = ty;
        }
        return moving;
    }

    // FUN_00410001 (rwg_functions.c:19751) — Pet::Update core
    _petUpdate(field) {
        if (this._actionFinished()) {
            this._onActionEnd(field);     // vtable[10]
            this._chooseNextAction(field); // vtable[11]
            this._rerandomRate();         // vtable[13]
        }
        this._tickAction(field);          // vtable[12]
        return true;
    }

    // End of the original constructors: vtable[10] then vtable[11].
    initActions(field) { this._runCtorActions(field); }

    _runCtorActions(field) {
        if (!this._needsCtorActions) return;
        this._needsCtorActions = false;
        this._onActionEnd(field);
        this._chooseNextAction(field);
    }

    update(field) {
        this._runCtorActions(field);
        return this._petUpdate(field);
    }

    // Image for the current action — FUN_0040a32a (rwg_functions.c:13046)
    _getActionImage() {
        switch (this.mType) {
            case PetType.MOUSE:
                return this.mActionId === ACTION_WALK ? IMAGES.IMAGE_PET_WALK_MOUSE
                    : this.mActionId === ACTION_SPECIAL ? null : IMAGES.IMAGE_PET_IDLE_MOUSE;
            case PetType.ELEPHANT:
                return this.mActionId === ACTION_WALK ? IMAGES.IMAGE_PET_WALK_ELEPHANT
                    : this.mActionId === ACTION_SPECIAL ? null : IMAGES.IMAGE_PET_IDLE_ELEPHANT;
            case PetType.WOLF:
                // No idle wolf image is loaded (loader skips index 2 for
                // DAT_00500664, rwg_functions.c:31556).
                return this.mActionId === ACTION_WALK ? IMAGES.IMAGE_PET_WALK_WOLF
                    : this.mActionId === ACTION_SPECIAL ? IMAGES.IMAGE_PET_SPECIAL_WOLF : null;
        }
        return null;
    }

    // FUN_00409800 (asm 0x409800): pet rect {x, y, w, h} in screen space.
    //   H = walkImg[type].height * scale, W = walkImg[type].width * scale /
    //   walkImg[0].numCols (note: always the MOUSE walk image's column count).
    //   x = sx - (int)(W*k + 0.5), k = 0.25/0.75 for the mouse (unflipped/
    //   flipped; _DAT_004e92c0 / _DAT_004e92b8) else 0.5,
    //   y = sy - (int)(H*_DAT_004e92a0(0.8) + 0.5). Also used as the wolf
    //   click rect by the field click handler (asm 0x40cea3 + FUN_0040d241).
    getRect() {
        const walkImgs = [IMAGES.IMAGE_PET_WALK_MOUSE, IMAGES.IMAGE_PET_WALK_ELEPHANT,
            IMAGES.IMAGE_PET_WALK_WOLF];
        const img = walkImgs[this.mType];
        const mouseWalk = walkImgs[0];
        if (!img || !img.mWidth || !mouseWalk || !mouseWalk.mWidth) return null;
        const scale = 1.0; // FUN_004090cd: params +0x18 = 1.0f
        // numCols (+0x10) set at load by FUN_0041a5b6 (Res.js _celCols).
        const mouseCols = mouseWalk.mNumCols || 1;
        // asm 0x409886-0x4098d4: fildl; fmuls scale; (fidivl cols); fstps.
        const H = f32(img.mHeight * scale);
        const W = f32((img.mWidth * scale) / mouseCols);
        const sx = this.mX;
        const sy = this.mY;
        const flip = this.mDirX > 0;
        let k = 0.5;
        if (this.mType === PetType.MOUSE) k = flip ? 0.75 : 0.25;
        return {
            x: sx - Math.trunc(W * k + 0.5),
            y: sy - Math.trunc(H * 0.800000011920929 + 0.5),
            w: Math.trunc(W + 0.5),
            h: Math.trunc(H + 0.5),
        };
    }

    // Pet draw — GameView::Draw pet loop (asm 0x40ab9b-0x40ac8e):
    //   rect FUN_00409800, params FUN_00409f04, image FUN_0040a32a.
    // FUN_00409f04 (asm 0x409f04): mirror when dirX > 0, frame =
    // (int)(numCols * cur/max) clamped to numCols-1, colorize (255,150,150)
    // when vtable[5] isStunned. No shadow is drawn for pets (IMAGE_SHADOW is
    // only drawn in the chick and diamond loops, rwg_functions.c:13405/13495).
    draw(g) {
        if (!this.mIsAlive) return;
        const img = this._getActionImage();
        if (!img || !img.img) return;
        const rect = this.getRect();
        if (!rect) return;
        // FUN_00409f04 asm 0x409f53-0x409f88: progress = max > 0 ? cur/max
        // : 0 (fstps float); frame = (int)(numCols * progress), clamped to
        // numCols-1 (numCols = image +0x10).
        const cols = img.mNumCols || 1;
        const progress = this.mActionMax > 0 ? f32(this.mActionCur / this.mActionMax) : 0;
        let frame = Math.trunc(cols * progress);
        if (frame >= cols) frame = cols - 1;
        // asm 0x409f1b-0x409f33: mirror flag = dirX > 0; asm 0x409f8b-
        // 0x409fb5: colorize (255,150,150) when vtable[5] isStunned.
        // Drawn at (rect.x, rect.y) (asm 0x40ac0c-0x40ac67, FUN_004090ec).
        drawWithParams(g, img, rect.x, rect.y, {
            frame,
            mirror: this.mDirX > 0,
            color: this.isStunned() ? [255, 150, 150] : undefined,
        });
    }
}

export class Mouse extends Pet {
    // Sexy::Mouse vtable 004dd7a4. Constructor FUN_0040ebe7 (rwg_functions.c:18227,
    // asm 0x40ebe7): alloc 0x50.
    constructor(fx = 0, fy = 0, field = null) {
        super(PetType.MOUSE, fx, fy);
        this.mMoveX = 0;                  // +0x34 current move destination
        this.mMoveY = 0;                  // +0x38
        this.mTargetX = NO_TARGET;        // +0x3c wander target (_DAT_004e9230)
        this.mTargetY = NO_TARGET;        // +0x40
        this.mRateTimer = 0;              // +0x44
        this.mIdleCount = 0;              // +0x48
        this.mAccel = 0;                  // +0x4c (0..1 ramp)
        // +0x1c = (rand % 1500) * 2 + 1500 (asm 0x40ec44-0x40ec5a). Nothing
        // ever decrements it, so the "timer == 0" branch of FUN_0040ede2 is
        // never taken; kept for fidelity.
        this.mWanderTimer = (mtRand() % 0x5dc) * 2 + 0x5dc;
        this.mMode = 0;                   // +0x18
        if (field) this.initActions(field);
    }

    // vtable[8] FUN_0040eddb: radius = _DAT_004e90e4 = 3.0f
    _getRadius() { return 3.0; }
    // vtable[9] FUN_0040edbd (rwg_functions.c:18440):
    //   accel * rate * _DAT_004e9118 (0.17) * _DAT_004e9110 (1.4)
    _getSpeed() {
        return Math.fround(this.mAccel * this.mActionRate * 0.17000000178813934 * 1.399999976158142);
    }

    // vtable[10] FUN_0040ed77 (rwg_functions.c:18379): mode = gem list non-empty
    _onActionEnd(field) {
        this.mMode = liveFieldGems(field).length !== 0 ? 1 : 0;
    }

    // vtable[11] FUN_0040ed90 (rwg_functions.c:18397)
    _chooseNextAction(field) {
        if (this.mMode === 0) this._wander();
        else if (this.mMode === 1) this._chase(field);
    }

    // vtable[13] FUN_0040ecf9 (rwg_functions.c:18324)
    _rerandomRate() {
        if (this.mRateTimer < 1) {
            this.mRateTimer = 1000;
            this.mActionRate = Math.fround(randAround(1.0, 0.20000000298023224)); // _DAT_004e90e0
        }
    }

    // FUN_0040eda8 (rwg_functions.c:18419): idle
    _idle() {
        this._startAction(ACTION_IDLE);
        this.mIdleCount++;
        this.mAccel = 0;
    }

    // FUN_0040f08d (rwg_functions.c:18649): set move destination; reset the
    // acceleration ramp if there was no previous destination or the new one
    // points backwards (dot product < 0).
    // asm 0x40f08d-0x40f0fc: every difference and the dot product are
    // stored as floats (fstps); reset when 0 < accel && (!(0 < moveX) ||
    // dot < 0).
    _setMoveTarget(px, py) {
        if (0 < this.mAccel) {
            let reset = !(0 < this.mMoveX);
            if (!reset) {
                const ox = f32(this.mMoveX - this.mPosX);
                const oy = f32(this.mMoveY - this.mPosY);
                const nx = f32(px - this.mPosX);
                const ny = f32(py - this.mPosY);
                reset = f32(nx * ox + oy * ny) < 0;
            }
            if (reset) this.mAccel = 0;
        }
        this.mMoveX = px;
        this.mMoveY = py;
    }

    // FUN_0040ee9e (rwg_functions.c:18519, asm 0x40ee9e): wander
    _wander() {
        if (this._isNear(this.mTargetX, this.mTargetY)) {
            this.mTargetX = NO_TARGET;
            this.mTargetY = NO_TARGET;
            this._idle();
            return;
        }
        if (this.mTargetX < 0) {
            // idleCount < 2: 50% (rand & 0x80000001) chance to pick a point;
            // idleCount >= 2: always pick.
            let pick = true;
            if (this.mIdleCount < 2) pick = (mtRand() % 2) !== 0;
            if (pick) {
                const [x, y] = randomWanderPoint();
                this.mTargetX = x;
                this.mTargetY = y;
            }
        }
        if (this.mTargetX < 0) {
            this._idle();
            return;
        }
        this.mIdleCount = 0;
        this._setMoveTarget(this.mTargetX, this.mTargetY);
        this._startAction(ACTION_WALK);
    }

    // FUN_0040ede2 (rwg_functions.c:18471, asm 0x40ede2): chase nearest gem
    _chase(field) {
        if (this.mIdleCount < 2 && this.mWanderTimer === 0) {
            this.mWanderTimer = (mtRand() % 0x5dc) * 2 + 0x5dc;
            this._idle();
            return;
        }
        // FUN_0040c7db (rwg_functions.c:15406, asm 0x40c84a-0x40c88c): nearest
        // by Chebyshev distance of the float differences (pos - gem), result
        // stored as float; initial best _DAT_004e9280 = 1e6, strict '<'.
        let best = BIG_DIST;
        let bestGem = null;
        for (const gem of liveFieldGems(field)) {
            const [gx, gy] = gemFieldPos(gem);
            const d = f32(chebyshev(f32(this.mPosX - gx), f32(this.mPosY - gy)));
            if (d < best) {
                best = d;
                bestGem = gem;
            }
        }
        if (!bestGem) {
            this._wander();
            return;
        }
        this.mIdleCount = 0;
        const [gx, gy] = gemFieldPos(bestGem);
        this._setMoveTarget(gx, gy);
        this._startAction(ACTION_WALK);
    }

    // vtable[12] FUN_0040ed26 (rwg_functions.c:18347)
    _tickAction(field) {
        this._advanceAction(this.mActionId === ACTION_WALK ? this.mAccel : 1.0);
        if (!this._actionFinished() && this.mActionId === ACTION_WALK) {
            if (!this._moveTowards(this.mMoveX, this.mMoveY)) {
                this.mActionCur = this.mActionMax;
                if (this.mMode === 1) this._collectNearbyGems(field);
            }
        }
    }

    // FUN_0040ef39 (rwg_functions.c:18579, asm 0x40ef39): collect every gem
    // whose Chebyshev distance is < 2*radius, each via FUN_0040c75b
    // (rwg_functions.c:15342) — the same pickup the player's click uses
    // (FieldController._collectGemAt): if !vt[2] isCollected: money +=
    // vt[4] value at the gem position (FUN_00406b22 -> FUN_00424b5d), the
    // type counter ++ (FUN_0041fb98, unconditionally), vt[6] sound, vt[3]
    // set collected + remove (FUN_0040c49d).
    _collectNearbyGems(field) {
        // asm 0x40ef6a-0x40ef6f: r2 = (float)(radius + radius);
        // asm 0x40efc5-0x40efe9: float differences (gem - pos), cheb < r2.
        const r2 = f32(this._getRadius() + this._getRadius());
        const picked = [];
        for (const gem of liveFieldGems(field)) {
            const [gx, gy] = gemFieldPos(gem);
            if (chebyshev(f32(gx - this.mPosX), f32(gy - this.mPosY)) < r2) picked.push(gem);
        }
        const fc = field && field.mFieldController;
        for (const gem of picked) {
            if (gem.mCollected) continue;
            const value = gem.collect();   // vt[4] value, vt[6] sound, vt[3] collected
            if (!fc) continue;
            // FUN_0040c75b calls FUN_00406b22(value) unconditionally (rwg:~14990).
            // FUN_00406b22 gets the gem field position (gem +0xc, asm 0x40c789).
            fc.addMoney(value, gem.mX, gem.mY, gem.mFieldX);
            fc._trackCollection(gem);
        }
    }

    // vtable[1] FUN_0040ec95 (rwg_functions.c:18290)
    update(field) {
        this._runCtorActions(field);
        if (this.mMode !== 0) {
            this.mTargetX = NO_TARGET;
            this.mTargetY = NO_TARGET;
        }
        if (this.mAccel < 1.0) {
            const a = Math.fround(this.mAccel + 0.05000000074505806); // _DAT_004e9228
            this.mAccel = a;
            if (1.0 < a) this.mAccel = 1.0;
        }
        if (this.mRateTimer > 0) this.mRateTimer--;
        return this._petUpdate(field);
    }
}

export class Elephant extends Pet {
    // Sexy::Elephant vtable 004dca48. Constructor FUN_00407ebf (rwg_functions.c:9951):
    // alloc 0x44. Its effect on ravens is applied by the raven controller via
    // FUN_004104b3(1) (pet of type 1 present) — FieldController's job.
    constructor(fx = 0, fy = 0, field = null) {
        super(PetType.ELEPHANT, fx, fy);
        this.mTargetX = NO_TARGET;   // +0x34 (_DAT_004e9230)
        this.mTargetY = NO_TARGET;   // +0x38
        this.mRateTimer = 0;         // +0x3c
        this.mIdleCount = 0;         // +0x40
        if (field) this.initActions(field);
    }

    // vtable[8] FUN_0040804b: radius = _DAT_004e90e0 = 0.2f
    _getRadius() { return 0.20000000298023224; }
    // vtable[9] FUN_00408030 (rwg_functions.c:10154):
    //   rate * _DAT_004e9148 (0.03) * _DAT_004e9110 (1.4)
    _getSpeed() {
        return Math.fround(this.mActionRate * 0.029999999329447746 * 1.399999976158142);
    }

    // vtable[10] FUN_00407fef: +0x18 = 0
    _onActionEnd() { this.mMode = 0; }

    // vtable[11] FUN_00407ff4: if +0x18 == 0 -> FUN_00408052
    _chooseNextAction() {
        if (this.mMode === 0) this._chooseTarget();
    }

    // FUN_00408002 (rwg_functions.c:10130): idle
    _idle() {
        this.mTargetX = NO_TARGET;
        this.mTargetY = NO_TARGET;
        this._startAction(ACTION_IDLE);
        this.mIdleCount++;
    }

    // FUN_00408052 (rwg_functions.c:10186, asm 0x408052)
    _chooseTarget() {
        if (this._isNear(this.mTargetX, this.mTargetY)) {
            this.mTargetX = NO_TARGET;
            this.mTargetY = NO_TARGET;
            this._idle();
            return;
        }
        if (this.mTargetX < 0) {
            // pick when (rand & 0x80000001) is odd, or idleCount >= 2
            if ((mtRand() % 2) !== 0 || this.mIdleCount >= 2) {
                const [x, y] = randomWanderPoint();
                this.mTargetX = x;
                this.mTargetY = y;
            }
        }
        if (this.mTargetX < 0) {
            this._idle();
        } else {
            this._startAction(ACTION_WALK);
            this.mIdleCount = 0;
        }
    }

    // vtable[13] FUN_00407f93 (rwg_functions.c:10049)
    _rerandomRate() {
        if (this.mRateTimer < 1) {
            this.mRateTimer = 1000;
            this.mActionRate = Math.fround(randAround(1.0, 0.20000000298023224)); // _DAT_004e90e0
        }
    }

    // vtable[12] FUN_00407fc0 (rwg_functions.c:10072)
    _tickAction() {
        this._advanceAction(1.0);
        if (this.mActionId === ACTION_WALK) {
            if (!this._moveTowards(this.mTargetX, this.mTargetY)) {
                this.mActionCur = this.mActionMax;
            }
        }
    }

    // vtable[1] FUN_00407f83 (rwg_functions.c:10029)
    update(field) {
        this._runCtorActions(field);
        if (this.mRateTimer > 0) this.mRateTimer--;
        return this._petUpdate(field);
    }
}

export class Wolf extends Pet {
    // Sexy::Wolf vtable 004e191c. Constructor FUN_00424be6 (rwg_functions.c:45130,
    // asm 0x424be6): alloc 0x4c. Fields:
    //   action at +0x1c (max +0x20, cur +0x24, rate +0x28, id +0x2c),
    //   +0x30/+0x34 target chick (shared ptr), +0x38 HP, +0x3c speed factor,
    //   +0x40 stun, +0x44/+0x48 knockback.
    // HP comes from the caller in EDX (factory FUN_00410299 passes the raven
    // controller's +0x10, asm 0x4015c7; FieldController passes ctl.wolfHP).
    constructor(hp, fx = 0, fy = 0, field = null) {
        super(PetType.WOLF, fx, fy);
        this.mHP = hp;                  // +0x38
        this.mSpeedFactor = 1.0;        // +0x3c
        this.mStun = 0;                 // +0x40
        this.mKnockbackX = 0;           // +0x44
        this.mKnockbackY = 0;           // +0x48
        this.mTargetChick = null;       // +0x34
        if (field) this.initActions(field);
    }

    // vtable[4] FUN_00424bb9: HP <= 0
    isDead() { return this.mHP <= 0; }
    // vtable[5] FUN_00424bc2: stun > 0
    isStunned() { return this.mStun > 0; }

    // vtable[3] FUN_00424f19 (rwg_functions.c:45439): HP -= dmg (floored at 0),
    // stun = 15, knockback += dir * _DAT_004e91a8 (0.6) * dmg.
    // dirX/dirY are the hit direction in field units.
    // asm 0x424f19-0x424f75: kx = (float)((float)(dirX*0.6) * (float)dmg),
    // ky = (float)((float)dmg * (float)(0.6*dirY)), knockback += (float).
    hit(damage, dirX, dirY) {
        this.mHP -= damage;
        if (this.mHP < 0) this.mHP = 0;
        this.mStun = 0xf;
        const k = 0.6000000238418579;   // _DAT_004e91a8 (double)
        const fd = f32(damage);
        const kx = f32(f32(dirX * k) * fd);
        const ky = f32(fd * f32(k * dirY));
        this.mKnockbackX = f32(this.mKnockbackX + kx);
        this.mKnockbackY = f32(this.mKnockbackY + ky);
    }

    // vtable[8] FUN_0040eddb: radius 3.0
    _getRadius() { return 3.0; }

    // FUN_00424d88 (asm 0x424d88): stunned (and alive) -> _DAT_004e90e0 (0.2),
    // else +0x3c.
    _speedFactor() {
        if (!this.isDead() && this.isStunned()) return 0.20000000298023224;
        return this.mSpeedFactor;
    }
    // vtable[9] FUN_00424d6d: speedFactor * _DAT_004e90e8 (0.2)
    _getSpeed() { return Math.fround(this._speedFactor() * 0.20000000298023224); }

    // vtable[6] FUN_00424fa0 (rwg_functions.c:45485): like Pet::moveTowards but
    // the knockback is added to the position while moving.
    // asm 0x424ffb-0x42504a: sx = (float)(dx*step); sx = (float)(kx + sx);
    // x = (float)(x + sx) (same for y).
    _moveTowards(tx, ty) {
        const step = f32(this._getSpeed());
        let dx = f32(tx - this.mPosX);
        let dy = f32(ty - this.mPosY);
        const moving = step * 1.100000023841858 <= chebyshev(dx, dy);
        if (moving) {
            [dx, dy] = normalize(dx, dy);
            this.mDirX = dx;
            this.mDirY = dy;
            const sx = f32(this.mKnockbackX + f32(dx * step));
            const sy = f32(this.mKnockbackY + f32(dy * step));
            this.mPosX = f32(this.mPosX + sx);
            this.mPosY = f32(sy + this.mPosY);
        } else {
            this.mPosX = tx;
            this.mPosY = ty;
        }
        return moving;
    }

    // vtable[10] FUN_00424cf5 (rwg_functions.c:45248, asm 0x424cf5):
    // dead -> mode 1; else target = FUN_00404fb1 (nearest chick), mode = 0 if
    // a target was found, 1 otherwise ("leave the field").
    _onActionEnd(field) {
        if (this.isDead()) {
            this.mMode = 1;
            return;
        }
        this.mTargetChick = this._findTarget(field);
        this.mMode = this.mTargetChick ? 0 : 1;
    }

    // FUN_00404fb1 (rwg_functions.c:6116): nearest chick with vtable[5]
    // isActive, distance FUN_004050cf = 3D Chebyshev of
    // (wolf.x - c.x, wolf.y - c.y, 0 - c.z); best starts at 1e6, strict '<'.
    _findTarget(field) {
        if (!field || !field.mChickens) return null;
        let best = BIG_DIST;
        let target = null;
        for (const c of field.mChickens) {
            if (!chickIsActive(c)) continue;
            // asm 0x40504d-0x405083: float differences (wolf - chick) and
            // (0 - z), FUN_004050cf max of the absolute values, fstps.
            const [cx, cy] = chickFieldPos(c);
            const dx = Math.abs(f32(this.mPosX - cx));
            const dy = Math.abs(f32(this.mPosY - cy));
            const dz = Math.abs(f32(0 - c.mPos[2])); // isActive implies z == 0
            const d = f32(Math.max(dx, dy, dz));
            if (d < best) {
                best = d;
                target = c;
            }
        }
        return target;
    }

    // vtable[11] FUN_00424d5f: always start walking (action 1)
    _chooseNextAction() { this._startAction(ACTION_WALK); }

    // vtable[13] FUN_0044a036: no-op
    _rerandomRate() {}

    // vtable[12] FUN_00424da9 (rwg_functions.c:45365, asm 0x424da9)
    _tickAction(field) {
        this._advanceAction(this._speedFactor());
        if (this._actionFinished()) {
            if (this.mActionId === ACTION_SPECIAL) {
                // End of the eat action: FUN_0040481d -> FUN_0040466e kills the
                // chick (FUN_0040342b sets state 6) when it is still active.
                // FUN_0040342b plays no sound (the death sample is only
                // played by FUN_0040344c:3637-3638 for age/sickness deaths).
                // FUN_0040466e also erases the chick from the list
                // (FUN_00405184) — Chick.removeFromField().
                const t = this.mTargetChick;
                if (t && chickIsActive(t)) t.removeFromField();
                this.mTargetChick = null;  // FUN_004022f8 resets the shared ptr
            }
            return;
        }
        if (this.mActionId !== ACTION_WALK) return;
        if (this.mMode === 1) {
            // Leave the field: x = (_DAT_004e9210 (64) < x) ? _DAT_004e920c (138)
            // : _DAT_004e9208 (-10), y unchanged.
            const ex = (64.0 < this.mPosX) ? 138.0 : -10.0;
            if (!this._moveTowards(ex, this.mPosY)) this.mActionCur = this.mActionMax;
            return;
        }
        const t = this.mTargetChick;
        // asm 0x424ebd-0x424ed1: ptr != null && state != 6 && vt[5] isActive
        if (!t || !t.mIsAlive || !chickIsActive(t)) {
            this.mActionCur = this.mActionMax;
            return;
        }
        const [tx, ty] = chickFieldPos(t);
        if (!this._isNear(tx, ty) && this._moveTowards(tx, ty)) return;
        this._startAction(ACTION_SPECIAL);
    }

    // vtable[1] FUN_00424cb9 (rwg_functions.c:45218): returns false when dead,
    // which makes the pet list (FUN_00410116) remove the wolf.
    update(field) {
        this._runCtorActions(field);
        this._petUpdate(field);
        if (this.mStun > 0) this.mStun--;
        if (this.isDead()) {
            this.mIsAlive = false;
            this.mTargetChick = null;
            return false;
        }
        const k = 0.9200000166893005; // _DAT_004e9268
        this.mKnockbackX = Math.fround(this.mKnockbackX * k);
        this.mKnockbackY = Math.fround(this.mKnockbackY * k);
        return true;
    }
}
