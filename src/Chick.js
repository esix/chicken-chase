// Port of Sexy::Chick and subclasses
// Original vtables (rwg_vtables.txt):
//   Chick 004dc894, SimpleChick 004dc8dc, BroodyChick 004dc924,
//   LayerChick 004dc96c, RoosterChick 004dc9b4,
//   MagicChick 004dd62c, HolyChick 004dd11c
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
// Original action ids (+0x0c) and nominal durations (PTR_004d01f0 table,
// read from the binary: [0,150,120,50,100,50,70,400,70,100,30,60,100,200]):
//   1 idle(150)  2 dig(120)  3 sick-start(50)  4 sick-idle(100)
//   5 cured(50)  6/7/8 broody sit/on-nest/get-up (70/400/70)
//   9 lay egg(100)  10 peck/eat(30)  11 walk(60)  12 holy spell(100)
//   13 death(200)
// Action → image (FUN_0040a166:12962 + loader loop rwg_functions.c:31025-31157,
// load order matches app/properties/resources.xml):
//   default → IDLE0, 2 → IDLE1 (dig.jpg), 3/5 → SICK_START (LAYER only),
//   4 → SICK_IDLE (LAYER only), 9 → LAYER_LAYER, 10 → PECK, 11 → WALK,
//   12 → CHICK_HOLY_SPELL, 13 → DEATH.
//
// Float constants read from app/chicken_chase.RWG .rdata (the PE the
// decompilation was produced from): _DAT_004e9398=100.0, _DAT_004e92ac=50.0,
// _DAT_004e9240=120.0, _DAT_004e9360=60.0, _DAT_004e9410=30.0,
// _DAT_004e9244=200.0, _DAT_004e9150=0.01 (double), _DAT_004e9408=0.999
// (double), _DAT_004e9388=0.35 (double), _DAT_004e9380=0.24, _DAT_004e9378=0.14,
// _DAT_004e9370=0.15, _DAT_004e9368=2147483647.0, _DAT_004dc7e0=1.0.

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

// Chick states. NOTE: original keeps state (+0x08) and action (+0x0c)
// separately; the JS port folds them into one mState value.
export const ChickState = {
    NEWBORN: 0,    // state +0x08 = 0 (held by hand / not active)
    ADULT: 4,      // state +0x08 = 4 (FUN_004032ca:3480)
    DEATH: 6,      // state +0x08 = 6 (FUN_0040342b:3541)
    BROODING: 0x14, // state +0x08 = 0x14 (FUN_00402369:2127)
    // JS action states (map to original action ids, see header):
    IDLE: 0x100,       // action 1
    WALK: 0x101,       // action 11
    PECK: 0x102,       // action 10
    SICK_START: 0x103, // action 3/5
    SICK_IDLE: 0x104,  // action 4
    LAYING: 0x105,     // action 9
    DIG: 0x106,        // action 2
    BROOD_IDLE: 0x107, // action 7
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
    GOLDEN: 4,    // broody eggs
};

const CHICK_TO_EGG = [EggType.WHITE, EggType.GOLDEN, EggType.BLACK, EggType.BLUE, EggType.RED];

// Action durations from PTR_004d01f0 (see header).
const DUR_IDLE = 150;   // action 1
const DUR_DIG = 120;    // action 2 (_DAT_004e9240 = 120.0, FUN_004039f5:4031)
const DUR_LAY = 100;    // action 9 (_DAT_004e9398 = 100.0, FUN_00403602:3711)
const DUR_PECK = 30;    // action 10 (_DAT_004e9410 = 30.0, FUN_00420069:39654)
const DUR_SPELL = 100;  // action 12 (_DAT_004e9398 = 100.0, FUN_0040d8b1:16775)

function levelOf(field) {
    return (field && field.mFieldController) ? field.mFieldController.mCurrentLevel : 1;
}

export class Chick {
    // Port of Sexy::Chick - vtable at 004dc894
    // Constructor: FUN_004032ca (rwg_functions.c:3426)
    constructor(type, x, y) {
        // Layout: +0=vtable, +4=type, +8=state, +0xC=action, +0x10=actionDur,
        // +0x14=actionElapsed, +0x18=speed mult, +0x1C=age, +0x20=posX, +0x24=posY,
        // +0x28=height(z), +0x34=food, +0x38=hunger, +0x3c=id, +0x40=layCooldown,
        // +0x44=sick flag, +0x48=digCooldown, +0x4c=speed reroll timer,
        // +0x54/+0x58=walk target, +0x5c/+0x60=wander target, +0x64=hungry anim.
        this.mType = type;
        this.mX = x;                        // +0x20
        this.mY = y;                        // +0x24
        // FUN_004032ca:3479: age = (rand%200)*2 + 0xCE4 → [3300, 3698]
        this.mAge = (Math.floor(Math.random() * 200)) * 2 + 0xCE4;
        // FUN_004032ca:3446: hunger (+0x38) = 2000
        this.mHunger = 2000;
        // +0x44 sick flag, recomputed by FUN_00403a9a (rwg_functions.c:4103)
        this.mIsSick = false;
        // +0x40 egg-lay cooldown. FUN_004032ca:3447-3455 sets it to -1 or
        // 1500/2000 depending on a ctor argument whose value at the
        // FUN_0041ff68 call sites is UNKNOWN — not found in decompiled.
        // JS keeps 0.
        this.mLayCooldown = 0;
        // +0x34 food counter
        this.mFoodCounter = 0;
        // +0x54/+0x58 walk target
        this.mTargetX = x;
        this.mTargetY = y;
        // +0x5c/+0x60 wander target (init -1 = none, FUN_004032ca:3466-3469)
        this._wanderTarget = null;
        // +0x64 hungry-icon animation timer (0..0.999)
        this.mHungryAnim = 0;
        // Show-hungry-icon flag cached from update (vt[2]) for draw().
        this._hungryIcon = false;
        // JS-only bookkeeping
        this.mIsAdult = false;
        this.mIsAlive = true;
        this.mAnimTimer = 0;
        this.mStateTimer = 0;
        this.mActionDur = 0;
        // Walking speed in screen px/tick. Original step is
        // (fedRatio*0.05*0.5+0.05)*speedMult logical units (FUN_00403af3:4189)
        // in a 128x57 logical field; the logical→screen scale is UNKNOWN —
        // not found in decompiled. JS keeps its 0.5 px/tick.
        this.mSpeed = 0.5;
        this.mDirection = Math.random() < 0.5 ? 0 : 1;
        this.mScale = 0.5;
        // +0x48 coin-dig cooldown
        this.mPeckCooldown = 0;
        this.mBroodingEgg = null;
        this.mDeathTimer = 0;
        this._targetSeeds = null;
        this.mGrowTimer = 0;
        // Set true when a raven captures this chick mid-flight (Field.js).
        this.mIsCarried = false;
        this.mState = ChickState.IDLE;
    }

