// Port of the gameplay "world" logic that the original keeps on the Core
// sub-objects created per level by FUN_00406069 (rwg_functions.c:7496):
//   app+0x04  game state   (+0 level number, +4 paused, +8 elapsed ticks)
//   app+0x0c  money object (+0 "no income" byte, +4 money, +8 cap; -1 = none)
//   app+0x10  raven/wolf attack controller (FUN_00401202, 0x44 bytes)
//   app+0x14  field (chicken list; +8 = chicken count)
//   app+0x1c  seed controller (FUN_0041be8a; +0x20 = seed upgrade level)
//   app+0x24  egg controller   app+0x28 gem controller
//   app+0x30  shop slots (FUN_0041e7f2; +4 = price-inflation flag)
//   app+0x34  level object (FUN_0042166f; tasks, +0x14 bonus flag, +0x48 ace secs)
// Sexy::FieldController itself (vtable 004dca94) is an 8-byte object whose
// only virtual method is the destructor FUN_004081ae (rwg_functions.c:10322);
// all of the game logic ported below lives in the non-virtual functions cited
// per method.
//
// Per-tick order of the original Core::Update FUN_00405fcf (rwg_functions.c:7445):
//   elapsed++ (state+8) → FUN_004015f8 ravens → FUN_004043fd field → ... →
//   FUN_0041ea9a shop inflation → ... → FUN_0041b901 risk → FUN_0040cc71 hand →
//   FUN_00421b21 task check / level end.

import { Field } from './Field.js';
import { createChick, ChickType } from './Chick.js';
import { TaskType, getLevelConfig } from './LevelData.js';
import { IMAGES, SOUNDS } from './Res.js';
import { Wolf, Mouse, Elephant } from './Pet.js';

// DAT_0050032c chicken buy prices (rwg_functions.c:6690-6706).
const CHICK_BASE_PRICES = [100, 200, 500, 1000, 1200];
// DAT_0050034c seeds dropped per click by seed upgrade level (rwg_functions.c:6677-6685),
// read by FUN_0041bfe2 (rwg_functions.c:34304).
const SEEDS_PER_DROP = [5, 9, 12];
// FUN_0041bfe2 asm 0x41c01d-0x41c02f: price = ftol(count * 0.4 + 0.5)
// (_DAT_004e93d8 = 0.4 double, _DAT_004e90c8 = 0.5 double).
const SEED_PRICE_FACTOR = 0.4;
// FUN_0040490a (rwg_functions.c:5444-5450): cure costs 0x32.
const CURE_COST = 50;
// FUN_0040cc71 (rwg_functions.c:16117-16121): raven killed → FUN_00424b5d(+0x32).
const RAVEN_KILL_REWARD = 50;
// FUN_0041050c asm 0x410567: wolf killed → FUN_00406b22(0x1f4).
const WOLF_KILL_REWARD = 500;

// FUN_00422d10 money caps: *(iVar4 + 8) = N (cases 0x1e, 0x24, 0x2f, 0x30, 0x31:
// rwg_functions.c:43316, 43381, 43489, 43504, 43514). All other levels keep the
// FUN_00406069 default of -1 (no cap, rwg_functions.c:7531).
const MONEY_CAP_BY_LEVEL = { 30: 500, 36: 1000, 47: 800, 48: 800, 49: 1000 };

// FUN_00422d10 cases that write *(iVar10 + 4) = 1 (shop object app+0x30, +4
// = price-inflation flag read by FUN_0041ea9a): 0x20, 0x25, 0x27, 0x2b, 0x31, 0x32.
const INFLATION_LEVELS = new Set([32, 37, 39, 43, 49, 50]);

// FUN_00422d10: cases that zero raven-controller +0x14/+0x1c/+0x18 (no raven attacks).
const RAVENS_OFF_LEVELS = new Set([1, 2, 3, 9, 10, 11, 12, 19, 26, 41]);
// FUN_00422d10: cases that zero +0xc/+0x10 (no wolf attacks). Includes the
// goto targets LAB_00422e7f (4,5) and LAB_00422fe6 (9, 21).
const WOLVES_OFF_LEVELS = new Set([1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 17,
    18, 19, 21, 22, 23, 24, 41]);
// FUN_00422d10: *(iVar2 + 0x3c) = 1 for cases 0x1c, 0x2c, 0x2e, 0x31 (no-rooster
// levels) → FUN_0040134a uses the flat _DAT_004e93c0 = 0.02 attack chance.
const IGNORE_ROOSTER_LEVELS = new Set([28, 44, 46, 49]);

// Bonus ("competitive") levels → FUN_00423cb3(level, N, mult) with
// task 0xd = EAX*100 ticks. N/mult from the C (rwg_functions.c:43094-43509),
// EAX seconds from the asm at the switch targets (jump table 0x4238d4):
//   L8 0x422f98 (push 0x1e), L13 0x4230c7→0x422fa4 (0x1e), L16/20 0x42317b (0x2d),
//   L25 0x423310 (0x14), L33 0x4234dd→0x423316 (0x14), L38 0x423601→0x42331c (0x14),
//   L45 0x42378f→0x422fa4 (0x1e).
// mult floats: _DAT_004e941c=0.8, _DAT_004e9418=0.9, 1.0, _DAT_004e9414=1.1,
// _DAT_004e92a8=1.2 (read from app/chicken_chase.RWG .rdata).
const BONUS_LEVELS = {
    8:  { chicks: 3, mult: 0.8, seconds: 30 },
    13: { chicks: 4, mult: 0.9, seconds: 30 },
    16: { chicks: 4, mult: 1.0, seconds: 45 },
    20: { chicks: 4, mult: 1.0, seconds: 45 },
    25: { chicks: 4, mult: 1.1, seconds: 20 },
    33: { chicks: 4, mult: 1.2, seconds: 20 },
    38: { chicks: 5, mult: 0.9, seconds: 20 },
    45: { chicks: 5, mult: 1.0, seconds: 30 },
};

// rand()/RAND_MAX — FUN_00401148 (rwg_functions.c:203): rand() / _DAT_004e9178 (32767.0).
function rand01() {
    return Math.floor(Math.random() * 32768) / 32767;
}

export class FieldController {
    // Port of Sexy::FieldController - vtable at 004dca94 (destructor-only,
    // FUN_004081ae rwg_functions.c:10322).
    constructor(gameApp) {
        this.mGameApp = gameApp;
        this.mField = new Field();
        this.mField.mFieldController = this;
        this.mCurrentLevel = 1;             // state+0 (**(app+4))
        this.mMoney = 0;                    // money obj +4
        this.mMoneyCap = -1;                // money obj +8 (-1 = none, FUN_00406069:7531)
        this.mMoneyFrozen = false;          // money obj +0 (FUN_00424b5d gate)
        this.mTotalMoney = 0;               // JS-only statistic (not used by tasks)
        this.mTimeElapsed = 0;              // state+8 ticks, stored in ms (×10)
        this.mTimeLimit = 0;                // task 0xc/0xd target, in ms
        this.mTasks = [];
        this.mTaskProgress = [];            // task entry +4 (current)
        this.mTaskFlash = [];               // task entry +0xc (FUN_0042164e)
        this.mIsPaused = false;
        this.mIsLevelComplete = false;
        this.mIsLevelFailed = false;
        this.mFailReason = null;            // 'chickens' | 'time' | null
        this.mLevelConfig = null;
        this.mLevelAceTime = 0;
        this.mRavenCtl = null;              // app+0x10 (see _setupRavenController)
        this.mRavenScaredTimer = 0;         // app+0x10 +0x30 (RiskCaseRavensScared)
        this.mChickPriceInflation = 1.0;    // _DAT_004fc3b8 (FUN_00405540:6655)
        this.mInflationTick = 0;            // shop +0x1c (FUN_0041ea9a)
        this.mInflationEnabled = false;     // shop +4
        this.mEggSellDisabled = false;      // egg ctl +0x28 (FUN_00423e5a)
        this.mCollectedCoins = 0;           // gem counters [0]+[1]
        this.mCollectedBlueDiamonds = 0;    // gem counter [2]
        this.mCollectedRedDiamonds = 0;     // gem counter [3]
        this.mCollectedWhiteEggs = 0;       // egg counter, layer
        this.mCollectedBlueEggs = 0;        // egg counter, magic
        this.mCollectedRedEggs = 0;         // egg counter, holy
        this.mCollectedBlackEggs = 0;       // egg counter, rooster
        this.mCollectedGoldenEggs = 0;      // egg counter, broody
        this.mHatchedMagic = 0;             // JS-only statistics (tasks use live counts)
        this.mHatchedHoly = 0;
        this.mHatchedRooster = 0;
        this.mTotalRaisedChicks = 0;
        // Seed calories — UNKNOWN — not found in decompiled (FUN_0041c0a8 per-seed
        // values not traced); kept from the previous port for Field/Chick.
        this.mSeedCalories = 30;
        this.mSeedCount = SEEDS_PER_DROP[0];
        this.mGunPower = 1;                 // (app+0x40)+0x11 → damage 2 when set
        this.mGunArea = false;              // (app+0x40)+0x10 → 20px crosshair
        this.mPlayerHouseUpgrade = 0;
        this.mHasElephant = false;
        this.mHasMouse = false;
        this.mSicknessFactor = 0;
        this.mBonusAchieved = false;
        this.mNextUpgradeHalfPrice = false;
        this._bonusStartChicks = 0;         // level obj +0x50 (FUN_00423cb3:43857)
        // JS-only visual effects (not present in the original).
        this.mFloatingTexts = [];
        this.mClickRipples = [];
        this.mParticles = [];
        this.mConfettiTimer = 0;
        this.mShakeMag = 0;
    }

