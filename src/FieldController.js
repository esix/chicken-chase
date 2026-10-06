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

import { Field, fieldToScreen } from './Field.js';

// thunk_FUN_00429891: Mersenne twister masked with 0x7fffffff (asm 0x429891).
function mtRand() { return Math.floor(Math.random() * 0x80000000); }
import { createChick, ChickType, foodUnit } from './Chick.js';
import { TaskType, getLevelConfig, getInitialChicks, SHOP_ITEMS, SHOP_ITEM_LIST } from './LevelData.js';
import { IMAGES, SOUNDS } from './Res.js';
import { Wolf, Mouse, Elephant, randomSpawnPoint } from './Pet.js';
import { FONT_CSS, drawOutlinedText } from './CreditsView.js';

// HUD fonts (resource loader rwg_functions.c:30926-30938; resources.xml):
// DAT_004fff08 = FONT_8 (ArialBlack8), DAT_004fff0c = FONT_10 (ArialBlack10),
// DAT_004fff10 = FONT_12 (ArialBlack12), DAT_004fff14 = FONT_16
// (ArialBlack16). Canvas "Arial Black" sizes follow the CreditsView
// calibration (digit advance in the .txt WidthList / 0.667 em): digits are
// 7 / 9 / 11 / 14 px wide → 10.5 / 13.5 / 16.5 / 21 px.
const HUD_FONT_8 = '10.5px "Arial Black", Arial, sans-serif';
const HUD_FONT_10 = FONT_CSS.FONT_10;
const HUD_FONT_12 = '16.5px "Arial Black", Arial, sans-serif';
const HUD_FONT_16 = FONT_CSS.FONT_16;

// DAT_0050032c chicken buy prices (rwg_functions.c:6690-6706).
const CHICK_BASE_PRICES = [100, 200, 500, 1000, 1200];
// DAT_0050034c seeds dropped per click, indexed by seed controller +0x20
// (rwg_functions.c:6677-6685), read by FUN_0041bfe2 (rwg_functions.c:34304).
const SEEDS_PER_DROP = [5, 9, 12];
// FUN_0041bfe2 asm 0x41c01d-0x41c02f: price = ftol(count * 0.4 + 0.5)
// (_DAT_004e93d8 = 0.4 double, _DAT_004e90c8 = 0.5 double).
const SEED_PRICE_FACTOR = 0.4;
// FUN_0040490a (rwg_functions.c:5444-5450): cure costs 0x32.
const CURE_COST = 50;
// FUN_0040cc71 (rwg_functions.c:16117-16121): raven killed → FUN_00424b5d(+0x32).
const RAVEN_KILL_REWARD = 50;
// FUN_0041050c (rwg_functions.c:~20180, asm 0x410567): wolf killed →
// FUN_00406b22(money, 500) → FUN_00424b5d.
const WOLF_KILL_REWARD = 500;
// Store +0 (FUN_0041e7f2:37614): special-shop item price 0xfa; after each
// purchase FUN_0041eb94 (rwg_functions.c:37974-37996) doubles it, floor 0xfa.
const SHOP_ITEM_BASE_PRICE = 0xfa;
// Seed controller +0x1c (seed quality 0..2) is passed to every new seed
// (FUN_0041c0a8 → FUN_0041bdcb +0x20) and selects the food multiplier
// DAT_0050031c[q] = {1.0, 1.3, 1.6} (FUN_00405540:6662-6672, seed +0x2c,
// asm 0x41be07). Field.dropSeeds takes the quality encoded as these tags
// (30 → 0, 50 → 1, 80 → 2) and applies the original values itself.
const JS_SEED_CALORIES = [30, 50, 80];

