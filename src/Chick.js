// Port of Sexy::Chick and subclasses
// Original vtable: Sexy::Chick at 004dc894
// SimpleChick at 004dc8dc, BroodyChick at 004dc924
// LayerChick at 004dc96c, RoosterChick at 004dc9b4
// MagicChick at 004dd62c, HolyChick at 004dd11c
//
// Verified key addresses (others were mislabels — see DECOMPILED_MAP.md):
//   FUN_004032ca - Chick base constructor (sets state=4 ADULT, age, hunger)
//   FUN_0040344c - Chick::update (the per-tick logic)
//   FUN_0040327c - vtable[5] isActive: state != 6 && state != 0 && stun == 0
//   FUN_00402342 - isWalking: action == 3 || action == 4
//   FUN_00403a3e - food-tier check (foodCounter vs base*5 / base*0xb)
//   FUN_00403a9a - sickness check (age < 3000 sets sick; age >= 5000 clears)
//   FUN_00403e3c - LayerChick canLay (vt[3]); other types' vt[3] = FUN_0040e36f returns 0
//   FUN_00403e7e - LayerChick subclass dispatcher
//   FUN_0040dba2 - LayerChick getEggType (random across 5 weighted types)
//   FUN_0040e36f - "returns 0" stub used as no-op vt[3] for non-layer types
//   FUN_0040e372 - MagicChick vt[15] getCoinType: returns 2 (DiamondBlue).
//                  NOTE: previously described as "getEggType returns magic
//                  egg id" but MagicChick.canLayEggs is false (vt[3] =
//                  FUN_0040e36f returns 0) so getEggType is unused for
//                  magic — vt[15] is the coin-drop type, not egg-lay type.
//   FUN_0040c4d9 - Gem factory (CoinGold/CoinSilver/DiamondBlue/DiamondRed)
//   FUN_004201a0 - default vt[15] coin-type chooser (gold vs silver by food)
//   FUN_00405899 - food base: 700 (level >= 7) or 500 (level < 7)
//   FUN_00405886 - "is level < 7" predicate

import { IMAGES, SOUNDS } from './Res.js';

// Chick types enum - from FUN_00403ec2 switch
export const ChickType = {
    LAYER: 0,    // SimpleChick/LayerChick
    BROODY: 1,   // BroodyChick
    ROOSTER: 2,  // RoosterChick
    MAGIC: 3,    // MagicChick
    HOLY: 4,     // HolyChick
};

// Module-level throttle timestamp for SOUND_CHICK_DEATH. Prevents the death
// sound from clipping into a wall of overlapping plays when multiple chicks
// die within the same handful of ticks (RiskCaseChickFlu sick wave, raven
// wave, wolf pack feeding). 300ms gate.
let _lastDeathSoundT = 0;

// Chick states from decompiled FUN_004032ca, DECOMPILED_MAP.md section 11.
// NOTE: state field at +0x08 vs action field at +0x0C. JS conflates them as mState
// for simplicity, with action subdivided via mAction.
export const ChickState = {
    NEWBORN: 0,    // state +0x08 = 0 (rwg_functions.c:3580)
    ADULT: 4,      // state +0x08 = 4 (default, rwg_functions.c:3480)
    DEATH: 6,      // state +0x08 = 6 (rwg_functions.c:3541)
    BROODING: 0x14, // state +0x08 = 0x14 (BroodyChick sitting, rwg_functions.c:2127)
    // JS-internal action states (kept for visual rendering):
    IDLE: 0x100,
    WALK: 0x101,
    PECK: 0x102,
    SICK_START: 0x103,
    SICK_IDLE: 0x104,
    LAYING: 0x105,
    BROOD_IDLE: 0x107,
    HOLY_SPELL: 0x10c,
};

// Egg types - from FUN_00422228 decompiled constants
export const EggType = {
    WHITE: 0,     // layer eggs
    BLUE: 1,      // magic eggs -> blue diamonds
    RED: 2,       // holy eggs -> red diamonds
    BLACK: 3,     // rooster eggs
    GOLDEN: 4,    // broody eggs -> gold coins
};

export class Chick {
    // Port of Sexy::Chick - vtable at 004dc894
    // Constructor: FUN_0040329b

    constructor(type, x, y) {
        // Offsets verified from DECOMPILED_MAP.md section 11 (FUN_004032ca:3426).
        // Layout: +0=vtable, +4=owner, +8=state, +0xC=action, +0x10=actionDur,
        // +0x14=actionElapsed, +0x18=scaleX, +0x1C=age/lifespan, +0x20=posX, +0x24=posY,
        // +0x28=stun, +0x34=foodCounter, +0x38=hungerTimer, +0x40=sickTimer,
        // +0x44=sickFlag, +0x48=layCooldown.
        this.mType = type;
        this.mX = x;                        // +0x20
        this.mY = y;                        // +0x24
        // mState is set to IDLE at end of ctor — don't bother with the
        // transient NEWBORN value (it's never visible during gameplay).
        // Age/lifespan timer: init = (rand%200)*2 + 0xCE4 (rwg_functions.c:3479).
        // rand%200 = [0,199] → *2 = [0,398] → +3300 (0xCE4) = [3300,3698].
        // Even values only (every-other-tick since the *2 doubling).
        this.mAge = (Math.floor(Math.random() * 200)) * 2 + 0xCE4;
        // Hunger timer: init = 2000 (line 3450)
        this.mHunger = 2000;
        // Sickness flag at +0x44 (deterministic, NOT random) (line 4111-4121)
        this.mIsSick = false;
        // Egg-lay (action 9) and coin-dig (action 2) use SEPARATE cooldown
        // timers in the original (rwg_functions.c:3760-3782):
        //   egg-lay  → in_EAX[0x10] (+0x40), reset to 1500 (lvl<7) / 2000
        //   coin-dig → in_EAX[0x12] (+0x48), reset to 800 (lvl<7) / 1000
        // Conflating them (resetting both on either action) starved coin
        // production — fed layer chicks laid eggs every cycle and never dug
        // coins, making L1's "collect 15 coins" task unwinnable. Keep them
        // independent so a layer chick produces BOTH eggs and coins.
        this.mLayCooldown = 0;   // +0x40 — egg-lay gate
        // Food/seeds-eaten counter at +0x34 (line 3633)
        this.mFoodCounter = 0;
        // Target X/Y at +0x54/+0x58
        this.mTargetX = x;
        this.mTargetY = y;
        // Misc rendering / JS-only fields
        this.mIsAdult = false;
        this.mIsAlive = true;
        this.mAnimTimer = 0;
        this.mStateTimer = 0;
        this.mSpeed = 0.5;
        this.mDirection = Math.random() < 0.5 ? 0 : 1;
        this.mScale = 0.5;          // visual growth, separate from struct +0x18 scaleX
        // Peck/coin-drop cooldown +0x48 (rwg_functions.c:3779). Set to 1000 (or
        // 800 in late game) after each EAT_PECK that spawns a gem.
        this.mPeckCooldown = 0;
        this.mBroodingEgg = null;
        this.mDeathTimer = 0;
        // Seed cluster the chick is heading toward (set by _updateIdle when
        // hungry; cleared on arrival/peck-end).
        this._targetSeeds = null;
        // Idle wait threshold — picked per IDLE entry, refreshed via
        // `_idleWait === undefined` check in _updateIdle. Explicit init keeps
        // V8 hidden-class shape consistent (same pattern as Raven.mScareTimer,
        // HolyChick.mSpellFlashTimer fixes earlier).
        this._idleWait = 60 + Math.floor(Math.random() * 120);
        // mGrowTimer — incremented in update's juvenile-growth branch.
        // Explicit init avoids the `(undefined || 0) + 1` pattern that would
        // require V8 to add the field to the hidden class on first growth tick.
        this.mGrowTimer = 0;
        // Set true when a raven captures this chick mid-flight (Field.js Raven
        // CATCHING → FLYING_OUT). Skips AI updates while carried.
        this.mIsCarried = false;
        // Mood emote — short-lived emoji shown above the chick (♥ on feed,
        // ♪ when laying, etc.). Visible while mEmoteTimer > 0.
        this.mEmote = null;
        this.mEmoteTimer = 0;
        // After-init: enter the IDLE behaviour state. The decompiled "state +0x08 = 4"
        // (ADULT) is just a flag that the chick is past the egg/hatch path; the
        // active behavior switch in our JS port keys on the IDLE/WALK/PECK 0x10x
        // bucket, so we start in IDLE so chicks actually begin wandering.
        this.mState = ChickState.IDLE;
    }