    // JS-only VFX — screen shake (no original counterpart).
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

    // JS-only VFX — click ripple (no original counterpart).
    addClickRipple(x, y, color = '#fff') {
        this.mClickRipples.push({ x, y, color, t: 0 });
    }

    // JS-only VFX — particle burst (no original counterpart).
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

    // JS-only VFX — confetti (no original counterpart).
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
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.angle);
                ctx.fillRect(-p.size, -p.size / 2, p.size * 2, p.size);
                ctx.restore();
            } else {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }

    // Level start = FUN_00406069 (fresh world, rwg_functions.c:7496) →
    // FUN_0042166f (level object + starter chickens, rwg_functions.c:41149) →
    // FUN_00422c01 (money / raven defaults, rwg_functions.c:42819) →
    // FUN_00422d10 (per-level switch, rwg_functions.c:42903).
    startLevel(level) {
        this.mCurrentLevel = level;
        this.mLevelConfig = getLevelConfig(level);
        const cfg = this.mLevelConfig;
        const bonus = BONUS_LEVELS[level] || null;

        // Level object +0x48 (FUN_00422d10, e.g. case 1: 0x2c) is the Ace time in
        // seconds: screenshots/17.png shows L1 "Ace time 00:44" = 0x2c
        // (LevelData `aceTime`). Bonus levels never write +0x48 (FUN_00423cb3)
        // → UNKNOWN — not found in decompiled (0 shown as 00:00).
        this.mLevelAceTime = (cfg.aceTime > 0) ? cfg.aceTime * 1000 : 0;

        this.mField = new Field();
        this.mField.mFieldController = this;
        this.mTimeElapsed = 0;
        this.mSicknessFactor = cfg.sicknessFactor;
        this.mIsLevelComplete = false;
        this.mIsLevelFailed = false;
        this.mFailReason = null;
        this.mIsPaused = false;
        this.mBonusAchieved = false;

        // Player-profile upgrades are re-applied by GameView after this call.
        this.mPlayerHouseUpgrade = 0;
        this.mSeedCalories = 30;
        this.mSeedCount = SEEDS_PER_DROP[0];
        this.mGunPower = 1;
        this.mGunArea = false;
        this.mField.mUpgradeLevel = Math.max(cfg.upgradeLevel || 0, this.mPlayerHouseUpgrade || 0);

        this.mTotalMoney = 0;
        this.mCollectedCoins = 0;
        this.mCollectedBlueDiamonds = 0;
        this.mCollectedRedDiamonds = 0;
        this.mCollectedWhiteEggs = 0;
        this.mCollectedBlueEggs = 0;
        this.mCollectedRedEggs = 0;
        this.mCollectedBlackEggs = 0;
        this.mCollectedGoldenEggs = 0;
        this.mHatchedMagic = 0;
        this.mHatchedHoly = 0;
        this.mHatchedRooster = 0;
        this.mTotalRaisedChicks = 0;
        this.mLaySoundCd = 0;
        this.mSickSoundCd = 0;

        // Tasks. Bonus levels: FUN_00423cb3:43837 task 0xd = EAX*100 ticks.
        if (bonus) {
            this.mTasks = [{ type: TaskType.TIME_LIMIT, target: bonus.seconds * 1000 }];
            this.mTimeLimit = bonus.seconds * 1000;
        } else {
            this.mTasks = cfg.tasks;
            this.mTimeLimit = cfg.timeLimit;
        }
        this.mTaskProgress = this.mTasks.map(() => 0);
        this.mTaskFlash = this.mTasks.map(() => 0);

        // Money object (FUN_00406069:7524-7531): flag 0, money 0, cap -1.
        this.mMoneyFrozen = false;
        this.mMoneyCap = MONEY_CAP_BY_LEVEL[level] || -1;
        this.mEggSellDisabled = false;
        // _DAT_004fc3b8 = 1.0 (FUN_00405540:6655, called from FUN_00406069).
        this.mChickPriceInflation = 1.0;
        this.mInflationTick = 0;
        this.mInflationEnabled = (cfg.priceRisesOverTime !== undefined)
            ? !!cfg.priceRisesOverTime : INFLATION_LEVELS.has(level);
        // Shop slot purchase counters — JS mirror of the per-slot limits.
        this._specialShopBoughtCount = [0, 0, 0, 0, 0];

        // FUN_0042166f:41259 money = 1000000 while the starter chickens are bought.
        this.mMoney = 1000000;
        this._setupStartingChickens();

        // FUN_00422c01 (rwg_functions.c:42840-42858): money = 200 / 300 (lvl>9) /
        // 400 (lvl>29), +100 when FUN_00405886 (level < 7). screenshots/13.png:
        // L1 shows $294 after three $2 seed drops = 300 start.
        let startMoney = 200;
        if (level > 9) startMoney = 300;
        if (level > 0x1d) startMoney = 400;
        if (level < 7) startMoney += 100;
        this.mMoney = startMoney;

        // FUN_00422c01 / FUN_00422d10 / FUN_00423cb3 raven+wolf controller.
        this._setupRavenController(level, bonus, cfg.raven);

        if (bonus) {
            // FUN_00423cb3:43850 FUN_00423deb(N): buy layers until N chickens
            // (money temporarily 1000000, FUN_00423deb:43941-43958).
            this._buyStarterUntil(bonus.chicks);
            // FUN_00423cb3:43857 level +0x50 = chicken count (perfect check).
            this._bonusStartChicks = this.mField.getAliveChickCount();
            // FUN_00423cb3:43859 money = 10000.
            this.mMoney = 10000;
        } else {
            this._bonusStartChicks = 0;
        }
        if (level === 0x22 || level === 0x25) {
            // FUN_00423e5a (rwg_functions.c:43976-43989), cases 0x22 / 0x25:
            // money obj +0 = 1 (no income), money = 5000, egg selling off.
            this.mMoneyFrozen = true;
            this.mMoney = 5000;
            this.mEggSellDisabled = true;
        }
        if (level === 0x23) {
            // case 0x23 (rwg_functions.c:43360): FUN_00423deb(10); money restored.
            this._buyStarterUntil(10);
        }

        // Pets — the original rebuilds the pet list (app+0x44) per level; whether
        // purchased pets carry over is UNKNOWN — not found in decompiled.
        // JS keeps the previous behaviour (re-add owned pets).
        if (this.mHasMouse) {
            const m = new Mouse();
            m.mX = 100 + Math.random() * 600;
            m.mY = 380 + Math.random() * 180;
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

        // JS-only VFX reset.
        this.mFloatingTexts = [];
        this.mClickRipples = [];
        this.mParticles = [];
        this.mConfettiTimer = 0;
        this.mShakeMag = 0;
        this.mMoneyFlashTimer = 0;
    }

    // FUN_0042166f starter purchases, decoded from asm 0x421828-0x421917
    // (chicken type is passed in EAX, slot index in ESI — not visible in the C
    // at rwg_functions.c:41260-41300):
    //   slot0 limit 3, buy type 0 ×3                       (always)
    //   if FUN_00405886 (level<7): slot0=1, slot1=1, buy 0, buy 1
    //   if level>=10 && level!=29: slot1=1, buy 1
    //   if level>=30: slot0=1, buy 0
    // screenshots/13.png (L1): four layers + one broody.
    _setupStartingChickens() {
        const lvl = this.mCurrentLevel;
        const types = [ChickType.LAYER, ChickType.LAYER, ChickType.LAYER];
        if (lvl < 7) types.push(ChickType.LAYER, ChickType.BROODY);
        if (lvl >= 10 && lvl !== 0x1d) types.push(ChickType.BROODY);
        if (lvl >= 0x1e) types.push(ChickType.LAYER);
        for (const t of types) this._spawnBoughtChick(t);
        // FUN_0042166f:41297-41301 FUN_00404c34 (level>1) raises each chick's
        // +0x34 food to FUN_00405899()*5 — Chick.js uses a different food scale,
        // so this is not applied. UNKNOWN — not mappable to Chick.js units.
    }

    // FUN_00423deb (rwg_functions.c:43926): buy type-0 chickens until the
    // field holds N, with money temporarily 1000000, then restore money.
    _buyStarterUntil(n) {
        const saved = this.mMoney;
        this.mMoney = 1000000;
        while (this.mField.getAliveChickCount() < n) {
            if (!this._buySlot(ChickType.LAYER)) break;
        }
        this.mMoney = saved;
    }

    // FUN_00404865 (rwg_functions.c:5395) via FUN_0041e8f5: the chick is built
    // by FUN_00403ec2 → FUN_004032ca (state 4 = adult, scale 1.0,
    // rwg_functions.c:3441, 3480) at a random world point FUN_00408107
    // (rand%128, rand%72). The world→screen mapping is UNKNOWN — not found in
    // decompiled; the JS yard rectangle below is kept.
    _spawnBoughtChick(type) {
        const x = 120 + Math.random() * 560;
        const y = 380 + Math.random() * 180;
        const c = createChick(type, x, y);
        c.mIsAdult = true;
        c.mScale = 1.0;
        c.mGrowTimer = 800;
        this.mField.addChick(c);
        this.mTotalRaisedChicks++;
        return c;
    }

    // Raven/wolf controller app+0x10. Defaults FUN_00401202 (rwg_functions.c:284),
    // per-level base FUN_00422c01 (rwg_functions.c:42858-42879), overrides
    // FUN_00422d10 / FUN_00423cb3.
    // When LevelData supplies the same raw fields (cfg.raven, derived from the
    // same functions) they are used; the local tables are the fallback.
    _setupRavenController(level, bonus, raw) {
        this.mRavenScaredTimer = 0;                                   // +0x30
        if (raw) {
            this.mRavenCtl = {
                wolvesPerAttack: raw.wolvesPerWave, unk10: raw.f10,
                waveSize: raw.perWave, ravenHP: raw.f18, maxActive: raw.atOnce,
                remaining: 0, rollTick: 0, waveTimer: 0, attacking: false,
                bonusRate: raw.f34, rateDelay: raw.f38,
                ignoreRoosters: !!raw.fixedChance, speedMult: raw.f40,
            };
            return;
        }
        const ctl = {
            wolvesPerAttack: level >= 0x1f ? 2 : 1,                  // +0x0c (local_8)
            unk10: level >= 0x1f ? 6 : 7,                             // +0x10 — use UNKNOWN
            waveSize: level >= 0x1f ? 0x19 : (level > 10 ? 0xc : 8),  // +0x14
            ravenHP: level > 0x28 ? 2 : 1,                            // +0x18 (raven ctor HP, asm 0x40128f)
            maxActive: 4,                                             // +0x1c
            remaining: 0,                                             // +0x20
            rollTick: 0,                                              // +0x24
            waveTimer: 0,                                             // +0x28
            attacking: false,                                         // +0x2c
            bonusRate: 1.0,                                           // +0x34
            rateDelay: -1,                                            // +0x38
            ignoreRoosters: false,                                    // +0x3c
            speedMult: 1.0,                                           // +0x40 (raven ctor arg, asm 0x401288)
        };
        if (RAVENS_OFF_LEVELS.has(level)) {
            ctl.waveSize = 0; ctl.maxActive = 0; ctl.ravenHP = 0;
        }
        if (WOLVES_OFF_LEVELS.has(level)) {
            ctl.wolvesPerAttack = 0; ctl.unk10 = 0;
        }
        if (IGNORE_ROOSTER_LEVELS.has(level)) ctl.ignoreRoosters = true;
        if (level === 0x23) {
            // case 0x23 (rwg_functions.c:43354-43359): _DAT_004dc820 = 0.4.
            ctl.bonusRate = 0.4; ctl.rateDelay = 0;
            ctl.waveSize = 2; ctl.maxActive = 2; ctl.ravenHP = 1;
        } else if (level === 0x24) {
            ctl.bonusRate = 1.0; ctl.rateDelay = 24000;      // rwg_functions.c:43369-43370
        } else if (level === 0x2a) {
            ctl.bonusRate = 1.0; ctl.rateDelay = 30000;      // rwg_functions.c:43445-43446
        }
        if (bonus) {
            // FUN_00423cb3 (rwg_functions.c:43838-43846): +0x34 = _DAT_004dc7f8 (6.0),
            // +0x40 = mult, +0x38 = 0, +0x14 = +0x1c = N, +0x18 = 1.
            ctl.bonusRate = 6.0;
            ctl.speedMult = bonus.mult;
            ctl.rateDelay = 0;
            ctl.waveSize = bonus.chicks;
            ctl.maxActive = bonus.chicks;
            ctl.ravenHP = 1;
        }
        this.mRavenCtl = ctl;
    }

    _activeRavenCount() {
        return this.mField.mRavens.filter(r => r.mIsAlive).length;
    }

    _wolvesAlive() {
        // FUN_004104b3(2): a type-2 pet (wolf) exists.
        return (this.mField.mWolves || []).some(w => w.mIsAlive);
    }

    _hasElephant() {
        // FUN_004104b3(1): a type-1 pet (elephant) exists.
        return !!(this.mField.mPets && this.mField.mPets.some(p => p.mType === 1));
    }

    // FUN_0040123f (rwg_functions.c:313): spawn one raven at a target chick
    // (target pick FUN_0040178e lives in Field.spawnRaven). The raven ctor
    // FUN_00416c26 receives HP = ctl+0x18 and speed = ctl+0x40 (asm
    // 0x401288-0x40128f). Returns true when a raven was created.
    _spawnRaven() {
        const before = this.mField.mRavens.length;
        const res = this.mField.spawnRaven(this.mRavenCtl.ravenHP, this.mRavenCtl.speedMult);
        if (typeof res === 'boolean') return res;
        return this.mField.mRavens.length > before;
    }

    // FUN_00401308 (rwg_functions.c:393): roosters needed.
    _roostersNeeded() {
        if (!(this.mRavenCtl.waveSize > 0)) return 0;
        const t = Math.trunc((this.mField.getAliveChickCount() - 1) / 5);
        const needed = this._hasElephant() ? t - 5 : t - 1;
        return needed > 0 ? needed : 0;
    }

    // FUN_004014eb (rwg_functions.c:582): raven wave.
    _startRavenWave() {
        const ctl = this.mRavenCtl;
        ctl.remaining = ctl.waveSize;
        if (this._hasElephant()) ctl.remaining = Math.trunc((ctl.remaining * 2) / 3);
        for (let i = 0; i < ctl.maxActive; i++) {
            if (ctl.remaining < 1) return;
            if (this._spawnRaven()) ctl.remaining--;
        }
    }

    // FUN_00401543 (rwg_functions.c:620): wolf attack.
    _startWolfAttack() {
        const ctl = this.mRavenCtl;
        if (SOUNDS.SOUND_WOLF) SOUNDS.SOUND_WOLF.play();    // DAT_004feda0 :645
        let n = ctl.wolvesPerAttack;
        if (n > 2 && this._hasElephant()) n = 2;
        for (let i = 0; i < n; i++) {
            // FUN_0040178e picks a target chick; no target → no wolf.
            if (this.mField.getAliveChickCount() === 0) continue;
            // Wolf spawn position (pet factory FUN_00410299) UNKNOWN — not found
            // in decompiled; JS spawns at a field edge.
            const wolf = new Wolf();
            wolf.mX = Math.random() < 0.5 ? 50 : 750;
            wolf.mY = 380 + Math.random() * 180;
            wolf.mDirection = wolf.mX < 400 ? 1 : 0;
            this.mField.addWolf(wolf);
        }
    }

    // RiskCaseRavensAttack (FUN_0041b4ac) entry point used by RiskController.js.
    startAttackWave() {
        this.startRavenAttack();
    }

    // FUN_00401491 (rwg_functions.c:527): start an attack (also called by
    // RiskCaseRavensAttack FUN_0041b4ac after zeroing +0x30).
    startRavenAttack() {
        const ctl = this.mRavenCtl;
        if (!ctl) return;
        if (ctl.waveSize < 1) {
            this._startWolfAttack();
        } else if (ctl.wolvesPerAttack > 0 && rand01() >= 0.5) { // _DAT_004dc858 = 0.5
            this._startWolfAttack();
        } else {
            this._startRavenWave();
        }
        ctl.attacking = this._activeRavenCount() !== 0 || this._wolvesAlive();
    }

    // FUN_00401427 (rwg_functions.c:480): wave timer / continue a wave.
    _ravenWaveTick() {
        const ctl = this.mRavenCtl;
        if (ctl.waveSize < 1 && ctl.wolvesPerAttack < 1) return;
        if (!ctl.attacking) {
            ctl.waveTimer++;
            if (ctl.waveTimer < 9000) return;
            ctl.waveTimer = 0;
            this.startRavenAttack();
            return;
        }
        while (this._activeRavenCount() < ctl.maxActive && ctl.remaining > 0
            && this._spawnRaven()) {
            ctl.remaining--;
        }
        ctl.attacking = this._activeRavenCount() !== 0 || this._wolvesAlive();
    }

    // FUN_0040134a (rwg_functions.c:428): random single raven every 10 ticks.
    _ravenRandomTick() {
        const ctl = this.mRavenCtl;
        if (!(ctl.waveSize > 0) || ctl.attacking) return;
        ctl.rollTick++;
        if (ctl.rollTick <= 9) return;
        ctl.rollTick = 0;
        let p = 0.0;
        // FUN_00404ad0(2) counts every listed chicken of type 2.
        const roosters = this.mField.getChickCountByType(ChickType.ROOSTER);
        if (this.mField.getAliveChickCount() > 3) {
            const needed = this._roostersNeeded();
            if (needed < roosters) p = 0.0;
            else if (roosters === needed) p = 0.0033333334;     // _DAT_004e93d4
            else if (roosters === needed - 1) p = 0.033333335;  // _DAT_004e93d0
            else if (roosters === needed - 2) p = 0.05;         // _DAT_004dc84c
            else if (roosters === needed - 3) p = 0.1;          // _DAT_004e9170
            else p = 0.2;                                       // _DAT_004e90e0
        }
        // +0x38 == 0: p = +0x34 * _DAT_004e93c8 (0.1 double) * 2
        if (ctl.rateDelay === 0) p = ctl.bonusRate * 0.1 * 2;
        if (ctl.ignoreRoosters) p = 0.02;                      // _DAT_004e93c0
        if (rand01() < p) this._spawnRaven();
    }

    // FUN_004015f8 (rwg_functions.c:682) — controller part (the raven entity
    // updates themselves run in Field.update).
    _updateRavenController() {
        const ctl = this.mRavenCtl;
        if (!ctl) return;
        if (ctl.rateDelay > 0) ctl.rateDelay--;                       // :702-704
        if (this.mRavenScaredTimer < 1) {
            this._ravenWaveTick();
            this._ravenRandomTick();
        } else {
            this.mRavenScaredTimer--;                                  // :763-767
            if (ctl.attacking) {
                this._ravenWaveTick();
                this._ravenRandomTick();
            }
        }
    }

    // FUN_0041ea9a (rwg_functions.c:37884): with the inflation flag set, every
    // 101 ticks _DAT_004fc3b8 *= _DAT_004e9278 (1.003 double); slot prices refresh.
    _updateInflation() {
        if (!this.mInflationEnabled) return;
        if (this.mInflationTick < 100) {
            this.mInflationTick++;
        } else {
            this.mInflationTick = 0;
            this.mChickPriceInflation *= 1.003;
        }
    }

    // Core::Update FUN_00405fcf (rwg_functions.c:7445) — runs once per tick.
    update() {
        if (this.mIsPaused) return;   // state+4 paused → only FUN_0040907e
        const gameLogicPaused = this.mIsLevelComplete || this.mIsLevelFailed;
        if (!gameLogicPaused) {
            this._tickGameLogic();
        }
        // JS-only VFX timers.
        this.updateFloatingTexts();
        this.updateParticles();
        this.updateShake();
        this.updateClickRipples();
        if (this.mMoneyFlashTimer > 0) this.mMoneyFlashTimer--;
        if (this.mConfettiTimer > 0) {
            this.mConfettiTimer--;
            if (this.mConfettiTimer % 18 === 0) this.addConfetti(20);
        }
        if (this.mRiskReady) this.mRiskAnimTimer = (this.mRiskAnimTimer || 0) + 1;
        else this.mRiskAnimTimer = 0;
    }

    _tickGameLogic() {
        // FUN_00405fcf:7468 *(state+8) += 1 tick (10 ms).
        this.mTimeElapsed += 10;

        // FUN_004015f8 — raven/wolf attack controller.
        this._updateRavenController();

        // FUN_004043fd et al. — field entities.
        this.mField.update();

        if (this.mSickSoundCd > 0) this.mSickSoundCd--;
        if (this.mLaySoundCd > 0) this.mLaySoundCd--;
        // Random sickness. The original makes one random eligible chick sick every
        // FUN_00404caf() ticks (60/40/30/15/10 s by chicken count, halved by field
        // +0x26c) inside FUN_004043fd (rwg_functions.c:5084-5180) — Field scope.
        // This per-chick probability roll is the previous JS stand-in:
        // UNKNOWN — not found in decompiled (left unchanged until Field.js ports
        // FUN_004043fd).
        if (this.mSicknessFactor > 0) {
            for (const c of this.mField.mChickens) {
                if (c.mIsAlive && c.mIsAdult && !c.mIsSick
                    && Math.random() < 0.0001 * this.mSicknessFactor) {
                    c.mIsSick = true;
                    if (SOUNDS.SOUND_SICK && (this.mSickSoundCd || 0) === 0) {
                        SOUNDS.SOUND_SICK.play();
                        this.mSickSoundCd = 200;
                    }
                }
            }
        }

        // JS bookkeeping: release an egg whose claiming broody died/was sold.
        for (const gem of this.mField.mGems) {
            if (gem.mType === 4 && gem.mIsAlive && gem.mBrooding
                && gem._claimedBy
                && (!gem._claimedBy.mIsAlive || gem._claimedBy.mBroodingEgg !== gem)) {
                gem._claimedBy = null;
                gem.mBroodProgress = 0;
            }
        }

        // FUN_0041ea9a — chicken price inflation.
        this._updateInflation();

        // FUN_00421b21 — task progress + level end.
        this._checkTasks();
    }

    // FUN_00424b5d (rwg_functions.c:45035): add money unless the money object's
    // +0 flag is set; clamp to the cap when 0 < cap < money. With a position the
    // original also queues an effect (FUN_0040693f) — its look is UNKNOWN; the JS
    // shows a floating "+$N".
    addMoney(amount, x, y) {
        if (!(amount > 0)) return;
        if (this.mMoneyFrozen) return;
        this.mMoney += amount;
        this.mTotalMoney += amount;
        if (this.mMoneyCap > 0 && this.mMoneyCap < this.mMoney) {
            this.mMoney = this.mMoneyCap;
        }
        if (typeof x === 'number' && typeof y === 'number') {
            this.addFloatingText(x, y - 10, `+$${amount}`, '#ffd700');
        }
        // JS-only HUD flash.
        this.mMoneyFlashTimer = 30;
        this.mMoneyFlashColor = '#5cff5c';
    }

    // FUN_00403e23 (rwg_functions.c:4524): spend if money >= amount.
    spendMoney(amount) {
        if (!(amount > 0)) return false;
        if (this.mMoney >= amount) {
            this.mMoney -= amount;
            this.mMoneyFlashTimer = 30;          // JS-only HUD flash
            this.mMoneyFlashColor = '#ff5c5c';
            return true;
        }
        return false;
    }

    // Current value for one task — FUN_00421bc4 (rwg_functions.c:41547; counter
    // indices decoded from asm 0x421bc4-0x421d6f).
    _taskCurrent(task) {
        switch (task.type) {
            case TaskType.COLLECT_COINS:          // gem[0] + gem[1]
                return this.mCollectedCoins;
            case TaskType.COLLECT_BLUE_DIAMONDS:  // gem[2]
                return this.mCollectedBlueDiamonds;
            case TaskType.COLLECT_RED_DIAMONDS:   // gem[3]
                return this.mCollectedRedDiamonds;
            case TaskType.EARN_MONEY:             // current money (money obj +4); screenshots/29.png "442 / 1500" with Money 442
                return this.mMoney;
            case TaskType.COLLECT_WHITE_EGGS:     // sum of all egg counters
                return this.mCollectedWhiteEggs + this.mCollectedBlueEggs
                    + this.mCollectedRedEggs + this.mCollectedBlackEggs
                    + this.mCollectedGoldenEggs;
            case TaskType.COLLECT_BLUE_EGGS:      // egg[3] magic
                return this.mCollectedBlueEggs;
            case TaskType.COLLECT_RED_EGGS:       // egg[4] holy
                return this.mCollectedRedEggs;
            case TaskType.COLLECT_BLACK_EGGS:     // egg[2] rooster
                return this.mCollectedBlackEggs;
            case TaskType.RAISE_CHICKENS:         // field +8 chicken count
                return this.mField.getAliveChickCount();
            case TaskType.HATCH_MAGIC:            // FUN_00404ad0(3)
                return this.mField.getChickCountByType(ChickType.MAGIC);
            case TaskType.HATCH_HOLY:             // FUN_00404ad0(4)
                return this.mField.getChickCountByType(ChickType.HOLY);
            case TaskType.RAISE_ROOSTERS:         // FUN_00404ad0(2)
                return this.mField.getChickCountByType(ChickType.ROOSTER);
            case TaskType.TIME_LIMIT:             // state+8 elapsed
            case TaskType.EARN_MONEY_TIMED:
                return this.mTimeElapsed;
            default:
                return 0;
        }
    }

    _taskTarget(task) {
        // Task 0xc/0xd target lives in mTimeLimit so RiskCasePlusTime
        // (FUN_0041b0b3: target += 3000 ticks) can extend it.
        if (task.type === TaskType.TIME_LIMIT || task.type === TaskType.EARN_MONEY_TIMED) {
            return this.mTimeLimit;
        }
        return task.target;
    }

    // FUN_00421bc4 (rwg_functions.c:41547) — refresh every task's +4 current via
    // FUN_0042164e (rwg_functions.c:41124): +0xc flash counter counts down; when
    // the value changes and +0x10 is set, flash = 15. +0x10 is cleared for tasks
    // 3, 8, 0xc, 0xd (FUN_0042166f:41250-41256).
    _updateTaskProgress() {
        for (let i = 0; i < this.mTasks.length; i++) {
            const task = this.mTasks[i];
            const value = this._taskCurrent(task);
            if (this.mTaskFlash[i] > 0) this.mTaskFlash[i]--;
            if (this.mTaskProgress[i] !== value) {
                const flashes = task.type !== TaskType.EARN_MONEY
                    && task.type !== TaskType.RAISE_CHICKENS
                    && task.type !== TaskType.TIME_LIMIT
                    && task.type !== TaskType.EARN_MONEY_TIMED;
                if (flashes) this.mTaskFlash[i] = 15;
                this.mTaskProgress[i] = value;
            }
        }
    }

    _isBonus() {
        return !!BONUS_LEVELS[this.mCurrentLevel];
    }

    // FUN_00421afa (rwg_functions.c:41460): "lost" = no chickens, or task 0xc
    // has a target and elapsed reached it (bonus levels carry no task 0xc).
    _isLost() {
        if (this.mField.getAliveChickCount() !== 0) {
            const hasTimeTask = !this._isBonus()
                && this.mTasks.some(tk => tk.type === TaskType.TIME_LIMIT);
            const target = hasTimeTask ? this.mTimeLimit : 0;
            if (target < 1 || this.mTimeElapsed < target) return false;
        }
        return true;
    }

    // FUN_00421b21 (rwg_functions.c:41489): task check, called every tick.
    _checkTasks() {
        this._updateTaskProgress();
        const bonus = this._isBonus();
        for (let i = 0; i < this.mTasks.length; i++) {
            const task = this.mTasks[i];
            // Task 0xc (time limit) is skipped; on bonus levels the JS stores the
            // original task 0xd as TIME_LIMIT, so it is checked here.
            if (task.type === TaskType.TIME_LIMIT && !bonus) continue;
            const target = this._taskTarget(task);
            if (!(target > 0)) continue;
            if (this.mTaskProgress[i] < target) {
                if (!bonus || !this._isLost()) {
                    if (this._isLost()) {
                        this._levelFailed();
                    }
                    // FUN_00422036 (hint dispatcher) and the level-1 +0x54 slot
                    // unlock (rwg_functions.c:41522-41530) — UNKNOWN effect, not ported.
                    return;
                }
                break;   // bonus level with all chickens gone → completed
            }
        }
        this._levelCompleted();
    }

    // FUN_00421948 (rwg_functions.c:41320): level completed.
    _levelCompleted() {
        this.mIsLevelComplete = true;
        if (this._isBonus()) {
            // FUN_00423d5b (rwg_functions.c:43870): perfect = chicken count == level +0x50.
            const perfect = this.mField.getAliveChickCount() === this._bonusStartChicks;
            this.mBonusAchieved = perfect;
            // :41391 DAT_004fc2f8 = level + 1 → next level's upgrade price halved
            // (FUN_0041e7f2:37670-37677).
            if (perfect) this.mNextUpgradeHalfPrice = true;
        }
        // JS-only celebration VFX.
        this.addConfetti(80);
        this.mConfettiTimer = 90;
        // DAT_004fedbc (rwg_functions.c:41398).
        if (SOUNDS.SOUND_LEVEL_COMPLETED) SOUNDS.SOUND_LEVEL_COMPLETED.play();
        // :41359-41372 unlock next level and record time (FUN_0041111b with
        // state+8); their gate FUN_00402839 is UNKNOWN.
        if (this.mGameApp && this.mGameApp.unlockNextLevel) {
            this.mGameApp.unlockNextLevel(this.mCurrentLevel + 1);
        }
        if (this.mGameApp && this.mGameApp.mCore && this.mGameApp.mCore.recordLevelTime) {
            this.mGameApp.mCore.recordLevelTime(this.mCurrentLevel, this.mTimeElapsed);
        }
    }

    // FUN_00421a66 (rwg_functions.c:41411): level failed; dialog reason is
    // (chicken count != 0) → time ran out, else chickens lost (:41443-41446).
    _levelFailed() {
        this.mIsLevelFailed = true;
        this.mFailReason = this.mField.getAliveChickCount() !== 0 ? 'time' : 'chickens';
        // DAT_004fed7c (rwg_functions.c:41452).
        if (SOUNDS.SOUND_LEVEL_FAILED) SOUNDS.SOUND_LEVEL_FAILED.play();
    }

    // Egg-box click → FUN_00406e6a (rwg_functions.c:8569) via FUN_00409c92:12552.
    // The original toggles the egg in the egg controller's brood list; the add
    // branch decompiles empty, so the "needs a broody" gate and sounds below are
    // the previous JS behaviour — UNKNOWN — not found in decompiled.
    startEggBrooding(egg) {
        if (!egg) return;
        if (egg.mBrooding) {
            // Cancel: egg +0x18 = -1, +0x20 = 0, removed from list (:8584-8586).
            const claimed = egg._claimedBy;
            egg.mBrooding = false;
            egg.mBroodProgress = 0;
            egg._claimedBy = null;
            if (claimed && claimed._endBrooding) claimed._endBrooding();
            if (SOUNDS.SOUND_EGG_REF) SOUNDS.SOUND_EGG_REF.play();
            return;
        }
        const freeBroodies = this.mField.mChickens.filter(
            c => c.mIsAlive && c.mIsAdult && !c.mIsSick
                && c.mType === ChickType.BROODY && !c.mBroodingEgg
        );
        const anyAvailableBroody = this.mField.mChickens.some(
            c => c.mIsAlive && c.mIsAdult && !c.mIsSick
                && c.mType === ChickType.BROODY
        );
        if (!anyAvailableBroody) {
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
            return;
        }
        egg.mBrooding = true;
        egg.mBroodProgress = 0;
        if (SOUNDS.SOUND_EGG_REF) SOUNDS.SOUND_EGG_REF.play();
        if (freeBroodies.length > 0) {
            freeBroodies[0].startBrooding(egg);
        }
    }

    // Slot price — FUN_004058e7 asm 0x40590a-0x405919:
    // ftol(DAT_0050032c[type] * _DAT_004fc3b8 + 0.5). There is no per-purchase
    // doubling for chickens (that is FUN_0041eb94, the upgrade price).
    getChickPrice(type) {
        const base = CHICK_BASE_PRICES[type] || CHICK_BASE_PRICES[0];
        return Math.floor(base * this.mChickPriceInflation + 0.5);
    }

    // Shop-slot limit (FUN_0040bfb3 slot value): -1 unlimited, 0 closed, N left.
    // The per-level slot values are carried by LevelData (hasBuy/buyableTypes/
    // hasMagicHoly/maxBuyPerType).
    _slotLimit(type) {
        const cfg = this.mLevelConfig;
        if (!cfg) return 0;
        const bought = (this._specialShopBoughtCount && this._specialShopBoughtCount[type]) || 0;
        if (Array.isArray(cfg.buySlots)) {
            // FUN_00422c01:42836-42849 (-1 ×5) + FUN_00423c04 / FUN_00422d10 slot writes;
            // screenshots/19.png (L2): layer slot open at 100 with no count.
            const base = cfg.buySlots[type];
            if (base === 0) return 0;
            if (base < 0) return -1;
            return Math.max(0, base - bought);
        }
        if (!cfg.hasBuy) return 0;
        const typeKeys = ['layer', 'broody', 'rooster', 'magic', 'holy'];
        const bt = cfg.buyableTypes || {};
        if (bt[typeKeys[type]] === false) return 0;
        if ((type === 3 || type === 4) && !cfg.hasMagicHoly) return 0;
        const maxBuy = (cfg.maxBuyPerType || {})[typeKeys[type]];
        if (typeof maxBuy === 'number') {
            return Math.max(0, maxBuy - bought);
        }
        return -1;
    }

    // FUN_0041e8f5 (rwg_functions.c:37701) without the slot gate — used by the
    // level-start purchases, which set their own slot limits.
    _buySlot(type) {
        if (!this.spendMoney(this.getChickPrice(type))) {
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();   // DAT_004fedac :37736
            return false;
        }
        this._spawnBoughtChick(type);
        return true;
    }

    // HUD slot click: FUN_00409ba0 (rwg_functions.c:12469) → FUN_0041e8f5.
    //   slot value 0 → nothing (no sound); money < price → SOUND_ERROR;
    //   success → chick spawned, slot value decremented if > 0, SOUND_CHICK_BUY.
    buyChick(type) {
        if (this._slotLimit(type) === 0) return false;
        const price = this.getChickPrice(type);
        if (this.mMoney < price) {
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
            return false;
        }
        this.spendMoney(price);
        this._spawnBoughtChick(type);
        if (!this._specialShopBoughtCount) this._specialShopBoughtCount = [0, 0, 0, 0, 0];
        this._specialShopBoughtCount[type]++;
        if (type === ChickType.MAGIC) this.mHatchedMagic++;
        else if (type === ChickType.HOLY) this.mHatchedHoly++;
        else if (type === ChickType.ROOSTER) this.mHatchedRooster++;
        // DAT_004fed80 (rwg_functions.c:12495).
        if (SOUNDS.SOUND_CHICK_BUY) SOUNDS.SOUND_CHICK_BUY.play();
        return true;
    }

    // Seed upgrade level = seed controller +0x20 (FUN_0041bfe2:34304). The JS
    // upgrade effects only raise mSeedCalories (seeds_1 → 50, seeds_2 → 80), so
    // the level is derived from it. The writer of +0x20 is UNKNOWN — not found
    // in decompiled.
    _seedUpgradeLevel() {
        if (this.mSeedCalories >= 80) return 2;
        if (this.mSeedCalories >= 50) return 1;
        return 0;
    }

    // drawHUD — part of GameView::Draw FUN_0040a3d6 (rwg_functions.c:13085).
    // Positions from the decompiled draw (x) plus screenshots 13/17/19/24/29
    // where the y argument was passed in a register (DX) and is lost in the C.
    drawHUD(g) {
        const ctx = g.ctx;
        const ready = (res) => res && res.img && g._isReady(res.img);

        // IMAGE_IN_GAME_UP at x = width - image.w = 400, y = 0 (:13659).
        const igUpImg = IMAGES.IMAGE_IN_GAME_UP;
        if (ready(igUpImg)) ctx.drawImage(igUpImg.img, 400, 0, 400, 81);

        // Two IMAGE_NUMBER_SLOT (200x42) at x = 800-200 (:13663-13664); y = 0 and
        // 42 measured from screenshots/29.png (pattern repeats every 42 px).
        const numSlotImg = IMAGES.IMAGE_NUMBER_SLOT;
        if (ready(numSlotImg)) {
            ctx.drawImage(numSlotImg.img, 600, 0, 200, 42);
            ctx.drawImage(numSlotImg.img, 600, 42, 200, 42);
        }

        // Shop slots (:13668-13711): x = 80*i, y = 0. Value 0 → IMAGE_SHOP_SLOT_CLOSED;
        // else IMAGE_SHOP_SLOT_OPEN + price + chick icon at x+0xd (DAT_00500604[i])
        // + remaining-limit number when > 0. Icon y=6, price baseline 70,
        // limit right edge x+66 baseline 23 measured from screenshots/24.png.
        const shopClosed = IMAGES.IMAGE_SHOP_SLOT_CLOSED;
        const shopOpen = IMAGES.IMAGE_SHOP_SLOT_OPEN;
        const previewKeys = [
            'IMAGE_CHICK_PREVIEW_LAYER',
            'IMAGE_CHICK_PREVIEW_BROODY',
            'IMAGE_CHICK_PREVIEW_ROOSTER',
            'IMAGE_CHICK_PREVIEW_MAGIC',
            'IMAGE_CHICK_PREVIEW_HOLY',
        ];
        for (let i = 0; i < 5; i++) {
            const bx = 80 * i;
            const limit = this._slotLimit(i);
            if (limit === 0) {
                if (ready(shopClosed)) ctx.drawImage(shopClosed.img, bx, 0, 80, 81);
                continue;
            }
            if (ready(shopOpen)) ctx.drawImage(shopOpen.img, bx, 0, 80, 81);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(String(this.getChickPrice(i)), bx + 40, 70);
            const prevImg = IMAGES[previewKeys[i]];
            if (ready(prevImg)) ctx.drawImage(prevImg.img, bx + 13, 6);
            if (limit > 0) {
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 12px Arial, sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(String(limit), bx + 66, 23);
            }
        }

        // MENU button: Resize(0x193, 0x27, 0x65, 0x26) = (403, 39, 101, 38) (:14005).
        const _hudOver = (bx, by, bw, bh) => {
            const hx = this.mHudHoverX, hy = this.mHudHoverY;
            return typeof hx === 'number' && typeof hy === 'number'
                && hx >= bx && hx < bx + bw && hy >= by && hy < by + bh;
        };
        const drawButton = (x, y, w, h, label) => {
            const img = _hudOver(x, y, w, h) && IMAGES.IMAGE_DIALOG_BUTTON_OVER
                ? IMAGES.IMAGE_DIALOG_BUTTON_OVER : IMAGES.IMAGE_DIALOG_BUTTON;
            if (ready(img)) {
                ctx.drawImage(img.img, x, y, w, h);
            } else {
                ctx.fillStyle = 'rgba(80,160,40,0.9)';
                ctx.fillRect(x, y, w, h);
            }
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(label, x + w / 2, y + 24);
        };
        drawButton(403, 39, 101, 38, 'MENU');
        const lc = this.mLevelConfig || {};
        // SELL: Resize(0x1FA, 0x27, 0x55, 0x26); visible per shop +0x18 (:13294).
        const showSell = lc.sellButton !== undefined ? lc.sellButton : lc.hasSell;
        if (showSell) drawButton(506, 39, 85, 38, 'SELL');
        // BUY: Resize(0x1FA, 0x01, 0x55, 0x26); visible per shop +0x19 (:13297).
        const showBuy = lc.specialShopButton !== undefined ? lc.specialShopButton : lc.hasBuy;
        if (showBuy) drawButton(506, 1, 85, 38, 'BUY');

        // Task slots (:13727-13798): in task-index order, skipping target <= 0;
        // IMAGE_NUMBER_SLOT_TASK at x = 800-200, y = 42*k + 0x50; icon = task +8;
        // text y = slot y + 0x19. Icon (605, y-2) and text centre x=715 measured
        // from screenshots/13.png and 29.png.
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
            [TaskType.TIME_LIMIT]: 'IMAGE_MISSION_TIME',
            [TaskType.EARN_MONEY_TIMED]: 'IMAGE_MISSION_TIME',
        };
        const order = this.mTasks.map((t, i) => i)
            .sort((a, b) => this.mTasks[a].type - this.mTasks[b].type);
        let taskIdx = 0;
        for (const i of order) {
            const task = this.mTasks[i];
            const target = this._taskTarget(task);
            if (!(target > 0)) continue;
            const ty = 42 * taskIdx + 0x50;
            if (ready(slotTaskImg)) ctx.drawImage(slotTaskImg.img, 600, ty, 200, 42);
            const iconImg = IMAGES[missionIcons[task.type]];
            if (ready(iconImg)) ctx.drawImage(iconImg.img, 605, ty - 2);
            ctx.font = 'bold 14px Arial, sans-serif';
            ctx.textAlign = 'center';
            if (task.type === TaskType.TIME_LIMIT || task.type === TaskType.EARN_MONEY_TIMED) {
                // Remaining time in red (255,50,50); white when remaining < 0x3e9
                // ticks and (remaining / 0x32) is odd (:13760-13771).
                const remTicks = Math.max(0, Math.floor((target - this.mTimeElapsed) / 10));
                const blink = remTicks < 0x3e9 && (Math.floor(remTicks / 0x32) & 1) !== 0;
                ctx.fillStyle = blink ? '#fff' : 'rgb(255,50,50)';
                ctx.fillText(this._formatTicks(remTicks), 715, ty + 0x19);
            } else {
                // Flash (+0xc != 0) → (100,100,200); else white (:13774-13780).
                ctx.fillStyle = this.mTaskFlash[i] > 0 ? 'rgb(100,100,200)' : '#fff';
                ctx.fillText(`${this.mTaskProgress[i] || 0} / ${target}`, 715, ty + 0x19);
            }
            taskIdx++;
        }

        // Egg boxes (:13809-13862), shown when FUN_00404a71 (feature bit UNKNOWN —
        // JS shows them whenever eggs exist). Position FUN_00409ab2
        // (rwg_functions.c:12376): x = 54*i, y = 0x50; i > 10 → x -= 11*54,
        // y += 54. Box: IMAGE_EGG_REF_FOR_BROOD when in the brood list, else
        // IMAGE_EGG_REF. Overlay MISSION_EGGS_* by egg type at (+4,+10) and
        // brood progress (45x10) at (+5,+5) clipped to progress*45 — offsets
        // measured from screenshots/24.png.
        const eggRefImg = IMAGES.IMAGE_EGG_REF;
        const eggBroodImg = IMAGES.IMAGE_EGG_REF_FOR_BROOD;
        const eggProgressImg = IMAGES.IMAGE_EGG_REF_BROOD_PROGRESS;
        // JS EggType → original type 0..4 (layer, broody, rooster, magic, holy)
        // → DAT_004fffdc..DAT_004fffec (:13842-13849).
        const eggIconByJsType = [
            'IMAGE_MISSION_EGGS_LAYER',   // WHITE  → layer
            'IMAGE_MISSION_EGGS_MAGIC',   // BLUE   → magic
            'IMAGE_MISSION_EGGS_HOLY',    // RED    → holy
            'IMAGE_MISSION_EGGS_ROOSTER', // BLACK  → rooster
            'IMAGE_MISSION_EGGS_BROODY',  // GOLDEN → broody
        ];
        const fieldEggs = this.mField.mGems.filter(gem => gem.mType === 4 && gem.mIsAlive);
        for (let i = 0; i < fieldEggs.length; i++) {
            const egg = fieldEggs[i];
            let ex = 54 * i;
            let ey = 0x50;
            if (i > 10) { ex -= 11 * 54; ey += 54; }
            const boxImg = egg.mBrooding ? eggBroodImg : eggRefImg;
            if (ready(boxImg)) ctx.drawImage(boxImg.img, ex, ey, 54, 54);
            const iconImg = IMAGES[eggIconByJsType[egg.mEggType] || eggIconByJsType[0]];
            if (ready(iconImg)) ctx.drawImage(iconImg.img, ex + 4, ey + 10);
            // FUN_00406ac9 > _DAT_004e90b0 (0.0f)
            const p = egg.mBrooding ? (egg.mBroodProgress || 0) : 0;
            if (p > 0 && ready(eggProgressImg)) {
                const w = Math.floor(45 * Math.min(1, p));
                if (w > 0) {
                    ctx.drawImage(eggProgressImg.img, 0, 0, w, 10, ex + 5, ey + 5, w, 10);
                }
            }
        }

        // "Time" (elapsed, state+8 /100 s) and "Money" rows (:13864-13895),
        // white (DAT_005012a0). Label x=613, value right edge 787, baselines
        // 27/69 and "Level N" at x=411 baseline 25 — screenshots/13.png.
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Level ${this.mCurrentLevel}`, 411, 25);
        ctx.fillText('Time', 613, 27);
        ctx.fillText('Money', 613, 69);
        ctx.textAlign = 'right';
        ctx.fillText(this._formatTicks(Math.floor(this.mTimeElapsed / 10)), 787, 27);
        ctx.fillText(String(this.mMoney), 787, 69);

        // Risk icon — FUN_00409af0:12452: x = 0x2da, y = (count-1)*slot.h + 0x75,
        // shown when (app+0x48)+9 is set (:13899-13905). Gate on level >= 7 is
        // the previous JS behaviour (RiskController scope).
        if (this.mRiskReady && taskIdx > 0 && this.mCurrentLevel >= 7) {
            const ry = (taskIdx - 1) * 42 + 0x75;
            const riskImg = IMAGES.IMAGE_ICON_RISK;
            if (ready(riskImg)) {
                const fw = riskImg.getCelWidth();
                const fh = riskImg.getCelHeight();
                // Frame timing UNKNOWN — not found in decompiled (FUN_0041742b frame
                // argument from (app+0x48)+0x10); JS cycles 6 ticks/frame.
                const numFrames = (riskImg.mNumCols || 1) * (riskImg.mNumRows || 1);
                const frame = numFrames > 1
                    ? Math.floor((this.mRiskAnimTimer || 0) / 6) % numFrames
                    : 0;
                const cols = riskImg.mNumCols || 1;
                const sx = (frame % cols) * fw;
                const sy = Math.floor(frame / cols) * fh;
                ctx.drawImage(riskImg.img, sx, sy, fw, fh, 0x2da, ry, fw, fh);
                this._riskIconRect = { x: 0x2da, y: ry, w: fw, h: fh };
            } else {
                this._riskIconRect = { x: 0x2da, y: ry, w: 40, h: 40 };
            }
        } else {
            this._riskIconRect = null;
        }

        ctx.textAlign = 'left';
    }

    // mm:ss from ticks: seconds = ticks/100 % 60 (:13864), minutes = ticks/6000.
    _formatTicks(ticks) {
        const totalSec = Math.floor(ticks / 100);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
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

    // Closest point of the crosshair square (centre x,y, half-size h) to the
    // entity centre — rect overlap test of FUN_0040d241 (rwg_functions.c:16195)
    // against an entity hit box exposed only through contains().
    static _crosshairPoint(ex, ey, x, y, h) {
        return {
            x: Math.max(x - h, Math.min(x + h, ex)),
            y: Math.max(y - h, Math.min(y + h, ey)),
        };
    }

    // Hand click — FUN_0040cc71 (rwg_functions.c:15843-16190). Modes:
    // 0 seeds, 1 cure, 2 gun (FUN_0040cc01). The hovered raven/wolf/sick chick is
    // picked by the auto-cursor (GameView); this applies the "fire" action.
    handleClick(x, y, handMode) {
        if (this.mIsPaused || this.mIsLevelComplete || this.mIsLevelFailed) return;

        if (handMode === 'gun') {
            // Raven/wolf hover only below y 0x82 (:15893). Crosshair 8x8, or
            // 0x14 with the gun-area upgrade (app+0x40)+0x10 (:15880-15886).
            if (!(y > 0x82)) return;
            const aim = this.mGunArea ? 0x14 : 8;
            const h = aim >> 1;
            // Damage (cVar1 != 0) + 1 with the gun-power flag (app+0x40)+0x11 (:16112).
            const dmg = this.mGunPower > 1 ? 2 : 1;
            for (const raven of this.mField.mRavens) {
                if (!raven.mIsAlive) continue;
                // Raven.contains(x, y, aimSize) is the FUN_0040d241 overlap of the
                // crosshair with the raven rect FUN_00409a2d (Field.js).
                if (!raven.contains(x, y, aim)) continue;
                // FUN_0040cc71:16114-16123: only while HP (+0x44) > 0 →
                // FUN_00416d35(dmg), SOUND_SHOOT (asm 0x40d0f0, DAT_004fed88);
                // HP now < 1 → FUN_00424b5d(+$50) at the raven (asm 0x40d113).
                if (!(raven.mHP > 0)) return;
                raven.hit(dmg);
                if (SOUNDS.SOUND_SHOOT) SOUNDS.SOUND_SHOOT.play();
                if (raven.mHP < 1) this.addMoney(RAVEN_KILL_REWARD, raven.mX, raven.mY);
                return;
            }
            for (const wolf of this.mField.mWolves || []) {
                if (!wolf.mIsAlive) continue;
                // Wolf hit box (±60, ±50) is the JS Pet.js sprite box; the original
                // rect FUN_00409800 is UNKNOWN.
                const p = FieldController._crosshairPoint(wolf.mX, wolf.mY, x, y, h);
                if (Math.abs(wolf.mX - p.x) > 60 || Math.abs(wolf.mY - p.y) > 50) continue;
                // FUN_0041050c (rwg_functions.c:20161): if not dead → hit(dmg),
                // SOUND_SHOOT (DAT_004fed88), dead now → +$500 at the wolf.
                if (wolf.isDead && wolf.isDead()) return;
                if (wolf.hit) wolf.hit(dmg, wolf.mX > x ? 1 : -1, -1);
                if (SOUNDS.SOUND_SHOOT) SOUNDS.SOUND_SHOOT.play();
                if (wolf.isDead && wolf.isDead()) {
                    this.addMoney(WOLF_KILL_REWARD, wolf.mX, wolf.mY);
                }
                return;
            }
            return;
        }

        if (handMode === 'cure') {
            // Mode 1 (:16144-16153): gem under the cursor is collected first
            // (FUN_0040c6a5); otherwise the hovered sick chick is cured.
            if (this._collectGemAt(x, y)) return;
            for (const c of this.mField.mChickens) {
                if (c.mIsAlive && c.mIsSick && !c.mIsCarried) {
                    // Chick hit box (mX±25, mY-70..mY+15) shared with GameView's
                    // auto-cursor — original FUN_00407ad4 rect UNKNOWN.
                    const inX = Math.abs(c.mX - x) <= 25;
                    const inY = (y >= c.mY - 70 && y <= c.mY + 15);
                    if (inX && inY) {
                        this._cureChick(c);
                        return;
                    }
                }
            }
            return;
        }

        // Mode 0 (:16155-16170): gem → egg → seeds (y >= 0x15f).
        if (this._collectGemAt(x, y)) return;
        if (this._clickEggAt(x, y)) return;
        this._feedArea(x, y);
    }

    // FUN_0040490a (rwg_functions.c:5432): money < 0x32 → SOUND_ERROR
    // (DAT_004fedac); else money -= 0x32, cure (FUN_00403403), SOUND_CURED
    // (played by Chick.cure, DAT_004fed6c).
    _cureChick(c) {
        if (this.mMoney < CURE_COST) {
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
            return false;
        }
        this.spendMoney(CURE_COST);
        c.cure();
        return true;
    }

    // FUN_0040c6a5 (rwg_functions.c:15272): first coin/diamond under the cursor
    // is collected via FUN_0040c75b (counter++, value added by the gem).
    _collectGemAt(x, y) {
        for (const gem of this.mField.mGems) {
            if (gem.mType === 4) continue;   // eggs live in the egg controller
            if (gem.mIsAlive && !gem.mCollected && gem.contains(x, y)) {
                const value = gem.collect();
                if (value > 0) this.addMoney(value, gem.mX, gem.mY);
                this._trackCollection(gem);
                // JS-only VFX.
                const colors = ['#ffd700', '#cccccc', '#5cb8ff', '#ff5c5c'];
                this.addParticleBurst(gem.mX, gem.mY, colors[gem.mType] || '#fff',
                    gem.mType >= 2 ? 14 : 10);
                return true;
            }
        }
        return false;
    }

    // FUN_004072fa (rwg_functions.c:8920): egg under the cursor (eggs whose +0x20
    // is clear) → if selling allowed (egg ctl +0x28 == 0) add DAT_0050033c[type]
    // at the egg; counter[type]++; drop from the brood list; remove egg.
    // The JS refuses eggs already flagged for brooding — the mapping of egg
    // +0x20 to JS state is UNKNOWN, previous behaviour kept.
    _clickEggAt(x, y) {
        for (const gem of this.mField.mGems) {
            if (gem.mType !== 4) continue;
            if (!gem.mIsAlive || gem.mCollected || !gem.contains(x, y)) continue;
            if (gem.mBrooding) return false;
            const value = gem.collect();
            if (value > 0 && !this.mEggSellDisabled) this.addMoney(value, gem.mX, gem.mY);
            this._trackEggCollection(gem);
            return true;
        }
        return false;
    }

    // Seed drop — FUN_0040cc71:16166-16180 → FUN_0041bfe2 (rwg_functions.c:34292):
    // only for y >= 0x15f; count = DAT_0050034c[seed level]; price =
    // ftol(count*0.4 + 0.5) via FUN_00403e23 (no sound when unaffordable).
    // screenshots/13.png: $6 spent / ~15 seeds after three L1 clicks.
    _feedArea(x, y) {
        if (y < 0x15f) return false;
        const count = SEEDS_PER_DROP[this._seedUpgradeLevel()];
        const price = Math.floor(count * SEED_PRICE_FACTOR + 0.5);
        if (!this.spendMoney(price)) return false;
        this.mField.dropSeeds(x, y, count, this.mSeedCalories);
        return true;
    }

    // Public entry for the right-button autofire path (FUN_0040cc71:16176-16180,
    // every 0x14 ticks while held) so callers share the same price/count.
    dropSeedsAt(x, y) {
        return this._feedArea(x, y);
    }

    // JS-only: floating text popups (used for the FUN_0040693f money effect).
    addFloatingText(x, y, text, color) {
        this.mFloatingTexts.push({
            x, y, text, color: color || '#fff',
            timer: 0, maxTimer: 80,
        });
    }

    updateFloatingTexts() {
        for (const ft of this.mFloatingTexts) {
            ft.timer++;
            ft.y -= 0.5;
        }
        this.mFloatingTexts = this.mFloatingTexts.filter(ft => ft.timer < ft.maxTimer);
    }

    updateClickRipples() {
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
            ctx.fillStyle = ft.color;
            ctx.font = 'bold 14px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(ft.text, ft.x, ft.y);
        }
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
    }

    // Gem counters (gem ctl +0xc vector, FUN_0040c75b:15363): index = gem type
    // (0 gold, 1 silver, 2 blue diamond, 3 red diamond). Coins task = [0]+[1].
    _trackCollection(gem) {
        switch (gem.mType) {
            case 0:
            case 1:
                this.mCollectedCoins++;
                break;
            case 2:
                this.mCollectedBlueDiamonds++;
                break;
            case 3:
                this.mCollectedRedDiamonds++;
                break;
        }
    }

    // Egg counters (egg ctl +0x2c vector, FUN_004072fa:9014-9016), one per egg
    // type; task 4 sums all of them (asm 0x421ca5-0x421cd1).
    _trackEggCollection(egg) {
        switch (egg.mEggType) {
            case 0: this.mCollectedWhiteEggs++; break;   // layer
            case 1: this.mCollectedBlueEggs++; break;    // magic
            case 2: this.mCollectedRedEggs++; break;     // holy
            case 3: this.mCollectedBlackEggs++; break;   // rooster
            case 4: this.mCollectedGoldenEggs++; break;  // broody
        }
    }
}