    // FUN_00403a3e (rwg_functions.c:4054) food tier >= 1:
    //   food >= FUN_00405899()*5 (base 500 lvl<7 / 700).
    // JS food units are not the original's (JS cap 200*scale vs original
    // base*33); the JS-scale equivalent threshold used throughout this port
    // is 100*scale. Exact JS↔original scale: UNKNOWN — not found in decompiled.
    _isFed() {
        return this.mFoodCounter >= 100 * this.mScale;
    }

    // vt[2] FUN_00403ac8 (rwg_functions.c:4133): sick (+0x44) AND the seed
    // list (world+0x1c) is empty. MagicChick overrides with FUN_0040e36f → 0.
    showsHungryIcon(field) {
        if (!this.mIsSick) return false;
        if (!field || !field.mSeeds) return false;
        return !field.mSeeds.some(s => s.hasFood && s.hasFood());
    }

    // FUN_0040344c (rwg_functions.c:3560) Chick::Update
    update(field) {
        if (!this.mIsAlive) {
            this.mDeathTimer++;
            this.mAnimTimer++;
            return;
        }
        // Carried by a raven — position/state is owned by the Raven.
        if (this.mIsCarried) {
            this.mAnimTimer++;
            return;
        }

        // Juvenile growth. UNKNOWN — not found in decompiled (the 0x70-byte
        // Chick struct has no growth field), but level texts 43/44 mention
        // chickens "growing", so the JS growth phase is left as is.
        if (!this.mIsAdult) {
            const inc = this.mIsSick ? (this.mAnimTimer % 2 === 0 ? 1 : 0) : 1;
            this.mGrowTimer = (this.mGrowTimer || 0) + inc;
            this.mScale = 0.5 + Math.max(0, Math.min(1, this.mGrowTimer / 800)) * 0.5;
            if (this.mGrowTimer >= 800) {
                this.mIsAdult = true;
                this.mScale = 1.0;
            }
        }

        // FUN_0040344c:3586-3596 — hungry-icon timer +0x64: while vt[2] is
        // true it grows by 0.01/tick (_DAT_004e9150) and saturates at 0.999
        // (_DAT_004e9408/_DAT_004e9400); otherwise it is reset to 0.
        this._hungryIcon = this.showsHungryIcon(field);
        if (this._hungryIcon) {
            this.mHungryAnim += 0.01;
            if (!(this.mHungryAnim < 0.999)) this.mHungryAnim = 0.999;
        } else {
            this.mHungryAnim = 0;
        }

        // FUN_0040344c:3601-3603 — dig cooldown (+0x48) decrements every tick.
        if (this.mPeckCooldown > 0) this.mPeckCooldown--;
        // FUN_0040344c:3604-3607 — lay cooldown (+0x40) decrements only while
        // the chick is fed (FUN_00403a3e != 0).
        if (this.mLayCooldown > 0 && this._isFed()) this.mLayCooldown--;

        // FUN_0040344c:3626-3640 — if vt[5] isActive: age (+0x1c)--, and if
        // in action 3/4 (FUN_00402342, = SICK_START/SICK_IDLE here) hunger
        // (+0x38)--. Death when age < 1 or hunger < 1 → FUN_0040342b + death
        // sound DAT_004fed94.
        // BroodyChick vt[5] = FUN_00403dec returns 0 while state == 0x14
        // (brooding), so a brooding broody does not age (rwg_functions.c:4493).
        const isActive = this.mState !== ChickState.DEATH;
        const inHungerAction = this.mState === ChickState.SICK_START
            || this.mState === ChickState.SICK_IDLE;
        const isBrooding = this.mBroodActive === true;
        if (isActive && this.mIsAdult && !isBrooding) {
            this.mAge--;
            if (inHungerAction) this.mHunger--;
            if (this.mAge < 1 || this.mHunger < 1) {
                this.die(true);
                return;
            }
        }

        // FUN_00403a9a (rwg_functions.c:4103): sick flag (+0x44) =
        //   not sick: age < 3000; sick: age < (lvl<7 ? 4500 : 5000).
        // JS keeps its sick pose (SICK_START → SICK_IDLE) for chicks that
        // enterSickPose(); see report — the original's sick pose belongs to a
        // separate world-driven event (FUN_004043fd → FUN_00404d00).
        const justSickened = this.mIsSick
            && this.mState !== ChickState.SICK_START
            && this.mState !== ChickState.SICK_IDLE;
        if ((!this.mIsSick && this.mAge < 3000) || (justSickened && this.entersSickPose())) {
            this.mIsSick = true;
            if (this.entersSickPose()) this.setState(ChickState.SICK_START);
        }
        const lvl = (field && field.mFieldController) ? field.mFieldController.mCurrentLevel : 7;
        const recoverThreshold = lvl < 7 ? 4500 : 5000;
        if (this.mIsSick && this.mAge >= recoverThreshold) {
            this.mIsSick = false;
            if (this.mState === ChickState.SICK_START || this.mState === ChickState.SICK_IDLE) {
                const nextState = this.mBroodActive
                    ? ChickState.BROOD_IDLE
                    : ChickState.IDLE;
                this.setState(nextState);
            }
        }

        this.mStateTimer++;
        this.mAnimTimer++;

        switch (this.mState) {
            case ChickState.IDLE:
                this._updateIdle(field);
                break;
            case ChickState.WALK:
                this._updateWalk(field);
                break;
            case ChickState.PECK:
                this._updatePeck(field);
                break;
            case ChickState.DIG:
                this._updateDig(field);
                break;
            case ChickState.SICK_START:
                // Action 3 → action 4 (FUN_0040386a:3876-3884): 50-tick
                // start, then SICK_IDLE (100-tick loop).
                if (this.mStateTimer >= 50) {
                    this.setState(ChickState.SICK_IDLE);
                }
                break;
            case ChickState.SICK_IDLE:
                // Action 4 loops until cured or hunger runs out.
                break;
            case ChickState.LAYING:
                this._updateLaying(field);
                break;
            case ChickState.BROODING:
                this._updateBrooding(field);
                break;
            case ChickState.BROOD_IDLE:
                this._updateBroodIdle(field);
                break;
            case ChickState.DEATH:
                break;
            case ChickState.HOLY_SPELL:
                // Action 12 lasts 100 (_DAT_004e9398); at its end vt[10]
                // (HolyChick FUN_0040d922) performs the spell.
                if (this.mStateTimer >= DUR_SPELL) {
                    this._onSpellEnd(field);
                    if (this.mIsAlive) this._chooseNextAction(field);
                }
                break;
        }
    }

