// Port of Sexy::Pet and subclasses
// Original vtables:
//   Sexy::Pet at 004dca0c
//   Sexy::Mouse at 004dd7a4
//   Sexy::Elephant at 004dca48
//   Sexy::Wolf at 004e191c
//   Sexy::Pet::PetAction at 004dca0c (inner class)
//   Sexy::Mouse::Action at 004dd7e0
//   Sexy::Elephant::Action at 004dca84
//   Sexy::Wolf::Action at 004e1958
//
// Key functions (verified against decompiled):
//   FUN_00407ebf - Elephant constructor (sets vftable + fields including
//                  speed at +0x2c = 1.0f)
//   FUN_0040ebe7 - Mouse constructor (sets vftable + speed +0x2c = 1.0f
//                  + wander timer = (rand%1500)*2 + 1500)
//   FUN_00424be6 - Wolf constructor (sets vftable + speed +0x3c = 1.0f)
//   FUN_00424f19 - Wolf hit handler (HP-=damage, stun=0xf, knockback)
//   FUN_00408052 - Elephant movement helper
//   FUN_0040ef39 - Mouse pickup check (within 2× pet radius)
// (FUN_00407f66, FUN_00424c7f are subclass dispatchers, not Pet logic.)

import { IMAGES, SOUNDS } from './Res.js';

// Pet types
export const PetType = {
    MOUSE: 0,
    ELEPHANT: 1,
    WOLF: 2,
};

// Pet action states
const PetState = {
    IDLE: 0,
    WALK: 1,
    SPECIAL: 2,
};

export class Pet {
    // Port of Sexy::Pet - vtable at 004dca0c
    constructor(type) {
        this.mType = type;              // offset +0x00
        this.mX = 400;                  // offset +0x04
        this.mY = 500;                  // offset +0x08
        this.mTargetX = 400;            // offset +0x0c
        this.mTargetY = 500;            // offset +0x10
        this.mState = PetState.IDLE;    // offset +0x14
        this.mAnimTimer = 0;            // offset +0x1c
        this.mStateTimer = 0;           // offset +0x20
        this.mSpeed = 1.0;              // offset +0x24
        this.mDirection = 1;            // offset +0x28
        // Field.update filters mWolves by `w.mIsAlive`; without an explicit
        // init this was `undefined` (falsy), so every freshly-spawned wolf
        // was filtered out the tick after spawn and never visibly attacked.
        this.mIsAlive = true;
        // mIsActive (offset +0x2c in original) — always true in our port. The
        // original used it to pause specific pets via the Risk system, but we
        // don't have an "inactive pet" code path, so the field is omitted to
        // avoid the impression that it gates anything.
    }

    // Pet base update — anim/state timers + clamp to playable yard.
    // Subclasses override and chain via super.update(field).
    update(field) {
        this.mAnimTimer++;
        this.mStateTimer++;
        // Clamp to field bounds. The `!== undefined` checks here are dead —
        // mX/mY are always defined (set in constructor lines 43-44) — removed
        // to keep the hot-path simple.
        this.mX = Math.max(40, Math.min(760, this.mX));
        this.mY = Math.max(370, Math.min(580, this.mY));
    }

    draw(g) {
        // Override in subclass
    }

