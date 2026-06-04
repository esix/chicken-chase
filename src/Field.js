// Port of Sexy::Field - vtable at 004dca8c
// and Sexy::FieldController - vtable at 004dca94
//
// Source-citation note (DOC FIXES — earlier comments were misidentified):
//   Field::draw — exact original FUN_xxxxxxxx UNKNOWN; FUN_00406069 was
//       misidentified (it's a tick-counter / game-loop helper using
//       GetTickCount).
//   FUN_00417990 - resource/sound loader (NOT field update — original loop
//       UNKNOWN)
//   FUN_0041b569 - Sexy::RiskController CONSTRUCTOR (vtable setup +
//       RiskCaseNothing/Offensive/PlusMoney/... initialization at
//       rwg_functions.c:33416-33580). NOT the raven update — previous
//       comment here mis-identified it as "ravenAttack". The actual raven
//       update function is UNKNOWN in decompiled (no Sexy::Raven entry in
//       rwg_vtables.txt; alien/raven sprites referenced only by struct
//       field offsets).
//   FUN_0042207d - L1 introductory hint dispatcher (NOT collectibles).
//   FUN_00422228 - L2-context hint dispatcher (NOT chick growth). Also
//       contains the SICK_CHICKEN hint string at line 42236 ("Your chicken
//       is sick! Click on your chicken to cure it!") — fires on first-sick
//       detection.
//   FUN_00422a24 - periodic hint check (NOT money/scoring).

import { ChickType, EggType, createChick } from './Chick.js';
import { CoinSilver, CoinGold, DiamondBlue, DiamondRed, Egg } from './Gem.js';
import { IMAGES, SOUNDS } from './Res.js';

// Raven states (enemy that steals chickens)
const RavenState = {
    FLYING_IN: 0,
    CATCHING: 1,
    FLYING_OUT: 2,
    SCARED: 3,
};

export class Raven {
    // Raven entity (called "alien" in the original assets — alien_catch.jpg /
    // alien_up.jpg / alien_down.jpg). Original update function UNKNOWN in
    // decompiled (no Sexy::Raven entry in rwg_vtables.txt).
    constructor(targetChick) {
        this.mX = Math.random() < 0.5 ? -50 : 850;
        this.mY = 100 + Math.random() * 100;
        this.mState = RavenState.FLYING_IN;
        this.mTargetChick = targetChick;
        this.mSpeed = 2.0;
        this.mAnimTimer = 0;
        this.mIsAlive = true;
        this.mCarriedChick = null;
        // Explicit init — referenced unconditionally each tick in update()
        // (`if (this.mScareTimer > 0) this.mScareTimer--;`), set by scare().
        // Implicit undefined worked because `undefined > 0` is false, but
        // initializing keeps the field shape consistent for engines that
        // optimize hidden classes (Node/V8) and removes a needless deopt.
        this.mScareTimer = 0;
    }