    // FUN_0040344c - Chick::update
    // From DECOMPILED_MAP.md section 11
    update(field) {
        if (!this.mIsAlive) {
            this.mDeathTimer++;
            this.mAnimTimer++;
            return;
        }
        // Carried by a raven — position/state is owned by the Raven; skip AI
        // (matches FUN_00402342 returning 0 for carried/stunned chicks).
        if (this.mIsCarried) {
            this.mAnimTimer++;
            return;
        }

        // Visual growth (JS-port enhancement — original treats chicks as adult on
        // construction with only cosmetic +0x18 scale-x jitter every 1000 ticks
        // per FUN_0040344c:3622-3623). We keep a small juvenile period for nicer
        // visuals — chicks start small and grow to 1.0 over ~800 ticks.
        if (!this.mIsAdult) {
            // Sick juvenile chicks grow at half rate per L43/L44 description:
            // "Your chickens are sick and growing very slowly." The threshold
            // factor is UNKNOWN-exact in decompiled; 0.5× matches the brood
            // slowdown we apply to sick broodies (consistent treatment for
            // all "sick → slower" mechanics).
            const inc = this.mIsSick ? (this.mAnimTimer % 2 === 0 ? 1 : 0) : 1;
            this.mGrowTimer = (this.mGrowTimer || 0) + inc;
            this.mScale = 0.5 + Math.max(0, Math.min(1, this.mGrowTimer / 800)) * 0.5;
            if (this.mGrowTimer >= 800) {
                this.mIsAdult = true;
                this.mScale = 1.0;
            }
        }

        // Per rwg_functions.c:3627-3634:
        //   if vtable[5] (isActive: not death/newborn/stunned) → age (+0x1C)--
        //   AND if walking (FUN_00402342: action 3 or 4)        → hunger (+0x38)--
        // FUN_0040327c (vtable[5]) checks: state != DEATH && state != NEWBORN
        // && stun == 0. Sick chicks ARE active and continue to age — if not
        // cured they die naturally. We gate on mIsAdult to match the NEWBORN
        // semantics (juveniles freeze until they grow into ADULT).
        const isActive = this.mState !== ChickState.DEATH;
        const isWalking = this.mState === ChickState.WALK;
        // A broody actively sitting on a nest doesn't age — JS-port UX
        // enhancement that diverges from the original (FUN_0040327c returns
        // 1 for BROODING state, so the original DOES age sitting broodies).
        // The original cap-related concern is moot now (cap-check at hatch
        // was removed in an earlier iteration), but the gate still helps:
        // a broody with low starting mAge (e.g. ~4000) would otherwise drop
        // to <0 over a 30-tick × 100-tps brood cycle, dying mid-hatch and
        // forcing the player to lose the broody + egg combo with no
        // recourse. The matching Egg.update pause keeps the egg+broody
        // pair frozen in time as a unit.
        const isBrooding = this.mBroodActive === true;
        if (isActive && this.mIsAdult && !isBrooding) {
            this.mAge--;
            if (isWalking) this.mHunger--;
        }
        // Peck/coin cooldown +0x48 decrements every tick (rwg_functions.c:3605-3607)
        if (this.mPeckCooldown > 0) this.mPeckCooldown--;
        // Egg-lay cooldown +0x48 also decrements every tick per chick — verified
        // via FUN_004015f8:716-718, which iterates all chicks and decrements
        // *(chick+0x48) regardless of state. Previously this was decremented
        // only inside _updatePeck, making chicks lay ~20× slower than original.
        if (this.mLayCooldown > 0) this.mLayCooldown--;
        if (this.mEmoteTimer > 0) this.mEmoteTimer--;

        // Death conditions (rwg_functions.c:3635-3638):
        // age (+0x1C) ≤ 0 OR hunger (+0x38) ≤ 0 → death
        if (this.mAge <= 0 || this.mHunger <= 0) {
            this.die();
            return;
        }

        // Sickness — deterministic via age timer thresholds (FUN_00403a9a:4111-4117)
        // Becomes sick when age timer < 3000; recovers when age timer >= 5000.
        // Age starts at 3300-3700 and decrements every active-adult tick, so a
        // healthy adult chick becomes sick after ~3-7 seconds at 100fps if not
        // cured. Cure (FUN_0040490a) bumps age to 5200, breaking the cycle.
        //
        // Sync-state branch covers TWO triggers: the natural age-out path
        // (`!mIsSick && mAge < 3000`) AND the force-sick path used by
        // RiskCaseChickFlu / mSicknessFactor (which set `mIsSick = true`
        // directly without state transition). Both should converge on
        // SICK_START + ✗ emote. Previously only the age path transitioned
        // state, so a force-sickened chick at mAge>=3000 stayed in IDLE/WALK
        // with just the "!" overlay — no slumped pose, no cough emote.
        const justSickened = this.mIsSick
            && this.mState !== ChickState.SICK_START
            && this.mState !== ChickState.SICK_IDLE;
        if ((!this.mIsSick && this.mAge < 3000) || justSickened) {
            this.mIsSick = true;
            this.setState(ChickState.SICK_START);
            // Mood cue — the slump-pose change is subtle especially when the
            // chick is far from the player's gaze. A short coughing emote
            // catches attention so the player can click to cure before death.
            this._emote('✗', '#ff4040', 80);
        }
        // Auto-recovery — FUN_00403a9a:4115-4121. Threshold is level-conditional
        // (FUN_00405886 returns 1 for level<7): age >= 4500 for early levels,
        // age >= 5000 for level>=7. Reachable via MagicChick eating a magic
        // egg (line 961) which can push age up to 5000. Without this, a sick
        // magic chick that eats a magic egg stays sick despite the age refresh.
        const lvl = (field && field.mFieldController) ? field.mFieldController.mCurrentLevel : 7;
        const recoverThreshold = lvl < 7 ? 4500 : 5000;
        if (this.mIsSick && this.mAge >= recoverThreshold) {
            this.mIsSick = false;
            if (this.mState === ChickState.SICK_START || this.mState === ChickState.SICK_IDLE) {
                // Same broody-aware transition as cure() — sick broody on
                // nest naturally recovering should return to BROOD_IDLE, not
                // IDLE, since the brooding (mBroodActive) is still active.
                const nextState = this.mBroodActive
                    ? ChickState.BROOD_IDLE
                    : ChickState.IDLE;
                this.setState(nextState);
            }
            // Visible cured cue — same emote the manual cure() uses, so the
            // player sees natural age-based recovery happened (otherwise the
            // chick silently flips from sick to healthy with no indication).
            this._emote('✓', '#5cff5c', 60);
        }

        // State machine - FUN_004032ca
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
            case ChickState.SICK_START:
                // sick_start.jpg is 858x78 → 11 frames × 6 = 66 tick animation.
                // `>= 66` (not `> 66`) so we transition exactly when the
                // (mAnimTimer/6) % 11 frame index would wrap from 10 back to 0,
                // avoiding a 1-tick flash of frame 0 of sick_start before the
                // chick settles into SICK_IDLE.
                if (this.mStateTimer >= 66) {
                    this.setState(ChickState.SICK_IDLE);
                }
                break;
            case ChickState.SICK_IDLE:
                // Stays sick until cured
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
                // spell.jpg is 15 frames × 6 ticks/frame = 90-tick cycle.
                // `>= 90` so we transition right at the wrap point (where
                // (mAnimTimer/6) % 15 = 0 again) — without this the spell
                // flash anim restarts from frame 0 for 1 tick before fading out.
                if (this.mStateTimer >= 90) {
                    this.setState(ChickState.IDLE);
                }
                break;
        }