    // Whether this chick shows the SICK_START/SICK_IDLE pose when its sick
    // flag is set. The pose images (actions 3/4/5) exist only for LAYER
    // (loader rwg_functions.c:31072-31125 loads them for type 0 only) and
    // only LayerChick passes vt[3] FUN_00403e3c, the filter used by the
    // sick-event picker FUN_004043fd:5118/5172. Other types handle +0x44 by
    // seeking food (vt[13]).
    entersSickPose() {
        return this.mType === ChickType.LAYER;
    }

    // Subclasses override — only LayerChick lays (vt[3] FUN_00403e3c).
    canLayEggs() {
        return false;
    }

    // vt[7] FUN_004037e8 (rwg_functions.c:3813) + vt[8] FUN_0040386a
    // (rwg_functions.c:3867): decide the next action at the end of the
    // current one.
    //   sick (+0x44)                    → state 2 → vt[13] seekFood
    //   lay cooldown 0 and lay spot     → state 3 → walk/lay (action 9)
    //   otherwise                       → state 4 → FUN_0040392e wander/dig
    _chooseNextAction(field) {
        if (this.mIsSick) {
            this._wanderTarget = null;   // state != 4 clears it (3591-3594)
            this._seekFood(field);
            return;
        }
        // State 3: the original also requires a lay spot reserved for this
        // chick (FUN_004075da:3843); that reservation system is UNKNOWN in
        // JS, so the lay starts in place.
        if (this.canLayEggs() && this.mIsAdult && this.mLayCooldown === 0 && this._isFed()) {
            this._wanderTarget = null;
            this.setState(ChickState.LAYING);
            return;
        }
        this._wander(field);
    }

    // FUN_0040392e (rwg_functions.c:3930): state-4 wander. If no wander
    // target, with 50% (rand & 1) pick one via FUN_004046aa; if a target
    // exists walk to it (action 11), else FUN_004039f5.
    _wander(field) {
        if (!this._wanderTarget && (Math.floor(Math.random() * 0x7fffffff) & 1)) {
            if (field && field.pickRandomTarget) {
                this._wanderTarget = field.pickRandomTarget(this.mX, this.mY);
            }
        }
        if (this._wanderTarget) {
            this.mTargetX = this._wanderTarget.x;
            this.mTargetY = this._wanderTarget.y;
            this._targetSeeds = null;
            this.setState(ChickState.WALK);
            return;
        }
        this._digOrIdle();
    }

    // FUN_004039f5 (rwg_functions.c:4019): if dig cooldown (+0x48) is 0 and
    // the chick is on the field → dig (action 2, 120). Otherwise action
    // rand%2+1 (1 = idle 150, 2 = dig 120).
    _digOrIdle() {
        if (this.mPeckCooldown === 0 && !this.mIsCarried) {
            this.setState(ChickState.DIG);
            this.mActionDur = DUR_DIG;
            return;
        }
        if (Math.floor(Math.random() * 0x7fffffff) % 2 === 0) {
            this.setState(ChickState.IDLE);
            this.mActionDur = DUR_IDLE;
        } else {
            this.setState(ChickState.DIG);
            this.mActionDur = DUR_DIG;
        }
    }

    // vt[13] SimpleChick FUN_0042013e (rwg_functions.c:39664): if the seed
    // list is empty → FUN_004039f5; else walk (action 11) to the nearest seed
    // cluster (FUN_0041c11f).
    _seekFood(field) {
        const seeds = field ? field.getNearestSeeds(this.mX, this.mY) : null;
        if (!seeds) {
            this._digOrIdle();
            return;
        }
        this.mTargetX = seeds.mX;
        this.mTargetY = seeds.mY;
        this._targetSeeds = seeds;
        this.setState(ChickState.WALK);
    }

    // Action 1 (idle). The JS seed-seeking trigger below (hungry/near
    // seeds while healthy) is UNKNOWN — not found in decompiled: the
    // original only seeks seeds when sick (state 2 → vt[13]).
    _updateIdle(field) {
        const urgent = this.mFoodCounter < (this.mScale || 1) * 50;
        if (field && this.mFoodSeeker !== false) {
            const seeds = field.getNearestSeeds(this.mX, this.mY);
            if (seeds) {
                const dx = seeds.mX - this.mX;
                const dy = seeds.mY - this.mY;
                const near = (dx * dx + dy * dy) < 80 * 80;
                if (this.mIsSick || urgent || near) {
                    this.mTargetX = seeds.mX + (Math.random() - 0.5) * 20;
                    this.mTargetY = seeds.mY + (Math.random() - 0.5) * 10;
                    this._targetSeeds = seeds;
                    this._wanderTarget = null;
                    this.setState(ChickState.WALK);
                    return;
                }
            }
        }
        if (this.mStateTimer >= this.mActionDur) {
            this._chooseNextAction(field);
        }
    }

    // Action 11 (walk). FUN_00403602:3667-3700 moves toward +0x54 via
    // FUN_00403af3 until arrival, then vt[9]/next decision.
    _updateWalk(field) {
        if (this._targetSeeds && (!this._targetSeeds.mIsAlive || !this._targetSeeds.hasFood())) {
            this._targetSeeds = null;
            this._chooseNextAction(field);
            return;
        }
        const dx = this.mTargetX - this.mX;
        const dy = this.mTargetY - this.mY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 5) {
            // Arrived at seeds → action 10 (peck, FUN_00420069:39651-39655).
            if (this._targetSeeds && this._targetSeeds.hasFood()) {
                this.setState(ChickState.PECK);
                return;
            }
            // Arrived at wander target → FUN_0040392e:3966-3972 clears it
            // and calls FUN_004039f5.
            if (this._wanderTarget) {
                this._wanderTarget = null;
                this._digOrIdle();
                return;
            }
            this._chooseNextAction(field);
            return;
        }
        // JS-only safety timeout (target clipped by the field clamp).
        if (this.mStateTimer > 600) {
            this._targetSeeds = null;
            this._wanderTarget = null;
            this._chooseNextAction(field);
            return;
        }

