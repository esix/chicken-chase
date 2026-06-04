// Port of Sexy::FieldController - vtable at 004dca94
// THE MAIN GAME LOGIC
//
// Key functions:
//   FUN_00417990 - resource/sound loading initializer (988 lines) — NOT update; mislabel
//   FUN_0041c48a - SelectLevelDialog (NOT checkLevelComplete — see MainMenuView.js)
//   FUN_0041c772 - SelectLevelDialog destructor (NOT checkLevelFailed — mislabel)
//   FUN_0041ccf8 - SelectLevelView constructor (NOT processLevelResult — mislabel)
//   FUN_0041cef3 - Sexy::SelectLevelView destructor (NOT nextLevel — mislabel) (27 lines)
//   FUN_0041d723 - WIN-screen text builder ("Congratulations!", line 35923)
//   FUN_0041d828 - CREDITS-text builder ("Good day, Earth dweller!", line 35977)
//   FUN_00422a24 - level-specific hint dispatcher (NOT addMoney — mislabel)
//   drawHUD — exact original FUN_xxxxxxxx UNKNOWN; FUN_0042a7ce was misidentified (it's a DirectDraw error-code lookup)

import { Field } from './Field.js';
import { createChick, ChickType } from './Chick.js';
import { TaskType, getLevelConfig } from './LevelData.js';
import { IMAGES, SOUNDS } from './Res.js';
import { Wolf, Mouse, Elephant } from './Pet.js';
import { getTintedEggCel } from './Gem.js';

export class FieldController {
    // Port of Sexy::FieldController - vtable at 004dca94
    constructor(gameApp) {
        this.mGameApp = gameApp;            // offset +0x00
        this.mField = new Field();          // offset +0x04
        this.mField.mFieldController = this;
        this.mCurrentLevel = 1;             // offset +0x08
        this.mMoney = 10000;                // offset +0x0c - starting money
        this.mTotalMoney = 0;               // offset +0x10
        this.mTimeElapsed = 0;              // offset +0x18 - in ms
        this.mTimeLimit = 0;                // offset +0x1c
        this.mTasks = [];                   // offset +0x20
        this.mTaskProgress = [];            // offset +0x24
        this.mIsPaused = false;             // offset +0x28
        this.mIsLevelComplete = false;      // offset +0x2c
        this.mIsLevelFailed = false;        // offset +0x30
        this.mFailReason = null;            // 'chickens' | 'time' | null
        this.mLevelConfig = null;           // offset +0x34
        this.mRavenTimer = 0;              // offset +0x38
        this.mRavenInterval = 5000;        // offset +0x3c - ticks between raven attacks
        this.mWolfTimer = 0;               // offset +0x40
        this.mWolfInterval = 8000;         // offset +0x44
        this.mMoneyCap = 1000000;          // offset +0x48
        this.mCollectedCoins = 0;          // offset +0x4c
        this.mCollectedBlueDiamonds = 0;   // offset +0x50
        this.mCollectedRedDiamonds = 0;    // offset +0x54
        this.mCollectedWhiteEggs = 0;      // offset +0x58
        this.mCollectedBlueEggs = 0;       // offset +0x5c
        this.mCollectedRedEggs = 0;        // offset +0x60
        this.mCollectedBlackEggs = 0;      // offset +0x64
        this.mHatchedMagic = 0;            // offset +0x68
        this.mHatchedHoly = 0;             // offset +0x6c
        // Cumulative chicken-raised count (for RAISE_CHICKENS task on levels
        // where the target exceeds the cap, e.g. level 49 wants 50 raised
        // but the cap is 12 alive at once).
        this.mTotalRaisedChicks = 0;
        this.mSeedCalories = 30;           // offset +0x70
        this.mSeedCount = 3;               // offset +0x74
        this.mGunPower = 1;                // offset +0x78
        this.mGunArea = false;             // offset +0x7c
        // Player's persistent house-upgrade tier (0/1/2). Bumped by
        // GameView._applyUpgradeEffect on 'house_1' / 'house_2'. Carried
        // across level starts so upgrades aren't reset every level.
        this.mPlayerHouseUpgrade = 0;
        this.mHasElephant = false;         // offset +0x80
        this.mHasMouse = false;            // offset +0x84
        this.mSicknessFactor = 0;          // offset +0x8c
        this.mBonusAchieved = false;       // offset +0x90
        this.mChickenPriceMultiplier = 1;  // offset +0x94
        this.mCureCost = 50;               // from decompiled FUN_0040490a: 0x32 = 50
        // Floating score text popups
        this.mFloatingTexts = [];
        // Click ripples — brief expanding ring at each click location
        this.mClickRipples = [];
        // Particle bursts (coin/gem pickup, level complete confetti)
        this.mParticles = [];
        // Confetti — celebratory at level complete
        this.mConfettiTimer = 0;
        // Screen shake — set magnitude, ticks down each frame
        this.mShakeMag = 0;
    }

    addShake(magnitude) {
        this.mShakeMag = Math.max(this.mShakeMag, magnitude);
    }

    updateShake() {
        if (this.mShakeMag > 0) {
            this.mShakeMag = Math.max(0, this.mShakeMag - 0.5);
        }
    }

    getShakeOffset() {
        if (this.mShakeMag <= 0) return { x: 0, y: 0 };
        return {
            x: (Math.random() - 0.5) * 2 * this.mShakeMag,
            y: (Math.random() - 0.5) * 2 * this.mShakeMag,
        };
    }

    addClickRipple(x, y, color = '#fff') {
        this.mClickRipples.push({ x, y, color, t: 0 });
    }