        // Egg laying — FUN_00403e3c (LayerChick) line 4550.
        // Original gates on FUN_00403a3e returning ≥1 i.e. foodCounter ≥ base*5
        // where base = FUN_00405899 ≈ 700. Our food scale uses 30 per peck and
        // a cap/threshold ratio matching the decompiled 33:5 (cap 0x21, lay 5):
        //   cap   = 200*scale (~7 pecks)
        //   lay   = 100*scale (~4 pecks)  — must be < cap so chicks can lay
        // mLayCooldown decrement moved to main update() — FUN_004015f8 ticks
        // it every frame per chick, not just during PECK.
        //
        // mIsAdult gate (not mScale) matches FUN_00403e3c:4563 which calls
        // vtable[5] = FUN_0040327c — returns 0 for state == NEWBORN. Our
        // earlier mScale >= 0.85 cutoff let sub-adult chicks lay during their
        // final 240 growth ticks (mGrowTimer 560-800), which the original
        // disallows entirely.
        if (this.mIsAdult && !this.mIsSick
            && this.mLayCooldown === 0
            && this.mFoodCounter >= 100 * this.mScale
            && this.canLayEggs()) {
            this.layEgg(field);
        }
    }

    // Subclasses override — Chick base, Simple, Rooster, Holy: false. Layer/Magic: true.
    canLayEggs() {
        return false;
    }

    // FUN_004032ca sub-states
    _updateIdle(field) {
        // Eat seeds when hungry, or if there's a nearby cluster while idle.
        // FUN_00403a3e: returns 0 if food < base*5 (very hungry), 1 if < base*11,
        // 2 otherwise. We use scaled thresholds for our smaller food cap.
        const urgent = this.mFoodCounter < (this.mScale || 1) * 50;
        if (field) {
            const seeds = field.getNearestSeeds(this.mX, this.mY);
            if (seeds) {
                const dx = seeds.mX - this.mX;
                const dy = seeds.mY - this.mY;
                const near = (dx * dx + dy * dy) < 80 * 80;
                if (urgent || this.mHunger < 1100 || near) {
                    this.mTargetX = seeds.mX + (Math.random() - 0.5) * 20;
                    this.mTargetY = seeds.mY + (Math.random() - 0.5) * 10;
                    this._targetSeeds = seeds;
                    this.setState(ChickState.WALK);
                    return;
                }
            }
        }

        // Deterministic idle-wait threshold — refreshed on every IDLE entry
        // so the wait time is fixed-per-IDLE-period rather than re-rolled
        // each frame (which made the wait depend on moment-by-moment RNG
        // and produced a non-uniform transition distribution).
        //
        // Chick.update increments mStateTimer BEFORE running the state
        // machine, so `mStateTimer === 1` is the first IDLE tick after a
        // fresh setState(IDLE). Previously checked `=== 0` which never
        // fired (timer was already 1) — _idleWait stayed at its constructor
        // init value across consecutive IDLE entries, so the wait period
        // could already be expired when re-entering IDLE → instant
        // transition flicker.
        if (this.mStateTimer === 1) {
            this._idleWait = 60 + Math.floor(Math.random() * 120);
        }
        if (this.mStateTimer > this._idleWait) {
            const r = Math.random();
            if (r < 0.4) {
                // Use the cell-occupancy picker (FUN_004046aa)
                if (field && field.pickRandomTarget) {
                    const t = field.pickRandomTarget(this.mX, this.mY);
                    this.mTargetX = t.x;
                    this.mTargetY = t.y;
                } else {
                    this.mTargetX = 100 + Math.random() * 600;
                    this.mTargetY = 380 + Math.random() * 180;
                }
                this._targetSeeds = null;
                this.setState(ChickState.WALK);
            } else if (r < 0.7) {
                this.setState(ChickState.PECK);
            } else {
                // Stay idle — reset mStateTimer to 0 so we re-enter IDLE
                // cleanly. The mStateTimer===1 check above re-rolls
                // _idleWait on the next tick, so we don't need to roll it
                // here too (previously did both, but the explicit roll was
                // overwritten by the entry-check roll next tick anyway).
                this.mStateTimer = 0;
            }
        }
    }

    _updateWalk(field) {
        // If we were heading for seeds that are now empty/dead, drop target
        // and let _updateIdle re-evaluate (seek other seeds or just wander).
        if (this._targetSeeds && (!this._targetSeeds.mIsAlive || !this._targetSeeds.hasFood())) {
            this._targetSeeds = null;
            this.setState(ChickState.IDLE);
            return;
        }
        const dx = this.mTargetX - this.mX;
        const dy = this.mTargetY - this.mY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 5) {
            // Arrived at target — if walking to seeds, start pecking/eating
            if (this._targetSeeds && this._targetSeeds.hasFood()) {
                this.setState(ChickState.PECK);
                return;
            }
            this.setState(ChickState.IDLE);
            return;
        }
        // Safety timeout — if walking too long without arriving (e.g. target
        // clipped against the field clamp), give up and re-idle.
        if (this.mStateTimer > 600) {
            this._targetSeeds = null;
            this.setState(ChickState.IDLE);
            return;
        }

        this.mDirection = dx > 0 ? 0 : 1; // 0=right(flip needed), 1=left(natural)
        this.mX += (dx / dist) * this.mSpeed;
        this.mY += (dy / dist) * this.mSpeed;
        // Clamp to field bounds — keep chickens out of HUD and off-screen
        this.mX = Math.max(80, Math.min(720, this.mX));
        this.mY = Math.max(370, Math.min(580, this.mY));
        // Dust puff every ~30 ticks (about every footstep) — only adults
        // make visible dust to avoid spam from juveniles. mStateTimer is
        // always ≥ 1 here (Chick.update increments before the state machine
        // and setState resets to 0 → next tick is 1), so the previous
        // `mStateTimer > 0` guard was always true — dropped it.
        if (this.mIsAdult && this.mStateTimer % 30 === 0
            && field && field.mFieldController
            && field.mFieldController.addParticleBurst) {
            const fc = field.mFieldController;
            for (let i = 0; i < 3; i++) {
                fc.mParticles.push({
                    x: this.mX + (Math.random() - 0.5) * 12,
                    y: this.mY - 2,
                    vx: -((dx / dist) * 0.4) + (Math.random() - 0.5) * 0.3,
                    vy: -0.2 - Math.random() * 0.3,
                    color: '#cdb98a',
                    t: 0, life: 18, gravity: 0.04,
                    size: 1.5 + Math.random() * 1.5,
                });
            }
        }
    }

    _updatePeck(field) {
        // If there are seeds nearby, eat them
        if (this._targetSeeds && this._targetSeeds.hasFood() && this.mStateTimer % 12 === 0) {
            const cal = this._targetSeeds.eatOne();
            if (cal > 0) this.feed(cal);
        }
        // Peck cooldown is decremented in update() once per tick.

        // peck.jpg is 624x78 → 8 frames at 6 ticks each = 48-tick cycle.
        if (this.mStateTimer > 48) {
            this._targetSeeds = null;
            // Spawn a coin/gem from the peck per FUN_0040c4d9 (rwg_functions.c:3769-3779).
            // Original: when EAT_PECK fires AND cooldown +0x48 == 0 AND not sick,
            // spawn a gem and reset cooldown to 800-1000 ticks. Per FUN_00405886
            // + formula at 3779: level<7 → 800 ticks, level>=7 → 1000 ticks.
            // Level-config gate: noPeckCoins disables coin drops entirely.
            // Per L37 description: "Your chickens won't find any coins for
            // you" — set via FUN_00423e5a:43988 (`*(*(this+0x28)+0x1c) = 1`).
            // mIsAdult gate matches original NEWBORN exclusion: the peck-coin
            // path in FUN_0040344c:3769 only fires when the chick's action is 2
            // (a state reached only after NEWBORN→ADULT transition). Without
            // this gate, juvenile chicks (mScale<1) drop coins at lower food
            // thresholds than adults due to mScale-scaled getCoinType cap —
            // an exploit where rapid hatching pre-adulthood out-earned adult
            // labor.
            const fcCfg = field.mFieldController && field.mFieldController.mLevelConfig;
            const peckCoinsDisabled = fcCfg && fcCfg.noPeckCoins;
            if (this.mIsAdult && this.mPeckCooldown === 0 && !this.mIsSick
                && field && !peckCoinsDisabled) {
                const type = this.getCoinType();
                field.spawnGem(type, this.mX, this.mY - 20);
                const lvl = field.mFieldController
                    ? field.mFieldController.mCurrentLevel : 1;
                // Coin-dig cooldown (+0x48), independent of the egg-lay
                // cooldown (+0x40). 800 ticks (lvl<7) / 1000 — per
                // rwg_functions.c:3778-3779. Do NOT touch mLayCooldown here:
                // digging a coin and laying an egg are separate actions with
                // separate timers in the original.
                this.mPeckCooldown = lvl < 7 ? 800 : 1000;
            }
            this.setState(ChickState.IDLE);
        }
    }

    // Per-type gem dropped from a peck. FUN_0040c4d9 type-id mapping
    // (rwg_vtables.txt: CoinGold=0, CoinSilver=1, DiamondBlue=2, DiamondRed=3).
    // Default vtable[15] = FUN_004201a0: returns 0 when food ratio > threshold
    // (well-fed → gold), else 1 (silver). MagicChick overrides to return 2.
    getCoinType() {
        const cap = Math.max(1, Math.floor(200 * (this.mScale || 1)));
        const ratio = this.mFoodCounter / cap;
        return ratio > 0.5 ? 0 : 1;
    }

    // Egg-lay (action 9) — enter lay state, choose type, spawn egg.
    // Egg-lay cooldown (+0x40) reset to 1500 (lvl<7) / 2000 per
    // rwg_functions.c:3764 (`(-(uint)(lvl<7) & 0xfffffe0c) + 2000` →
    // 2000-500=1500 early, 2000 late). This is SEPARATE from the coin-dig
    // cooldown (+0x48 / mPeckCooldown) — laying an egg must NOT block
    // digging a coin, otherwise fed layer chicks never produce coins and the
    // L1 coin task is unwinnable.
    layEgg(field) {
        if (!field) return;
        this.setState(ChickState.LAYING);
        const lvl = field.mFieldController ? field.mFieldController.mCurrentLevel : 1;
        this.mLayCooldown = lvl < 7 ? 1500 : 2000;
        this.mFoodCounter = 0;             // food consumed by laying
        // Re-roll up to 31 times if the chosen egg type isn't allowed on this
        // level — matches the FUN_0040dba2 retry loop. Levels without
        // hasMagicHoly should never produce blue (magic) or red (holy) eggs,
        // and only ravens-active levels surface black (rooster) eggs.
        const cfg = field.mFieldController && field.mFieldController.mLevelConfig;
        let type = this.getEggType();
        if (cfg) {
            const blocked = (t) => {
                if ((t === EggType.BLUE || t === EggType.RED) && !cfg.hasMagicHoly) return true;
                if (t === EggType.BLACK && !cfg.hasRavens) return true;
                return false;
            };
            for (let i = 0; i < 31 && blocked(type); i++) {
                type = this.getEggType();
            }
            if (blocked(type)) type = EggType.WHITE; // last-resort fallback
        }
        field.spawnEgg(this.mX, this.mY, type);
        this._emote('♪', '#ffd700', 80);
        // Throttle egg-lay chime — late-game with 10+ laying chicks could
        // produce multiple simultaneous plays on the same tick, drowning the
        // soundscape in chirps. Per-field cooldown matches the sick-sound
        // throttle pattern in FieldController.update.
        const fc = field.mFieldController;
        if (SOUNDS.SOUND_EGG_LAYERED1 && (!fc || !fc.mLaySoundCd || fc.mLaySoundCd <= 0)) {
            (Math.random() < 0.5 ? SOUNDS.SOUND_EGG_LAYERED1 : SOUNDS.SOUND_EGG_LAYERED2).play();
            if (fc) fc.mLaySoundCd = 25; // ~0.25s
        }
    }

    _emote(symbol, color, duration) {
        // Store the duration so draw() can compute a normalized fade-out
        // alpha. Previous draw hardcoded `/80` which over-faded short
        // emotes (60-tick feed/cure ones) — alpha clamped to 1 for half
        // their life then linearly to 0.
        this.mEmote = { symbol, color, max: duration };
        this.mEmoteTimer = duration;
    }

    _updateLaying(field) {
        // layer.jpg is 1560x78 → 20 frames at 6 ticks each = 120-tick cycle.
        // `>= 120` transitions out at the wrap point ((mAnimTimer/6) % 20 = 0)
        // so the lay anim ends cleanly on frame 19 rather than flashing frame 0
        // again for one tick.
        if (this.mStateTimer >= 120) {
            this.setState(ChickState.IDLE);
        }
    }

    _updateBrooding(field) {
        // Broody-specific - only BroodyChick
    }

    _updateBroodIdle(field) {
        // Broody sitting on egg
    }

    // Override in subclass
    getEggType() {
        return EggType.WHITE;
    }

    setState(state) {
        this.mState = state;
        this.mStateTimer = 0;
        // Reset mAnimTimer for state-bound one-shot animations so they start
        // at frame 0 rather than wherever the continuous timer happened to
        // land. Continuous-loop states (IDLE/WALK/PECK/SICK_IDLE/BROOD_IDLE)
        // keep their existing timer so the animation doesn't visibly judder
        // each time the chick transitions back into them.
        if (state === ChickState.SICK_START
            || state === ChickState.LAYING
            || state === ChickState.HOLY_SPELL
            || state === ChickState.DEATH
            || state === ChickState.BROODING
            || state === ChickState.BROOD_IDLE) {
            // One-shot states reset the timer so animations start fresh.
            // BROOD_IDLE included so the on_nest breathing loop starts at
            // frame 0 after the sit_down → settled transition (rather than
            // continuing from mAnimTimer=60+ which started on a mid-loop frame).
            this.mAnimTimer = 0;
        }
    }

    // ravenAttack — fired when a raven escapes off-screen carrying this chick.
    // Per-chick proximity protection was a JS-only experiment; the original
    // uses GLOBAL rooster headcount via raven-spawn-rate scaling instead.
    ravenAttack() {
        this.die();
        return true;
    }

    die() {
        // Idempotent — guard against double-call (e.g. age + hunger both
        // triggering on the same tick, or ravenAttack + age-out racing).
        // Without this, the death sound would double-play and mDeathTimer
        // would reset, extending the corpse's visible time on screen.
        if (!this.mIsAlive) return;
        this.mIsAlive = false;
        // Use setState (not direct assignment) so the death animation timer
        // resets to 0. Direct mState assignment bypassed the centralized
        // mAnimTimer reset, making death animations start mid-cycle on
        // whatever frame the chick's mAnimTimer happened to land on (often
        // frame 10+ after long walks → only the tail end of the death anim
        // was visible).
        this.setState(ChickState.DEATH);
        this.mDeathTimer = 0;
        // Module-level throttle on the death sound — mass-death events
        // (RiskCaseChickFlu sick wave, raven wave, wolf pack) could stack
        // many SOUND_CHICK_DEATH plays into a clipped overlap. Gate via a
        // shared timestamp so any death within 300ms of a prior plays once.
        const now = Date.now();
        if (SOUNDS.SOUND_CHICK_DEATH && (now - _lastDeathSoundT) > 300) {
            SOUNDS.SOUND_CHICK_DEATH.play();
            _lastDeathSoundT = now;
        }
    }

    // FUN_0041ff9a:39571 — eating credits food counter and resets hunger.
    // FUN_00403403:3521 — hunger reset to 2000 post-eat.
    // Original adds (calories * 3) / 2 (rwg_functions.c:17657).
    feed(calories) {
        // Guard against zero/negative calories — defensive, symmetric with
        // addMoney/spendMoney guards. A bug elsewhere passing 0 cal would
        // play the heart emote + reset hunger without actually feeding.
        if (!(calories > 0)) return;
        this.mFoodCounter += Math.floor(calories * 1.5);
        // Cap = base * 0x21 (=200*scale in our normalised scale).
        const cap = Math.floor(200 * this.mScale);
        if (this.mFoodCounter > cap) this.mFoodCounter = cap;
        // Lifespan bump — FUN_0041ff9a:39569 adds the seed cluster's calories
        // to the chick's age timer (+0x1c). Previously we only refilled
        // hunger and food counter, so eating didn't extend lifespan and
        // chicks died from age (~33-37s at default mAge=3300-3698) regardless
        // of feeding. Per the decompiled, each grain eaten extends mAge by
        // the cluster's calories value (mSeedCalories: 30 base, 50/80 with
        // seeds upgrades). With seed eating, lifespan can grow well beyond
        // the 5000 recovery threshold, keeping chicks healthy.
        this.mAge += calories;
        // Only refresh the heart emote if it's NOT already showing — avoids
        // resetting the 60-tick timer on every grain (4 grains per peck cycle
        // would otherwise keep the heart visible indefinitely; one heart per
        // peck cycle is the intended cue).
        if (!(this.mEmoteTimer > 0 && this.mEmote && this.mEmote.symbol === '♥')) {
            this._emote('♥', '#ff66aa', 60);
        }
        // Hunger fully reset to 2000 (line 3521)
        this.mHunger = 2000;
    }

    // Cure sickness — clears the flag and bumps age above the recovery
    // threshold (FUN_00403a9a:4111-4121: sick clears when age ≥ 5000).
    cure() {
        if (this.mIsSick) {
            this.mIsSick = false;
            this.mAge = Math.max(this.mAge, 5200);
            // Pick the post-cure state based on what the chick was doing
            // BEFORE getting sick. Sick broodies stay anchored to their egg
            // (BroodyChick.update is gated on mBroodActive, not state), so
            // unconditionally transitioning to IDLE would show the broody in
            // a standing pose while still magically anchored to the egg —
            // visually confusing. BROOD_IDLE keeps the on-nest sprite.
            const nextState = this.mBroodActive
                ? ChickState.BROOD_IDLE
                : ChickState.IDLE;
            this.setState(nextState);
            this._emote('✓', '#5cff5c', 60);
            if (SOUNDS.SOUND_CURED) SOUNDS.SOUND_CURED.play();
        }
    }

    // Sell pricing lives in ShopDialogs.sellPrice (uses verified DAT_0050035c
    // SELL_BASE + DAT_0050033c BUY_MID per FUN_00403bd6:4245). No Chick-side
    // helper — keeping a duplicate here drifted from the real table.

    // Get the image set for this chick type
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

    // Draw — verified per chick image research (2026-05-06).
    // Action→image mapping from FUN_0040a166 (rwg_functions.c:12962-13030):
    //   default → IDLE0 per type
    //   action 2 → IDLE1 per type
    //   action 3,5 → IMAGE_CHICK_LAYER_LAYER (singleton, not per-type)
    //   action 4 → IMAGE_CHICK_PREVIEW_LAYER (singleton)
    //   action 9 → IMAGE_CHICK_DEATH_LAYER (singleton, no per-type variants exist)
    //   action 10 → PECK per type
    //   action 0xb → WALK per type
    //   action 0xc → IMAGE_CHICK_HOLY_SPELL (singleton)
    //   action 0xd → SICK_IDLE per type
    //   SICK_START is per-type (DAT_00500604[type])
    draw(g) {
        const prefix = this.getImagePrefix();
        let img = null;

        switch (this.mState) {
            case ChickState.IDLE:
                img = IMAGES[`IMAGE_CHICK_IDLE0_${prefix}`];
                break;
            case ChickState.WALK:
                img = IMAGES[`IMAGE_CHICK_WALK_${prefix}`];
                break;
            case ChickState.PECK:
                img = IMAGES[`IMAGE_CHICK_PECK_${prefix}`];
                break;
            case ChickState.SICK_START:
                // SICK_START is per-type (DAT_00500604[type]) in the decompiled,
                // but only the LAYER variant ships as an asset in this build.
                // Fall back to IMAGE_CHICK_SICK_START_LAYER for non-layer sick
                // chicks so the player sees a clear visual cue (slumped pose +
                // sickness frames) instead of a regular IDLE0 plus only the
                // floating '!' marker — the body would look healthy otherwise.
                img = IMAGES[`IMAGE_CHICK_SICK_START_${prefix}`]
                    || IMAGES.IMAGE_CHICK_SICK_START_LAYER;
                break;
            case ChickState.SICK_IDLE:
                img = IMAGES[`IMAGE_CHICK_SICK_IDLE_${prefix}`]
                    || IMAGES.IMAGE_CHICK_SICK_IDLE_LAYER;
                break;
            case ChickState.LAYING:
                // Singleton — only LAYER variant exists in original (DAT_00500644).
                img = IMAGES[`IMAGE_CHICK_LAYER_LAYER`];
                break;
            case ChickState.BROODING:
                // Brief "sit down on the egg" transition animation per
                // FUN_0040a166 action 7 (BROOD-START). Falls back to the
                // settled-on-nest sprite if sit_down.jpg isn't loaded yet.
                img = IMAGES[`IMAGE_CHICK_BROOD_START_BROODY`]
                    || IMAGES[`IMAGE_CHICK_BROOD_IDLE_BROODY`];
                break;
            case ChickState.BROOD_IDLE:
                img = IMAGES[`IMAGE_CHICK_BROOD_IDLE_BROODY`];
                break;
            case ChickState.DEATH:
                // Per-type death sprite if available, fallback to LAYER.
                // (Earlier comment claimed singleton but Res.js loads all 5.)
                img = IMAGES[`IMAGE_CHICK_DEATH_${prefix}`]
                    || IMAGES.IMAGE_CHICK_DEATH_LAYER;
                break;
            case ChickState.HOLY_SPELL:
                img = IMAGES[`IMAGE_CHICK_HOLY_SPELL`];
                break;
        }
        // Fallback to LAYER when per-type asset missing for this type
        if (!img) img = IMAGES[`IMAGE_CHICK_IDLE0_${prefix}`] || IMAGES.IMAGE_CHICK_IDLE0_LAYER;

        if (img && img.img) {
            const celW = img.getCelWidth();
            const celH = img.getCelHeight();
            const numFrames = img.mNumCols * img.mNumRows;
            // Death animation is a one-shot: hold the final frame after the
            // 84-tick cycle rather than looping back to frame 0. Without this
            // the dead chick would briefly come back to life visually during
            // ticks 85-90 (frame 0 reappearing as anim wraps).
            let frame;
            if (this.mState === ChickState.DEATH && numFrames > 1) {
                frame = Math.min(numFrames - 1, Math.floor(this.mAnimTimer / 6));
            } else {
                frame = numFrames > 1 ? Math.floor(this.mAnimTimer / 6) % numFrames : 0;
            }

            // Draw shadow UNDER the chicken (at feet level)
            // From decompiled: y = chickenY - shadow.height/2, centered horizontally
            // Only when alive and not in death state (piVar13[2] != 6).
            // Skip when carried by a raven — the chick is in mid-air; drawing
            // the shadow at the chick's airborne mY made it appear as a giant
            // ground shadow flying along with the chick (broken depth cue).
            const shadowImg = IMAGES.IMAGE_SHADOW;
            if (this.mIsAlive && !this.mIsCarried
                && this.mState !== ChickState.DEATH
                && shadowImg && shadowImg.img) {
                // Scale shadow with chick size — juveniles (mScale=0.5..1.0)
                // get a proportionally smaller shadow so their footprint
                // visually matches their body. Previously full-size shadow
                // under tiny juvenile = "floating" appearance.
                const baseW = shadowImg.mWidth || 64;
                const baseH = shadowImg.mHeight || 34;
                const sw = baseW * this.mScale;
                const sh = baseH * this.mScale;
                g.ctx.drawImage(shadowImg.img, this.mX - sw / 2, this.mY - sh / 2, sw, sh);
            }

            // Draw the chicken sprite. Use a clean canvas matrix transform:
            //   translate to chick anchor (feet centered on mX, mY)
            //   apply horizontal flip if facing right (mDirection=0)
            //   scale to mScale (juveniles draw smaller)
            //   draw the cell at (0, 0) so the matrix handles positioning.
            const ctx = g.ctx;
            ctx.save();
            const sx = this.mDirection === 0 ? -this.mScale : this.mScale;
            ctx.translate(this.mX, this.mY);
            ctx.scale(sx, this.mScale);
            // After flip, +X is to the chick's left in image coords, so center
            // the cell at (-celW/2, -celH) so its feet sit at (mX, mY).
            const cols = img.mNumCols || 1;
            const srcX = (frame % cols) * celW;
            const srcY = Math.floor(frame / cols) * celH;
            ctx.drawImage(img.img, srcX, srcY, celW, celH,
                -celW / 2, -celH, celW, celH);
            ctx.restore();

            // Hunger indicator (FUN_00422802). Original threshold: foodCounter
            // shortage; here approximated by hunger timer < 600 (severe).
            if (this.mHunger < 600 && this.mIsAlive) {
                const hungryImg = IMAGES.IMAGE_CHICK_HUNGRY;
                if (hungryImg && hungryImg.img) {
                    const hFrame = Math.floor(this.mAnimTimer / 10) % (hungryImg.mNumCols || 1);
                    g.drawImageCell(hungryImg, this.mX - hungryImg.getCelWidth() / 2,
                        this.mY - celH * this.mScale - hungryImg.getCelHeight() - 4, hFrame);
                }
            }

            // Sick indicator — small red exclamation above the chick when sick.
            // Helps the player spot sick chicks at a glance.
            if (this.mIsSick && this.mIsAlive) {
                const ctx = g.ctx;
                const blink = (Math.floor(this.mAnimTimer / 15) % 2 === 0);
                if (blink) {
                    ctx.fillStyle = '#ff2222';
                    ctx.font = 'bold 18px Arial Black, Arial, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('!', this.mX, this.mY - celH * this.mScale - 6);
                    ctx.textAlign = 'left';
                }
            }

            // Mood emote — bobs and fades over its lifetime.
            if (this.mEmoteTimer > 0 && this.mEmote && this.mIsAlive) {
                const ctx = g.ctx;
                // Fade based on this emote's own duration, not a hardcoded 80.
                const lifeFrac = this.mEmoteTimer / (this.mEmote.max || 80);
                const alpha = Math.min(1, lifeFrac * 2);
                const bob = Math.sin(this.mAnimTimer / 8) * 2;
                ctx.globalAlpha = alpha;
                ctx.fillStyle = this.mEmote.color;
                ctx.font = 'bold 16px Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(this.mEmote.symbol, this.mX,
                    this.mY - celH * this.mScale - 14 + bob);
                ctx.globalAlpha = 1;
                ctx.textAlign = 'left';
            }
        }
    }
}