    update(chickens) {
        if (!this.mIsAlive) return;
        this.mAnimTimer++;
        if (this.mScareTimer > 0) this.mScareTimer--;

        // CORRECTION (2026-05-06): Rooster protection in original is GLOBAL via
        // FUN_0040134a:446-461 — based on rooster count vs needed count (modifies
        // attack probability). NOT per-rooster proximity scaring. The proximity
        // logic here is removed; FieldController.update() now decides whether to
        // spawn ravens at all using the global headcount.

        switch (this.mState) {
            case RavenState.FLYING_IN:
                if (this.mTargetChick && this.mTargetChick.mIsAlive) {
                    const dx = this.mTargetChick.mX - this.mX;
                    const dy = this.mTargetChick.mY - this.mY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 15) {
                        this.mState = RavenState.CATCHING;
                        // Reset mAnimTimer so the 9-frame alien_catch one-shot
                        // (4 ticks/frame = 36-tick anim) plays from frame 0
                        // rather than continuing from wherever the alien_down
                        // flying-in loop happened to land. Same animation-cycle
                        // bug pattern as Wolf SPECIAL and Chick DEATH.
                        this.mAnimTimer = 0;
                    } else {
                        this.mX += (dx / dist) * this.mSpeed;
                        this.mY += (dy / dist) * this.mSpeed;
                    }
                } else {
                    this.scare();
                }
                break;

            case RavenState.CATCHING:
                // First-tick grab logic — captures the chick. Subsequent ticks
                // play out the 9-frame catch animation (alien_catch.jpg = 900x100
                // = 9 frames × 4 ticks/frame = 36 ticks) before transitioning to
                // FLYING_OUT. Without this hold, the catch anim never visibly
                // plays — raven dives, grabs, and immediately ascends in one tick.
                if (this.mCatchTimer === undefined) {
                    // Bail if chick is already carried (concurrent ravens
                    // targeting same chick same-tick race). Without the
                    // `!mIsCarried` guard both ravens would claim the chick
                    // and only the latter's mCarriedChick reference would
                    // survive while the first raven flew off carrying air.
                    if (this.mTargetChick && this.mTargetChick.mIsAlive
                        && !this.mTargetChick.mIsCarried) {
                        this.mCarriedChick = this.mTargetChick;
                        this.mTargetChick.mIsCarried = true;
                        if (SOUNDS.SOUND_KAR_KAR) SOUNDS.SOUND_KAR_KAR.play();
                    }
                    // mTargetChick has fulfilled its purpose (transferred to
                    // mCarriedChick). Clear the now-stale reference so the
                    // raven doesn't hold two pointers to the same chick —
                    // matches the cleanup pattern in Raven.scare() and the
                    // Wolf.isDead branch where the target is nulled once the
                    // pursuit phase ends.
                    this.mTargetChick = null;
                    this.mCatchTimer = 0;
                }
                this.mCatchTimer++;
                // Hold the carried chick at the raven's beak position during the
                // catch anim (otherwise the chick would stay at its old field
                // position visible "underneath" the raven sprite for 36 ticks).
                if (this.mCarriedChick && this.mCarriedChick.mIsAlive) {
                    this.mCarriedChick.mX = this.mX;
                    this.mCarriedChick.mY = this.mY + 20;
                }
                if (this.mCatchTimer >= 36) {
                    this.mState = RavenState.FLYING_OUT;
                    this.mCatchTimer = undefined;
                    // Reset mAnimTimer so the alien_up wing-flap cycle (35
                    // frames × 4 ticks = 140-tick loop) starts at frame 0
                    // — the strong upward stroke that visually sells the
                    // ascend. Without this, FLYING_OUT begins at frame 9
                    // (mAnimTimer carries over from CATCHING's 36-tick hold),
                    // skipping the first quarter of the cycle.
                    this.mAnimTimer = 0;
                }
                break;

            case RavenState.FLYING_OUT:
                this.mY -= this.mSpeed;
                this.mX += this.mX < 400 ? -this.mSpeed : this.mSpeed;
                // Carried chicken follows the raven
                if (this.mCarriedChick && this.mCarriedChick.mIsAlive) {
                    this.mCarriedChick.mX = this.mX;
                    this.mCarriedChick.mY = this.mY + 20;
                }
                if (this.mY < -50) {
                    // Raven escaped — kill the carried chicken now AND clear
                    // the carry flag so the chick's update loop can tick
                    // mDeathTimer (otherwise the early `if (mIsCarried) return`
                    // path keeps the dead chick alive in mChickens forever,
                    // never reaching the filter at mDeathTimer >= 90).
                    if (this.mCarriedChick) {
                        if (this.mCarriedChick.mIsAlive
                            && this.mCarriedChick.ravenAttack) {
                            this.mCarriedChick.ravenAttack();
                        }
                        this.mCarriedChick.mIsCarried = false;
                        this.mCarriedChick = null;
                    }
                    this.mIsAlive = false;
                }
                break;

            case RavenState.SCARED:
                this.mY -= this.mSpeed * 2;
                this.mX += this.mX < 400 ? -this.mSpeed * 2 : this.mSpeed * 2;
                if (this.mY < -50) {
                    this.mIsAlive = false;
                }
                break;
        }
    }

    scare() {
        // Idempotent — re-scaring an already-SCARED raven was double-playing
        // SOUND_KAR_KAR every tick the Mouse pet stayed within scare radius
        // (Pet.js:172-180 calls scare() per-tick without filtering by state),
        // turning the soundscape into a rapid caw-spam. The handleClick path
        // already filters SCARED before calling scare(); apply the same gate
        // here so all callers are safe.
        if (this.mState === RavenState.SCARED) return;
        this._dropCarried();
        this.mState = RavenState.SCARED;
        this.mScareTimer = 30; // brief visual indicator
        // Drop target reference — SCARED state doesn't pursue anything, so
        // holding a stale chick reference until off-screen filter (~1+ sec
        // later) was just deferred GC. Same defensive cleanup pattern as
        // Wolf.update isDead branch.
        this.mTargetChick = null;
        // Play scared/caw sound
        if (SOUNDS.SOUND_KAR_KAR) SOUNDS.SOUND_KAR_KAR.play();
    }

    // Drop the carried chicken back to the field (if any).
    // Per user note: "raven can take chicken and try to fly away but you can still
    // shoot it and return your chicken".
    _dropCarried() {
        if (this.mCarriedChick) {
            // Reposition the chicken at the raven's current ground level
            this.mCarriedChick.mX = this.mX;
            this.mCarriedChick.mY = Math.max(this.mY + 30, 380);
            this.mCarriedChick.mIsCarried = false;
            this.mCarriedChick = null;
        }
    }

    draw(g) {
        if (!this.mIsAlive) return;
        // Subtle shadow on the ground below the raven (depth cue).
        // Project to a ground-level Y at 460 (rough yard floor).
        const ctx = g.ctx;
        const groundY = 460;
        const heightFactor = Math.max(0.2, Math.min(1, 1 - (groundY - this.mY) / 350));
        ctx.fillStyle = `rgba(0,0,0,${0.25 * heightFactor})`;
        ctx.beginPath();
        ctx.ellipse(this.mX, groundY, 24 * heightFactor, 7 * heightFactor, 0, 0, Math.PI * 2);
        ctx.fill();

        // Pulsing red warning ring on the raven's target chick while it's
        // diving in — gives the player a clear "click here!" cue.
        if (this.mState === RavenState.FLYING_IN
            && this.mTargetChick && this.mTargetChick.mIsAlive
            && !this.mTargetChick.mIsCarried) {
            const t = this.mTargetChick;
            const pulse = 1 + Math.sin(this.mAnimTimer / 4) * 0.15;
            const r = 26 * pulse;
            ctx.strokeStyle = `rgba(255,60,60,${0.7 + Math.sin(this.mAnimTimer / 3) * 0.2})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(t.mX, t.mY - 18, r, 0, Math.PI * 2);
            ctx.stroke();
        }

        let img;
        switch (this.mState) {
            case RavenState.FLYING_IN:
                img = IMAGES.IMAGE_ALIEN_DOWN;
                break;
            case RavenState.CATCHING:
                img = IMAGES.IMAGE_ALIEN_CATCH;
                break;
            case RavenState.FLYING_OUT:
            case RavenState.SCARED:
                // SCARED state moves UP-and-outward (mY -= speed*2). Using
                // ALIEN_DOWN here showed a diving sprite while the raven was
                // actually ascending — visually contradictory. ALIEN_UP
                // matches the upward motion, sharing the FLYING_OUT sprite
                // since both are "raven leaving the field" animations.
                img = IMAGES.IMAGE_ALIEN_UP;
                break;
        }
        if (img && img.img) {
            const celW = img.getCelWidth();
            const celH = img.getCelHeight();
            const numFrames = img.mNumCols * img.mNumRows;
            const frame = numFrames > 1 ? Math.floor(this.mAnimTimer / 4) % numFrames : 0;
            g.drawImageCell(img, this.mX - celW / 2, this.mY - celH / 2, frame);
        }
        // Scared visual: !!! above raven (decrement happens in update,
        // not here, so the indicator duration is display-fps independent).
        if (this.mScareTimer > 0) {
            ctx.fillStyle = '#ffff44';
            ctx.font = 'bold 16px Arial Black, Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('!!!', this.mX, this.mY - 30);
            ctx.textAlign = 'left';
        }
    }

    // Click on raven to scare it away (like in the hint text). Hit-box
    // matches the visible raven sprite (~100x100 cell from alien_down.jpg,
    // drawn centered on mX/mY). Previous ±30 covered only the body core,
    // leaving wing tips and tail unclickable.
    contains(x, y) {
        return Math.abs(x - this.mX) < 50 && Math.abs(y - this.mY) < 50;
    }
}

// Seed cluster dropped by the player
export class SeedCluster {
    constructor(x, y, count, calories) {
        // Clamp drop Y to the chick-reachable yard range (370–560).
        // Chicks clamp their position to mY ∈ [370, 580] in _updateWalk, so
        // seeds dropped in the sky (Y < 370) were unreachable — chicks would
        // walk in place at Y=370 forever, hit the 600-tick safety timeout,
        // re-idle, and try again. Reported by user: "chicken went up and stuck,
        // couldn't eat until dead by hunger". Snap seeds to the ground.
        this.mX = Math.max(80, Math.min(720, x));
        this.mY = Math.max(370, Math.min(560, y));
        this.mCount = count;          // number of seed grains
        this.mCalories = calories;    // how much hunger each seed restores
        this.mSeeds = [];             // individual grain positions
        this.mLifeTimer = 0;
        this.mMaxLife = -1;           // -1 = never expires (from decompiled: 0xffffffff)
        this.mIsAlive = true;
        this.mConsumed = 0;           // how many grains eaten

        // Scatter seed grains around the click point
        for (let i = 0; i < count; i++) {
            this.mSeeds.push({
                x: this.mX + (Math.random() - 0.5) * 40,
                y: this.mY + (Math.random() - 0.5) * 20,
                eaten: false,
            });
        }
    }

    update() {
        if (!this.mIsAlive) return;
        // From decompiled FUN_004015f8: timer at offset 0x38 decrements from initial value
        // Seeds with timer=-1 (0xffffffff) never expire — only consumed by chickens
        if (this.mMaxLife > 0) {
            this.mLifeTimer++;
            if (this.mLifeTimer >= this.mMaxLife) {
                this.mIsAlive = false;
                return;
            }
        }
        // Die when all grains eaten
        if (this.mConsumed >= this.mCount) {
            this.mIsAlive = false;
        }
    }

    // A chicken eats one grain, returns calories gained
    eatOne() {
        for (const s of this.mSeeds) {
            if (!s.eaten) {
                s.eaten = true;
                this.mConsumed++;
                return this.mCalories;
            }
        }
        return 0;
    }

    hasFood() {
        return this.mConsumed < this.mCount && this.mIsAlive;
    }

    draw(g) {
        if (!this.mIsAlive) return;
        const seedImg = IMAGES.IMAGE_SEED;
        const fc = this.mFieldController;
        const img = (fc && fc.mSeedCalories > 50) ? IMAGES.IMAGE_SEED_CALORIES2
                  : (fc && fc.mSeedCalories > 30) ? IMAGES.IMAGE_SEED_CALORIES1
                  : seedImg;
        for (const s of this.mSeeds) {
            if (!s.eaten) {
                if (img && img.img) {
                    g.drawImage(img, s.x, s.y);
                } else {
                    // Fallback: draw a tiny yellow dot
                    g.setColor(220, 180, 50, 255);
                    g.fillRect(s.x, s.y, 3, 2);
                }
            }
        }
    }
}

export class Field {
    // Port of Sexy::Field - vtable at 004dca8c
    // Constructor part of FieldController setup
    constructor() {
        this.mChickens = [];            // offset +0x00
        this.mGems = [];                // offset +0x04 (coins, diamonds, eggs)
        this.mRavens = [];              // offset +0x08
        this.mPets = [];                // offset +0x0c
        this.mWolves = [];              // offset +0x10
        this.mSeeds = [];               // seed clusters on the ground
        this.mFieldController = null;   // offset +0x14
        this.mUpgradeLevel = 0;         // offset +0x18 - background upgrade index (0-16)
    }

    addChick(chick) {
        this.mChickens.push(chick);
    }

    // FUN_004046aa (rwg_functions.c:5257) — random target picker on 16x9 cell grid.
    // Cell size is 8 px in original; we approximate to fit the JS field.
    // Returns {x, y} biased toward the least-occupied cell.
    pickRandomTarget(fromX, fromY) {
        const cols = 16, rows = 9;
        const minX = 100, minY = 380;
        const maxX = 700, maxY = 560;
        const cellW = (maxX - minX) / cols;
        const cellH = (maxY - minY) / rows;
        // Build a quick occupancy map (cells where chickens already are)
        const occ = new Array(cols * rows).fill(0);
        for (const c of this.mChickens) {
            if (!c.mIsAlive) continue;
            const cx = Math.floor((c.mX - minX) / cellW);
            const cy = Math.floor((c.mY - minY) / cellH);
            if (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
                occ[cy * cols + cx]++;
            }
        }
        // Sample 48 cells (matching FUN_004046aa:5283 which decrements
        // local_c from 0x30=48 down to 0), pick the one with lowest
        // occupancy. Previously sampled 12 — fewer samples meant the
        // "least-occupied" choice was noisier and chicks clustered more.
        let best = -1, bestVal = Infinity;
        for (let i = 0; i < 48; i++) {
            const idx = Math.floor(Math.random() * cols * rows);
            if (occ[idx] < bestVal) { bestVal = occ[idx]; best = idx; }
        }
        if (best < 0) best = Math.floor(Math.random() * cols * rows);
        const cx = best % cols, cy = Math.floor(best / cols);
        const x = minX + cx * cellW + Math.random() * cellW;
        const y = minY + cy * cellH + Math.random() * cellH;
        return { x, y };
    }

    // FUN_0040c4d9 (rwg_functions.c:15132) — Gem factory. type: 0=Gold, 1=Silver, 2=DiamondBlue, 3=DiamondRed.
    // Callers usually pass the chick's chest position as (x, y); the gem then
    // bounces and settles on the ground line (chick's feet ≈ y + 20). Pass
    // an explicit `groundY` to override (e.g. when chick is near the edge).
    spawnGem(type, x, y, groundY) {
        let g;
        // Per Gem struct +0x08 numbering (FUN_0040c4d9:15155): 0=Gold,
        // 1=Silver, 2=DiamondBlue, 3=DiamondRed. Unknown types are silently
        // dropped (no-op) rather than throwing — defensive for any future
        // caller passing -1 or 4+ accidentally.
        if (type === 0) g = new CoinGold(x, y);
        else if (type === 1) g = new CoinSilver(x, y);
        else if (type === 2) g = new DiamondBlue(x, y);
        else if (type === 3) g = new DiamondRed(x, y);
        if (g) {
            // Land on the ground line, not at spawn height. Default to a body
            // height below spawn so a tossed coin visibly drops to feet level.
            // Clamped so gems at the bottom of the yard don't settle outside
            // the mouse pet's walk-clamp range (≤580).
            const ground = (typeof groundY === 'number') ? groundY : y + 20;
            g.mGroundY = Math.min(580, ground);
            this.mGems.push(g);
        }
    }

    spawnEgg(x, y, eggType) {
        // Same trajectory shape as coins: spawn above the chick's feet, land
        // back on the feet line so the freshly-laid egg drops to the ground.
        // Clamp ground Y to the chick walk range (≤580) so broody chicks
        // can actually reach eggs laid by chicks at the bottom edge.
        const egg = new Egg(eggType, x, y - 10);
        egg.mGroundY = Math.min(580, y + 5);
        this.mGems.push(egg);
    }

    hatchEgg(egg, x, y) {
        // Determine chick type from egg type
        let chickType;
        switch (egg.mEggType) {
            case EggType.WHITE: chickType = ChickType.LAYER; break;
            case EggType.BLUE: chickType = ChickType.MAGIC; break;
            case EggType.RED: chickType = ChickType.HOLY; break;
            case EggType.BLACK: chickType = ChickType.ROOSTER; break;
            case EggType.GOLDEN: chickType = ChickType.BROODY; break;
            default: chickType = ChickType.LAYER;
        }
        // Spawn within the playable yard — egg x/y might be at the edge
        // (e.g., near 80/720 X clamp), so a ±15 jitter could land the new
        // chick at X=65 or 735, outside the walk-clamp range.
        const sx = Math.max(80, Math.min(720, x + (Math.random() - 0.5) * 30));
        // Y jitter ±10px gives newly-hatched chicks slight spatial spread
        // around the egg position rather than identical Y — minor visual
        // polish for multi-hatch scenarios.
        const sy = Math.max(370, Math.min(580, y + (Math.random() - 0.5) * 20));
        const chick = createChick(chickType, sx, sy);
        this.addChick(chick);
        // Count toward RAISE_CHICKENS task (cumulative).
        if (this.mFieldController) this.mFieldController.mTotalRaisedChicks++;
        // Hatch sparkle visual — floating text + particle burst in the same
        // type-colored palette. The burst makes the hatch event satisfying
        // without overshadowing the spawning chick.
        if (this.mFieldController) {
            const colors = {
                [ChickType.LAYER]: '#fff5e0',
                [ChickType.BROODY]: '#ffe07f',
                [ChickType.ROOSTER]: '#ffaa44',
                [ChickType.MAGIC]: '#aaaaff',
                [ChickType.HOLY]: '#ffaaaa',
            };
            const c = colors[chickType] || '#fff';
            if (this.mFieldController.addFloatingText) {
                this.mFieldController.addFloatingText(x, y - 20, '✨ Hatched!', c);
            }
            if (this.mFieldController.addParticleBurst) {
                this.mFieldController.addParticleBurst(x, y - 10, c, 12);
            }
        }
        // Track hatch counts for tasks (HATCH_MAGIC, HATCH_HOLY, RAISE_ROOSTERS)
        if (this.mFieldController) {
            if (chickType === ChickType.MAGIC) this.mFieldController.mHatchedMagic++;
            else if (chickType === ChickType.HOLY) this.mFieldController.mHatchedHoly++;
            else if (chickType === ChickType.ROOSTER) {
                this.mFieldController.mHatchedRooster = (this.mFieldController.mHatchedRooster || 0) + 1;
            }
        }
    }

    dropSeeds(x, y, count, calories) {
        const cluster = new SeedCluster(x, y, count, calories);
        cluster.mFieldController = this.mFieldController;
        this.mSeeds.push(cluster);
    }

    // Find the nearest seed cluster with food remaining
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

    spawnRaven() {
        // Candidate filter for raven targets:
        // - !mIsCarried: skip a chick already in another raven's claws.
        // - mIsAdult: matches FUN_0040178e:851 → vtable[5] (FUN_0040327c
        //   rwg_functions.c:3371) which returns 0 for NEWBORN/DEATH/STUNNED.
        //   So juvenile chicks (mScale<1) were never raven targets.
        // - mType !== ROOSTER: FUN_0040178e:852 has the condition
        //   `(param_3 != 0 || piVar1[1] != 2)` — rooster chicks (type 2) are
        //   excluded when the caller passes param_3==0. Combined with the
        //   global rooster-count-modulated raven-spawn rate (FUN_00401308),
        //   roosters function as anti-raven protection rather than tank
        //   targets. (The earlier comment citing FUN_00422690 was wrong —
        //   that function is just the RAVEN_WARNING/BUY_ROOSTER hint
        //   dispatcher, not the target filter.)
        // - !mBroodActive: a brooding chick is anchored to its egg every tick
        //   by Chick.update; a raven catching one would carry a 'ghost' chick
        //   off-screen while the broody stayed on the nest. Skip.
        const candidates = this.mChickens.filter(
            c => c.mIsAlive && !c.mIsCarried
                && c.mIsAdult
                && c.mType !== 2 /* not ROOSTER */
                && !c.mBroodActive
        );
        if (candidates.length === 0) return;
        const target = candidates[Math.floor(Math.random() * candidates.length)];
        const raven = new Raven(target);
        this.mRavens.push(raven);
        // Approach caw — gives player audio cue to look for raven
        if (SOUNDS.SOUND_KAR_KAR) SOUNDS.SOUND_KAR_KAR.play();
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

    // Field::draw — drawn by FUN_004248b4:44841 per DECOMPILED_MAP section 23.
    // Depth-sort all ground entities by Y so closer ones overlap farther ones.
    draw(g) {
        // Single static background — IMAGE_GAME_BACK (DAT_004fff30, 800x600).
        // Per the decompiled, there is NO per-upgrade background swap; the
        // up0..up16 assets are small decoration sprites (~150-355 px wide)
        // loaded for runtime placement via FUN_0042c787, not full backgrounds.
        // Earlier we attempted `IMAGE_GAME_BACK_UPGRADE${n}` which drew a tiny
        // 213x156 sprite at (0,0) and left the rest of the field blank.
        const bg = IMAGES.IMAGE_GAME_BACK;
        if (bg) g.drawImage(bg, 0, 0);

        // Always draw seeds first (under everything else on the ground)
        for (const seed of this.mSeeds) {
            seed.draw(g);
        }

        // Combined Y-sort: gems + chickens + pets + wolves
        const ground = [];
        for (const gem of this.mGems) {
            if (gem.mIsAlive) ground.push(gem);
        }
        for (const chick of this.mChickens) ground.push(chick);
        for (const pet of this.mPets) ground.push(pet);
        for (const wolf of this.mWolves) ground.push(wolf);
        // Depth sort by Y so closer entities (higher mY) overlap farther
        // ones. mY is always defined (set in each entity's constructor),
        // so no `|| 0` fallback is needed.
        ground.sort((a, b) => a.mY - b.mY);
        for (const e of ground) {
            if (e.draw) e.draw(g);
        }

        // Draw ravens on top
        for (const raven of this.mRavens) {
            raven.draw(g);
        }
    }

    update() {
        // Update all chickens
        for (const c of this.mChickens) {
            c.update(this);
        }

        // Update seeds
        for (const seed of this.mSeeds) {
            seed.update();
        }
        this.mSeeds = this.mSeeds.filter(s => s.mIsAlive);

        // Update gems
        for (const gem of this.mGems) {
            gem.update();
        }

        // Clean up dead gems
        this.mGems = this.mGems.filter(g => g.mIsAlive);

        // Clean up dead chickens (after death animation)
        // death.jpg is 1092x78 → 14 frames × 6 ticks = 84-tick animation. Hold a
        // bit longer so the full death sprite plays before the chick disappears.
        this.mChickens = this.mChickens.filter(c => c.mIsAlive || c.mDeathTimer < 90);

        // Update ravens
        for (const raven of this.mRavens) {
            raven.update(this.mChickens);
        }
        this.mRavens = this.mRavens.filter(r => r.mIsAlive);

        // Update pets
        for (const pet of this.mPets) {
            pet.update(this);
        }

        // Update wolves, then filter out dead ones (Wolf sets mIsAlive=false
        // when HP hits 0, but never removes itself from the list).
        for (const wolf of this.mWolves) {
            wolf.update(this);
        }
        this.mWolves = this.mWolves.filter(w => w.mIsAlive);
    }
}