        this.mDirection = dx > 0 ? 0 : 1; // 0=right(flip needed), 1=left(natural)
        this.mX += (dx / dist) * this.mSpeed;
        this.mY += (dy / dist) * this.mSpeed;
        // JS field clamp (screen coords). Original clamps the logical field
        // to 0..128 x 0..57 (FUN_004046aa:5300-5311).
        this.mX = Math.max(80, Math.min(720, this.mX));
        this.mY = Math.max(370, Math.min(580, this.mY));
    }

    // Action 10 (peck, 30 ticks). At its end vt[11] SimpleChick
    // FUN_0041ff9a (rwg_functions.c:39547) eats one grain of the target
    // cluster. No coin is produced here — coins come only from action 2.
    _updatePeck(field) {
        if (this.mStateTimer >= DUR_PECK) {
            if (this._targetSeeds && this._targetSeeds.hasFood()) {
                const cal = this._targetSeeds.eatOne();
                if (cal > 0) this.feed(cal);
            }
            this._targetSeeds = null;
            this._chooseNextAction(field);
        }
    }

    // Action 2 (dig, 120 ticks). FUN_00403602:3714-3727 at its end: if dig
    // cooldown (+0x48) == 0 and the chick is on the field (FUN_00403bbf),
    // spawn gem vt[15] via FUN_0040c4d9 and set the cooldown to
    // (lvl<7 ? 800 : 1000). FUN_0040c4d9:15152 skips the spawn when the
    // level's no-coins flag is set (L37 — JS mLevelConfig.noPeckCoins).
    _updateDig(field) {
        if (this.mStateTimer < this.mActionDur) return;
        if (this.mPeckCooldown === 0 && !this.mIsCarried && field) {
            const fcCfg = field.mFieldController && field.mFieldController.mLevelConfig;
            const noCoins = fcCfg && fcCfg.noPeckCoins;
            // mIsAdult gate: JS growth phase (UNKNOWN in decompiled).
            if (this.mIsAdult && !noCoins) {
                field.spawnGem(this.getCoinType(), this.mX, this.mY - 20);
            }
            this.mPeckCooldown = levelOf(field) < 7 ? 800 : 1000;
        }
        this._chooseNextAction(field);
    }

    // vt[15] FUN_004201a0 (rwg_functions.c:39698): 0 (gold) when
    // FUN_00403a65 > 1.0 (_DAT_004dc7e0), else 1 (silver). FUN_00403a65 =
    // 2*food/(base*11) → gold iff food > base*5.5. JS food scale differs
    // (see _isFed); the JS ratio test below is kept. Exact JS threshold:
    // UNKNOWN — not found in decompiled.
    getCoinType() {
        const cap = Math.max(1, Math.floor(200 * (this.mScale || 1)));
        const ratio = this.mFoodCounter / cap;
        return ratio > 0.5 ? 0 : 1;
    }

    // Kept for API compatibility: start laying (action 9).
    layEgg(field) {
        this.setState(ChickState.LAYING);
    }

    // Action 9 (lay egg, 100 ticks). FUN_00403602:3729-3739 at its end:
    // lay cooldown (+0x40) = (lvl<7 ? 1500 : 2000); egg type = vt[14];
    // FUN_00407038 spawns the egg at the chick position and plays a random
    // DAT_00500624 sound (SOUND_EGG_LAYERED1/2, rand()%2 — rwg_functions.c:8748-8760).
    // The food counter is not touched by laying.
    _updateLaying(field) {
        if (this.mStateTimer < DUR_LAY) return;
        if (field) {
            this.mLayCooldown = levelOf(field) < 7 ? 1500 : 2000;
            const type = this.getEggType(field);
            field.spawnEgg(this.mX, this.mY, type);
            const snd = Math.floor(Math.random() * 2) === 0
                ? SOUNDS.SOUND_EGG_LAYERED1 : SOUNDS.SOUND_EGG_LAYERED2;
            if (snd) snd.play();
        }
        this._chooseNextAction(field);
    }

    _updateBrooding(field) {
        // Broody-specific - only BroodyChick
    }

    _updateBroodIdle(field) {
        // Broody sitting on egg
    }

    // vt[10] default FUN_0044a036 is a no-op; HolyChick overrides.
    _onSpellEnd(field) {
    }

    // vt[14] FUN_00465f98 (rwg_functions.c:107231): returns own type
    // (+0x04) → the egg type this chick produces.
    getEggType() {
        return CHICK_TO_EGG[this.mType] !== undefined ? CHICK_TO_EGG[this.mType] : EggType.WHITE;
    }

    setState(state) {
        this.mState = state;
        this.mStateTimer = 0;
        this.mActionDur = 0;
        if (state === ChickState.SICK_START
            || state === ChickState.LAYING
            || state === ChickState.HOLY_SPELL
            || state === ChickState.DEATH
            || state === ChickState.BROODING
            || state === ChickState.BROOD_IDLE
            || state === ChickState.DIG) {
            this.mAnimTimer = 0;
        }
    }

    // ravenAttack — fired when a raven escapes off-screen carrying this chick.
    ravenAttack() {
        this.die();
        return true;
    }

    // FUN_0040342b (rwg_functions.c:3530): state 6, action 13 (death, 200).
    // The death sound DAT_004fed94 is played by the caller in
    // FUN_0040344c:3637-3638 (age/hunger death), not by FUN_0040342b itself;
    // FUN_00420e2e (holy spell) kills without it. playSound defaults to true
    // for external callers (raven/wolf/risk — their sound behaviour is
    // outside this file's scope).
    die(playSound = true) {
        if (!this.mIsAlive) return;
        this.mIsAlive = false;
        this.setState(ChickState.DEATH);
        this.mDeathTimer = 0;
        if (playSound && SOUNDS.SOUND_CHICK_DEATH) SOUNDS.SOUND_CHICK_DEATH.play();
    }

    // vt[11] SimpleChick FUN_0041ff9a (rwg_functions.c:39547): eating one
    // grain: age (+0x1c) += cluster calories (+0x24); food (+0x34) += an
    // amount computed by FUN_004bed40 (UNKNOWN — not found in decompiled;
    // JS keeps calories*1.5); food capped at FUN_004058af (JS cap 200*scale).
    // Hunger (+0x38) is NOT touched by eating (only FUN_00403403, via cure).
    feed(calories) {
        if (!(calories > 0)) return;
        this.mFoodCounter += Math.floor(calories * 1.5);
        const cap = Math.floor(200 * this.mScale);
        if (this.mFoodCounter > cap) this.mFoodCounter = cap;
        this.mAge += calories;
    }

    // Cure — FUN_0040490a (rwg_functions.c:5440, $50, SOUND_CURED
    // DAT_004fed6c) → FUN_00403403 (rwg_functions.c:3510): if in action 3/4
    // → action 5 (50) and hunger (+0x38) = 2000. The original does not touch
    // age; JS additionally lifts age to 5200 and clears the sick flag
    // because JS conflates the age-based +0x44 flag with the sick event.
    cure() {
        if (this.mIsSick) {
            this.mIsSick = false;
            this.mAge = Math.max(this.mAge, 5200);
            this.mHunger = 2000;
            const nextState = this.mBroodActive
                ? ChickState.BROOD_IDLE
                : ChickState.IDLE;
            this.setState(nextState);
            if (SOUNDS.SOUND_CURED) SOUNDS.SOUND_CURED.play();
        }
    }

    // Sell pricing lives in ShopDialogs.sellPrice (FUN_00403bd6:4245).

    getImagePrefix() {
        const prefixes = {
            [ChickType.LAYER]: 'LAYER',
            [ChickType.BROODY]: 'BROODY',
            [ChickType.ROOSTER]: 'ROOSTER',
            [ChickType.MAGIC]: 'MAGIC',
            [ChickType.HOLY]: 'HOLY',
        };
        return prefixes[this.mType] || 'LAYER';
    }

    // Chick drawing — FUN_0040a3d6 chick loop (rwg_functions.c:13385-13440)
    // with image choice FUN_0040a166 (rwg_functions.c:12962). Exact sprite
    // anchor/shadow offsets use FUN_00409779/FUN_004bed40 results that are
    // UNKNOWN in decompiled; JS anchors the cel's bottom-centre at (mX, mY).
    draw(g) {
        const prefix = this.getImagePrefix();
        let img = null;

        switch (this.mState) {
            case ChickState.IDLE:
                img = IMAGES[`IMAGE_CHICK_IDLE0_${prefix}`];
                break;
            case ChickState.DIG:
                // action 2 → IDLE1 (dig.jpg)
                img = IMAGES[`IMAGE_CHICK_IDLE1_${prefix}`];
                break;
            case ChickState.WALK:
                img = IMAGES[`IMAGE_CHICK_WALK_${prefix}`];
                break;
            case ChickState.PECK:
                img = IMAGES[`IMAGE_CHICK_PECK_${prefix}`];
                break;
            case ChickState.SICK_START:
                img = IMAGES[`IMAGE_CHICK_SICK_START_${prefix}`]
                    || IMAGES.IMAGE_CHICK_SICK_START_LAYER;
                break;
            case ChickState.SICK_IDLE:
                img = IMAGES[`IMAGE_CHICK_SICK_IDLE_${prefix}`]
                    || IMAGES.IMAGE_CHICK_SICK_IDLE_LAYER;
                break;
            case ChickState.LAYING:
                img = IMAGES[`IMAGE_CHICK_LAYER_LAYER`];
                break;
            case ChickState.BROODING:
                img = IMAGES[`IMAGE_CHICK_BROOD_START_BROODY`]
                    || IMAGES[`IMAGE_CHICK_BROOD_IDLE_BROODY`];
                break;
            case ChickState.BROOD_IDLE:
                img = IMAGES[`IMAGE_CHICK_BROOD_IDLE_BROODY`];
                break;
            case ChickState.DEATH:
                img = IMAGES[`IMAGE_CHICK_DEATH_${prefix}`]
                    || IMAGES.IMAGE_CHICK_DEATH_LAYER;
                break;
            case ChickState.HOLY_SPELL:
                img = IMAGES[`IMAGE_CHICK_HOLY_SPELL`];
                break;
        }
        if (!img) img = IMAGES[`IMAGE_CHICK_IDLE0_${prefix}`] || IMAGES.IMAGE_CHICK_IDLE0_LAYER;

        if (img && img.img) {
            const celW = img.getCelWidth();
            const celH = img.getCelHeight();
            const numFrames = img.mNumCols * img.mNumRows;
            // Frame timing: UNKNOWN — not found in decompiled (JS 6 ticks/frame).
            // One-shot actions hold their last frame instead of wrapping
            // (their table durations — 70 sit, 100 spell, 200 death — can
            // exceed the JS 6-ticks/frame cycle).
            let frame;
            const oneShot = this.mState === ChickState.DEATH
                || this.mState === ChickState.BROODING
                || this.mState === ChickState.HOLY_SPELL;
            if (oneShot && numFrames > 1) {
                frame = Math.min(numFrames - 1, Math.floor(this.mAnimTimer / 6));
            } else {
                frame = numFrames > 1 ? Math.floor(this.mAnimTimer / 6) % numFrames : 0;
            }

            // Shadow (DAT_00500010 IMAGE_SHADOW) — FUN_0040a3d6:13431-13438
            // draws it when height (+0x28) == 0 and state != 6.
            const shadowImg = IMAGES.IMAGE_SHADOW;
            if (this.mIsAlive && !this.mIsCarried
                && this.mState !== ChickState.DEATH
                && shadowImg && shadowImg.img) {
                const baseW = shadowImg.mWidth || 64;
                const baseH = shadowImg.mHeight || 34;
                const sw = baseW * this.mScale;
                const sh = baseH * this.mScale;
                g.ctx.drawImage(shadowImg.img, this.mX - sw / 2, this.mY - sh / 2, sw, sh);
            }

            const ctx = g.ctx;
            ctx.save();
            const sx = this.mDirection === 0 ? -this.mScale : this.mScale;
            ctx.translate(this.mX, this.mY);
            ctx.scale(sx, this.mScale);
            const cols = img.mNumCols || 1;
            const srcX = (frame % cols) * celW;
            const srcY = Math.floor(frame / cols) * celH;
            ctx.drawImage(img.img, srcX, srcY, celW, celH,
                -celW / 2, -celH, celW, celH);
            ctx.restore();

            // Hungry icon (DAT_00500020 IMAGE_CHICK_HUNGRY) —
            // FUN_0040a3d6:13414-13430: drawn when vt[2] is true, frame =
            // ftol(+0x64 * numFrames), x = spriteLeft + (spriteW - celW)/2
            // + 0x14, y = spriteTop - image height. The original also caps
            // the icon at 5 chicks per frame (piStack_118 < 5) — not
            // enforced here (needs Field's draw loop).
            if (this._hungryIcon && this.mIsAlive) {
                const hungryImg = IMAGES.IMAGE_CHICK_HUNGRY;
                if (hungryImg && hungryImg.img) {
                    const hFrames = (hungryImg.mNumCols || 1) * (hungryImg.mNumRows || 1);
                    const hFrame = Math.min(hFrames - 1, Math.floor(this.mHungryAnim * hFrames));
                    const spriteW = celW * this.mScale;
                    const spriteLeft = this.mX - spriteW / 2;
                    const spriteTop = this.mY - celH * this.mScale;
                    g.drawImageCell(hungryImg,
                        spriteLeft + (spriteW - hungryImg.getCelWidth()) / 2 + 0x14,
                        spriteTop - hungryImg.getCelHeight(), hFrame);
                }
            }
        }
    }
}