// FUN_00403ec2 - Chick subclass factory
export class SimpleChick extends Chick {
    // vtable at 004dc8dc
    constructor(x, y) {
        super(ChickType.LAYER, x, y);
    }

    getEggType() {
        return EggType.WHITE;
    }
}

export class LayerChick extends SimpleChick {
    // vtable at 0x004dc96c. Lays eggs via FUN_00403e3c (vt[3]) — DECOMPILED_MAP.md.
    // No explicit constructor — `extends SimpleChick` inherits the default
    // ctor which forwards (x, y) to super(). Previously had a no-op
    // `constructor(x, y) { super(x, y); }` that mirrored exactly that.

    canLayEggs() { return true; }

    // Egg-type chooser FUN_0040dba2 (vt[14], line 16958) — weighted random
    // across 5 buckets. Per the decompiled body the buckets are
    //   local_30[0]=_DAT_004e9388, local_30[1]=_DAT_004e9380,
    //   local_30[2]=_DAT_004e9378, local_30[3]=_DAT_004e9370, local_30[4]=1.0
    // and the random divisor is _DAT_004e9368. Exact threshold VALUES are
    // UNKNOWN in decompiled (only addresses, not contents). Index 1 (magic)
    // is re-rolled when iVar1[0x274] is 0 — gated by hasMagicHoly in our
    // blocked() helper. Up to 31 retries before falling through.
    getEggType() {
        // 5-tier rarity weights are JS-port estimates matching the spirit:
        // most eggs are layer (white), rare special types. Mapping per
        // Field.hatchEgg: WHITE→Layer, BLUE→Magic, RED→Holy,
        // BLACK→Rooster, GOLDEN→Broody.
        const r = Math.random();
        if (r < 0.7)  return EggType.WHITE;     // 70% — Layer (most common)
        if (r < 0.88) return EggType.BLUE;      // 18% — Magic
        if (r < 0.95) return EggType.BLACK;     //  7% — Rooster
        if (r < 0.99) return EggType.RED;       //  4% — Holy
        return EggType.GOLDEN;                  //  1% — Broody (rarest)
    }
}