    // Helper: draw a small shadow ellipse below the pet at feet level.
    _drawShadow(g, w = 30, h = 8) {
        const ctx = g.ctx;
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        ctx.beginPath();
        ctx.ellipse(this.mX, this.mY + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

export class Mouse extends Pet {
    // Sexy::Mouse vtable at 0x004dd7a4. FUN_0040ebe7 (rwg_functions.c:18227).
    // Alloc 0x50 (80 bytes). State machine wander↔chase per FUN_0040ed90:18397.
    // - Wander timer: (rand%1500)*2 + 1500 ms per FUN_0040ee9e:18519
    // - Chase: picks gem within 2× pet radius (FUN_0040ef39:18616)
    // - Also disperses ravens nearby (FUN_0040c75b at line 18632)
    constructor() {
        super(PetType.MOUSE);
        // FUN_0040ebe7:18253 sets +0x2c (piVar2[0xb]) = 0x3f800000 = 1.0f.
        this.mSpeed = 1.0;
        this.mTargetGem = null;
        // First wander target picked within ~1 sec instead of 15-45 sec —
        // otherwise the mouse just sits at spawn doing nothing while waiting
        // out the full wander interval. Subsequent intervals stay long.
        this.mWanderTimer = 30 + Math.floor(Math.random() * 60);
        this.mScareRadius = 80;
    }

    update(field) {
        super.update(field);
        if (!field) return;

        // Find a gem to chase (within 2× pickup radius). Mouse collects coins
        // and diamonds — not eggs (player must hatch or collect those).
        if (!this.mTargetGem || !this.mTargetGem.mIsAlive) {
            this.mTargetGem = null;
            let minDist = Infinity;
            for (const gem of field.mGems) {
                if (!gem.mIsAlive || gem.mCollected) continue;
                if (gem.mType === 4 /* EGG */) continue;
                const dx = gem.mX - this.mX;
                const dy = gem.mY - this.mY;
                const dist = dx * dx + dy * dy;
                if (dist < minDist) {
                    minDist = dist;
                    this.mTargetGem = gem;
                }
            }
        }

        if (this.mTargetGem) {
            // Chase mode (FUN_0040ede2:18471). Mouse must walk to gem before pickup.
            this.mState = PetState.WALK;
            const dx = this.mTargetGem.mX - this.mX;
            const dy = this.mTargetGem.mY - this.mY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 14) {
                const gem = this.mTargetGem;
                const value = gem.collect();
                if (value > 0 && field.mFieldController) {
                    field.mFieldController.addMoney(value);
                    // Count toward COLLECT_COINS / COLLECT_*_DIAMONDS tasks.
                    if (field.mFieldController._trackCollection) {
                        field.mFieldController._trackCollection(gem);
                    }
                }
                this.mTargetGem = null;
            } else {
                this.mDirection = dx > 0 ? 1 : 0;
                this.mX += (dx / dist) * this.mSpeed;
                this.mY += (dy / dist) * this.mSpeed;
            }
        } else {
            // Wander mode (FUN_0040ee9e:18519)
            this.mWanderTimer--;
            if (this.mWanderTimer <= 0) {
                this.mTargetX = 80 + Math.random() * 640;
                this.mTargetY = 380 + Math.random() * 180;
                this.mWanderTimer = 1500 + Math.floor(Math.random() * 1500) * 2;
                this.mState = PetState.WALK;
            }
            const dx = this.mTargetX - this.mX;
            const dy = this.mTargetY - this.mY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 5) {
                this.mDirection = dx > 0 ? 1 : 0;
                this.mX += (dx / dist) * this.mSpeed * 0.5;
                this.mY += (dy / dist) * this.mSpeed * 0.5;
            } else {
                this.mState = PetState.IDLE;
            }
        }

        // Disperse ravens (FUN_0040c75b). Skip already-SCARED or dead
        // ravens: scare() is idempotent so they're already a no-op, but
        // filtering here avoids the per-raven dx/dy/r² math for ravens that
        // would no-op anyway. Defensive in case scare() gains side effects
        // later (e.g. animation triggers that aren't gated by state).
        if (field.mRavens) {
            for (const raven of field.mRavens) {
                if (!raven.mIsAlive || raven.mState === 3 /* SCARED */) continue;
                const dx = raven.mX - this.mX;
                const dy = raven.mY - this.mY;
                if (dx * dx + dy * dy < this.mScareRadius * this.mScareRadius) {
                    raven.scare();
                }
            }
        }
    }

    draw(g) {
        this._drawShadow(g, 26, 7);
        const img = this.mState === PetState.WALK
            ? IMAGES.IMAGE_PET_WALK_MOUSE
            : IMAGES.IMAGE_PET_IDLE_MOUSE;
        if (img && img.img) {
            const celW = img.getCelWidth();
            const celH = img.getCelHeight();
            const numFrames = img.mNumCols * img.mNumRows;
            const frame = numFrames > 1 ? Math.floor(this.mAnimTimer / 6) % numFrames : 0;
            _drawPetCell(g, img, frame, this.mX, this.mY, celW, celH, this.mDirection);
        }
    }
}

// Helper — draws a pet sprite cell with optional horizontal flip based on
// movement direction (mDirection: 1=heading right, 0=heading left).
// Pet sprites face right by default, so we flip when heading left.
function _drawPetCell(g, img, frame, x, y, celW, celH, dir) {
    const ctx = g.ctx;
    const cols = img.mNumCols || 1;
    const srcX = (frame % cols) * celW;
    const srcY = Math.floor(frame / cols) * celH;
    const flip = dir === 0;
    if (flip) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(-1, 1);
        ctx.drawImage(img.img, srcX, srcY, celW, celH,
            -celW / 2, -celH / 2, celW, celH);
        ctx.restore();
    } else {
        g.drawImageCell(img, x - celW / 2, y - celH / 2, frame);
    }
}