// SimpleChick — vtable 004dc8dc, ctor FUN_0041ff68 (rwg_functions.c:39518).
export class SimpleChick extends Chick {
    constructor(x, y) {
        super(ChickType.LAYER, x, y);
    }
}

// LayerChick — vtable 004dc96c, built by FUN_00403ec2:4645-4659.
export class LayerChick extends SimpleChick {
    // vt[3] FUN_00403e3c (rwg_functions.c:4550): can be picked for the sick
    // event / laying when fed, active and on the field.
    canLayEggs() { return true; }

    // vt[14] FUN_0040dba2 (rwg_functions.c:16958) — egg type. Up to 31
    // tries: r = rand()/2147483647.0 (_DAT_004e9368); subtract the weights
    // {0.35, 0.24, 0.14, 0.15, 1.0} (_DAT_004e9388/80/78/70) and take the
    // first index where r <= 0 → chick type 0..4 (Layer 35%, Broody 24%,
    // Rooster 14%, Magic 15%, Holy 12%). Accept if the level allows that
    // type (FUN_00404a71); Broody additionally needs world+0x274 (broody
    // count below the level's broody cap, FUN_004043fd:5084-5088). After 31
    // failed tries return 0 (Layer).
    // The level allow-mask (FUN_00404a71 / FUN_00423c04) and the broody cap
    // are not modelled in JS: the gate below (BLUE/RED need hasMagicHoly,
    // BLACK needs hasRavens) is the earlier JS approximation — UNKNOWN.
    getEggType(field) {
        const weights = [0.35, 0.24, 0.14, 0.15, 1.0];
        const cfg = field && field.mFieldController && field.mFieldController.mLevelConfig;
        const blocked = (t) => {
            if (!cfg) return false;
            if ((t === EggType.BLUE || t === EggType.RED) && !cfg.hasMagicHoly) return true;
            if (t === EggType.BLACK && !cfg.hasRavens) return true;
            return false;
        };
        for (let tries = 0; tries <= 0x1e; tries++) {
            let r = Math.floor(Math.random() * 0x7fffffff) / 2147483647.0;
            let chickType = 0;
            for (let i = 0; i < 5; i++) {
                r -= weights[i];
                if (r <= 0) { chickType = i; break; }
            }
            const eggType = CHICK_TO_EGG[chickType];
            if (!blocked(eggType)) return eggType;
        }
        return EggType.WHITE;
    }
}