export class BroodyChick extends Chick {
    // Sexy::BroodyChick vtable at 0x004dc924. Alloc 0x80 bytes (FUN_00403ec2:4670).
    // Subclass-specific fields:
    //   +0x70 smart-ptr to target egg (line 2090, init line 4671)
    //   +0x74 brooding flag (tested 2323)
    //   +0x78 brood-progress timer start
    //   +0x7C brood-progress timer current (bumped by FUN_00403de4:4474)
    constructor(x, y) {
        super(ChickType.BROODY, x, y);
        this.mBroodingEgg = null;       // +0x70
        this.mBroodActive = false;      // +0x74
        this.mBroodProgress = 0;        // +0x7C — increments while sitting
        this.mBroodDuration = 3000;     // ticks to hatch — UNKNOWN exact constant
        this.mWalkingToEgg = false;     // walking-to-target state
    }

    canLayEggs() { return false; }

    // Returns true if this broody is currently sitting on an egg.
    isBroody() { return this.mBroodActive && !!this.mBroodingEgg; }

    update(field) {
        super.update(field);
        if (!field || !this.mIsAlive || this.mIsCarried) return;

        // Active brooding: progress timer increments
        if (this.mBroodActive && this.mBroodingEgg) {
            // Validate target still exists
            if (!this.mBroodingEgg.mIsAlive || this.mBroodingEgg.mCollected) {
                this._endBrooding();
                return;
            }
            // Sit-down → settled transition (BROODING → BROOD_IDLE). The
            // sit_down.jpg animation is 780×78 = 10 frames × 6 ticks/frame
            // = 60 ticks; switch to on_nest (1170×78 = 15 frames) after the
            // sit-down anim completes one pass.
            if (this.mState === ChickState.BROODING && this.mBroodProgress >= 60) {
                // `>= 60` (not `> 60`) so the sit_down one-shot (10 frames × 6
                // ticks = 60 ticks) transitions to BROOD_IDLE at the wrap point,
                // rather than flashing frame 0 of sit_down for 1 tick before
                // switching sprites.
                this.setState(ChickState.BROOD_IDLE);
            }
            // Stay anchored on the egg — even when sick, the broody doesn't
            // abandon the nest. L31 description: "it takes sick birds longer
            // to hatch their eggs" implies slower progress, not zero progress.
            this.mX = this.mBroodingEgg.mX;
            this.mY = this.mBroodingEgg.mY;
            // Increment brood progress (FUN_00403de4:4474). Sick broody
            // progresses at half rate (UNKNOWN exact factor — the description
            // says "longer" without a number, 0.5× is a reasonable middle).
            if (this.mIsSick) {
                if (this.mAnimTimer % 2 === 0) this.mBroodProgress++;
            } else {
                this.mBroodProgress++;
            }
            if (this.mBroodingEgg.mBroodProgress !== undefined) {
                this.mBroodingEgg.mBroodProgress = this.mBroodProgress / this.mBroodDuration;
            }
            if (this.mBroodProgress >= this.mBroodDuration) {
                // Hatch unconditionally — the cap (DAT_0050034c = {5,9,12} per
                // rwg_functions.c:6677-6685) is consulted ONLY at buy time
                // (FUN_xxx:34313-34329 — FUN_00403e23 gates the buy loop on
                // cap). The original brood/hatch path has no cap check, so the
                // farm can briefly exceed cap via hatching; this is intended.
                // Previously we deferred hatch by rewinding mBroodProgress by
                // 30 ticks when aliveCount >= cap — on levels where starter
                // count already equals cap (L4-5: 4 layers + 1 broody = 5,
                // cap=5), this looped forever, so the progress bar filled but
                // never hatched.
                // Hatch into the egg's type
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
                        default: chickType = ChickType.LAYER;
                    }
                    field.addChick(createChick(chickType, ex, ey));
                }
                if (SOUNDS.SOUND_EGG_BROODED) SOUNDS.SOUND_EGG_BROODED.play();
                // Celebration emote on the broody — adds a moment of "I did
                // it" payoff before the broody returns to wandering. Same
                // sparkle palette as the Field.hatchEgg floating text so the
                // two cues feel like one event.
                this._emote('✨', '#ffe07f', 60);
                this._endBrooding();
            }
            return;
        }

        // Walking-to-target: super._updateWalk handles movement via mTargetX/Y;
        // we keep the target locked on the egg and watch for arrival.
        if (this.mWalkingToEgg && this.mBroodingEgg) {
            if (!this.mBroodingEgg.mIsAlive) {
                this.mBroodingEgg._claimedBy = null;
                this.mBroodingEgg = null;
                this.mWalkingToEgg = false;
                // Snap to IDLE so the broody can re-evaluate and pick a new
                // egg next tick. Without this, the chick stays in WALK heading
                // to the dead egg's old position for up to 600 ticks (the
                // _updateWalk safety timeout) — visually weird and during that
                // window the broody ignores newly-laid eggs.
                this.setState(ChickState.IDLE);
                return;
            }
            this.mTargetX = this.mBroodingEgg.mX;
            this.mTargetY = this.mBroodingEgg.mY;
            const dx = this.mBroodingEgg.mX - this.mX;
            const dy = this.mBroodingEgg.mY - this.mY;
            const d2 = dx * dx + dy * dy;
            if (d2 < 144) {
                // Sit on it — start with the brief BROODING (sit_down) anim
                // before settling into BROOD_IDLE (on_nest sprite). Matches
                // the original's BROOD-START → BROOD-SIT progression in
                // FUN_0040a166 actions 7 → 6. SOUND_EGG_BROODED is reserved
                // for the actual hatch event (~10 sec later) — the sit-down
                // moment is silent. The name ("brooded" = past-participle
                // of brood) implies completion.
                this.mBroodActive = true;
                this.mBroodProgress = 0;
                this.mWalkingToEgg = false;
                this.setState(ChickState.BROODING);
                // setState(BROODING) now resets mAnimTimer centrally, so the
                // sit_down animation starts at frame 0.
                if (this.mBroodingEgg.mBrooding !== undefined) {
                    this.mBroodingEgg.mBrooding = true;
                }
            }
            return;
        }

        // Idle: pick the NEAREST egg flagged for brooding. Original iteration
        // order in FUN_004046aa-style scans isn't pinpointed in decompiled,
        // but a nearest-egg pick matches player expectation ("hatch eggs one
        // by one, starting with the closest") and avoids the broody walking
        // past nearer eggs to grab a far one that happened to be earlier in
        // the gem list.
        //
        // Skip juveniles — matches FieldController.startEggBrooding's
        // mIsAdult filter (FC.js:770 in current revision). Without this, a
        // juvenile broody could
        // auto-claim an egg whose adult broody died (cleanup clears
        // _claimedBy but leaves mBrooding=true), bypassing the adult-only
        // gate. The juvenile would eventually grow up before hatch, but the
        // visual of a half-scale chick sitting on an egg is wrong, and the
        // claim-from-juveniles path circumvents the player's intent.
        if (!this.mIsAdult) return;
        // Skip sick broodies — they can't walk to the egg. If a sick broody
        // claims an egg here (sets _claimedBy = this), the next tick's
        // setState(WALK) gets immediately overridden back to SICK_START by
        // the justSickened branch in Chick.update. The egg ends up claimed
        // but never reached, blocking other broodies until the egg expires
        // (40s lifetime). Wait for cure before claiming.
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
            this.setState(ChickState.WALK);
        }
    }

    // Called by FieldController.startEggBrooding when the player clicks an egg box
    startBrooding(egg) {
        if (this.mBroodingEgg && this.mBroodingEgg !== egg) return;
        this.mBroodingEgg = egg;
        this.mWalkingToEgg = true;
        this.mBroodProgress = 0;  // explicit reset for clarity (_endBrooding
                                  // already zeroes this, but a redundant guard
                                  // protects against any future path that
                                  // calls startBrooding without prior end).
        this.mBroodActive = false;
        this.setState(ChickState.WALK);
        if (egg) {
            egg._claimedBy = this;
            this.mTargetX = egg.mX;
            this.mTargetY = egg.mY;
        }
        this._targetSeeds = null;
    }

    _endBrooding() {
        // Release the claim AND reset the egg's visible brood progress so a
        // new broody (or replay of the same egg) starts from a clean bar.
        // Without this the HUD shows stale progress on an unclaimed egg until
        // another broody takes over.
        if (this.mBroodingEgg) {
            this.mBroodingEgg._claimedBy = null;
            if (this.mBroodingEgg.mBroodProgress !== undefined) {
                this.mBroodingEgg.mBroodProgress = 0;
            }
        }
        this.mBroodingEgg = null;
        this.mBroodActive = false;
        this.mBroodProgress = 0;
        this.mWalkingToEgg = false;
        if (this.mState === ChickState.BROOD_IDLE || this.mState === ChickState.BROODING) {
            this.setState(ChickState.IDLE);
        }
    }

    getEggType() {
        return EggType.GOLDEN;
    }
}