export class Elephant extends Pet {
    // Sexy::Elephant vtable at 0x004dca48. FUN_00407ebf (rwg_functions.c:9951).
    // Alloc 0x44 (68 bytes). VERY slow meander (no active scaring).
    // Effect on ravens (FUN_004104b3(1)) is INDIRECT, applied by spawn logic:
    //  - FUN_00401308:407: max-deduction −5 instead of −1
    //  - FUN_004014eb:593: attack count *= 2/3
    //  - FUN_00401543:648: active attacks capped at 2
    constructor() {
        super(PetType.ELEPHANT);
        // FUN_00407ebf:9976 sets +0x2c (piVar3[0xb]) = 0x3f800000 = 1.0f.
        // Elephant feels "slow" because it picks new targets infrequently,
        // not because of a low speed value.
        this.mSpeed = 1.0;
    }

    update(field) {
        super.update(field);
        if (!field) return;

        // Slow meander (FUN_00408052:10186). No active scare.
        if (this.mState === PetState.IDLE && this.mStateTimer > 200) {
            this.mTargetX = 100 + Math.random() * 600;
            this.mTargetY = 380 + Math.random() * 180;
            this.mState = PetState.WALK;
            this.mStateTimer = 0;
            // Occasional trumpet — sound asset elephant.ogg exists in /sounds/.
            if (SOUNDS && SOUNDS.SOUND_ELEPHANT && Math.random() < 0.25) {
                SOUNDS.SOUND_ELEPHANT.play();
            }
        }
        if (this.mState === PetState.WALK) {
            const dx = this.mTargetX - this.mX;
            const dy = this.mTargetY - this.mY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 5) {
                this.mState = PetState.IDLE;
                this.mStateTimer = 0;
            } else {
                this.mDirection = dx > 0 ? 1 : 0;
                this.mX += (dx / dist) * this.mSpeed;
                this.mY += (dy / dist) * this.mSpeed;
            }
        }
    }

    draw(g) {
        this._drawShadow(g, 60, 14);
        const img = this.mState === PetState.WALK
            ? IMAGES.IMAGE_PET_WALK_ELEPHANT
            : IMAGES.IMAGE_PET_IDLE_ELEPHANT;
        if (img && img.img) {
            const celW = img.getCelWidth();
            const celH = img.getCelHeight();
            const numFrames = img.mNumCols * img.mNumRows;
            const frame = numFrames > 1 ? Math.floor(this.mAnimTimer / 6) % numFrames : 0;
            _drawPetCell(g, img, frame, this.mX, this.mY, celW, celH, this.mDirection);
        }
    }
}

export class Wolf extends Pet {
    // Sexy::Wolf vtable at 0x004e191c.
    // Constructor FUN_00424be6 (rwg_functions.c:45130). Alloc size 0x4c (76 bytes).
    // Field offsets verified per DECOMPILED_MAP (Wolf research):
    //   +0x38 HP (isDead via FUN_00424bb9: HP < 1)
    //   +0x40 stun timer (FUN_00424bc2: 0 < stun)
    //   +0x3c speed (1.0f init, line 45170)
    //   +0x34 target chicken
    //   +0x2c state machine (1=pursuing, 2=at-target)
    //   +0x44/+0x48 knockback velocity offsets
    constructor() {
        super(PetType.WOLF);
        this.mHP = 3;                  // HP — exact init UNKNOWN, picked low (3 hits)
        this.mStun = 0;                // +0x40 stun ticks
        // FUN_00424be6:45160 sets +0x3c (piVar2[0xf]) = 0x3f800000 = 1.0f.
        this.mSpeed = 1.0;
        this.mTargetChick = null;
        this.mEatTimer = 0;
        this.mKnockbackX = 0;
        this.mKnockbackY = 0;
    }

    isDead() { return this.mHP < 1; }
    isStunned() { return this.mStun > 0; }

    // Damage handler — vtable[3] FUN_00424f19 (rwg_functions.c:45439).
    // Sets stun=15 (0xf), drains HP, applies knockback.
    hit(damage = 1, dirX = 0, dirY = -1) {
        // Idempotent — don't re-stun or re-knockback an already-dead wolf
        // (HP < 1 per FUN_00424bb9 isDead). The click handler gates on
        // mIsAlive but there's a one-tick window between HP=0 and the
        // update loop setting mIsAlive=false, and clicks could land here.
        if (this.mHP < 1) return;
        this.mHP -= damage;
        if (this.mHP < 0) this.mHP = 0;
        this.mStun = 15;          // 0xf ticks
        this.mKnockbackX += dirX * 4 * damage;
        this.mKnockbackY += dirY * 4 * damage;
        // No dedicated wolf-hit sound in original; the gunshot (SOUND_SHOOT)
        // plays from the click handler.
    }