export class BroodyChick extends Chick {
    // Sexy::BroodyChick vtable 0x004dc924. Alloc 0x80 (FUN_00403ec2:4661-4677).
    //   +0x70 smart-ptr to target egg, +0x74 brooding flag,
    //   +0x78 brood start tick, +0x7C tick counter (FUN_00403de4:4474).
    // Original brood sequence (FUN_00402369/FUN_0040241b/FUN_004024b1/
    // FUN_0040258b, rwg_functions.c:2102-2340): walk to egg (action 11,
    // target y + 0.5), sit (action 6, 70), on nest (action 7, 400, repeated
    // while +0x74 set and the egg is still waiting), get up (action 8, 70).
    // Hatch timing lives on the egg (egg+0x1c, set to 0.001 at get-up);
    // the JS 3000-tick brood duration below is UNKNOWN — not found in decompiled.
    constructor(x, y) {
        super(ChickType.BROODY, x, y);
        this.mBroodingEgg = null;       // +0x70
        this.mBroodActive = false;      // +0x74
        this.mBroodProgress = 0;
        this.mBroodDuration = 3000;     // UNKNOWN — not found in decompiled
        this.mWalkingToEgg = false;
        this._broodTicks = 0;           // +0x7c - +0x78
    }

    canLayEggs() { return false; }

    isBroody() { return this.mBroodActive && !!this.mBroodingEgg; }

    // vt[1] FUN_00403de4 (rwg_functions.c:4471): +0x7c++ then FUN_0040344c.
    update(field) {
        super.update(field);
        if (!field || !this.mIsAlive || this.mIsCarried) return;

        if (this.mBroodActive && this.mBroodingEgg) {
            if (!this.mBroodingEgg.mIsAlive || this.mBroodingEgg.mCollected) {
                this._endBrooding();
                return;
            }
            this._broodTicks++;
            // Sit (action 6, 70 ticks — PTR_004d01f0[6]) → on nest (action 7).
            if (this.mState === ChickState.BROODING && this.mBroodProgress >= 70) {
                this.setState(ChickState.BROOD_IDLE);
            }
            this.mX = this.mBroodingEgg.mX;
            this.mY = this.mBroodingEgg.mY;
            // Sick slow-down: UNKNOWN — not found in decompiled (L31 text).
            if (this.mIsSick) {
                if (this.mAnimTimer % 2 === 0) this.mBroodProgress++;
            } else {
                this.mBroodProgress++;
            }
            if (this.mBroodingEgg.mBroodProgress !== undefined) {
                this.mBroodingEgg.mBroodProgress = this.mBroodProgress / this.mBroodDuration;
            }
            if (this.mBroodProgress >= this.mBroodDuration) {
                const ex = this.mBroodingEgg.mX;
                const ey = this.mBroodingEgg.mY;
                const eggType = this.mBroodingEgg.mEggType;
                this.mBroodingEgg.mIsAlive = false;
                this.mBroodingEgg.mCollected = true;
                if (field.hatchEgg) field.hatchEgg(this.mBroodingEgg, ex, ey);
                else {
                    let chickType;
                    switch (eggType) {
                        case EggType.WHITE: chickType = ChickType.LAYER; break;
                        case EggType.BLUE: chickType = ChickType.MAGIC; break;
                        case EggType.RED: chickType = ChickType.HOLY; break;
                        case EggType.BLACK: chickType = ChickType.ROOSTER; break;
                        case EggType.GOLDEN: chickType = ChickType.BROODY; break;
                        default: chickType = ChickType.LAYER;
                    }
                    field.addChick(createChick(chickType, ex, ey));
                }
                // SOUND_EGG_BROODED (DAT_004fedb4) trigger site: UNKNOWN in
                // decompiled; kept at hatch.
                if (SOUNDS.SOUND_EGG_BROODED) SOUNDS.SOUND_EGG_BROODED.play();
                // FUN_0040258b:2318-2323 — at get-up the broody's age gets
                // the brooding time back: age += (+0x7c - +0x78), min 0x5db.
                this.mAge += this._broodTicks;
                if (this.mAge < 0x5db) this.mAge = 0x5db;
                this._endBrooding();
            }
            return;
        }

        if (this.mWalkingToEgg && this.mBroodingEgg) {
            if (!this.mBroodingEgg.mIsAlive) {
                this.mBroodingEgg._claimedBy = null;
                this.mBroodingEgg = null;
                this.mWalkingToEgg = false;
                this._chooseNextAction(field);
                return;
            }
            this.mTargetX = this.mBroodingEgg.mX;
            this.mTargetY = this.mBroodingEgg.mY;
            const dx = this.mBroodingEgg.mX - this.mX;
            const dy = this.mBroodingEgg.mY - this.mY;
            const d2 = dx * dx + dy * dy;
            if (d2 < 144) {
                // vt[9] FUN_004024b1 (rwg_functions.c:2216): on arrival
                // action 6 (sit, 70).
                this.mBroodActive = true;
                this.mBroodProgress = 0;
                this._broodTicks = 0;
                this.mWalkingToEgg = false;
                this.setState(ChickState.BROODING);
                if (this.mBroodingEgg.mBrooding !== undefined) {
                    this.mBroodingEgg.mBrooding = true;
                }
            } else if (this.mState !== ChickState.WALK) {
                this.setState(ChickState.WALK);
            }
            return;
        }

        // Claiming an egg: the original target is set by the egg-box
        // (smart-ptr +0x70); auto-claim of the nearest waiting egg is a JS
        // approximation — UNKNOWN.
        if (!this.mIsAdult) return;
        if (this.mIsSick) return;
        let nearest = null;
        let nearestD2 = Infinity;
        for (const g of field.mGems) {
            if (g.mType !== 4 /* EGG */ || !g.mIsAlive || !g.mBrooding || g._claimedBy) continue;
            const dx = g.mX - this.mX;
            const dy = g.mY - this.mY;
            const d2 = dx * dx + dy * dy;
            if (d2 < nearestD2) {
                nearestD2 = d2;
                nearest = g;
            }
        }
        if (nearest) {
            this.mBroodingEgg = nearest;
            this.mWalkingToEgg = true;
            nearest._claimedBy = this;
            this.mTargetX = nearest.mX;
            this.mTargetY = nearest.mY;
            this._targetSeeds = null;
            this._wanderTarget = null;
            this.setState(ChickState.WALK);
        }
    }