export class RoosterChick extends Chick {
    // vtable at 004dc9b4
    constructor(x, y) {
        super(ChickType.ROOSTER, x, y);
    }

    // Rooster protection in the original is GLOBAL via FUN_0040134a:446-461 —
    // it adjusts the raven-spawn probability based on rooster count vs needed
    // (FieldController.update handles this). No per-rooster proximity protection.
    // RoosterChick has no per-tick override here.

    getEggType() {
        return EggType.BLACK;
    }
}

export class MagicChick extends Chick {
    // vtable at 0x004dd62c. Egg-type chooser FUN_0040e372 returns 2 (line 17603).
    // Magic chicks consume magic eggs (egg type 1, BLUE) to gain food
    // (FUN_0041ff9a:39566-39590 — adds +0x24 to +0x1c, +0x34 *= 1.5, capped).
    // Lays magic (BLUE) eggs.
    constructor(x, y) {
        super(ChickType.MAGIC, x, y);
        this.mTargetMagicEgg = null;       // +0x68 — magic-egg target (line 39533)
    }

    // MagicChick vtable[3] = FUN_0040e36f returns 0 — magic chicks DO NOT lay
    // eggs. New magic chicks come only from rare blue eggs laid by LayerChick
    // (FUN_0040dba2 randomly picks blue ~18% of layer's eggs). Magic chicks
    // exist only to consume blue eggs (food + sat) and drop blue diamonds on
    // peck (vtable[15] = FUN_0040e372 returns 2).
    canLayEggs() { return false; }