// All per-level values (start money, money cap, raven/wolf controller, bonus
// data, inflation flag, buy slots, starting chickens, shop unlocks) come from
// LevelData.getLevelConfig / getInitialChicks (FUN_0042166f, FUN_00422c01,
// FUN_00422d10 and helpers) — no per-level tables are kept here.

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
        this.mTotalMoney = 0;               // statistic (not used by tasks)
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
        this.mHatchedMagic = 0;             // statistics read by Field.js (tasks use live counts)
        this.mHatchedHoly = 0;
        this.mHatchedRooster = 0;
        this.mTotalRaisedChicks = 0;
        // Seed quality tag (see JS_SEED_CALORIES).
        this.mSeedCalories = JS_SEED_CALORIES[0];
        this.mSeedCount = SEEDS_PER_DROP[0];
        this.mGunPower = 1;                 // (app+0x40)+0x11 → damage 2 when set
        this.mGunArea = false;              // (app+0x40)+0x10 → 20px crosshair
        this.mPlayerHouseUpgrade = 0;
        this.mHasElephant = false;
        this.mHasMouse = false;
        this.mSicknessFactor = 0;
        this.mBonusAchieved = false;
        this.mHalfPriceLevel = -1;          // DAT_004fc2f8 (FUN_00421948:41391)
        this.mUpgradePrice = SHOP_ITEM_BASE_PRICE; // store +0
        this.mShopLists = { seed: [], weapon: [], pet: [] };
        this.mBuySlots = [0, 0, 0, 0, 0];   // store +8 slot values
        this.mSeedQuality = 0;              // seed ctl +0x1c
        this.mSeedCountLevel = 0;           // seed ctl +0x20
        this._bonusStartChicks = 0;         // level obj +0x50 (FUN_00423cb3:43857)
        // Money effects (app+0x3c)+0xc list, FUN_00424b5d → FUN_0040693f.
        this.mMoneyEffects = [];
    }

    // Level start = FUN_00406069 (fresh world, rwg_functions.c:7496) →
    // FUN_0042166f (level object + starter chickens, rwg_functions.c:41149) →
    // FUN_00422c01 (money / raven defaults, rwg_functions.c:42819) →
    // FUN_00422d10 (per-level switch, rwg_functions.c:42903).
    // Every per-level value is read from LevelData (single source of truth).
    startLevel(level) {
        this.mCurrentLevel = level;
        this.mLevelConfig = getLevelConfig(level);
        const cfg = this.mLevelConfig;

        // Level object +0x48 = Ace time in seconds (LevelData `aceTime`;
        // FUN_0040dde4 asm 0x40df31). Bonus levels never write it (0).
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

        // Per-level upgrade state — the original rebuilds the seed controller
        // (app+0x1c: +0x1c seed quality, +0x20 seeds-per-click index), the
        // weapon object (app+0x40: +0x10 area, +0x11 power) and the pet list
        // (app+0x44) for every level in FUN_00406069; they are only raised by
        // special-shop purchases (FUN_0041ebd3) during the level.
        // Player-profile upgrades are re-applied by GameView after this call.
        this.mPlayerHouseUpgrade = 0;
        this.mSeedQuality = 0;              // seed ctl +0x1c
        this.mSeedCountLevel = 0;           // seed ctl +0x20
        this.mSeedCalories = JS_SEED_CALORIES[0];
        this.mSeedCount = SEEDS_PER_DROP[0];
        this.mGunPower = 1;                 // (app+0x40)+0x11 clear
        this.mGunArea = false;              // (app+0x40)+0x10 clear
        this.mHasMouse = false;             // pet list rebuilt (app+0x44)
        this.mHasElephant = false;
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

        // Tasks (LevelData; bonus levels carry task 0xd as TIME_LIMIT with
        // origTaskId BONUS_TIME, FUN_00423cb3:43840).
        this.mTasks = cfg.tasks;
        this.mTimeLimit = cfg.timeLimit;
        this.mTaskProgress = this.mTasks.map(() => 0);
        this.mTaskFlash = this.mTasks.map(() => 0);

        // Money object (FUN_00406069:7524-7533): flag 0, cap -1; per-level cap
        // from FUN_00422d10 (LevelData moneyCap, Infinity = -1).
        this.mMoneyFrozen = false;
        this.mMoneyCap = Number.isFinite(cfg.moneyCap) ? cfg.moneyCap : -1;
        this.mEggSellDisabled = false;
        // _DAT_004fc3b8 = 1.0 (FUN_00405540:6655, called from FUN_00406069).
        this.mChickPriceInflation = 1.0;
        this.mInflationTick = 0;
        // Store +4 (FUN_00422d10 cases 0x20/0x25/0x27/0x2b/0x31/0x32).
        this.mInflationEnabled = !!cfg.priceRisesOverTime;
        // Store buy-slot vector +8 (FUN_00422c01 -1 ×5 + case writes); JS keeps
        // the live remaining counts here (FUN_0041e8f5:37718 decrements > 0).
        this.mBuySlots = (cfg.buySlots || [0, 0, 0, 0, 0]).slice();
        // Store +0 special-shop price (FUN_0041e7f2:37614 = 0xfa), halved when
        // DAT_004fc2f8 == this level, then DAT_004fc2f8 = -1 (37665-37673).
        this.mUpgradePrice = SHOP_ITEM_BASE_PRICE;
        if (this.mHalfPriceLevel > 0) {
            if (this.mHalfPriceLevel === level) this.mUpgradePrice = Math.trunc(this.mUpgradePrice / 2);
            this.mHalfPriceLevel = -1;
        }
        // Special-shop item lists (FUN_00423d75 / direct FUN_0040ca85 pushes).
        this.mShopLists = { seed: [], weapon: [], pet: [] };
        for (const id of cfg.shopUnlockItems || []) {
            const item = SHOP_ITEM_LIST[id];
            if (item) this.mShopLists[item.list].push(id);
        }

        // FUN_0042166f:41259 money = 1000000 while the starter chickens are
        // bought (asm 0x421816-0x421917, LevelData.getInitialChicks), then
        // FUN_00423deb(N) tops up with layers (L35, bonus levels).
        this.mMoney = 1000000;
        const start = getInitialChicks(level);
        for (let i = 0; i < start.layer; i++) this._spawnBoughtChick(ChickType.LAYER);
        for (let i = 0; i < start.broody; i++) this._spawnBoughtChick(ChickType.BROODY);
        // FUN_0042166f:41297-41301 (asm 0x42191c-0x42192a): level > 1 →
        // FUN_00404c34 (rwg_functions.c:5735): every chick whose food (+0x34,
        // Chick.mFoodCounter) is below FUN_00405899()*5 (Chick.foodUnit) gets
        // exactly that. Runs before FUN_00422c01/FUN_00422d10, so the
        // FUN_00423deb top-up chickens below keep their food.
        if (level > 1) {
            const minFood = foodUnit(level) * 5;
            for (const c of this.mField.mChickens) {
                if (c.mFoodCounter < minFood) c.mFoodCounter = minFood;
            }
        }
        if (start.fillLayersToTotal > 0) this._buyStarterUntil(start.fillLayersToTotal);

        // Final money: FUN_00422c01 default, or FUN_00423cb3 (10000) /
        // FUN_00423e5a (5000) — LevelData startMoney.
        this.mMoney = cfg.startMoney;
        if (cfg.budgetFlags) {
            // FUN_00423e5a (rwg_functions.c:43980-43990), cases 0x22 / 0x25:
            // money obj +0 = 1 (FUN_00424b5d adds nothing), egg ctl +0x28 = 1
            // (FUN_004072fa: eggs give no money).
            this.mMoneyFrozen = true;
            this.mEggSellDisabled = true;
        }
        // FUN_00423cb3:43857 level +0x50 = chicken count (perfect check).
        this._bonusStartChicks = cfg.isBonus ? this.mField.getAliveChickCount() : 0;

        // FUN_00422c01 / FUN_00422d10 / FUN_00423cb3 raven+wolf controller.
        this._setupRavenController(cfg.raven);

        // Money-effect list belongs to the per-level world (FUN_00406069).
        this.mMoneyEffects = [];
    }

    // FUN_00423deb (rwg_functions.c:43926): slot0 = -1, buy type-0 chickens
    // until the field holds N, with money temporarily 1000000, then restore.
    _buyStarterUntil(n) {
        const saved = this.mMoney;
        this.mMoney = 1000000;
        while (this.mField.getAliveChickCount() < n) {
            if (!this._buySlot(ChickType.LAYER)) break;
        }
        this.mMoney = saved;
    }

    // FUN_00404865 (rwg_functions.c:5395) via FUN_0041e8f5:37723-37727: the
    // buy passes point (-1,-1) (_DAT_004e9230), so x < 0 (asm 0x404894-0x4048aa)
    // → FUN_00408107 (rwg_functions.c:10260): x = mt%128 (signed-mod form),
    // y = mt%72 (thunk_FUN_00429891 = MT masked 0x7fffffff). The chick is
    // built at that field point by FUN_00403ff5 → FUN_00403ec2. Size/age are
    // owned by Chick.js (FUN_00409d5c, from food).
    _spawnBoughtChick(type) {
        const fx = mtRand() % 128;   // FUN_00408107: uVar1 & 0x8000007f
        const fy = mtRand() % 0x48;  // FUN_00408107: uVar2 % 0x48
        const s = fieldToScreen(fx, fy, 0);
        const c = createChick(type, s.x, s.y);
        // Exact field point (avoid the screen round-trip rounding).
        c.mPos[0] = fx;
        c.mPos[1] = fy;
        this.mField.addChick(c);
        this.mTotalRaisedChicks++;
        return c;
    }

    // Raven/wolf controller app+0x10 — raw fields from LevelData `raven`
    // (ctor FUN_00401202:284, FUN_00422c01:42863-42889, FUN_00422d10 cases,
    // FUN_00423cb3:43841-43846).
    _setupRavenController(raw) {
        this.mRavenScaredTimer = 0;                                   // +0x30
        const r = raw || { wolvesPerWave: 0, f10: 0, perWave: 0, f18: 0, atOnce: 0,
            f34: 1.0, f38: -1, fixedChance: false, f40: 1.0 };
        this.mRavenCtl = {
            wolvesPerAttack: r.wolvesPerWave,   // +0x0c
            wolfHP: r.f10,                      // +0x10 (asm 0x4015c7 → wolf +0x38)
            waveSize: r.perWave,                // +0x14
            ravenHP: r.f18,                     // +0x18 (asm 0x40128f → raven +0x44)
            maxActive: r.atOnce,                // +0x1c
            remaining: 0,                       // +0x20
            rollTick: 0,                        // +0x24
            waveTimer: 0,                       // +0x28
            attacking: false,                   // +0x2c
            bonusRate: r.f34,                   // +0x34
            rateDelay: r.f38,                   // +0x38 (ticks)
            ignoreRoosters: !!r.fixedChance,    // +0x3c
            speedMult: r.f40,                   // +0x40 (asm 0x401288 → raven +0x4c)
        };
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

    // FUN_00401543 (rwg_functions.c:620): wolf attack. SOUND_WOLF, then
    // n = +0x0c (2 if n > 2 and an elephant exists, FUN_004104b3(1)); per wolf
    // FUN_0040178e(ctl, allowRooster = 1) picks a target chick (asm 0x4015a9-
    // 0x4015c0) and only then FUN_00410299(pets, 2, +0x10) creates the wolf.
    // There is no "alive wolves" cap in the original.
    _startWolfAttack() {
        const ctl = this.mRavenCtl;
        if (SOUNDS.SOUND_WOLF) SOUNDS.SOUND_WOLF.play();    // DAT_004feda0 :645
        let n = ctl.wolvesPerAttack;
        if (n > 2 && this._hasElephant()) n = 2;
        for (let i = 0; i < n; i++) {
            const target = this.mField._pickRavenTarget
                ? this.mField._pickRavenTarget(true)
                : (this.mField.getAliveChickCount() > 0);
            if (!target) continue;
            // FUN_00410299 wolf branch (asm 0x4102d6-0x41030b): position =
            // FUN_00408107 (rand%128, rand%72), then x = -3.0 (_DAT_004e929c)
            // when rand01 < 0.5 (_DAT_004dc858) else 131.0 (_DAT_004e9298);
            // HP = controller +0x10 (wolf ctor FUN_00424be6 +0x38).
            const [, fy] = randomSpawnPoint();
            const fx = rand01() < 0.5 ? -3.0 : 131.0;
            this.mField.addWolf(new Wolf(ctl.wolfHP, fx, fy));
        }
    }

    // RiskCaseRavensAttack (FUN_0041b4ac, rwg_functions.c:33294): controller
    // +0x30 (scarecrow timer) = 0, then FUN_00401491. Entry point used by
    // RiskController.js.
    startAttackWave() {
        this.mRavenScaredTimer = 0;
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
    }

    _tickGameLogic() {
        // FUN_00405fcf:7468 *(state+8) += 1 tick (10 ms).
        this.mTimeElapsed += 10;

        // FUN_004015f8 — raven/wolf attack controller.
        this._updateRavenController();

        // FUN_004043fd et al. — field entities.
        this.mField.update();

        // Sickness (FUN_004043fd/FUN_00404caf) and brooding (FUN_0040412c)
        // are ticked inside Field.update().

        // FUN_0041ea9a — chicken price inflation.
        this._updateInflation();

        // FUN_0040686e — money effects.
        this._updateMoneyEffects();

        // FUN_00421b21 — task progress + level end.
        this._checkTasks();
    }

    // FUN_00424b5d (rwg_functions.c:45035, asm 0x424b5d-0x424bb4): unless the
    // money object's +0 flag is set: money += amount; clamp to the cap when
    // 0 < cap < money; then, when the position's x >= 0 (fldz/fcomps, jp at
    // 0x424b92), push {amount, pos, 1.0f} onto (app+0x3c)+0xc (FUN_0040693f).
    // The original passes a field position (drawn through FUN_00409567);
    // JS callers pass the screen point.
    addMoney(amount, x, y) {
        if (typeof amount !== 'number' || !Number.isFinite(amount)) return;
        if (this.mMoneyFrozen) return;
        this.mMoney += amount;
        this.mTotalMoney += amount;
        if (this.mMoneyCap > 0 && this.mMoneyCap < this.mMoney) {
            this.mMoney = this.mMoneyCap;
        }
        if (typeof x === 'number' && typeof y === 'number' && x >= 0) {
            this.mMoneyEffects.push({ amount, x, y, timer: 1.0 });
        }
    }

    // FUN_0040686e (rwg_functions.c:8070), Core::Update tick: every effect's
    // timer -= 0.01 (_DAT_004e9150, double); removed once <= 0.
    _updateMoneyEffects() {
        for (const e of this.mMoneyEffects) e.timer = Math.fround(e.timer - 0.009999999776482582);
        this.mMoneyEffects = this.mMoneyEffects.filter(e => !(e.timer <= 0.0));
    }

    // FUN_00403e23 (rwg_functions.c:4524): spend if money >= amount.
    spendMoney(amount) {
        if (!(amount > 0)) return false;
        if (this.mMoney >= amount) {
            this.mMoney -= amount;
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
            case TaskType.BONUS_TIME:
                return this.mTimeElapsed;
            default:
                return 0;
        }
    }

    _taskTarget(task) {
        // Task 0xc/0xd target lives in mTimeLimit so RiskCasePlusTime
        // (FUN_0041b0b3: target += 3000 ticks) can extend it.
        if (task.type === TaskType.TIME_LIMIT || task.type === TaskType.BONUS_TIME) {
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
                    && task.type !== TaskType.BONUS_TIME;
                if (flashes) this.mTaskFlash[i] = 15;
                this.mTaskProgress[i] = value;
            }
        }
    }

    _isBonus() {
        // level +0x14 (FUN_00423cb3:43854) — LevelData isBonus.
        return !!(this.mLevelConfig && this.mLevelConfig.isBonus);
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
                    // Level-1 +0x54 slot unlock and FUN_00422036 (rwg_functions.c:
                    // 41522-41530) run in GameView → HintController.LevelTutorial.tick.
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
            // :41391 DAT_004fc2f8 = level + 1 → the special-shop price (store
            // +0) is halved if that level is the next one started
            // (FUN_0041e7f2:37665-37673).
            if (perfect) this.mHalfPriceLevel = this.mCurrentLevel + 1;
        }
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

    // FUN_00406e6a (rwg_functions.c:8574, asm 0x406e6a-0x406eea): toggle the
    // egg in the egg controller's brood list (+0xc):
    //   not listed → FUN_00410585 push (no gate, no sound) — the broody is
    //                assigned later by Field._assignBroodEggs (FUN_0040412c);
    //   listed     → FUN_004078c4 remove, egg +0x18 = -1, +0x20 = 0, then
    //                FUN_00404b3b (rwg:5653) releases the broody sitting on it.
    // Also used without a sound by FUN_00406eed / FUN_00406f87.
    toggleEggBrooding(egg) {
        if (!egg) return;
        if (egg.mBrooding) {
            const owner = egg._claimedBy
                || this.mField.mChickens.find(c => c.mBroodingEgg === egg);
            egg.mBrooding = false;          // Gem setter: +0x18 = -1, +0x20 = 0
            if (owner && owner._endBrooding) owner._endBrooding();
            egg._claimedBy = null;
            return;
        }
        egg.mBrooding = true;
    }

    // Egg-box click FUN_00409c92 (rwg_functions.c:12552, asm 0x409d26-0x409d48):
    // FUN_00406e6a then SOUND_EGG_REF (DAT_004fed78, rwg:31755-31756) for both
    // the add and the remove case.
    startEggBrooding(egg) {
        if (!egg) return;
        this.toggleEggBrooding(egg);
        if (SOUNDS.SOUND_EGG_REF) SOUNDS.SOUND_EGG_REF.play();
    }

    // Slot price — FUN_004058e7 asm 0x40590a-0x405919:
    // ftol(DAT_0050032c[type] * _DAT_004fc3b8 + 0.5). There is no per-purchase
    // doubling for chickens (that is FUN_0041eb94, the upgrade price).
    getChickPrice(type) {
        const base = CHICK_BASE_PRICES[type] || CHICK_BASE_PRICES[0];
        return Math.floor(base * this.mChickPriceInflation + 0.5);
    }

    // Shop-slot value (store +8 vector, FUN_0040bfb3): -1 unlimited, 0 closed,
    // N = buys left. Initial values: FUN_00422c01:42836-42849 (-1 ×5) +
    // FUN_00423c04 / FUN_00422d10 writes (LevelData buySlots); screenshots/13
    // (L1: all closed) and 19 (L2: layer open, no count). Independent of the
    // BUY button (store +0x19).
    _slotLimit(type) {
        const v = this.mBuySlots ? this.mBuySlots[type] : 0;
        return (typeof v === 'number') ? v : 0;
    }

    // FUN_0041e8f5 (rwg_functions.c:37701) without the slot gate — used by the
    // level-start purchases (FUN_00423deb sets slot0 = -1 first, 43941).
    _buySlot(type) {
        if (!this.spendMoney(this.getChickPrice(type))) {
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();   // DAT_004fedac :37736
            return false;
        }
        this._spawnBoughtChick(type);
        return true;
    }

    // HUD slot purchase FUN_0041e8f5 as called by the slot click FUN_00409ba0
    // (rwg_functions.c:12469; GameView plays its success sound)
    // (rwg_functions.c:37701-37740):
    //   slot value 0 → nothing (no sound); money < price → SOUND_ERROR;
    //   success → chick spawned, slot value decremented if > 0 (37718-37721),
    //   SOUND_CHICK_BUY (DAT_004fed80, rwg_functions.c:12495).
    // Chicken prices never double per purchase (FUN_004058e7 = base × global
    // inflation factor); the only rise is FUN_0041ea9a's ×1.003.
    buyChick(type) {
        if (this._slotLimit(type) === 0) return false;
        const price = this.getChickPrice(type);
        if (this.mMoney < price) {
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
            return false;
        }
        this.spendMoney(price);
        this._spawnBoughtChick(type);
        if (this.mBuySlots[type] > 0) this.mBuySlots[type]--;
        if (type === ChickType.MAGIC) this.mHatchedMagic++;
        else if (type === ChickType.HOLY) this.mHatchedHoly++;
        else if (type === ChickType.ROOSTER) this.mHatchedRooster++;
        // SOUND_CHICK_BUY (DAT_004fed80) is played by the caller, the shop-slot
        // click FUN_00409ba0 (asm 0x409c16) in GameView.
        return true;
    }

    // Seed controller +0x20 (seeds-per-click index into DAT_0050034c, read by
    // FUN_0041bfe2:34304); written by FUN_0041c3c6 (items 0 → 1, 5 → 2).
    _seedUpgradeLevel() {
        return this.mSeedCountLevel || 0;
    }

    // ---- Special shop (BUY button, SpecialShopDialog FUN_00420232) ----------
    // FUN_0041eae5 (rwg_functions.c:37926): the item list shown by the special
    // shop and used by RiskCaseOffensive (FUN_0041aeaf):
    //   FUN_0041c25e (34473): seed list → [2 if present else 6 if present],
    //                         then [0 if present else 5 if present];
    //   then the whole weapon list (app+0x40)+4 (FUN_0040c998), then the whole
    //   pet list (app+0x44)+0xc (FUN_00410209).
    getSpecialShopItems() {
        const L = this.mShopLists || { seed: [], weapon: [], pet: [] };
        const ids = [];
        if (L.seed.includes(2)) ids.push(2);
        else if (L.seed.includes(6)) ids.push(6);
        if (L.seed.includes(0)) ids.push(0);
        else if (L.seed.includes(5)) ids.push(5);
        for (const id of L.weapon) ids.push(id);
        for (const id of L.pet) ids.push(id);
        return ids.map((id) => ({
            id,
            name: SHOP_ITEM_LIST[id].name,
            desc: SHOP_ITEM_LIST[id].desc,
            image: 'IMAGE_OFFENSIVE_' + SHOP_ITEMS[id],   // DAT_005005d4[id] (rwg:31518-31538)
        }));
    }

    // Special-shop price = store +0 (row text FUN_00420758:40144-40150, "FREE"
    // when < 1).
    getSpecialShopPrice() {
        return this.mUpgradePrice;
    }

    // FUN_0041eb94 (rwg_functions.c:37974): money < price → false (dialog shows
    // "You don't have enough money.", rwg:40388); else apply the item
    // (FUN_0041ebd3), spend the price, price *= 2 with floor 0xfa.
    buySpecialItem(id) {
        const price = this.mUpgradePrice;
        if (this.mMoney < price) return false;
        this._applyShopItem(id);
        this.spendMoney(price);
        let next = price * 2;
        if (next < SHOP_ITEM_BASE_PRICE) next = SHOP_ITEM_BASE_PRICE;
        this.mUpgradePrice = next;
        return true;
    }

    // RiskCaseOffensive (FUN_0041aeaf asm 0x41aee9): same list as the shop.
    getRiskOffensiveItems() {
        return this.getSpecialShopItems();
    }

    // RiskCaseOffensive apply (asm 0x41afbd-0x41afc9): FUN_0041ebd3(id), free.
    giveRiskOffensiveItem(id) {
        this._applyShopItem(id);
    }

    // FUN_0041ebd3 (rwg_functions.c:38003): seed list first (FUN_0041c3c6),
    // else weapon list (remove id; 3 → +0x10, 7 → +0x11), else pet list
    // (FUN_00410223: remove id; 1 → mouse, 4 → elephant spawned).
    _applyShopItem(id) {
        const L = this.mShopLists;
        const take = (list) => {
            const i = list.indexOf(id);
            if (i < 0) return false;
            list.splice(i, 1);           // FUN_0040ca0e removes every match
            while (list.indexOf(id) >= 0) list.splice(list.indexOf(id), 1);
            return true;
        };
        if (take(L.seed)) {
            // FUN_0041c3c6:34596-34607
            if (id === 2) this.mSeedQuality = 1;
            else if (id === 6) this.mSeedQuality = 2;
            else if (id === 0) this.mSeedCountLevel = 1;
            else if (id === 5) this.mSeedCountLevel = 2;
            this.mSeedCalories = JS_SEED_CALORIES[this.mSeedQuality];
            this.mSeedCount = SEEDS_PER_DROP[this.mSeedCountLevel];
            return true;
        }
        // FUN_0041ebd3:38018-38024 — the weapon list removal runs for any id.
        take(L.weapon);
        if (id === 3) { this.mGunArea = true; return true; }
        if (id === 7) { this.mGunPower = 2; return true; }
        if (!take(L.pet)) return false;
        if (id === 1 || id === 4) {
            // FUN_00410299 type 0 / 1 at FUN_00408107 (rand%128, rand%72).
            const [fx, fy] = randomSpawnPoint();
            const pet = id === 1 ? new Mouse(fx, fy) : new Elephant(fx, fy);
            this.mField.addPet(pet);
            if (id === 1) this.mHasMouse = true; else this.mHasElephant = true;
        }
        return true;
    }

    // drawHUD — the HUD part of GameView::Draw FUN_0040a3d6 (rwg_functions.c:
    // 13659-13907; asm 0x40af73-0x40b965). The view is 800x600 (this+0x38 /
    // this+0x3c). Every coordinate below is from the asm (the decompiler lost
    // most register arguments). Text is drawn with Graphics::DrawString
    // FUN_004665a6 (x = left edge, y = baseline); centring / right alignment is
    // done by the original through Font::StringWidth (font vtable +0x1c).
    drawHUD(g) {
        const ctx = g.ctx;
        const ready = (res) => res && res.img && g._isReady(res.img);
        const W = 800, H = 600;
        const strW = (str, font) => {
            ctx.font = font;
            return Math.round(ctx.measureText(str).width);
        };
        const text = (str, x, y, font, fill) => {
            ctx.font = font;
            drawOutlinedText(ctx, str, x, y, fill);
        };
        const half = (v) => Math.trunc(v / 2);   // cdq; sub edx; sar 1
        const WHITE = '#fff';                    // DAT_005012a0 / Color(255,255,255)

        // asm 0x40af77: IMAGE_IN_GAME_UP (DAT_004fffb8) at (W - w, 0).
        const up = IMAGES.IMAGE_IN_GAME_UP;
        if (ready(up)) ctx.drawImage(up.img, W - up.mWidth, 0);
        // asm 0x40af8d-0x40afa5: FUN_00466895 = DrawImage stretched (dest
        // x + trans, y + trans, w, h; src = whole image) of IMAGE_IN_GAME_DOWN
        // (DAT_004fffbc, 10x40, alpha from in_game_down_.png) into
        // (0, H - h, W, h) — the dark strip along the bottom of the field.
        const down = IMAGES.IMAGE_IN_GAME_DOWN;
        if (ready(down)) ctx.drawImage(down.img, 0, H - down.mHeight, W, down.mHeight);
        // asm 0x40afae-0x40afd2: IMAGE_NUMBER_SLOT (DAT_004fffc0) at
        // (W - w, 0) and (W - w, h).
        const ns = IMAGES.IMAGE_NUMBER_SLOT;
        if (ready(ns)) {
            ctx.drawImage(ns.img, W - ns.mWidth, 0);
            ctx.drawImage(ns.img, W - ns.mWidth, ns.mHeight);
        }

        // Shop slots (asm 0x40b001-0x40b1a8), i = 0 .. store slot count - 1,
        // x = IMAGE_SHOP_SLOT_OPEN (DAT_004fff88) width * i:
        //   slot value 0 → IMAGE_SHOP_SLOT_CLOSED (DAT_004fff8c) at (x, 0);
        //   else IMAGE_SHOP_SLOT_OPEN at (x, 0), price "%i" (slot +4) in FONT_8
        //   at (x + 0x28 - w/2, 0x46), preview DAT_00500604[i] at (x + 0xd, 6),
        //   and when the value > 0 the value "%i" in FONT_10 at
        //   (x + 0x3e - w/2, 0x17). Colour white (asm 0x40afde-0x40affc).
        const shopOpen = IMAGES.IMAGE_SHOP_SLOT_OPEN;
        const shopClosed = IMAGES.IMAGE_SHOP_SLOT_CLOSED;
        const previewKeys = [
            'IMAGE_CHICK_PREVIEW_LAYER',
            'IMAGE_CHICK_PREVIEW_BROODY',
            'IMAGE_CHICK_PREVIEW_ROOSTER',
            'IMAGE_CHICK_PREVIEW_MAGIC',
            'IMAGE_CHICK_PREVIEW_HOLY',
        ];
        if (ready(shopOpen)) {
            for (let i = 0; i < 5; i++) {
                const bx = shopOpen.mWidth * i;
                const limit = this._slotLimit(i);
                if (limit === 0) {
                    if (ready(shopClosed)) ctx.drawImage(shopClosed.img, bx, 0);
                    continue;
                }
                ctx.drawImage(shopOpen.img, bx, 0);
                const price = String(this.getChickPrice(i));
                text(price, bx - half(strW(price, HUD_FONT_8)) + 0x28, 0x46, HUD_FONT_8, WHITE);
                const prevImg = IMAGES[previewKeys[i]];
                if (ready(prevImg)) ctx.drawImage(prevImg.img, bx + 0xd, 6);
                if (limit > 0) {
                    const ls = String(limit);
                    text(ls, bx - half(strW(ls, HUD_FONT_10)) + 0x3e, 0x17, HUD_FONT_10, WHITE);
                }
            }
        }

        // MENU / SELL / BUY are child button widgets of GameView (created in
        // FUN_0040bbea; drawn here in this port). MENU: Resize(0x193, 0x27,
        // 0x65, 0x26) (rwg:14005); SELL Resize(0x1FA, 0x27, 0x55, 0x26) and BUY
        // Resize(0x1FA, 0x01, 0x55, 0x26), visible per store +0x18 / +0x19
        // (rwg:13294-13297). Label font / offsets: UNKNOWN — not found in
        // decompiled (ButtonWidget draw), left as is.
        const _hudOver = (bx, by, bw, bh) => {
            const hx = this.mHudHoverX, hy = this.mHudHoverY;
            return typeof hx === 'number' && typeof hy === 'number'
                && hx >= bx && hx < bx + bw && hy >= by && hy < by + bh;
        };
        const drawButton = (x, y, w, h, label) => {
            const img = _hudOver(x, y, w, h) && IMAGES.IMAGE_DIALOG_BUTTON_OVER
                ? IMAGES.IMAGE_DIALOG_BUTTON_OVER : IMAGES.IMAGE_DIALOG_BUTTON;
            if (ready(img)) ctx.drawImage(img.img, x, y, w, h);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(label, x + w / 2, y + 24);
            ctx.textAlign = 'left';
        };
        drawButton(403, 39, 101, 38, 'MENU');
        const lc = this.mLevelConfig || {};
        const showSell = lc.sellButton !== undefined ? lc.sellButton : lc.hasSell;
        if (showSell) drawButton(506, 39, 85, 38, 'SELL');
        const showBuy = lc.specialShopButton !== undefined ? lc.specialShopButton : lc.hasBuy;
        if (showBuy) drawButton(506, 1, 85, 38, 'BUY');

        // "Level %i" (0x4dcdac) in FONT_16 (DAT_004fff14), white, at
        // (0x19a, 0x19) (asm 0x40b1ae-0x40b20b).
        text(`Level ${this.mCurrentLevel}`, 0x19a, 0x19, HUD_FONT_16, WHITE);

        // Task slots (asm 0x40b210-0x40b4a4): the level task vector in id
        // order; entries with target (+0) > 0, k = drawn count:
        //   IMAGE_NUMBER_SLOT_TASK (DAT_004fffc4) at (W - w, h*k + 0x50);
        //   icon (+8) at (0x25d, slotY + h/2 - icon.h/2);
        //   time task (icon == DAT_00500000, tasks 0xc/0xd): FONT_16, colour
        //     (255,50,50), white when rem = target - current <= 1000 and
        //     (rem / 50) is odd; FUN_0040bebb(rem) centred on 0x2c1 at
        //     slotY + 0x1b;
        //   else: flash (+0xc) == 0 → FONT_10 white, else FONT_12
        //     (100,100,200); current "%i" right-aligned to 0x2c1 and
        //     " / %i" (0x4dcdb8, target) from 0x2c1, both at slotY + 0x19.
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
            [TaskType.BONUS_TIME]: 'IMAGE_MISSION_TIME',
        };
        const slotH = ready(slotTaskImg) ? slotTaskImg.mHeight : 0;
        let taskIdx = 0;
        for (let i = 0; i < this.mTasks.length; i++) {
            const task = this.mTasks[i];
            const target = this._taskTarget(task);
            if (!(target > 0)) continue;
            const ty = slotH * taskIdx + 0x50;
            if (ready(slotTaskImg)) ctx.drawImage(slotTaskImg.img, W - slotTaskImg.mWidth, ty);
            const iconImg = IMAGES[missionIcons[task.type]];
            if (ready(iconImg)) {
                ctx.drawImage(iconImg.img, 0x25d, half(slotH) - half(iconImg.mHeight) + ty);
            }
            const cur = this.mTaskProgress[i] || 0;
            if (task.type === TaskType.TIME_LIMIT || task.type === TaskType.BONUS_TIME) {
                // JS keeps task 0xc/0xd in ms (×10 of the original ticks).
                const rem = Math.trunc((target - cur) / 10);
                const blink = rem <= 1000 && (Math.trunc(rem / 0x32) & 1) !== 0;
                const ts = this._formatTicks(rem);
                text(ts, 0x2c1 - half(strW(ts, HUD_FONT_16)), ty + 0x1b, HUD_FONT_16,
                    blink ? WHITE : 'rgb(255,50,50)');
            } else {
                const flash = this.mTaskFlash[i] > 0;
                const font = flash ? HUD_FONT_12 : HUD_FONT_10;
                const fill = flash ? 'rgb(100,100,200)' : WHITE;
                const cs = String(cur);
                text(cs, 0x2c1 - strW(cs, font), ty + 0x19, font, fill);
                text(` / ${target}`, 0x2c1, ty + 0x19, font, fill);
            }
            taskIdx++;
        }

        // Egg boxes (asm 0x40b4a9-0x40b672), only when FUN_00404a71(1): the
        // broody bit of the field chick-type bitset (+0x24c) is set. For every
        // egg i of the egg controller: rect FUN_00409ab2(i) (asm 0x409ab2:
        // x = EGG_REF.w * i, y = 0x50; i > 10 → x -= 11 * w, y = h + 0x50);
        // box IMAGE_EGG_REF_FOR_BROOD (DAT_004fff78) when in the brood list
        // (FUN_00406e0d) else IMAGE_EGG_REF (DAT_004fff74) at (x, y); egg-type
        // icon DAT_004fffdc..DAT_004fffec at (x + (EGG_REF.w - icon.w)/2,
        // y + 10); when FUN_00406ac9 > 0.0, IMAGE_EGG_REF_BROOD_PROGRESS
        // (DAT_004fff7c) cropped to ftol(progress * w + 0.5) at (x + 5, y + 5).
        const types = this.mLevelConfig && this.mLevelConfig.chickTypeEnabled;
        const broodyBit = types ? !!types[1] : true;
        const eggRefImg = IMAGES.IMAGE_EGG_REF;
        if (broodyBit && ready(eggRefImg)) {
            const eggBroodImg = IMAGES.IMAGE_EGG_REF_FOR_BROOD;
            const eggProgressImg = IMAGES.IMAGE_EGG_REF_BROOD_PROGRESS;
            // JS EggType → original egg type → DAT_004fffdc..DAT_004fffec
            // (layer, broody, rooster, magic, holy; asm 0x40b582-0x40b5ba).
            const eggIconByJsType = [
                'IMAGE_MISSION_EGGS_LAYER',   // WHITE  → layer
                'IMAGE_MISSION_EGGS_MAGIC',   // BLUE   → magic
                'IMAGE_MISSION_EGGS_HOLY',    // RED    → holy
                'IMAGE_MISSION_EGGS_ROOSTER', // BLACK  → rooster
                'IMAGE_MISSION_EGGS_BROODY',  // GOLDEN → broody
            ];
            const ew = eggRefImg.mWidth, eh = eggRefImg.mHeight;
            const fieldEggs = this.mField.mGems.filter(gem => gem.mType === 4 && gem.mIsAlive);
            for (let i = 0; i < fieldEggs.length; i++) {
                const egg = fieldEggs[i];
                let ex = ew * i;
                let ey = 0x50;
                if (i > 10) { ex -= 11 * ew; ey = eh + 0x50; }
                const boxImg = egg.mBrooding ? eggBroodImg : eggRefImg;
                if (ready(boxImg)) ctx.drawImage(boxImg.img, ex, ey);
                const iconImg = IMAGES[eggIconByJsType[egg.mEggType]];
                if (ready(iconImg)) {
                    ctx.drawImage(iconImg.img, half(ew - iconImg.mWidth) + ex, ey + 10);
                }
                const p = egg.mBroodProgress || 0;
                if (p > 0.0 && ready(eggProgressImg)) {
                    const w = Math.trunc(p * eggProgressImg.mWidth + 0.5);
                    if (w > 0) {
                        ctx.drawImage(eggProgressImg.img, 0, 0, w, eggProgressImg.mHeight,
                            ex + 5, ey + 5, w, eggProgressImg.mHeight);
                    }
                }
            }
        }

        // Time / Money (asm 0x40b677-0x40b80b), FONT_16, white:
        //   s = state+8 / 100; "%i:" or "0%i:" (minutes s/60 > 9) + "%i" or
        //   "0%i" (seconds s%60 > 9); "Time" at (0x265, 0x1b), value at
        //   (0x2d5, 0x1b); "Money" at (0x265, 0x46), money "%i" right-aligned
        //   to 0x314 at 0x46.
        text('Time', 0x265, 0x1b, HUD_FONT_16, WHITE);
        text(this._formatTicks(Math.trunc(this.mTimeElapsed / 10)), 0x2d5, 0x1b, HUD_FONT_16, WHITE);
        text('Money', 0x265, 0x46, HUD_FONT_16, WHITE);
        const ms = String(this.mMoney);
        text(ms, 0x314 - strW(ms, HUD_FONT_16), 0x46, HUD_FONT_16, WHITE);

        // Risk icon — shown when (app+0x48)+9 (ready) is set (rwg:13899).
        // Rect FUN_00409af0 (rwg:12452-12457, asm 0x409b6a-0x409b98):
        // x = 0x2da, y = (count-1) * DAT_004fffc4(IMAGE_NUMBER_SLOT_TASK)+8
        // (height) + 0x75, w/h = DAT_00500014 (IMAGE_ICON_RISK) +4/+8 = the
        // whole image width/height (asm 0x409b88/0x409b8b). Drawn by
        // FUN_0041742b at rect x,y with cel = phase(+0x10) * numCols
        // (rwg:13901-13905; RiskController.getIconCel).
        const risk = this.mRiskController;
        if (this.mRiskReady && risk) {
            const ry = (taskIdx - 1) * slotH + 0x75;
            const riskImg = IMAGES.IMAGE_ICON_RISK;
            if (ready(riskImg)) {
                const fw = riskImg.getCelWidth();
                const fh = riskImg.getCelHeight();
                const cel = risk.getIconCel(riskImg.mNumCols || 1);
                ctx.drawImage(riskImg.img, cel * fw, 0, fw, fh, 0x2da, ry, fw, fh);
                this._riskIconRect = { x: 0x2da, y: ry, w: riskImg.mWidth, h: riskImg.mHeight };
            } else {
                this._riskIconRect = null;
            }
        } else {
            this._riskIconRect = null;
        }

        // Money effects (asm 0x40b87b-0x40b965): FONT_16, colourised; per
        // entry colour (255,255,255, ftol(timer * 256.0)) (_DAT_004e91e8),
        // "%i" of the amount drawn at FUN_00409567(pos) (left, baseline).
        // Alpha 256 at timer 1.0 is clamped to 255 here.
        for (const e of this.mMoneyEffects) {
            const a = Math.min(255, Math.trunc(e.timer * 256.0));
            if (a <= 0) continue;
            ctx.globalAlpha = a / 255;
            text(String(e.amount), Math.trunc(e.x), Math.trunc(e.y), HUD_FONT_16, WHITE);
        }
        ctx.globalAlpha = 1;
        ctx.textAlign = 'left';
    }

    // FUN_0040bebb (asm 0x40bebb-0x40bf55) / asm 0x40b677-0x40b70e: s =
    // ticks / 100 (negative → 0); "%i:" when s/60 > 9 else "0%i:", then "%i"
    // when s%60 > 9 else "0%i".
    _formatTicks(ticks) {
        let s = Math.trunc(ticks / 100);
        if (s < 0) s = 0;
        const min = Math.trunc(s / 60);
        const sec = s - min * 60;
        return (min > 9 ? `${min}:` : `0${min}:`) + (sec > 9 ? `${sec}` : `0${sec}`);
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
            // Crosshair rect (rwg_functions.c:15926-15936): (x - aim/2,
            // y - (aim>>1), aim, aim).
            const cross = { x: x - Math.trunc(aim / 2), y: y - h, w: aim, h: aim };
            for (const wolf of this.mField.mWolves || []) {
                if (!wolf.mIsAlive) continue;
                // Pet list loop (rwg_functions.c:15971-16010): type 2 pets whose
                // rect FUN_00409800 (Pet.getRect) overlaps the crosshair
                // (FUN_0040d241, strict).
                const r = wolf.getRect ? wolf.getRect() : null;
                if (!r) continue;
                if (!(cross.x < r.x + r.w && cross.y < r.y + r.h
                    && r.x < cross.x + cross.w && r.y < cross.y + cross.h)) continue;
                // Hit direction (rwg_functions.c:15990-16008): vector from the
                // crosshair centre to the rect centre, normalised to length 1.0
                // by FUN_00403cdf.
                let dx = (r.x + Math.trunc(r.w / 2)) - (cross.x + h);
                let dy = (r.y + Math.trunc(r.h / 2)) - (cross.y + h);
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 0) { dx /= len; dy /= len; }
                // FUN_0041050c (rwg_functions.c:20161): if not dead → vtable hit
                // (power, dir), SOUND_SHOOT (DAT_004fed88), dead now → +$500
                // (FUN_00406b22 → FUN_00424b5d).
                if (wolf.isDead && wolf.isDead()) return;
                if (wolf.hit) wolf.hit(dmg, dx, dy);
                if (SOUNDS.SOUND_SHOOT) SOUNDS.SOUND_SHOOT.play();
                if (wolf.isDead && wolf.isDead()) {
                    this.addMoney(WOLF_KILL_REWARD, wolf.mX, wolf.mY);
                }
                return;
            }
            return;
        }

        if (handMode === 'cure') {
            // Mode 1 (:16020-16040, 16144-16153): only when a sick chick
            // (FUN_00402342) is under the cursor (FUN_00407ad4): a gem under the
            // cursor is collected first (FUN_0040c6a5); otherwise that chick is
            // cured (FUN_0040490a).
            let sick = null;
            // rwg_functions.c:16080-16094: first chick with FUN_00402342
            // (action 3/4) whose rect FUN_00409956 (Chick.getRect) contains
            // the cursor (FUN_00407ad4: x in [rx, rx+w), y in [ry, ry+h)).
            for (const c of this.mField.mChickens) {
                if (c.mIsAlive && c.mIsSick) {
                    const r = c.getRect();
                    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
                        sick = c; break;
                    }
                }
            }
            if (!sick) return;
            if (this._collectGemAt(x, y)) return;
            this._cureChick(sick);
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
                return true;
            }
        }
        return false;
    }

    // FUN_004072fa (rwg_functions.c:8920, asm 0x4072fa-0x407440): first egg
    // whose +0x20 (sat-on flag, Gem.mBroodStarted) is clear and whose rect
    // FUN_004095cd contains the cursor:
    //   egg ctl +0x28 == 0 → FUN_00406b22: FUN_00424b5d(egg pos, DAT_0050033c
    //   [type]); counter[type]++; wasListed = FUN_00406e0d (brood list);
    //   FUN_00406c4d removes the egg (+0x1c = 1.0, egg + brood lists;
    //   Field.removeEgg); if it was listed, FUN_004074a3 (rwg:9054) toggles
    //   the first egg of the same type not yet in the brood list into it;
    //   sound (Egg collect sound, arg lost in the decompile).
    _clickEggAt(x, y) {
        for (const gem of this.mField.mGems) {
            if (gem.mType !== 4) continue;
            if (!gem.mIsAlive || gem.mCollected) continue;
            if (gem.mBroodStarted) continue;
            if (!gem.contains(x, y)) continue;
            const wasListed = !!gem.mBrooding;
            const value = gem.collect();   // plays the egg sound, marks removed
            if (!this.mEggSellDisabled) this.addMoney(value, gem.mX, gem.mY);
            this._trackEggCollection(gem);
            // FUN_00406c4d unlinks only (no FUN_00404b3b): a broody heading
            // for the egg notices its removal itself (Chick.js).
            if (wasListed) gem.mBrooding = false;
            if (this.mField.removeEgg) this.mField.removeEgg(gem);
            if (wasListed) {
                const next = this.mField.mGems.find(e => e.mType === 4 && e.mIsAlive
                    && !e.mCollected && e !== gem && e.mEggType === gem.mEggType
                    && !e.mBrooding);
                if (next) this.toggleEggBrooding(next);
            }
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

    // API kept for callers (Pet.js, ShopDialogs.js) that used to show their own
    // "+$N" popup: there is no such popup in the original — the only money
    // text is the FUN_00424b5d effect, queued by addMoney(amount, x, y) and
    // drawn by drawHUD. These are intentionally no-ops.
    addFloatingText(_x, _y, _text, _color) {}
    updateFloatingTexts() {}
    drawFloatingTexts(_g) {}

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