    // Called by FieldController.startEggBrooding when the player clicks an egg box
    startBrooding(egg) {
        if (this.mBroodingEgg && this.mBroodingEgg !== egg) return;
        this.mBroodingEgg = egg;
        this.mWalkingToEgg = true;
        this.mBroodProgress = 0;
        this.mBroodActive = false;
        this._wanderTarget = null;
        this.setState(ChickState.WALK);
        if (egg) {
            egg._claimedBy = this;
            this.mTargetX = egg.mX;
            this.mTargetY = egg.mY;
        }
        this._targetSeeds = null;
    }

    _endBrooding() {
        if (this.mBroodingEgg) {
            this.mBroodingEgg._claimedBy = null;
            if (this.mBroodingEgg.mBroodProgress !== undefined) {
                this.mBroodingEgg.mBroodProgress = 0;
            }
        }
        this.mBroodingEgg = null;
        this.mBroodActive = false;
        this.mBroodProgress = 0;
        this._broodTicks = 0;
        this.mWalkingToEgg = false;
        if (this.mState === ChickState.BROOD_IDLE || this.mState === ChickState.BROODING) {
            this.setState(ChickState.IDLE);
        }
    }

    // While walking to its egg the broody must not re-decide (state 0x14).
    _chooseNextAction(field) {
        if (this.mWalkingToEgg && this.mBroodingEgg) {
            this.setState(ChickState.WALK);
            return;
        }
        super._chooseNextAction(field);
    }
}

// RoosterChick — vtable 004dc9b4, built by FUN_00403ec2:4679-4691. No
// overrides besides the destructor. Raven protection is global
// (FUN_0040134a:446-461, handled in FieldController).
export class RoosterChick extends Chick {
    constructor(x, y) {
        super(ChickType.ROOSTER, x, y);
    }
}

// MagicChick — vtable 004dd62c, built by FUN_00403ec2:4693-4707 with
// FUN_004032ca(pos, 0) (lay cooldown -1: never lays) and +0x68/+0x6c = 0.
export class MagicChick extends Chick {
    constructor(x, y) {
        super(ChickType.MAGIC, x, y);
        this.mTargetMagicEgg = null;       // +0x68/+0x6c target egg
        // Magic chicks never eat seeds (vt[11..13] are egg versions).
        this.mFoodSeeker = false;
    }

    // vt[3] = FUN_0040e36f → 0.
    canLayEggs() { return false; }

    // vt[2] = FUN_0040e36f → 0: never shows the hungry icon.
    showsHungryIcon() { return false; }

    // vt[15] FUN_0040e372 (rwg_functions.c:17603) → 2 (DiamondBlue).
    getCoinType() { return 2; }

    // vt[13] FUN_0040e51f (rwg_functions.c:17749): if the egg list
    // (world+0x24) has no un-picked egg (FUN_004077fa) → FUN_004039f5; else
    // walk (action 11, 60) to the target chosen by FUN_004071b2.
    _seekFood(field) {
        const egg = this._pickEgg(field);
        if (!egg) {
            this.mTargetMagicEgg = null;
            this._digOrIdle();
            return;
        }
        this.mTargetMagicEgg = egg;
        egg._magicClaim = this;
        this.mTargetX = egg.mX;
        this.mTargetY = egg.mY;
        this._targetSeeds = null;
        this.setState(ChickState.WALK);
    }

    // FUN_004071b2 (rwg_functions.c:8826): nearest egg by Chebyshev
    // distance (FUN_00403c97) within 1e6 (_DAT_004e9280), not picked up
    // (+0x20), not reserved by another chick; eggs of type 3/4 (Magic/Holy
    // → BLUE/RED) are taken only if no other egg was found.
    // JS also skips eggs committed to brooding (FUN_00406ab6 busy test is on
    // egg+0x1c, whose JS equivalent is UNKNOWN).
    _pickEgg(field) {
        if (!field || !field.mGems) return null;
        let best = null;
        let bestD = 1000000;
        for (const g of field.mGems) {
            if (g.mType !== 4 /* EGG */ || !g.mIsAlive || g.mCollected) continue;
            if (g.mBrooding) continue;
            if (g._magicClaim && g._magicClaim !== this && g._magicClaim.mIsAlive
                && g._magicClaim.mTargetMagicEgg === g) continue;
            const d = Math.max(Math.abs(this.mX - g.mX), Math.abs(this.mY - g.mY));
            if (d >= bestD) continue;
            const special = g.mEggType === EggType.BLUE || g.mEggType === EggType.RED;
            if (!special) {
                bestD = d;
                best = g;
            } else if (!best) {
                best = g;   // bestD unchanged (FUN_004071b2:8866-8869)
            }
        }
        return best;
    }

    // Walking to the target egg: vt[12] FUN_0040e44d (rwg_functions.c:17686)
    // — on arrival action 10 (peck, 30).
    _updateWalk(field) {
        if (this.mTargetMagicEgg) {
            const egg = this.mTargetMagicEgg;
            if (!egg.mIsAlive || egg.mCollected || egg.mBrooding) {
                this.mTargetMagicEgg = null;
                this._chooseNextAction(field);
                return;
            }
            this.mTargetX = egg.mX;
            this.mTargetY = egg.mY;
            const dx = egg.mX - this.mX;
            const dy = egg.mY - this.mY;
            if (dx * dx + dy * dy < 25) {
                this.setState(ChickState.PECK);
                return;
            }
        }
        super._updateWalk(field);
    }