    // MagicChick vtable[15] = FUN_0040e372 returns 2 (DiamondBlue) — every peck
    // drops a blue diamond instead of a coin (rwg_vtables.txt: 004dd62c[15]).
    getCoinType() { return 2; }

    // FUN_0040e372 (line 17603) returns 2 — magic-egg type id.
    getEggType() {
        return EggType.BLUE;
    }

    update(field) {
        super.update(field);
        if (!field || !this.mIsAlive || this.mIsSick || this.mIsCarried) return;
        // Juveniles can't eat eggs — matches the NEWBORN exclusion pattern
        // used across raven/wolf targeting, lay-egg, peck-coin spawn, and
        // broody-claim. The original's magic-egg eat path (specific function
        // UNKNOWN — `FUN_0041ff9a` cited previously is the SEED-eat helper,
        // not magic-egg) is gated by vtable[5] = FUN_0040327c, which returns
        // 0 for NEWBORN (rwg_functions.c:3371). So juvenile magic chicks
        // never enter the eat path in the original.
        if (!this.mIsAdult) return;
        // Find the NEAREST magic egg to consume (FUN_0041ff9a:39566). First-
        // match-in-list would have the magic chick passively eating only the
        // egg that happens to be earliest in mGems, even when a closer one
        // is right next to it. Nearest-pick mirrors the BroodyChick/Wolf
        // nearest-target fixes earlier in the session.
        if (!this.mTargetMagicEgg || !this.mTargetMagicEgg.mIsAlive) {
            this.mTargetMagicEgg = null;
            let nearestD2 = Infinity;
            for (const g of field.mGems) {
                if (!g.mIsAlive || g.mCollected) continue;
                if (g.mType !== 4 /* EGG */) continue;
                if (g.mEggType !== EggType.BLUE) continue;
                // Don't eat an egg the player has committed to brooding —
                // otherwise a magic chick can race a broody for the same egg
                // and the player loses their brood progress without warning.
                if (g.mBrooding) continue;
                const dx = g.mX - this.mX;
                const dy = g.mY - this.mY;
                const d2 = dx * dx + dy * dy;
                if (d2 < nearestD2) {
                    nearestD2 = d2;
                    this.mTargetMagicEgg = g;
                }
            }
        }
        // Walk toward and consume. Drop the target if it became brooding
        // between when it was cached and now (player clicked brood-it on
        // the egg-box mid-approach).
        if (this.mTargetMagicEgg && this.mTargetMagicEgg.mBrooding) {
            this.mTargetMagicEgg = null;
        }
        if (this.mTargetMagicEgg) {
            const dx = this.mTargetMagicEgg.mX - this.mX;
            const dy = this.mTargetMagicEgg.mY - this.mY;
            const d = dx * dx + dy * dy;
            if (d < 400) {
                // Consume — credit food and reset hunger. The original
                // magic-chick-eat-egg path goes through FUN_0041ff9a (seed
                // eat) with the egg substituted as the cluster — calories
                // come from egg[+0x24]. UNKNOWN exact value in decompiled;
                // 36 (0x24) was a JS-port guess from confusing the offset
                // with the value. The 5000 cap keeps a freshly-cured chick
                // (mAge=5200) from being clamped down — eating shouldn't
                // shorten life. The Math.max guard preserves that property.
                this.mTargetMagicEgg.mIsAlive = false;
                this.mTargetMagicEgg.mCollected = true;
                this.mAge = Math.max(this.mAge, Math.min(this.mAge + 36, 5000));
                // food counter *= 1.5
                const cap = Math.floor(200 * this.mScale);
                this.mFoodCounter = Math.min(cap, Math.floor(this.mFoodCounter * 1.5));
                this.mHunger = 2000;
                this.mTargetMagicEgg = null;
                // Audible cue — SOUND_EAT_EGG asset was previously unused
                // despite being loaded. Magic-chick eating a magic egg is the
                // natural fit per the asset's name and the only egg-eating
                // behavior in the game.
                if (SOUNDS.SOUND_EAT_EGG) SOUNDS.SOUND_EAT_EGG.play();
            }
        }
    }
}