    update(field) {
        super.update(field);
        if (!field) return;

        // Stun decrement (FUN_00424cb9:45218 — base update decrements +0x40)
        if (this.mStun > 0) this.mStun--;
        // Velocity decay (rwg_functions.c:45226-45228 with _DAT_004e9268)
        this.mKnockbackX *= 0.85;
        this.mKnockbackY *= 0.85;
        this.mX += this.mKnockbackX;
        this.mY += this.mKnockbackY;
        // Re-clamp after knockback so a hard hit at the edge doesn't push
        // the wolf off-canvas (Pet.update's clamp ran before knockback).
        this.mX = Math.max(40, Math.min(760, this.mX));
        this.mY = Math.max(370, Math.min(580, this.mY));

        if (this.isDead()) {
            // Defeat visual — wolf has no death sprite in the original asset
            // set (only walk + eat), so the kill currently registered as a
            // silent vanish. A particle burst gives the player feedback that
            // their shots paid off.
            const fc = field.mFieldController;
            if (this.mIsAlive && fc && fc.addParticleBurst) {
                fc.addParticleBurst(this.mX, this.mY - 20, '#882222', 22);
                if (fc.addFloatingText) {
                    fc.addFloatingText(this.mX, this.mY - 30, '*DOWN*', '#ff8');
                }
            }
            this.mIsAlive = false;
            // Drop the target reference — defensive cleanup. Without this, a
            // dead wolf holds a reference to the chick it was chasing until
            // the Field.update filter runs at end of tick. If the chick dies
            // and gets filtered before the wolf, the wolf's mTargetChick
            // points to a stale chick that's no longer in mChickens.
            this.mTargetChick = null;
            return;
        }
        if (this.isStunned()) return; // can't act while stunned

        switch (this.mState) {
            case PetState.IDLE:
                if (this.mStateTimer > 60) {
                    this.mTargetChick = null;
                    // Pick NEAREST alive non-rooster non-carried chicken. The
                    // wolf is a predator — going for the closest target is
                    // both more menacing and avoids the wolf running across
                    // the field past nearer prey.
                    let nearestD2 = Infinity;
                    for (const c of field.mChickens) {
                        if (!c.mIsAlive || c.mIsCarried || c.mType === 2 /* ROOSTER */) continue;
                        // Skip juveniles — matches Field.spawnRaven's filter
                        // per the original's vtable[5] isActive gate (state
                        // != NEWBORN, FUN_0040327c:3371). Baby chicks were
                        // never wolf prey in the original; without this gate,
                        // a wolf could chase a newly-hatched half-scale chick.
                        if (!c.mIsAdult) continue;
                        // Skip sitting broody (same reason as Field.spawnRaven —
                        // broody is anchored to its egg and can't be moved/eaten
                        // cleanly while brooding).
                        if (c.mBroodActive) continue;
                        const dx = c.mX - this.mX;
                        const dy = c.mY - this.mY;
                        const d2 = dx * dx + dy * dy;
                        if (d2 < nearestD2) {
                            nearestD2 = d2;
                            this.mTargetChick = c;
                        }
                    }
                    if (this.mTargetChick) {
                        this.mState = PetState.WALK;
                        this.mStateTimer = 0;
                    }
                }
                break;

            case PetState.WALK: {
                if (!this.mTargetChick || !this.mTargetChick.mIsAlive
                    || this.mTargetChick.mIsCarried) {
                    // Drop unreachable target. mIsCarried check: once a raven
                    // grabs the chick, it's at Y~100 (sky) but the wolf clamps
                    // to mY ≥ 370, so the chick is permanently out of reach.
                    // Without this guard, the wolf paces directly under the
                    // raven indefinitely until the raven flies off-screen,
                    // then the chick dies via ravenAttack — but the wolf is
                    // still in WALK state because the dist check never fires.
                    this.mState = PetState.IDLE;
                    this.mStateTimer = 0;
                    this.mTargetChick = null;
                    break;
                }
                const dx = this.mTargetChick.mX - this.mX;
                const dy = this.mTargetChick.mY - this.mY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                this.mDirection = dx > 0 ? 1 : 0;
                if (dist < 15) {
                    // FUN_00424da9 → FUN_0040481d → FUN_0040466e → FUN_00405184
                    // Wolf instantly kills the chicken on contact.
                    this.mState = PetState.SPECIAL;
                    this.mStateTimer = 0;
                    this.mEatTimer = 0;
                    // Reset mAnimTimer so the eat animation (9 frames × 6 ticks
                    // = 54-tick one-shot) plays from frame 0. Without this,
                    // the eat anim starts at whatever mAnimTimer % 9 frame
                    // the wolf's walk-anim had reached — skipping the lunge
                    // frames and starting mid-chew.
                    this.mAnimTimer = 0;
                    const fc = field.mFieldController;
                    if (fc) {
                        if (fc.addShake) fc.addShake(8);
                        if (fc.addParticleBurst) {
                            fc.addParticleBurst(this.mTargetChick.mX,
                                this.mTargetChick.mY, '#cc0000', 18);
                        }
                    }
                    this.mTargetChick.die();
                    if (SOUNDS.SOUND_WOLF) SOUNDS.SOUND_WOLF.play();
                } else {
                    this.mX += (dx / dist) * this.mSpeed;
                    this.mY += (dy / dist) * this.mSpeed;
                }
                break;
            }

            case PetState.SPECIAL:
                this.mEatTimer++;
                // 54 = 9 eat-anim frames × 6 ticks/frame. `>= 54` transitions
                // out the moment mAnimTimer reaches 54, which is when the
                // (mAnimTimer/6) % 9 frame index wraps from 8 back to 0. The
                // previous `> 54` kept SPECIAL for 1-2 extra ticks past the
                // wrap, briefly restarting the eat anim from frame 0 before
                // the wolf disengaged — visible as a tiny "double bite" at
                // the end of the eat sequence.
                if (this.mEatTimer >= 54) {
                    this.mState = PetState.IDLE;
                    this.mStateTimer = 0;
                }
                break;
        }
    }