    // vt[11] FUN_0040e392 (rwg_functions.c:17636) at the end of the peck:
    // age (+0x1c) += cal; food (+0x34) += cal*3/2, capped at FUN_004058af;
    // the egg is removed (FUN_004077ae). `cal` is read from
    // `extraout_ECX + 0x14` whose object is ambiguous in the decompile —
    // UNKNOWN; JS keeps its earlier value 36. Sound: FUN_004077ae plays a
    // one-shot whose DAT is not visible — SOUND_EAT_EGG kept (UNKNOWN).
    _updatePeck(field) {
        if (!this.mTargetMagicEgg) {
            super._updatePeck(field);
            return;
        }
        if (this.mStateTimer < DUR_PECK) return;
        const egg = this.mTargetMagicEgg;
        this.mTargetMagicEgg = null;
        if (egg.mIsAlive && !egg.mCollected && !egg.mBrooding) {
            egg.mIsAlive = false;
            egg.mCollected = true;
            const cal = 36; // UNKNOWN — not found in decompiled
            this.mAge += cal;
            this.mFoodCounter += Math.floor((cal * 3) / 2);
            const cap = Math.floor(200 * this.mScale);
            if (this.mFoodCounter >= cap) this.mFoodCounter = cap;
            if (SOUNDS.SOUND_EAT_EGG) SOUNDS.SOUND_EAT_EGG.play();
        }
        this._chooseNextAction(field);
    }
}

// HolyChick — vtable 004dd11c, alloc 0x74, +0x70 spell cooldown = 6000
// (FUN_00403ec2:4709-4726).
export class HolyChick extends Chick {
    constructor(x, y) {
        super(ChickType.HOLY, x, y);
        this.mSpellCooldown = 6000; // +0x70, FUN_00403ec2:4722
        // Spell effect drawn at the converted chick (world+0x38 list entry,
        // 16-byte {timer, x, y, z} built in FUN_00420e2e:40570-40577).
        this.mSpellFx = null;
        this.mSpellFlashTimer = 0;
    }

    // vt[1] FUN_0040d912 (rwg_functions.c:16790): +0x70-- (if > 0), then
    // FUN_0040344c.
    update(field) {
        if (this.mSpellCooldown > 0) this.mSpellCooldown--;
        super.update(field);
        if (this.mSpellFx) {
            this.mSpellFx.t++;
            // Effect lifetime: UNKNOWN — not found in decompiled (JS 30 ticks).
            if (this.mSpellFx.t >= 30) this.mSpellFx = null;
        }
        this.mSpellFlashTimer = this.mSpellFx ? 30 - this.mSpellFx.t : 0;
    }

    canLayEggs() { return false; }

    // vt[8] FUN_0040d8b1 (rwg_functions.c:16759): if state == 4 and the
    // cooldown is 0 and FUN_00420f72 finds a target → cooldown = 6000,
    // action 12 (100). Otherwise FUN_0040386a.
    _chooseNextAction(field) {
        if (!this.mIsSick && this.mIsAdult && this.mSpellCooldown === 0
            && this._pickSpellTarget(field)) {
            this.mSpellCooldown = 6000;
            this._wanderTarget = null;
            this.setState(ChickState.HOLY_SPELL);
            return;
        }
        super._chooseNextAction(field);
    }

    // Kept for API compatibility: force a cast attempt now.
    castSpell(field) {
        if (this.mSpellCooldown > 0 || !this.mIsAdult) return false;
        if (!this._pickSpellTarget(field)) return false;
        this.mSpellCooldown = 6000;
        this.setState(ChickState.HOLY_SPELL);
        return true;
    }

    // FUN_00420f72 (rwg_functions.c:40611): collect chicks with type 3
    // (Magic) that are fed (FUN_00403a3e != 0), active (vt[5]) and on the
    // field (!FUN_00403bbf); stop once more than 10 are collected; return a
    // random one (rand % count), or null.
    _pickSpellTarget(field) {
        if (!field || !field.mChickens) return null;
        const list = [];
        for (const c of field.mChickens) {
            if (c.mType !== ChickType.MAGIC) continue;
            if (!c.mIsAlive || c.mState === ChickState.DEATH) continue;
            if (!c.mIsAdult || c.mIsCarried) continue;
            if (!c._isFed()) continue;
            list.push(c);
            if (list.length > 10) break;
        }
        if (list.length === 0) return null;
        return list[Math.floor(Math.random() * 0x7fffffff) % list.length];
    }

    // vt[10] FUN_0040d922 (rwg_functions.c:16808) → FUN_00420e2e
    // (rwg_functions.c:40526) at the end of action 12: pick a target again
    // (FUN_00420f72); spawn a gem at its position (FUN_0040c4d9 — red
    // diamond, matching SOUND_CHICK_TO_RED_DIAMOND; the gem-type argument is
    // not visible in the decompile), kill it (FUN_0040342b, no death
    // sound), play DAT_004fed70 SOUND_CHICK_TO_RED_DIAMOND and add the
    // IMAGE_SPELL effect at its position.
    _onSpellEnd(field) {
        const target = this._pickSpellTarget(field);
        if (!target) return;
        const tx = target.mX, ty = target.mY;
        if (field.spawnGem) field.spawnGem(3 /* DIAMOND_RED */, tx, ty - 20);
        target.die(false);
        if (SOUNDS.SOUND_CHICK_TO_RED_DIAMOND) SOUNDS.SOUND_CHICK_TO_RED_DIAMOND.play();
        this.mSpellFx = { x: tx, y: ty, t: 0 };
    }

    // Spell effect — FUN_0040a3d6:13575-13602: IMAGE_SPELL (DAT_0050000c)
    // drawn centred on the effect point (x - h/2, y - h/2), frame clamped to
    // numFrames-1. Frame-advance rate: UNKNOWN (JS spreads 8 frames over 30 ticks).
    draw(g) {
        super.draw(g);
        const fx = this.mSpellFx;
        if (fx) {
            const img = IMAGES.IMAGE_SPELL;
            if (img && img.img) {
                const fw = img.getCelWidth ? img.getCelWidth() : img.mWidth;
                const fh = img.getCelHeight ? img.getCelHeight() : img.mHeight;
                const numFrames = (img.mNumCols || 1) * (img.mNumRows || 1);
                const frame = Math.min(numFrames - 1, Math.floor(fx.t * numFrames / 30));
                const cols = img.mNumCols || 1;
                const sx = (frame % cols) * fw;
                const sy = Math.floor(frame / cols) * fh;
                g.ctx.drawImage(img.img, sx, sy, fw, fh,
                    fx.x - fh / 2, fx.y - fh / 2, fw, fh);
            }
        }
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
        default:                return new SimpleChick(x, y);
    }
}