export class HolyChick extends Chick {
    // vtable at 0x004dd11c. Holy spell at vt[8] FUN_0040d8b1 (line 16759).
    // Spell cooldown +0x70 = 6000 ticks (decremented 1/tick by vt[1]
    // FUN_0040d912:16794 → ~60s at 100fps).
    constructor(x, y) {
        super(ChickType.HOLY, x, y);
        this.mSpellCooldown = 6000; // FUN_0040d8b1:16771 sets +0x1c (param[0x1c]) to 6000
        // Explicit init for the same hidden-class reason as Raven.mScareTimer —
        // mSpellFlashTimer is referenced unconditionally each tick by update()
        // (`if (this.mSpellFlashTimer > 0) this.mSpellFlashTimer--;`), set by
        // castSpell(). Implicit undefined worked because `undefined > 0` is
        // false, but explicit init keeps the field shape consistent for
        // V8's optimization.
        this.mSpellFlashTimer = 0;
    }

    update(field) {
        super.update(field);
        // Skip the spell logic for dead or raven-carried chicks — super.update
        // returns early in those cases but the post-super lines here would
        // otherwise still tick the cooldown and (when it hits 0) cast a spell
        // from a dead chick.
        if (!this.mIsAlive || this.mIsCarried) return;
        // Spell-flash visual timer ticks in update (100Hz) so duration is
        // display-fps independent. Previously decremented inside draw().
        if (this.mSpellFlashTimer > 0) this.mSpellFlashTimer--;
        // Decremented in vt[1] (FUN_0040d912:16793-16794)
        if (this.mSpellCooldown > 0) this.mSpellCooldown--;
        // Auto-cast when adult and cooldown expired (FUN_0040d8b1:16770-16775)
        else if (this.mIsAdult && field) {
            this.castSpell(field);
        }
    }

    canLayEggs() { return false; } // Holy chicks don't lay; they cast.

    // FUN_0040d8b1 (line 16773): when state==4 (ADULT) && +0x70==0, cast spell.
    // Effect (per level 26 description "make red gems / 15 magic chickens"):
    // turns nearby coins/silver coins/blue diamonds into a RED diamond.
    castSpell(field) {
        if (this.mSpellCooldown > 0 || !this.mIsAdult) return false;
        // Find nearest non-egg gem FIRST — if no target in range, skip the
        // cast entirely so the cooldown isn't wasted. The original FUN_0040d8b1
        // checks `*(param_1 + 4) != 0` (target field) before setting the
        // cooldown, so a target-less cast is a no-op there too. Without this,
        // holy chicks were silently burning 60s of cooldown for nothing
        // whenever the field was bare of coins/blue diamonds.
        let nearest = null;
        if (field && field.mGems) {
            let bestD = 14400; // 120px squared radius
            for (const g of field.mGems) {
                if (!g.mIsAlive || g.mCollected) continue;
                if (g.mType === 4 /* EGG */) continue;
                if (g.mType === 3 /* DIAMOND_RED */) continue;
                const dx = g.mX - this.mX;
                const dy = g.mY - this.mY;
                const d = dx * dx + dy * dy;
                if (d < bestD) { bestD = d; nearest = g; }
            }
        }
        if (!nearest) return false;
        this.mSpellCooldown = 6000;  // Reset to 6000ms (line 4722)
        this.setState(ChickState.HOLY_SPELL);
        // Visual flash — IMAGE_SPELL (DAT_0050000c)
        this.mSpellFlashTimer = 30;
        if (SOUNDS.SOUND_CHICK_TO_RED_DIAMOND) SOUNDS.SOUND_CHICK_TO_RED_DIAMOND.play();

        // Convert nearest gem to RED diamond.
        if (field && field.spawnGem) {
            {
                const gx = nearest.mX, gy = nearest.mY;
                nearest.mIsAlive = false;
                nearest.mCollected = true;
                field.spawnGem(3 /* DIAMOND_RED */, gx, gy);
            }
        }
        return true;
    }

    getEggType() {
        return EggType.RED;
    }

    // Override draw to overlay spell flash if active
    draw(g) {
        super.draw(g);
        if (this.mSpellFlashTimer > 0) {
            const img = IMAGES.IMAGE_SPELL;
            if (img && img.img) {
                const fw = img.getCelWidth ? img.getCelWidth() : img.mWidth;
                const fh = img.getCelHeight ? img.getCelHeight() : img.mHeight;
                // spell_flash.png is 512x64 = 8 frames at 64x64 (auto-detected
                // mNumCols=8). Previously the 5-arg drawImage(img, x, y, w, h)
                // drew the WHOLE 512x64 source squished into one 64x64 cel —
                // all 8 frames smeared together. Use 9-arg form with a source
                // rect, and advance the frame as the 30-tick timer ticks down
                // so the player sees a proper spell-burst animation.
                const numFrames = (img.mNumCols || 1) * (img.mNumRows || 1);
                // mSpellFlashTimer: 30 → 0 over 30 ticks. Map to frame 0 → 7.
                const elapsed = 30 - this.mSpellFlashTimer;
                const frame = numFrames > 1
                    ? Math.min(numFrames - 1, Math.floor(elapsed * numFrames / 30))
                    : 0;
                const cols = img.mNumCols || 1;
                const sx = (frame % cols) * fw;
                const sy = Math.floor(frame / cols) * fh;
                const alpha = Math.min(1, this.mSpellFlashTimer / 30);
                g.ctx.globalAlpha = alpha;
                g.ctx.drawImage(img.img, sx, sy, fw, fh,
                    this.mX - fw / 2, this.mY - fh - 10, fw, fh);
                g.ctx.globalAlpha = 1;
            }
        }
    }
}

// Maps ChickType to subclass instance — original FUN_00403ec2 (113 lines)
// branches on the type id and allocates the right struct size + vtable.
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