    draw(g) {
        // Defensive `!mIsAlive` guard. The mWolves filter at Field.update:640
        // (`mWolves.filter(w => w.mIsAlive)`) runs BEFORE Field.draw in the
        // normal frame order, so a dead wolf shouldn't reach this draw call.
        // But the filter and draw live in different functions that could
        // be reordered by a future refactor — keep the guard as a cheap
        // safety net.
        if (!this.mIsAlive) return;
        this._drawShadow(g, 50, 12);
        let img;
        if (this.mState === PetState.SPECIAL) {
            img = IMAGES.IMAGE_PET_SPECIAL_WOLF;
        } else {
            img = IMAGES.IMAGE_PET_WALK_WOLF;
        }
        // Red flash when stunned/hit
        const isHit = this.mStun > 8 && (Math.floor(this.mStun / 3) % 2 === 0);
        if (img && img.img) {
            const celW = img.getCelWidth();
            const celH = img.getCelHeight();
            const numFrames = img.mNumCols * img.mNumRows;
            // For SPECIAL (eating) use mEatTimer, not mAnimTimer, so the eat
            // animation freezes during stun. mAnimTimer ticks in the Pet base
            // update unconditionally, but mEatTimer is gated behind the
            // isStunned() early-return — without this, shooting an eating
            // wolf shows the chew anim still advancing while the wolf is
            // motionless ("eating while stunned").
            const animSrc = (this.mState === PetState.SPECIAL)
                ? (this.mEatTimer || 0)
                : this.mAnimTimer;
            const frame = numFrames > 1 ? Math.floor(animSrc / 6) % numFrames : 0;
            _drawPetCell(g, img, frame, this.mX, this.mY, celW, celH, this.mDirection);
            if (isHit) {
                g.ctx.fillStyle = 'rgba(255,0,0,0.5)';
                g.ctx.fillRect(this.mX - celW / 2, this.mY - celH / 2, celW, celH);
            }
            // HP bar above the wolf — only when hurt (HP < max), so it
            // doesn't add visual noise for fresh wolves. Wolf starts with
            // 3 HP, so the bar appears after the first hit.
            if (this.mHP < 3 && this.mHP > 0) {
                const ctx = g.ctx;
                const barW = 30, barH = 4;
                const bx = this.mX - barW / 2;
                const by = this.mY - celH / 2 - 8;
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                ctx.fillRect(bx, by, barW, barH);
                ctx.fillStyle = '#ff4040';
                ctx.fillRect(bx + 1, by + 1, Math.floor((barW - 2) * (this.mHP / 3)), barH - 2);
            }
        }
    }
}