    // Spawn a small radial particle burst at (x, y).
    addParticleBurst(x, y, color = '#ffd700', count = 10) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 2.5;
            this.mParticles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 0.5,
                color,
                t: 0,
                life: 25 + Math.floor(Math.random() * 15),
                gravity: 0.18,
                size: 2 + Math.random() * 2,
            });
        }
    }

    // Confetti — short bursts that rain down from the top of the screen.
    addConfetti(count = 60) {
        const colors = ['#ffd700', '#5cff5c', '#ff5c5c', '#5cb8ff', '#ffaa44', '#ff66cc'];
        for (let i = 0; i < count; i++) {
            this.mParticles.push({
                x: 100 + Math.random() * 600,
                y: -20 - Math.random() * 100,
                vx: (Math.random() - 0.5) * 2,
                vy: 1 + Math.random() * 2,
                color: colors[Math.floor(Math.random() * colors.length)],
                t: 0,
                life: 240,
                gravity: 0.05,
                size: 3 + Math.random() * 3,
                spin: (Math.random() - 0.5) * 0.3,
                angle: Math.random() * Math.PI * 2,
            });
        }
    }

    updateParticles() {
        for (const p of this.mParticles) {
            p.t++;
            p.vy += p.gravity;
            p.x += p.vx;
            p.y += p.vy;
            if (p.spin !== undefined) p.angle += p.spin;
        }
        this.mParticles = this.mParticles.filter(p => p.t < p.life && p.y < 700);
    }

    drawParticles(g) {
        const ctx = g.ctx;
        for (const p of this.mParticles) {
            const alpha = Math.max(0, 1 - p.t / p.life);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = p.color;
            if (p.angle !== undefined) {
                // Confetti — small rotated rectangle
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.angle);
                ctx.fillRect(-p.size, -p.size / 2, p.size * 2, p.size);
                ctx.restore();
            } else {
                // Sparkle dot
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }

    // FUN_004088d0 - startLevel
    startLevel(level) {
        this.mCurrentLevel = level;
        this.mLevelConfig = getLevelConfig(level);
        // "Ace time" (FUN_0040dde4:17223) is a per-level developer PAR time,
        // distinct from the player's best time. That par table is UNKNOWN — not
        // present in the decompiled data we extracted nor in LevelData — so we
        // leave it 0 (rendered as "--:--"). Do NOT conflate it with getBestTime:
        // the LevelCompletedDialog shows Ace time AND a separate "Best time - by
        // <player>" line (Core.getBestTime), so reusing best-time here duplicated
        // that value across two rows.
        this.mLevelAceTime = 0;
        this.mField = new Field();
        this.mField.mFieldController = this;
        this.mTimeElapsed = 0;
        this.mTimeLimit = this.mLevelConfig.timeLimit;
        this.mMoneyCap = this.mLevelConfig.moneyCap;
        this.mSicknessFactor = this.mLevelConfig.sicknessFactor;
        this.mChickenPriceMultiplier = this.mLevelConfig.chickenPriceMultiplier;
        this.mMoney = this.mLevelConfig.startMoney;
        // Reset upgrade-tracked state to constructor defaults BEFORE GameView
        // re-applies the player profile's upgrade list. This matters when the
        // player switches profile mid-session (ChangePlayerDialog): without
        // this, the FieldController instance would still carry the previous
        // player's mPlayerHouseUpgrade / mSeedCalories / mGunPower / mGunArea.
        // Pet ownership (mHasMouse/mHasElephant) is NOT in profile and persists
        // within a session — don't reset those here.
        this.mPlayerHouseUpgrade = 0;
        this.mSeedCalories = 30;
        this.mSeedCount = 3;
        this.mGunPower = 1;
        this.mGunArea = false;
        // Field upgrade level: max(level config baseline, player's persistent
        // house upgrade). Without this, player loses their house upgrade on
        // every level transition. (mPlayerHouseUpgrade just reset above; the
        // upgrade-restore in GameView.startLevel runs after FC.startLevel and
        // bumps it back up via _applyUpgradeEffect.)
        this.mField.mUpgradeLevel = Math.max(
            this.mLevelConfig.upgradeLevel || 0,
            this.mPlayerHouseUpgrade || 0
        );
        this.mIsLevelComplete = false;
        this.mIsLevelFailed = false;
        this.mFailReason = null;  // cleared so a previous level's reason doesn't leak
        this.mIsPaused = false;
        this._everHadChicks = false;

        // Reset collection counters
        this.mTotalMoney = 0;
        this.mCollectedCoins = 0;
        this.mCollectedBlueDiamonds = 0;
        this.mCollectedRedDiamonds = 0;
        this.mCollectedWhiteEggs = 0;
        this.mCollectedBlueEggs = 0;
        this.mCollectedRedEggs = 0;
        this.mCollectedBlackEggs = 0;
        this.mHatchedMagic = 0;
        this.mHatchedHoly = 0;
        this.mTotalRaisedChicks = 0;
        this.mHatchedRooster = 0;
        this.mBonusAchieved = false;
        // Sound cooldown timers — without resetting, an in-flight lay-sound
        // throttle from the previous level briefly suppresses chimes on the
        // new level's first tick. Same applies to sick-sound throttle.
        this.mLaySoundCd = 0;
        this.mSickSoundCd = 0;

        // Set up tasks from config
        this.mTasks = this.mLevelConfig.tasks;
        this.mTaskProgress = this.mTasks.map(() => 0);

        // Give starting chickens - FUN_00423deb
        this._setupStartingChickens();

        // Set up raven timing. The spawn condition is `mRavenTimer >=
        // mRavenInterval`, so the first raven fires at (ravenInterval) ticks
        // by default. With ravenDelay we want the FIRST spawn to land at
        // exactly the delay — e.g. L36 description "4 minutes before the
        // ravens attack" should produce a raven at 240s sharp, not 240s +
        // interval. Pre-load the timer by (interval - delay) ticks: it
        // starts at a negative value, counts up, and crosses the interval
        // threshold exactly when (ticks elapsed) == ravenDelay. Without
        // this offset, ravens would spawn at delay + interval (32s late on
        // L36 with its 32s interval).
        // Minimum ticks between raven spawn attempts. The original rolls a
        // per-frame probability (FUN_0040134a every ~10 ticks) with no long
        // gate, producing a steady trickle; we approximate with a per-level
        // interval. Previously 5000-lvl*50 (~47s on L5) made ravens so rare
        // the player never saw the "Watch for ravens!" threat materialize
        // before the level ended. Tightened to ~19s early, ramping toward
        // ~7s by L50 (matches L50's "ravens attack you more frequently").
        this.mRavenInterval = 2000 - Math.min(1300, level * 28);
        this.mRavenTimer = 0;
        if (this.mLevelConfig.ravenDelay > 0) {
            const delayTicks = this.mLevelConfig.ravenDelay / 10; // ms → ticks
            this.mRavenTimer = this.mRavenInterval - delayTicks;
        }
        // Risk-effect timers don't carry between levels — a "ravens scared"
        // effect triggered late in level N shouldn't keep ravens away on
        // level N+1.
        this.mRavenScaredTimer = 0;
        this.mWolfTimer = 0;

        // Set up pets/wolves from config. Randomize position on recreate so
        // the pet doesn't always spawn at the default (400, 500) center —
        // matches the shop-buy spawn which also randomizes (100..700, 380..560).
        if (this.mHasMouse) {
            const m = new Mouse();
            m.mX = 100 + Math.random() * 600;
            m.mY = 380 + Math.random() * 180;
            // Face toward field center on spawn — Pet base defaults to
            // mDirection=1 (right, sprite default orientation), so a right-
            // half spawn would face away from the action until the first
            // _updateWalk flip. Same fix pattern as wolf-edge spawn.
            m.mDirection = m.mX < 400 ? 1 : 0;
            this.mField.addPet(m);
        }
        if (this.mHasElephant) {
            const e = new Elephant();
            e.mX = 100 + Math.random() * 600;
            e.mY = 380 + Math.random() * 180;
            e.mDirection = e.mX < 400 ? 1 : 0;
            this.mField.addPet(e);
        }

        // For bonus levels: capture chick count at start so we can detect
        // "Perfect!" (no chicks lost) on completion.
        this._bonusStartChicks = this.mField.getAliveChickCount();

        // Reset VFX queues so a previous level's tail of particles/floating
        // texts/click ripples/confetti doesn't bleed into the new level.
        this.mFloatingTexts = [];
        this.mClickRipples = [];
        this.mParticles = [];
        this.mConfettiTimer = 0;
        this.mShakeMag = 0;
        this.mMoneyFlashTimer = 0;
        // Special-shop doubling counter resets per level — without this,
        // chicks bought on level 5 would still be price-doubled on level 6.
        // Also resets the per-level maxBuyPerType caps (e.g. L48 layer=10):
        // the cap is per-level, so the count must too.
        this._specialShopBoughtCount = [0, 0, 0, 0, 0];
    }

    // FUN_00423deb - setup starting chickens
    _setupStartingChickens() {
        // FUN_00423deb (rwg_functions.c:43926) — runs a chicken-spawn loop
        // until count reaches N, with money cap temporarily set to 1000000.
        // Different per level. Levels 1-3 typically start with 3 layer chicks.
        // Higher levels start with more variety (broody, rooster, etc.).
        const lvl = this.mCurrentLevel;
        // Starter chicks get a STAGGERED mAge spread instead of the constructor's
        // narrow [3300, 3698] range (4-sec spread → all sick within 4s).
        // Sickness threshold is mAge < 3000. With cure costing $50 and L1
        // startMoney=$44 (matches original case 1: 0x2c), the player can't
        // afford a cure before earning coins. Spreading starter ages across
        // [4000, 7000] gives the player ~10-40 seconds between successive
        // sicknesses — time to drop seeds, collect peck-coins, save up cure
        // money. Hatched/bought chicks (non-starter) keep the original
        // narrow range as they appear during gameplay.
        let _spawnIdx = 0;
        const spawn = (type, x, y) => {
            const c = createChick(type, x, y);
            c.mIsAdult = true;
            c.mScale = 1.0;
            // Start chicks well-fed to give the player breathing room.
            c.mFoodCounter = 30; // about 1 grain worth
            c.mHunger = 2000;    // full hunger meter
            // Staggered mAge so starter chicks don't all enter sickness in
            // a 4-second window. Each subsequent starter is ~1000 ticks
            // (10s) older than the previous, plus ±200 jitter.
            c.mAge = 4000 + _spawnIdx * 1000 + Math.floor(Math.random() * 400);
            _spawnIdx++;
            this.mField.addChick(c);
            this.mTotalRaisedChicks++;
        };
        // Field bounds approximation (yard area). Y ~380-560, X ~100-700.
        const rx = () => 120 + Math.random() * 560;
        const ry = () => 380 + Math.random() * 180;

        if (lvl === 1) {
            // 3 starter chickens, all Layer (per screenshot 13.png)
            for (let i = 0; i < 3; i++) spawn(ChickType.LAYER, rx(), ry());
        } else if (lvl === 2) {
            for (let i = 0; i < 3; i++) spawn(ChickType.LAYER, rx(), ry());
        } else if (lvl === 3) {
            // 3 layer + 1 broody = 4 starter chicks. L3 cap is 5 (tier 0), so
            // 4 leaves room for one immediate egg hatch — otherwise the player
            // is stuck at cap until a chick dies. Description: "you can only
            // buy a maximum of 5 chickens" — the cap, not the starter count.
            for (let i = 0; i < 3; i++) spawn(ChickType.LAYER, rx(), ry());
            spawn(ChickType.BROODY, rx(), ry());
        } else if (lvl >= 4 && lvl <= 5) {
            // 4 layers + 1 broody = 5 starter chicks. (Comment about cap/
            // FARM_CROWDED was stale — both the alive-chicken cap at buy
            // time AND the per-frame FARM_CROWDED hint trigger have been
            // removed in earlier iterations; the count of 5 is now just the
            // intended starter feel for these levels, not a cap-driven
            // workaround.)
            for (let i = 0; i < 4; i++) spawn(ChickType.LAYER, rx(), ry());
            spawn(ChickType.BROODY, rx(), ry());
        } else if (this.mLevelConfig && this.mLevelConfig.isBonus) {
            // Competitive bonus levels — per decompiled FUN_00423cb3 (the
            // competitive helper), the spawn count comes from a per-level
            // `iVar10` passed through. Values per case:
            //   L8 (case 8):    iVar10 = 3
            //   L13 (0xd):      iVar10 = 4
            //   L16, L20 (fallthrough): iVar10 = 4
            //   L25 (0x19 → LAB_00423316): iVar10 = 4
            //   L33 (0x21):     iVar10 = 4
            //   L38 (0x26):     iVar10 = 5
            //   L45 (0x2d):     iVar10 = 5
            // The "protect each chicken" task is meant to be tense — with
            // our prior 8-chick default for lvl 9+, late-bonus levels were
            // trivial. Map to the decompiled counts.
            const bonusStarters = {
                8: 3, 13: 4, 16: 4, 20: 4, 25: 4, 33: 4, 38: 5, 45: 5,
            };
            const n = bonusStarters[lvl] || 4;
            for (let i = 0; i < n; i++) spawn(ChickType.LAYER, rx(), ry());
        } else if (lvl >= 6 && lvl <= 7) {
            for (let i = 0; i < 6; i++) spawn(ChickType.LAYER, rx(), ry());
            spawn(ChickType.BROODY, rx(), ry());
            spawn(ChickType.ROOSTER, rx(), ry());
        } else {
            // Higher levels — mix of types
            for (let i = 0; i < 8; i++) spawn(ChickType.LAYER, rx(), ry());
            // L29 description: "you'll have to do it without the help of the
            // broody chickens" — no broodies in starter set.
            // L49 description: "you only have one broody chicken... can't
            // replace it" — exactly one, no backup.
            const broodyCount = (lvl === 29) ? 0 : (lvl === 49 ? 1 : 2);
            for (let i = 0; i < broodyCount; i++) {
                spawn(ChickType.BROODY, rx(), ry());
            }
            spawn(ChickType.ROOSTER, rx(), ry());
            if (this.mLevelConfig && this.mLevelConfig.hasMagicHoly) {
                spawn(ChickType.MAGIC, rx(), ry());
            }
        }
    }

    // FieldController.update — runs once per game tick (10ms @ 100fps). Times
    // task progress, raven/wolf spawning, particle/shake updates, and gates the
    // level-complete and level-failed checks.
    update() {
        // Pause stops everything (true freeze). Level-complete/failed stops
        // game logic but lets VFX continue so the celebration confetti and
        // floating texts can still animate over the end-of-level overlay.
        if (this.mIsPaused) return;
        const gameLogicPaused = this.mIsLevelComplete || this.mIsLevelFailed;
        if (!gameLogicPaused) {
            this._tickGameLogic();
        }
        // VFX timers — tick during complete/failed too.
        this.updateFloatingTexts();
        this.updateParticles();
        this.updateShake();
        this.updateClickRipples();
        if (this.mMoneyFlashTimer > 0) this.mMoneyFlashTimer--;
        if (this.mConfettiTimer > 0) {
            this.mConfettiTimer--;
            if (this.mConfettiTimer % 18 === 0) this.addConfetti(20);
        }
        // Risk-icon sprite-strip animation timer — only ticks when the icon
        // is currently visible (mRiskReady set in GameView.update). Ticking
        // unconditionally would waste a counter when the icon isn't shown.
        if (this.mRiskReady) this.mRiskAnimTimer = (this.mRiskAnimTimer || 0) + 1;
        else this.mRiskAnimTimer = 0;
    }

    _tickGameLogic() {
        // Time tracking
        this.mTimeElapsed += 10; // 10ms per tick at 100fps

        // Update field entities
        this.mField.update();

        // Money cap enforcement - from decompiled case 0x1e, 0x24, etc.
        if (this.mMoney > this.mMoneyCap) {
            this.mMoney = this.mMoneyCap;
        }

        // Sickness - FUN_00422228. Throttle SOUND_SICK so it doesn't spam
        // when several chicks get sick on the same tick — only one chime
        // per ~2 sec window so the player gets one audible heads-up cluster.
        if (this.mSickSoundCd > 0) this.mSickSoundCd--;
        // Egg-lay sound throttle — late-game flocks of 10+ layers fire many
        // overlapping chirps on the same tick when cooldowns align.
        if (this.mLaySoundCd > 0) this.mLaySoundCd--;
        if (this.mSicknessFactor > 0) {
            for (const c of this.mField.mChickens) {
                // mIsAdult gate: juveniles have mAge frozen at 3300-3696
                // (no aging until adult). The natural recovery threshold is
                // 4500/5000, which juveniles never reach — so a force-sickened
                // juvenile stays sick forever until manual cure. The original's
                // vtable[5] = FUN_0040327c excludes NEWBORN from "active" state,
                // so force-sickness paths in the original also implicitly
                // skip juveniles.
                if (c.mIsAlive && c.mIsAdult && !c.mIsSick
                    && Math.random() < 0.0001 * this.mSicknessFactor) {
                    c.mIsSick = true;
                    if (SOUNDS.SOUND_SICK && (this.mSickSoundCd || 0) === 0) {
                        SOUNDS.SOUND_SICK.play();
                        this.mSickSoundCd = 200; // ~2s at 100fps
                    }
                }
            }
        }

        // Egg brooding progresses ONLY when a BroodyChick is sitting on it.
        // BroodyChick.update() handles the walk-to-egg, sit, increment timer,
        // and final hatch — see Chick.js BroodyChick. No auto-hatch fallback:
        // in the original game, eggs need a broody. If the player has none,
        // flagged eggs sit until a broody is bought OR the egg's lifetime
        // (4000 ticks per FUN_00407038:8775) expires.
        //
        // Recovery: if an egg's claimed broody died (or sold), clear the
        // claim AND reset the visible brood progress so a new broody starts
        // from a clean bar. Chick.die() doesn't call _endBrooding, so without
        // this the egg keeps its stale progress bar after its broody dies.
        for (const gem of this.mField.mGems) {
            if (gem.mType === 4 && gem.mIsAlive && gem.mBrooding
                && gem._claimedBy
                && (!gem._claimedBy.mIsAlive || gem._claimedBy.mBroodingEgg !== gem)) {
                gem._claimedBy = null;
                gem.mBroodProgress = 0;
            }
        }

        // Raven spawning. RiskCaseRavensScared sets mRavenScaredTimer.
        if (this.mLevelConfig && this.mLevelConfig.hasRavens) {
            if (this.mRavenScaredTimer > 0) {
                this.mRavenScaredTimer--;
            }
            if (this.mRavenScaredTimer <= 0) {
                this.mRavenTimer++;
                // Per FUN_0040134a:446-461 — raven probability scales with rooster count.
                // Needed count = ceil(chickens / 5) (approximation; original uses
                // FUN_00401308 with constants UNKNOWN). When roosters >= needed,
                // probability = 0. Each missing rooster increases probability.
                const aliveChicks = this.mField.mChickens.filter(c => c.mIsAlive);
                const roosterCount = aliveChicks.filter(c => c.mIsAdult && c.mType === 2).length;
                // Elephant check first — affects needed formula per FUN_00401308.
                const hasElephantPet = this.mField.mPets && this.mField.mPets.some(
                    p => p.mType === 1
                );
                // FUN_00401308: needed = max(0, (count-1)/5 - 1), or
                //               needed = max(0, (count-1)/5 - 5) with elephant.
                const tier = Math.floor((aliveChicks.length - 1) / 5);
                const needed = Math.max(0, tier - (hasElephantPet ? 5 : 1));
                // Per FUN_0040134a:450-459 — attack probability keyed off how
                // many roosters SHORT of `needed` the farm is:
                //   roosters >  needed  → 0          (more than enough → safe)
                //   roosters == needed  → base rate  (_DAT_004e93d4)
                //   1/2/3+ short        → rising rates (_DAT_004e93d0/4dc84c/…)
                // The original uses STRICT `needed < roosters` for the safe
                // case — so at `needed==0, roosters==0` (small farms like L5,
                // 5 chicks) ravens STILL attack at the base rate. Our prior
                // `roosters >= needed` wrongly silenced ravens on every
                // sub-11-chick farm, so they never appeared on L4/L5 despite
                // the "Watch for ravens!" intro.
                let attackChance = 0;
                if (aliveChicks.length > 3) {
                    const short = needed - roosterCount;
                    if (short < 0)      attackChance = 0;     // strictly more roosters than needed
                    else if (short === 0) attackChance = 0.06; // base — meets need exactly
                    else if (short === 1) attackChance = 0.12;
                    else if (short === 2) attackChance = 0.20;
                    else                  attackChance = 0.30; // 3+ short
                }
                // Elephant — also reduces frequency (FUN_004014eb:593 → *= 2/3)
                // and caps active raven count to 2 (FUN_00401543).
                if (hasElephantPet) attackChance *= 2 / 3;
                const maxActive = hasElephantPet ? 2 : 4;
                if (this.mRavenTimer >= this.mRavenInterval
                    && this.mField.mRavens.filter(r => r.mIsAlive).length < maxActive
                    && Math.random() < attackChance) {
                    this.mRavenTimer = 0;
                    this.mField.spawnRaven();
                }
            }
        }

        // Wolf spawning. Cap active wolves at 2 — two simultaneous threats is
        // already a lot for the player to manage; original game also limits.
        if (this.mLevelConfig && this.mLevelConfig.hasWolves) {
            this.mWolfTimer++;
            const aliveWolves = this.mField.mWolves.filter(w => w.mIsAlive).length;
            if (this.mWolfTimer >= this.mWolfInterval && aliveWolves < 2) {
                this.mWolfTimer = 0;
                const wolf = new Wolf();
                wolf.mX = Math.random() < 0.5 ? 50 : 750;
                wolf.mY = 380 + Math.random() * 180;
                // Initial direction faces the field center, so a right-edge
                // spawn doesn't render facing right for one frame before
                // _updateWalk flips it on tick 2. mDirection: 1=right (no
                // flip — wolf sprite faces right by default), 0=left (flip).
                wolf.mDirection = wolf.mX < 400 ? 1 : 0;
                this.mField.addWolf(wolf);
                // Approach howl — gives the player audio warning to look for
                // the wolf entering from the field edge.
                if (SOUNDS.SOUND_WOLF) SOUNDS.SOUND_WOLF.play();
            }
        }

        // Check level completion (per-frame task progress eval).
        this._checkLevelComplete();

        // Check level failure - FUN_0041c772
        this._checkLevelFailed();
    }

    // addMoney — increments cash + cumulative-earned, capped at mMoneyCap,
    // and flashes the HUD money number green for 30 ticks.
    addMoney(amount) {
        // Guard against negative/zero — symmetric with spendMoney. A buggy
        // caller passing -5 would let the player "earn" -$5, effectively
        // a no-op spendMoney path that also corrupts mTotalMoney (used by
        // the EARN_MONEY task).
        if (!(amount > 0)) return;
        this.mMoney += amount;
        this.mTotalMoney += amount;
        if (this.mMoney > this.mMoneyCap) {
            this.mMoney = this.mMoneyCap;
        }
        // Flash green
        this.mMoneyFlashTimer = 30;
        this.mMoneyFlashColor = '#5cff5c';
    }

    // FUN_0040a3d6 - spendMoney
    spendMoney(amount) {
        // Guard against negative amounts — `this.mMoney >= -X` is always true
        // for positive money, which would let a buggy caller passing -5 to
        // "spend" -$5 actually GAIN $5. Treat negative or zero as a no-op
        // and only spend strictly positive amounts.
        if (!(amount > 0)) return false;
        if (this.mMoney >= amount) {
            this.mMoney -= amount;
            this.mMoneyFlashTimer = 30;
            this.mMoneyFlashColor = '#ff5c5c';
            return true;
        }
        return false;
    }

    // FUN_0041c48a - SelectLevelDialog (NOT checkLevelComplete — see MainMenuView.js)
    _checkLevelComplete() {
        let allComplete = true;
        for (let i = 0; i < this.mTasks.length; i++) {
            const task = this.mTasks[i];
            let current = 0;

            switch (task.type) {
                case TaskType.COLLECT_COINS:
                    current = this.mCollectedCoins;
                    break;
                case TaskType.COLLECT_BLUE_DIAMONDS:
                    current = this.mCollectedBlueDiamonds;
                    break;
                case TaskType.COLLECT_RED_DIAMONDS:
                    current = this.mCollectedRedDiamonds;
                    break;
                case TaskType.EARN_MONEY:
                    current = this.mTotalMoney;
                    break;
                case TaskType.COLLECT_WHITE_EGGS:
                    current = this.mCollectedWhiteEggs;
                    break;
                case TaskType.COLLECT_BLUE_EGGS:
                    current = this.mCollectedBlueEggs;
                    break;
                case TaskType.COLLECT_RED_EGGS:
                    current = this.mCollectedRedEggs;
                    break;
                case TaskType.COLLECT_BLACK_EGGS:
                    current = this.mCollectedBlackEggs;
                    break;
                case TaskType.RAISE_CHICKENS:
                    // Use the higher of current alive count or cumulative
                    // hatched+bought. Cumulative is the meaningful metric
                    // for levels with high targets (L49 wants 50, L32 wants
                    // 100) where attrition between raising and counting is
                    // possible — chicks die, but the player still "raised
                    // them" toward the goal. Mirrors the HATCH_MAGIC/HOLY/
                    // ROOSTER pattern below. (Earlier comment cited a
                    // permanent alive-cap of 12; that cap was JS-port
                    // speculation and has been removed.)
                    current = Math.max(
                        this.mField.getAliveChickCount(),
                        this.mTotalRaisedChicks || 0
                    );
                    break;
                case TaskType.HATCH_MAGIC:
                    // Count cumulative hatches (mHatchedMagic) OR current alive Magic chicks,
                    // whichever is higher (covers both initial buys and hatched).
                    current = Math.max(this.mHatchedMagic || 0,
                        this.mField.getChickCountByType(ChickType.MAGIC));
                    break;
                case TaskType.HATCH_HOLY:
                    current = Math.max(this.mHatchedHoly || 0,
                        this.mField.getChickCountByType(ChickType.HOLY));
                    break;
                case TaskType.RAISE_ROOSTERS:
                    current = Math.max(this.mHatchedRooster || 0,
                        this.mField.getChickCountByType(ChickType.ROOSTER));
                    break;
                case TaskType.TIME_LIMIT:
                    // Time limit is handled by failure check
                    current = task.target;
                    break;
            }

            this.mTaskProgress[i] = current;
            if (current < task.target) {
                allComplete = false;
            }
        }

        // Bonus levels: surviving the full timer = complete. With the
        // fail-on-death check in _checkLevelFailed (any chick death = fail),
        // by the time we reach this branch all starter chicks are still
        // alive. The previous `alive > 0` guard was redundant — if alive
        // dropped to 0 the failure check would have already fired earlier
        // in the tick. Match the original FUN_00423cb3 semantics: protect
        // every chick until time expires (rwg_functions.c:43844-43846).
        if (this.mLevelConfig && this.mLevelConfig.isBonus) {
            allComplete = this.mTimeLimit > 0 && this.mTimeElapsed >= this.mTimeLimit;
        }

        if (allComplete) {
            this.mIsLevelComplete = true;
            // Bonus complete = all chicks survived (the fail-on-death check
            // in _checkLevelFailed ensures we only reach here when no chicks
            // were lost). Triggers the "Perfect!" copy in the
            // LevelCompletedDialog and a half-price upgrade next level (per
            // the bonus dialog copy at FUN_xxx).
            if (this.mLevelConfig && this.mLevelConfig.isBonus) {
                this.mBonusAchieved = true;
                this.mNextUpgradeHalfPrice = true;
            }
            this.addConfetti(80);
            this.mConfettiTimer = 90; // re-spawn waves for ~90 ticks
            if (SOUNDS.SOUND_LEVEL_COMPLETED) SOUNDS.SOUND_LEVEL_COMPLETED.play();
            // Persist progress (FUN_00408a1b unlockNextLevel)
            if (this.mGameApp && this.mGameApp.unlockNextLevel) {
                this.mGameApp.unlockNextLevel(this.mCurrentLevel + 1);
            }
            // Record best time for this level. The LevelCompletedDialog reads
            // Core.getBestTime directly for its "Best time - by <player>" line,
            // so recording here (before the dialog draws) means a record-setting
            // run shows its own time. Do NOT copy it into mLevelAceTime — that is
            // the (UNKNOWN) developer par, a separate row.
            if (this.mGameApp && this.mGameApp.mCore && this.mGameApp.mCore.recordLevelTime) {
                this.mGameApp.mCore.recordLevelTime(this.mCurrentLevel, this.mTimeElapsed);
            }
        }
    }

    // FUN_0041c772 - SelectLevelDialog destructor (NOT checkLevelFailed — mislabel)
    _checkLevelFailed() {
        // If we've already declared the level complete this tick, don't also
        // mark it failed — completion takes precedence.
        if (this.mIsLevelComplete) return;
        // Fail if no chickens left. Use the persistent _everHadChicks flag
        // because dead chicks are filtered out of mChickens after their
        // death animation completes (Field.js mChickens filter at line ~590).
        if (this.mField.getAliveChickCount() === 0 && this._everHadChicks) {
            this.mIsLevelFailed = true;
            this.mFailReason = 'chickens';
            if (SOUNDS.SOUND_LEVEL_FAILED) SOUNDS.SOUND_LEVEL_FAILED.play();
            return;
        }
        if (this.mField.getAliveChickCount() > 0) this._everHadChicks = true;

        // Bonus levels: per FUN_00423cb3 (rwg_functions.c:43844-43846) the
        // setup stores the required surviving count at game-state +0x14/+0x1c
        // and sets +0x18 = 1 (bonus flag). The "protect each of your
        // chickens" win condition fails the moment any chick dies — the
        // bonus is all-or-nothing. We capture the starter count in
        // _bonusStartChicks (FC.startLevel) and fail as soon as the alive
        // count drops below it. Previously a chick death only zeroed the
        // bonus reward (mBonusAchieved); the level still "completed" at
        // timer expiry, contradicting the description.
        if (this.mLevelConfig && this.mLevelConfig.isBonus
            && this._bonusStartChicks
            && this.mField.getAliveChickCount() < this._bonusStartChicks) {
            this.mIsLevelFailed = true;
            this.mFailReason = 'chickens';
            if (SOUNDS.SOUND_LEVEL_FAILED) SOUNDS.SOUND_LEVEL_FAILED.play();
            return;
        }

        // Fail if time limit exceeded (for non-bonus levels)
        if (this.mTimeLimit > 0 && this.mTimeElapsed >= this.mTimeLimit && !this.mLevelConfig.isBonus) {
            this.mIsLevelFailed = true;
            this.mFailReason = 'time';
            if (SOUNDS.SOUND_LEVEL_FAILED) SOUNDS.SOUND_LEVEL_FAILED.play();
        }
    }

    // Click on an egg box in the HUD to toggle brooding. Per FUN_00406e6a:8574
    // the original click handler cancels brooding if already active (sets the
    // claim-id back to -1 on the claimed-by chick).
    startEggBrooding(egg) {
        if (!egg) return;
        // Cancel brooding if already marked — releases the broody from the egg.
        if (egg.mBrooding) {
            const claimed = egg._claimedBy;
            egg.mBrooding = false;
            egg.mBroodProgress = 0;
            egg._claimedBy = null;
            if (claimed && claimed._endBrooding) claimed._endBrooding();
            if (SOUNDS.SOUND_EGG_REF) SOUNDS.SOUND_EGG_REF.play();
            return;
        }
        // Free broodies (not yet assigned to an egg): can take this one
        // immediately. Busy broodies will pick the egg up later via the idle-
        // path scan when they finish their current egg — that's how the
        // original supports queueing.
        const freeBroodies = this.mField.mChickens.filter(
            c => c.mIsAlive && c.mIsAdult && !c.mIsSick
                && c.mType === ChickType.BROODY && !c.mBroodingEgg
        );
        // Any adult non-sick broody (busy or free) — if at least one exists
        // we can queue the egg. mBrooding=true with no _claimedBy means
        // "queued for brooding"; BroodyChick.update's idle-path picks the
        // nearest queued egg once it's free.
        const anyAvailableBroody = this.mField.mChickens.some(
            c => c.mIsAlive && c.mIsAdult && !c.mIsSick
                && c.mType === ChickType.BROODY
        );
        if (!anyAvailableBroody) {
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
            const hasAnyBroody = this.mField.mChickens.some(
                c => c.mIsAlive && c.mIsAdult && c.mType === ChickType.BROODY
            );
            const msg = hasAnyBroody
                ? 'Broody is sick — cure it first!'
                : 'Need a broody!';
            this.addFloatingText(egg.mX, egg.mY - 30, msg, '#ff8080');
            return;
        }
        // Mark the egg as committed for brooding (queued). Either a free
        // broody picks it up immediately, or a busy one picks it up after
        // it finishes its current egg.
        egg.mBrooding = true;
        egg.mBroodProgress = 0;
        if (SOUNDS.SOUND_EGG_REF) SOUNDS.SOUND_EGG_REF.play();
        if (freeBroodies.length > 0) {
            freeBroodies[0].startBrooding(egg);
        }
        // else: egg sits queued; BroodyChick.update's idle-path will claim
        // it when a broody becomes free.
    }

    // GameView.startLevel owns level transitions — it calls this.startLevel
    // directly with the target level. The earlier nextLevel/restartLevel
    // helpers were removed because every call site already had GameView's
    // higher-level orchestrator (which also resets per-level UI state).

    // Get chick buy price based on type and level multiplier
    // From FUN_0040a3d6 and level config. Mirrors SpecialShopDialog._priceFor
    // (price doubles per purchase with floor 250, FUN_0041eb94:37992-37996)
    // so HUD quick-buy and SpecialShop charge the same price for the Nth
    // purchase. Previously HUD was flat, allowing the player to bypass the
    // price-doubling design by always quick-buying from the top panel.
    getChickPrice(type) {
        // DAT_0050032c[0..4] = {100, 200, 500, 1000, 1200} (rwg_functions.c:6690-6706).
        const basePrices = [100, 200, 500, 1000, 1200];
        let price = basePrices[type] || 100;
        const boughtArr = this._specialShopBoughtCount;
        const bought = (boughtArr && boughtArr[type]) || 0;
        for (let i = 0; i < bought; i++) price = Math.max(250, price * 2);
        return Math.floor(price * (this.mChickenPriceMultiplier || 1));
    }

    // BuyChick — quick-buy from a HUD shop slot. The original buy path is
    // FUN_00420ae8 (rwg_functions.c:40297 — contains the "You don't have
    // enough money." string at line 40388). FUN_0042207d cited previously
    // is the L1 introductory hint dispatcher, NOT the buy function — the
    // confusion came from both being in the same region of the binary.
    buyChick(type) {
        // Gate: level must allow buying, type must be in level's buyableTypes.
        const cfg = this.mLevelConfig;
        if (!cfg || !cfg.hasBuy) {
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
            return false;
        }
        const bt = cfg.buyableTypes || {};
        const typeKeys = ['layer', 'broody', 'rooster', 'magic', 'holy'];
        if (bt[typeKeys[type]] === false) {
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
            return false;
        }
        // Magic/Holy require hasMagicHoly.
        if ((type === 3 || type === 4) && !cfg.hasMagicHoly) {
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
            return false;
        }
        // Per-type purchase cap (maxBuyPerType, used by L48). Without this,
        // the HUD quick-buy bypasses the SpecialShop's cap enforcement and
        // the player can spam layer purchases past the level's intended limit.
        const maxBuyByKey = cfg.maxBuyPerType || {};
        const maxBuy = maxBuyByKey[typeKeys[type]];
        const boughtArr = this._specialShopBoughtCount;
        if (typeof maxBuy === 'number'
            && boughtArr && (boughtArr[type] || 0) >= maxBuy) {
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
            // Position the message near the HUD slot the player just clicked
            // (80px wide slots 0..400 at top of screen) rather than at an
            // arbitrary chick position which could be far from where the click
            // happened. y=100 places it just below the HUD strip.
            // Clamp x to ≥80 — addFloatingText uses textAlign='center' and the
            // message is ~130px wide. Without the clamp, the leftmost slot
            // (type=0, slotX=40) would have half the text clipped off-screen.
            const slotX = Math.max(80, 40 + 80 * type);
            this.addFloatingText(slotX, 100, `Cap reached — ${maxBuy} max`, '#ff8080');
            return false;
        }
        // NO chicken-count cap at buy time. The original's BuyChick path
        // (FUN_0041eb94) only checks money — there is no alive-chicken cap.
        // The DAT_0050034c table [5, 9, 12] is consulted at hen-house upgrade
        // (FUN_xxx:34313-34329) where it specifies how many chickens get
        // auto-spawned per tier, NOT a permanent buy cap. The "farm too
        // crowded" hint (rwg_functions.c:42530) is triggered by a different
        // condition (value < 0x97) and is unrelated to buying. Previously we
        // capped buys at tier-0 5 chickens — on L4-5 (4 layers + 1 broody = 5
        // starter chicks, immediately at cap) the player could never buy a
        // single chicken despite having money.
        const price = this.getChickPrice(type);
        if (this.mMoney < price) {
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
            return false;
        }

        this.spendMoney(price);  // red-flash money on chick purchase
        // Spawn within the playable yard (matches _setupStartingChickens).
        const x = 120 + Math.random() * 560;
        const y = 380 + Math.random() * 180;
        const chick = createChick(type, x, y);
        chick.mIsAdult = true;
        chick.mScale = 1.0;
        chick.mGrowTimer = 800;    // mark grow as complete so the juvenile
                                   // branch doesn't fire one tick of growth
                                   // logic on the first update — defensive.
        chick.mFoodCounter = 30;   // small starter food
        chick.mHunger = 2000;       // full hunger
        this.mField.addChick(chick);
        this.mTotalRaisedChicks++;
        // Track in the per-type bought count so the SpecialShop cap and HUD
        // cap share state — without this the HUD quick-buy and dialog buy
        // tracked separately and the L48 layer cap could be circumvented.
        if (!this._specialShopBoughtCount) this._specialShopBoughtCount = [0, 0, 0, 0, 0];
        this._specialShopBoughtCount[type]++;
        // L26 "Grow or buy 15 magic and 15 holy chickens" — buy counts toward
        // task progress. Without this, only broody-hatched chicks counted,
        // and a player who bought + lost N chickens saw their progress stuck.
        if (type === 3 /* MAGIC */) this.mHatchedMagic++;
        else if (type === 4 /* HOLY */) this.mHatchedHoly++;
        else if (type === 2 /* ROOSTER */) this.mHatchedRooster = (this.mHatchedRooster || 0) + 1;
        if (SOUNDS.SOUND_CHICK_BUY) SOUNDS.SOUND_CHICK_BUY.play();
        return true;
    }

    // drawHUD — exact layout reverse-engineered from the binary:
    //   in_game_up (400x81) drawn at x=400, y=0 (right half panel background)
    //   MENU button: (506, 1, 85, 38)  — uses dialog_btn images
    //   SELL button: (403, 39, 101, 38)
    //   BUY button:  (506, 39, 85, 38)
    //   Shop slots: x=80*i (left side, 80x81 each)
    //   Egg incubation: x=54*i, y=80 (54x54 each, below panel)
    //   Task progress: x=600, y=80+42*i (right side, 200x42 each)
    //   NO dark background — panel is transparent over game field
    drawHUD(g) {
        const ctx = g.ctx;

        // === RIGHT PANEL BACKGROUND (x=400, y=0, 400x81) ===
        const igUpImg = IMAGES.IMAGE_IN_GAME_UP;
        if (igUpImg && igUpImg.img && g._isReady(igUpImg.img)) {
            ctx.drawImage(igUpImg.img, 400, 0, 400, 81);
        }

        // === LEFT-SIDE LAYOUT (x=0..400, y=0..81) ===
        // Per screenshots 13/14/19/29/30: in shop levels (hasBuy=true) we draw
        // five 80x81 buy slots filling the left half. In non-shop levels only
        // a single "Level N" slot appears in the leftmost position; the rest
        // of the strip is transparent (the field shows through).
        const shopClosed = IMAGES.IMAGE_SHOP_SLOT_CLOSED;
        const showBuySlots = this.mLevelConfig && this.mLevelConfig.hasBuy;
        const previewKeys = [
            'IMAGE_CHICK_PREVIEW_LAYER',
            'IMAGE_CHICK_PREVIEW_BROODY',
            'IMAGE_CHICK_PREVIEW_ROOSTER',
            'IMAGE_CHICK_PREVIEW_MAGIC',
            'IMAGE_CHICK_PREVIEW_HOLY',
        ];
        const cfg = this.mLevelConfig;
        const typeKeys = ['layer', 'broody', 'rooster', 'magic', 'holy'];
        const isTypeBuyable = (i) => {
            if (!cfg || !cfg.hasBuy) return false;
            const bt = cfg.buyableTypes || {};
            if (bt[typeKeys[i]] === false) return false;
            if ((i === 3 || i === 4) && !cfg.hasMagicHoly) return false;
            return true;
        };

        if (showBuySlots) {
            for (let i = 0; i < 5; i++) {
                const bx = 80 * i;
                const by = 0;
                if (shopClosed && shopClosed.img && g._isReady(shopClosed.img)) {
                    ctx.drawImage(shopClosed.img, bx, by, 80, 81);
                }
                const buyable = isTypeBuyable(i);
                const prevImg = IMAGES[previewKeys[i]];
                if (prevImg && prevImg.img && g._isReady(prevImg.img)) {
                    if (!buyable) ctx.globalAlpha = 0.4;
                    ctx.drawImage(prevImg.img, bx + 12, by + 2, 56, 56);
                    ctx.globalAlpha = 1;
                }
                ctx.fillStyle = buyable ? '#ffd700' : '#888';
                ctx.font = 'bold 10px Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(buyable ? `$${this.getChickPrice(i)}` : '—',
                    bx + 40, by + 72);
                // Owned-count overlay (per screenshot 24/30 — small number
                // showing current count of this chick type on the field).
                const ownedCount = this.mField.mChickens.filter(
                    c => c.mIsAlive && c.mType === i
                ).length;
                if (ownedCount > 0) {
                    ctx.fillStyle = '#fff';
                    ctx.strokeStyle = '#000';
                    ctx.lineWidth = 2;
                    ctx.font = 'bold 12px Arial Black, Arial, sans-serif';
                    ctx.textAlign = 'right';
                    const txt = String(ownedCount);
                    ctx.strokeText(txt, bx + 75, by + 18);
                    ctx.fillText(txt, bx + 75, by + 18);
                }
            }
        } else {
            // Non-shop levels still draw all 5 slot backgrounds so the top
            // panel is continuous across the full 0..400 strip (per screenshot
            // 15 — the wood-frame is unbroken, with the leftmost slot showing
            // a chick icon and the rest as empty placeholders). Previously we
            // drew only slot 0, leaving a visible gap to the right panel
            // (which starts at x=400).
            if (shopClosed && shopClosed.img && g._isReady(shopClosed.img)) {
                for (let i = 0; i < 5; i++) {
                    ctx.drawImage(shopClosed.img, 80 * i, 0, 80, 81);
                }
            }
            // Small chick icon centered in slot 0 (the "Level N" indicator)
            const lvlIcon = IMAGES.IMAGE_CHICK_PREVIEW_LAYER;
            if (lvlIcon && lvlIcon.img && g._isReady(lvlIcon.img)) {
                ctx.drawImage(lvlIcon.img, 18, 4, 44, 44);
            }
            ctx.fillStyle = '#3a1a05';
            ctx.font = 'bold 12px Arial Black, Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`Level ${this.mCurrentLevel}`, 40, 68);
        }

        // === "Level N" indicator on shop levels: above the right panel ===
        // (In shop levels the badge is the BUY button area — keep a small
        // text marker so player still sees the level number.)
        if (showBuySlots) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px Arial Black, Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`Level ${this.mCurrentLevel}`, 448, 18);
        }

        // === MENU BUTTON: Resize(0x193, 0x27, 0x65, 0x26) = (403, 39, 101, 38) ===
        // Hover state: swap to IMAGE_DIALOG_BUTTON_OVER when the mouse is
        // within the button rect. mHudHoverX/Y are set by GameView.mouseMove —
        // null when no hover-tracking has happened yet (treat as no hover).
        const _hudOver = (bx, by, bw, bh) => {
            const hx = this.mHudHoverX, hy = this.mHudHoverY;
            return typeof hx === 'number' && typeof hy === 'number'
                && hx >= bx && hx < bx + bw && hy >= by && hy < by + bh;
        };
        const _menuHover = _hudOver(403, 39, 101, 38);
        const menuBtnImg = _menuHover && IMAGES.IMAGE_DIALOG_BUTTON_OVER
            ? IMAGES.IMAGE_DIALOG_BUTTON_OVER
            : IMAGES.IMAGE_DIALOG_BUTTON;
        if (menuBtnImg && menuBtnImg.img && g._isReady(menuBtnImg.img)) {
            ctx.drawImage(menuBtnImg.img, 403, 39, 101, 38);
        } else {
            ctx.fillStyle = 'rgba(80,160,40,0.9)';
            ctx.fillRect(403, 39, 101, 38);
        }
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('MENU', 453, 63);

        // === "Time" and value at top-right ===
        // Per DECOMPILED_MAP section 2: each row is ONE IMAGE_NUMBER_SLOT
        // draw, right-aligned to view.width, with label + value text overlaid.
        // Previously we drew two slots per row, leaving a visible seam.
        // Slot positions chosen to NOT overlap BUY/SELL buttons (right edge 591).
        const numSlotImg = IMAGES.IMAGE_NUMBER_SLOT;
        const slotX = 596, slotW = 200;
        if (numSlotImg && numSlotImg.img && g._isReady(numSlotImg.img)) {
            ctx.drawImage(numSlotImg.img, slotX, 2, slotW, 28);
        }
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Time', slotX + 8, 20);
        let timeStr;
        if (this.mTimeLimit > 0) {
            const remaining = Math.max(0, this.mTimeLimit - this.mTimeElapsed);
            const min = Math.floor(remaining / 60000);
            const sec = Math.floor((remaining % 60000) / 1000);
            // Minutes padded to two digits — matches the original HUD format
            // "00:13" seen in screenshots 13/14/17 (FUN_0040dde4 formatting).
            timeStr = `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
            ctx.fillStyle = remaining < 30000 ? '#f44' : '#fff';
        } else {
            const min = Math.floor(this.mTimeElapsed / 60000);
            const sec = Math.floor((this.mTimeElapsed % 60000) / 1000);
            timeStr = `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
            ctx.fillStyle = '#fff';
        }
        ctx.textAlign = 'right';
        ctx.fillText(timeStr, slotX + slotW - 8, 20);

        // === "Money" and value below Time === (single slot per row)
        if (numSlotImg && numSlotImg.img && g._isReady(numSlotImg.img)) {
            ctx.drawImage(numSlotImg.img, slotX, 34, slotW, 28);
        }
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.fillText('Money', slotX + 8, 52);
        // Money color: flash green/red on change, then gold; orange/red when at cap.
        const cap = this.mMoneyCap || 0;
        const atCap = cap > 0 && cap < 1000000 && this.mMoney >= cap - 50;
        let moneyColor = atCap ? '#ff8844' : '#ffd700';
        if (this.mMoneyFlashTimer > 0) {
            // Decrement happens in update() so duration is fps-independent.
            moneyColor = this.mMoneyFlashColor || moneyColor;
        }
        ctx.fillStyle = moneyColor;
        ctx.textAlign = 'right';
        const moneyRightX = slotX + slotW - 8;
        if (cap > 0 && cap < 1000000) {
            ctx.fillText(`${this.mMoney}/${cap}`, moneyRightX, 52);
        } else {
            ctx.fillText(`${this.mMoney}`, moneyRightX, 52);
        }

        // === SELL BUTTON: Resize(0x1FA, 0x27, 0x55, 0x26) = (506, 39, 85, 38) ===
        // Initially hidden, only visible when level allows selling
        // Shares y=39 with MENU, at x=506 (to the right of MENU)
        if (this.mLevelConfig && this.mLevelConfig.hasSell) {
            const sellHover = _hudOver(506, 39, 85, 38);
            const sellImg = sellHover && IMAGES.IMAGE_DIALOG_BUTTON_OVER
                ? IMAGES.IMAGE_DIALOG_BUTTON_OVER
                : IMAGES.IMAGE_DIALOG_BUTTON;
            if (sellImg && sellImg.img && g._isReady(sellImg.img)) {
                ctx.drawImage(sellImg.img, 506, 39, 85, 38);
            } else {
                ctx.fillStyle = 'rgba(80,160,40,0.9)';
                ctx.fillRect(506, 39, 85, 38);
            }
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('SELL', 548, 63);
        }

        // === BUY BUTTON: Resize(0x1FA, 0x01, 0x55, 0x26) = (506, 1, 85, 38) ===
        // Initially hidden, only visible when level allows buying
        // At x=506, y=1 (above SELL/MENU row)
        if (this.mLevelConfig && this.mLevelConfig.hasBuy) {
            const buyHover = _hudOver(506, 1, 85, 38);
            const buyImg = buyHover && IMAGES.IMAGE_DIALOG_BUTTON_OVER
                ? IMAGES.IMAGE_DIALOG_BUTTON_OVER
                : IMAGES.IMAGE_DIALOG_BUTTON;
            if (buyImg && buyImg.img && g._isReady(buyImg.img)) {
                ctx.drawImage(buyImg.img, 506, 1, 85, 38);
            } else {
                ctx.fillStyle = 'rgba(80,160,40,0.9)';
                ctx.fillRect(506, 1, 85, 38);
            }
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('BUY', 548, 25);
        }

        // === EGG INCUBATION BOXES (x=sz*i, y=0x50=80, sz x sz each) ===
        // One box per egg on the field. Per FUN_00409ab2:12389-12399 — the
        // original wraps to a second row at y = EGG_REF.height + 0x50 when
        // index > 10, with x reset by subtracting 11 * width. Our left half
        // only holds 7 boxes at sz=54, so we wrap at maxBoxes instead of 11
        // (preserving the wrap behavior with our packing).
        const eggRefImg = IMAGES.IMAGE_EGG_REF;
        const eggBroodImg = IMAGES.IMAGE_EGG_REF_FOR_BROOD;
        const eggProgressImg = IMAGES.IMAGE_EGG_REF_BROOD_PROGRESS;
        const eggImg = IMAGES.IMAGE_EGG;
        const fieldEggs = this.mField.mGems.filter(gem => gem.mType === 4 && gem.mIsAlive);
        const sz = 54;
        const maxBoxes = Math.max(1, Math.floor(400 / sz));
        // Two rows max — matches the original which only ever handles 1 wrap.
        const totalMax = maxBoxes * 2;

        for (let i = 0; i < fieldEggs.length && i < totalMax; i++) {
            const egg = fieldEggs[i];
            const col = i % maxBoxes;
            const row = Math.floor(i / maxBoxes);
            const ex = sz * col;
            const ey = 80 + row * sz;

            // Box background: yellow if brooding active, brown otherwise
            const boxImg = egg.mBrooding ? eggBroodImg : eggRefImg;
            if (boxImg && boxImg.img && g._isReady(boxImg.img)) {
                ctx.drawImage(boxImg.img, ex, ey, sz, sz);
            } else {
                g.setColor(egg.mBrooding ? 200 : 100, egg.mBrooding ? 160 : 80, egg.mBrooding ? 30 : 50, 255);
                g.fillRect(ex, ey, sz, sz);
            }
            // Yellow pulsing halo when ready to be brooded (clickable hint)
            if (!egg.mBrooding) {
                const pulse = 0.6 + 0.4 * Math.abs(Math.sin(Date.now() / 300));
                ctx.strokeStyle = `rgba(255,220,80,${pulse.toFixed(2)})`;
                ctx.lineWidth = 2;
                ctx.strokeRect(ex + 1, ey + 1, sz - 2, sz - 2);
            }

            // Draw egg sprite (frame 0) inside the box, tinted per egg type
            // using the same pre-baked tint cache as the field eggs
            // (Gem.js:getTintedEggCel). Tint palette matches the original
            // mission_eggs_*.png icons (layer=white, magic=blue, holy=red,
            // rooster=dark, broody=golden).
            if (eggImg && eggImg.img && g._isReady(eggImg.img)) {
                const ew = eggImg.getCelWidth();
                const eh = eggImg.getCelHeight();
                const scale = Math.min((sz - 8) / ew, (sz - 8) / eh);
                const dx = ex + (sz - ew * scale) / 2;
                const dy = ey + (sz - eh * scale) / 2;
                const tinted = getTintedEggCel(eggImg, 0, egg.mEggType);
                if (tinted) {
                    ctx.drawImage(tinted, 0, 0, ew, eh, dx, dy, ew * scale, eh * scale);
                } else {
                    ctx.drawImage(eggImg.img, 0, 0, ew, eh, dx, dy, ew * scale, eh * scale);
                }
            }

            // Brood progress bar — at bottom of box
            // From decompiled: IMAGE_EGG_REF_BROOD_PROGRESS (45x10)
            // Drawn when progress > 0, width scaled by progress fraction
            if (egg.mBrooding && egg.mBroodProgress > 0) {
                const pct = egg.mBroodProgress;
                const barFullW = sz - 8; // 46px max width inside 54px box
                const barW = Math.floor(barFullW * pct);
                const barH = 10;
                const barX = ex + 4;
                const barY = ey + sz - barH - 4; // bottom of box with small margin
                if (eggProgressImg && eggProgressImg.img && g._isReady(eggProgressImg.img)) {
                    ctx.drawImage(eggProgressImg.img, 0, 0, eggProgressImg.mWidth, eggProgressImg.mHeight,
                        barX, barY, barW, barH);
                } else {
                    g.setColor(50, 80, 220, 255);
                    g.fillRect(barX, barY, barW, barH);
                }
            }
        }

        // === TASK PROGRESS (right side, with mission icons) ===
        const slotTaskImg = IMAGES.IMAGE_NUMBER_SLOT_TASK;
        const missionIcons = {
            [TaskType.COLLECT_COINS]: 'IMAGE_MISSION_COIN',
            [TaskType.COLLECT_BLUE_DIAMONDS]: 'IMAGE_MISSION_DIAMONDS_BLUE',
            [TaskType.COLLECT_RED_DIAMONDS]: 'IMAGE_MISSION_DIAMONDS_RED',
            [TaskType.EARN_MONEY]: 'IMAGE_MISSION_MONEY',
            [TaskType.COLLECT_WHITE_EGGS]: 'IMAGE_MISSION_EGGS',
            [TaskType.COLLECT_BLUE_EGGS]: 'IMAGE_MISSION_EGGS_MAGIC',
            [TaskType.COLLECT_RED_EGGS]: 'IMAGE_MISSION_EGGS_HOLY',
            [TaskType.COLLECT_BLACK_EGGS]: 'IMAGE_MISSION_EGGS_ROOSTER',
            [TaskType.RAISE_CHICKENS]: 'IMAGE_MISSION_CHICKENS',
            [TaskType.HATCH_MAGIC]: 'IMAGE_MISSION_CHICKENS_MAGIC',
            [TaskType.HATCH_HOLY]: 'IMAGE_MISSION_CHICKENS_HOLY',
            [TaskType.RAISE_ROOSTERS]: 'IMAGE_MISSION_CHICKENS_ROOSTER',
        };
        let taskIdx = 0;
        // Per FUN_0040a3d6:13757-13759 — task slot bg at y = slot.h * index + 0x50
        // (80) with slot natural height 42. Per :13760-13771 the time-limit
        // task is rendered first so it sits at the top.
        const taskY0 = 80;
        const taskStep = 42;
        for (let i = 0; i < this.mTasks.length; i++) {
            const task = this.mTasks[i];
            if (task.type !== TaskType.TIME_LIMIT) continue;
            const remaining = Math.max(0, task.target - this.mTimeElapsed);
            const sec = Math.floor(remaining / 1000);
            const min = Math.floor(sec / 60);
            const ss = (sec % 60).toString().padStart(2, '0');
            const ty = taskY0 + taskIdx * taskStep;
            if (slotTaskImg && slotTaskImg.img && g._isReady(slotTaskImg.img)) {
                ctx.drawImage(slotTaskImg.img, 680, ty, 116, 32);
            }
            // Time icon
            const tImg = IMAGES.IMAGE_MISSION_TIME;
            if (tImg && tImg.img && g._isReady(tImg.img)) {
                ctx.drawImage(tImg.img, 684, ty + 2, 28, 28);
            }
            // Red when remaining ≤ 30s; blink white in last 10s
            const isLow = remaining < 30000;
            const blink = remaining < 10000 && (Math.floor(this.mTimeElapsed / 250) % 2 === 0);
            ctx.fillStyle = blink ? '#fff' : (isLow ? '#ff4444' : '#fff');
            ctx.font = 'bold 14px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${min.toString().padStart(2, '0')}:${ss}`, 752, ty + 22);
            taskIdx++;
        }
        for (let i = 0; i < this.mTasks.length; i++) {
            const task = this.mTasks[i];
            if (task.type === TaskType.TIME_LIMIT) continue;
            const progress = this.mTaskProgress[i] || 0;
            const ty = taskY0 + taskIdx * taskStep;

            // Task slot background
            if (slotTaskImg && slotTaskImg.img && g._isReady(slotTaskImg.img)) {
                ctx.drawImage(slotTaskImg.img, 680, ty, 116, 32);
            }

            // Subtle progress fill behind text
            const pct = Math.max(0, Math.min(1, progress / Math.max(1, task.target)));
            if (pct > 0) {
                ctx.fillStyle = progress >= task.target ? 'rgba(100,200,100,0.35)' : 'rgba(255,200,80,0.25)';
                ctx.fillRect(716, ty + 4, 76 * pct, 24);
            }

            // Mission icon
            const iconKey = missionIcons[task.type];
            const iconImg = iconKey ? IMAGES[iconKey] : null;
            if (iconImg && iconImg.img && g._isReady(iconImg.img)) {
                ctx.drawImage(iconImg.img, 684, ty + 2, 28, 28);
            }

            // Progress text "0 / 15"
            ctx.fillStyle = progress >= task.target ? '#64c864' : '#fff';
            ctx.font = 'bold 14px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${progress} / ${task.target}`, 752, ty + 22);
            taskIdx++;
        }

        // Risk icon — drawn under the task list when ready (FUN_00409af0:12452).
        // Position per decompiled: x = 0x2da (730), y = (count-1) * NUMBER_SLOT_TASK.h + 0x75.
        // With slot.h=42, that's (count-1)*42 + 117. Gated to level >= 7 since
        // the question-mark surprise is introduced by the L7 description
        // ("Click on the question mark button. You might benefit from
        // something great...or you might get a 'fowl' surprise.").
        if (this.mRiskReady && taskIdx > 0 && this.mCurrentLevel >= 7) {
            const ry = (taskIdx - 1) * taskStep + 117;
            const riskImg = IMAGES.IMAGE_ICON_RISK;
            if (riskImg && riskImg.img && g._isReady(riskImg.img)) {
                const fw = riskImg.getCelWidth();
                const fh = riskImg.getCelHeight();
                // icon_risk.jpg is 900x60 → auto-detected as 15 frames × 60px
                // cel-width. Cycle through frames at 6 ticks/frame (90-tick
                // loop ≈ 0.9s) so the "?" icon visibly pulses, drawing the
                // player's attention to the surprise option. Without this we
                // were rendering only frame 0 of a 15-frame sprite strip —
                // the other 14 frames (loaded by Res.js) were dead pixels.
                // mRiskAnimTimer ticks in update() at game-tick (100Hz), not
                // here in draw — keeps cycle speed display-fps independent.
                const numFrames = (riskImg.mNumCols || 1) * (riskImg.mNumRows || 1);
                const frame = numFrames > 1
                    ? Math.floor((this.mRiskAnimTimer || 0) / 6) % numFrames
                    : 0;
                const cols = riskImg.mNumCols || 1;
                const sx = (frame % cols) * fw;
                const sy = Math.floor(frame / cols) * fh;
                ctx.drawImage(riskImg.img, sx, sy, fw, fh, 730, ry, fw, fh);
                this._riskIconRect = { x: 730, y: ry, w: fw, h: fh };
            } else {
                ctx.fillStyle = '#ff8';
                ctx.fillRect(730, ry, 40, 40);
                ctx.fillStyle = '#000';
                ctx.font = 'bold 28px Arial Black, Arial, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('?', 750, ry + 30);
                this._riskIconRect = { x: 730, y: ry, w: 40, h: 40 };
            }
        } else {
            this._riskIconRect = null;
        }

        // Rooster-needed warning (visual hint when ravens are around but few roosters).
        // Per FUN_0040134a:446-461 + FUN_00401308: needed = max(0, (alive-1)/5 - 1)
        // (or -5 if elephant pet is present).
        if (this.mLevelConfig && this.mLevelConfig.hasRavens) {
            const aliveAll = this.mField.mChickens.filter(c => c.mIsAlive);
            const adults = aliveAll.filter(c => c.mIsAdult);
            const roosters = adults.filter(c => c.mType === 2).length;
            const hasEle = this.mField.mPets && this.mField.mPets.some(
                p => p.mType === 1
            );
            const tier = Math.floor((aliveAll.length - 1) / 5);
            const needed = Math.max(0, tier - (hasEle ? 5 : 1));
            if (aliveAll.length > 3 && roosters < needed) {
                ctx.fillStyle = '#ff4444';
                ctx.font = 'bold 11px Arial, sans-serif';
                ctx.textAlign = 'right';
                // Position below the task strip — with up to 4 task slots
                // (taskStep=42 starting at y=80), the strip can reach y=80+4*42=248.
                // Place the warning at y=260 so it doesn't overlap the slot text
                // (which centers at slot.y+22 — would clash with the previous
                // y=96 hardcoded position).
                const warnY = 80 + Math.min(this.mTasks.length, 4) * 42 + 14;
                ctx.fillText(`Need ${needed - roosters} more rooster${needed - roosters > 1 ? 's' : ''}!`, 795, warnY);
            }
        }
        // No chicken-count cap indicator — the original game has no permanent
        // cap on alive chickens (the DAT_0050034c table {5,9,12} is the
        // hen-house auto-spawn count per tier, not a buy cap). Showing
        // "X / Y chickens" implied a cap that doesn't exist.
        const baseInfoY = 80 + Math.min(this.mTasks.length, 4) * 42 + 14;
        let infoY = baseInfoY + 14;
        // Raven-scared indicator (RiskCaseRavensScared timer)
        if (this.mRavenScaredTimer > 0) {
            ctx.fillStyle = '#ffd700';
            ctx.font = 'bold 11px Arial, sans-serif';
            ctx.textAlign = 'right';
            const sec = Math.ceil(this.mRavenScaredTimer / 100);
            ctx.fillText(`Ravens scared (${sec}s)`, 795, infoY);
        }

        ctx.textAlign = 'left';
    }

    _getTaskLabel(task) {
        switch (task.type) {
            case TaskType.COLLECT_COINS: return 'Coins';
            case TaskType.COLLECT_BLUE_DIAMONDS: return 'Blue Gems';
            case TaskType.COLLECT_RED_DIAMONDS: return 'Red Gems';
            case TaskType.EARN_MONEY: return 'Money';
            case TaskType.COLLECT_WHITE_EGGS: return 'Eggs';
            case TaskType.COLLECT_BLUE_EGGS: return 'Blue Eggs';
            case TaskType.COLLECT_RED_EGGS: return 'Red Eggs';
            case TaskType.COLLECT_BLACK_EGGS: return 'Black Eggs';
            case TaskType.RAISE_CHICKENS: return 'Chickens';
            case TaskType.HATCH_MAGIC: return 'Magic';
            case TaskType.HATCH_HOLY: return 'Holy';
            case TaskType.RAISE_ROOSTERS: return 'Roosters';
            default: return '???';
        }
    }

    // Handle click on field - collect items, scare ravens, feed chickens
    handleClick(x, y, handMode) {
        if (this.mIsPaused || this.mIsLevelComplete || this.mIsLevelFailed) return;

        // Check ravens first (click to scare). Skip ravens already in
        // SCARED state — re-scaring fires SOUND_KAR_KAR + SOUND_SHOOT
        // again for no effect (state is already SCARED), so clicking a
        // fleeing raven would spam two sounds per click.
        // Direct-hit pass — find the raven under the cursor.
        let primaryRaven = null;
        for (const raven of this.mField.mRavens) {
            if (raven.mIsAlive && raven.mState !== 3 /* SCARED */
                && raven.contains(x, y)) {
                primaryRaven = raven;
                break;
            }
        }
        if (primaryRaven) {
            primaryRaven.scare();
            if (SOUNDS.SOUND_SHOOT) SOUNDS.SOUND_SHOOT.play();
            this.addFloatingText(x, y, '*BANG*', '#ff8');
            // gun_area upgrade ("Wide Slingshot — scares all ravens in an
            // area"): also scare every other unscared raven within a 120px
            // splash radius. Previously this upgrade only changed the cursor
            // graphic; the actual hit was single-target identical to the
            // base gun, making the upgrade a placebo on raven-heavy levels.
            if (this.mGunArea) {
                const splashR2 = 120 * 120;
                for (const r of this.mField.mRavens) {
                    if (r === primaryRaven) continue;
                    if (!r.mIsAlive || r.mState === 3) continue;
                    const dx = r.mX - primaryRaven.mX;
                    const dy = r.mY - primaryRaven.mY;
                    if (dx * dx + dy * dy < splashR2) r.scare();
                }
            }
            return;
        }
        // Click on wolf to hurt it. Hit box matches the visible sprite
        // (~135x130 wolf cell, centered on mX/mY). Previous 40px circle
        // only covered the wolf's belly so clicks on snout/tail/legs
        // missed and the wolf felt unresponsive to shots.
        for (const wolf of this.mField.mWolves || []) {
            if (wolf.mIsAlive) {
                const dx = wolf.mX - x;
                const dy = wolf.mY - y;
                if (Math.abs(dx) <= 60 && Math.abs(dy) <= 50) {
                    // gun_power upgrade increases per-shot damage so wolves
                    // die in 2 hits instead of 3 (HP 3, mGunPower=2 damage).
                    // mGunPower defaults to 1 — set to 2 by gun_1 upgrade.
                    const dmg = this.mGunPower || 1;
                    if (wolf.hit) wolf.hit(dmg, dx > 0 ? 1 : -1, -1);
                    if (SOUNDS.SOUND_SHOOT) SOUNDS.SOUND_SHOOT.play();
                    this.addFloatingText(x, y, '*HIT*', '#ff8');
                    return;
                }
            }
        }

        // LEFT CLICK behavior (from decompiled FUN_0040cc71):
        // 1. Click on raven = scare/shoot it
        // 2. Click on sick chicken = cure ($50 cost from FUN_0040490a)
        // 3. Click on egg = collect directly for money (no dialog!)
        // 4. Click on coin/gem = collect for money + floating text
        // 5. Click on field = drop seeds (costs $1)

        // Check sick chickens first (cursor changes on hover).
        // Hit-box covers the chick's visible body: chick.mY is the feet
        // position and the sprite extends ~70px up. Previous circular check
        // around mY (r=30) missed clicks on the head/body — only feet were
        // clickable. Use an AABB that spans (mX±25) × (mY-70, mY+15).
        for (const c of this.mField.mChickens) {
            // Skip carried (mid-air with raven) — curing them just wastes
            // $50; the raven still flies off-screen and the chick dies.
            if (c.mIsAlive && c.mIsSick && !c.mIsCarried) {
                const inX = Math.abs(c.mX - x) <= 25;
                const inY = (y >= c.mY - 70 && y <= c.mY + 15);
                if (inX && inY) {
                    // Cure costs $50 from decompiled: 0x32
                    if (this.mMoney >= this.mCureCost) {
                        // Use spendMoney so the HUD money number flashes red,
                        // signalling the deduction in addition to the floating
                        // text. Direct mMoney -= 50 misses the flash.
                        this.spendMoney(this.mCureCost);
                        c.cure();
                        // Distinct success message — "Cured -$50" in green so
                        // the player clearly distinguishes a successful cure
                        // from the insufficient-funds "Need $50" message.
                        this.addFloatingText(c.mX, c.mY - 40,
                            `Cured -$${this.mCureCost}`, '#5cff5c');
                    } else {
                        // Player tried to cure but can't afford — give visible
                        // feedback in addition to the error blip, otherwise it
                        // looks like the click did nothing.
                        if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
                        this.addFloatingText(c.mX, c.mY - 40,
                            `Cure costs $${this.mCureCost}!`, '#ff4444');
                    }
                    return;
                }
            }
        }

        // Click on any collectible (eggs, coins, diamonds) = collect directly.
        // Eggs flagged for brooding (mBrooding=true via the HUD egg-box) are
        // committed to the nest — clicking them on the field must NOT cash
        // them in, otherwise the player can accidentally sell an egg that a
        // broody is already walking to. Original UX behavior — exact decompiled
        // FUN_xxxxxxxx UNKNOWN, but matches the game flow where the egg-box
        // click is the commit gesture and on-field click is the sell gesture.
        for (const gem of this.mField.mGems) {
            if (gem.mIsAlive && !gem.mCollected && gem.contains(x, y)) {
                if (gem.mType === 4 /* EGG */ && gem.mBrooding) {
                    if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
                    this.addFloatingText(gem.mX, gem.mY - 30,
                        'Brooding — can\'t sell', '#ffd080');
                    return;
                }
                const value = gem.collect();
                if (value > 0) {
                    this.addMoney(value);
                    // Floating score text — color matches the collectible type.
                    // Gem.js: GemType.COIN_GOLD=0, COIN_SILVER=1, DIAMOND_BLUE=2, DIAMOND_RED=3, EGG=4
                    // (matches the decompiled struct +0x08 numbering — FUN_0040c4d9:15155+)
                    let color = '#fff';
                    if (gem.mType === 0) color = '#ffd700';        // CoinGold
                    else if (gem.mType === 1) color = '#cccccc';   // CoinSilver
                    else if (gem.mType === 2) color = '#5cb8ff';   // DiamondBlue
                    else if (gem.mType === 3) color = '#ff5c5c';   // DiamondRed
                    else if (gem.mType === 4) color = '#fff5e0';   // Egg (warm white)
                    this.addFloatingText(gem.mX, gem.mY - 10, `+$${value}`, color);
                    this.addParticleBurst(gem.mX, gem.mY, color,
                        gem.mType >= 2 ? 14 : 10);
                    // Track for task progress
                    if (gem.mType === 4) { // EGG
                        this._trackEggCollection(gem);
                    } else {
                        this._trackCollection(gem);
                    }
                }
                return;
            }
        }

        // Left click on field = single seed drop (costs $1)
        if (handMode === 'seeds') {
            this._feedArea(x, y);
        }
    }

    _feedArea(x, y) {
        // Left click single seed drop costs $1 - from decompiled FUN_004015f8
        if (this.mMoney > 0) {
            this.mMoney--;
            this.mField.dropSeeds(x, y, this.mSeedCount, this.mSeedCalories);
        } else {
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
        }
    }

    // JS-port helper: add a floating score text at position. The original
    // doesn't use floating texts for collection events (it shows the value
    // in a popup dialog at FUN_0041e8e0 instead). FUN_00424b5d cited
    // previously is unrelated — that's an add-and-cap helper on a different
    // struct. Keep this as JS-port visual polish.
    addFloatingText(x, y, text, color) {
        this.mFloatingTexts.push({
            x, y, text, color: color || '#fff',
            timer: 0, maxTimer: 80, // ~0.8 seconds
        });
    }

    updateFloatingTexts() {
        for (const ft of this.mFloatingTexts) {
            ft.timer++;
            ft.y -= 0.5; // float upward
        }
        this.mFloatingTexts = this.mFloatingTexts.filter(ft => ft.timer < ft.maxTimer);
    }

    updateClickRipples() {
        // Advance ripple timers in update (tick-fps) so animation speed
        // doesn't change with display refresh rate. Previously inlined in
        // drawClickRipples, which ran at requestAnimationFrame cadence.
        for (const r of this.mClickRipples) r.t++;
        this.mClickRipples = this.mClickRipples.filter(r => r.t < 25);
    }

    drawClickRipples(g) {
        const ctx = g.ctx;
        for (const r of this.mClickRipples) {
            const a = 1 - r.t / 25;
            ctx.globalAlpha = a;
            ctx.strokeStyle = r.color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(r.x, r.y, r.t * 1.5, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    drawFloatingTexts(g) {
        const ctx = g.ctx;
        for (const ft of this.mFloatingTexts) {
            const alpha = 1 - ft.timer / ft.maxTimer;
            ctx.globalAlpha = alpha;
            // Sparkle ring on first 8 ticks of "+$X" texts (collect feedback)
            if (ft.timer < 8 && ft.text && ft.text.startsWith('+$')) {
                ctx.strokeStyle = ft.color;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(ft.x, ft.y + 12, 6 + ft.timer * 2, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.fillStyle = ft.color;
            ctx.font = 'bold 14px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(ft.text, ft.x, ft.y);
        }
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
    }

    _trackCollection(gem) {
        switch (gem.mType) {
            case 0: // COIN_GOLD (per Gem struct +0x08, FUN_0040c4d9:15155)
            case 1: // COIN_SILVER
                this.mCollectedCoins++;
                break;
            case 2: // DIAMOND_BLUE
                this.mCollectedBlueDiamonds++;
                break;
            case 3: // DIAMOND_RED
                this.mCollectedRedDiamonds++;
                break;
        }
    }

    _trackEggCollection(egg) {
        // Track by egg type for task progress. Golden (type 4 = broody-chick
        // egg) doesn't have a COLLECT_GOLDEN_EGGS task — don't fall back to
        // bumping the white-egg counter, otherwise selling a broody egg would
        // falsely progress a "collect white eggs" task.
        switch (egg.mEggType) {
            case 0: this.mCollectedWhiteEggs++; break;  // WHITE
            case 1: this.mCollectedBlueEggs++; break;   // BLUE
            case 2: this.mCollectedRedEggs++; break;    // RED
            case 3: this.mCollectedBlackEggs++; break;  // BLACK
            // case 4 GOLDEN: not tracked — no matching task type.
        }
    }
}
