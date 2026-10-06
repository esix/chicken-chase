// Sexy::RiskController (vtable 0x004def0c) and the RiskCase* classes.
// Constructor FUN_0041b569 (rwg_functions.c:33420) builds ONE instance of each
// case into the vector at this+0x18 and keeps them for the controller's
// lifetime (case state such as PlusTime's "once" flag persists).
//
// Case vtables (slot [0] = check/canApply, [1] = apply, [2] = dtor):
//   0 RiskCaseNothing       0x004dee7c  FUN_004108a8 (true)   / FUN_0044a036 (no-op)
//   1 RiskCaseOffensive     0x004dee8c  FUN_0041aeaf          / FUN_0041afbd
//   2 RiskCasePlusMoney     0x004dee9c  FUN_0041afd1          / FUN_0041b05f
//   3 RiskCasePlusTime      0x004deeac  FUN_0041b08d          / FUN_0041b0b3
//   4 RiskCaseRavensScared  0x004deebc  FUN_0041b499          / FUN_0041b0dd
//   5 RiskCaseStealChickens 0x004deecc  FUN_0041b0f3          / FUN_0041b30a
//   6 RiskCaseMinusMoney    0x004deedc  FUN_0041b3ae          / FUN_0041b436
//   7 RiskCaseChickFlu      0x004deeec  FUN_0041b44b          / FUN_0041b45b
//   8 RiskCaseRavensAttack  0x004deefc  FUN_0041b499          / FUN_0041b4ac
// Controller vtable: [0] FUN_0041b9cf (dialog-closed / continue), [1] FUN_0040d4bb.

import { SOUNDS } from './Res.js';

export const RiskCaseType = {
    NOTHING: 0,
    OFFENSIVE: 1,
    PLUS_MONEY: 2,
    PLUS_TIME: 3,
    RAVENS_SCARED: 4,
    STEAL_CHICKENS: 5,
    MINUS_MONEY: 6,
    CHICK_FLU: 7,
    RAVENS_ATTACK: 8,
};

// FUN_0041b901 (rwg_functions.c:33629): counter limit 0x1d4c
const COOLDOWN_TICKS = 7500;

// _rand (FUN_004a082c) — MSVC rand(), 0..32767
function crtRand() { return Math.floor(Math.random() * 32768); }
// FUN_00401148 (asm 0x401148): rand() / _DAT_004e9178 (32767.0)
function rand01() { return crtRand() / 32767.0; }
// FUN_00403d6c (rwg_functions.c:4398, asm 0x403d6c):
//   (int)(rand01 * (hi - lo) + 0.5) + lo
function randRange(lo, hi) {
    return Math.trunc(rand01() * (hi - lo) + 0.5) + lo;
}

// Chick helpers (JS mapping of the original chick vtable predicates).
// vtable[5] isActive FUN_0040327c (rwg_functions.c:3368): state != 6, state != 0,
// z == 0  ->  mIsAlive && mIsAdult && !mIsCarried.
function chickIsActive(c) {
    return !!c && c.mIsAlive && c.mIsAdult && !c.mIsCarried;
}
// FUN_00402342 (asm 0x402342): action == 3 || action == 4. Actions 3/4 are
// the sick animations set by FUN_0040386a (rwg_functions.c, state 1 branch);
// JS represents them with mIsSick (SICK_START / SICK_IDLE states).
function chickInSickAction(c) {
    return !!c.mIsSick;
}
function chickFieldY(c) { return (c.mY - 367) / 2.8; } // FUN_00409533

export class RiskCase {
    // FUN_0041b4e7 (rwg_functions.c:33334): base ctor stores the description
    // string at this+4. JS: the verbatim strings live in js/index.html
    // (surprise-result, [data-risk-case="<mKey>"]); the case exposes only its
    // key and the runtime value substituted for %i / appended name (mValue).
    constructor(type, key) {
        this.mType = type;
        this.mKey = key;
        this.mValue = null;
    }
    // vtable[0] check
    canApply(fc) { return true; }
    // vtable[1] apply
    apply(fc) {}
}

export class RiskCaseNothing extends RiskCase {
    constructor() {
        // FUN_0041b569 (rwg_functions.c:33457); text in index.html
        super(RiskCaseType.NOTHING, 'Nothing');
    }
    // FUN_004108a8: return 1
    canApply() { return true; }
    // FUN_0044a036: ret
    apply() {}
}

export class RiskCaseOffensive extends RiskCase {
    constructor() {
        super(RiskCaseType.OFFENSIVE, 'Offensive');
        this.mItemId = 0; // +0x20
    }
    // FUN_0041aeaf (rwg_functions.c:32762, asm 0x41aeaf):
    //   list = FUN_0041eae5() (offensive items the player can still get);
    //   empty -> false; else item = list[rand() % size], description =
    //   DAT_004decf4 + itemName[item]
    //   (string array at 0x500480 + item*0x1c). Prefix text: index.html.
    // The item list (FUN_0041eae5) and item names live in shop/FieldController
    // code that this file can't see. When FieldController exposes
    // getRiskOffensiveItems()/giveRiskOffensiveItem() they are used; otherwise
    // the previous JS behaviour is kept.
    canApply(fc) {
        if (fc && typeof fc.getRiskOffensiveItems === 'function') {
            const list = fc.getRiskOffensiveItems();
            if (!list || list.length === 0) return false;
            const item = list[crtRand() % list.length];
            this.mItemId = item.id;
            // JS: mValue = appended item name (text prefix in index.html).
            this.mValue = item.name || '';
            return true;
        }
        // UNKNOWN — not found in decompiled: JS-side item list / names. The
        // 0x500480 std::string array has no initializer reachable in the
        // decompiled/disassembly (candidate names exist in .rdata at
        // 0x4dd930..0x4dd99c, rwg_structs.txt:1097-1103, but nothing
        // references them), so the name is left empty.
        this.mItemId = -1;
        this.mValue = '';
        return true;
    }
    // FUN_0041afbd -> FUN_0041ebd3 (rwg_functions.c:38008): item 3 -> upgrades
    // +0x10 = 1 (GUN_AREA), item 7 -> +0x11 = 1 (GUN_POWER), otherwise
    // FUN_00410223 (pets: item 1 -> Mouse, item 4 -> Elephant; seeds are only
    // recorded as owned).
    apply(fc) {
        if (fc && typeof fc.giveRiskOffensiveItem === 'function' && this.mItemId >= 0) {
            fc.giveRiskOffensiveItem(this.mItemId);
            return;
        }
        // UNKNOWN — not found in decompiled: mapping of the original item ids
        // to JS upgrade fields. Previous JS behaviour kept unchanged.
        const r = Math.random();
        if (r < 0.34) fc.mSeedCount = Math.min(10, fc.mSeedCount + 1);
        else if (r < 0.67) fc.mGunPower = Math.min(5, (fc.mGunPower || 1) + 1);
        else fc.mGunArea = true;
    }
}

export class RiskCasePlusMoney extends RiskCase {
    constructor() {
        super(RiskCaseType.PLUS_MONEY, 'PlusMoney');
        this.mAmount = 0; // +0x20
    }
    // FUN_0041afd1 (rwg_functions.c:32858, asm 0x41afd1):
    //   money-struct flag (byte 0) set -> false;
    //   amount = FUN_00403d6c(lo = money/20, hi = money*3/20); if < 500 -> 500;
    //   description = DAT_004ded14 with %i = amount (text: index.html).
    // The money-struct byte flag has no JS equivalent (UNKNOWN), so it is
    // treated as clear.
    canApply(fc) {
        const m = fc.mMoney || 0;
        let amount = randRange(Math.trunc(m / 20), Math.trunc(m * 3 / 20));
        if (amount < 500) amount = 500;
        this.mAmount = amount;
        this.mValue = amount; // %i
        return true;
    }
    // FUN_0041b05f -> FUN_00424b5d (rwg_functions.c:45035): money += amount,
    // capped at the level money cap; no popup (position is -1).
    apply(fc) {
        if (fc.addMoney) fc.addMoney(this.mAmount);
        else fc.mMoney += this.mAmount;
    }
}

export class RiskCasePlusTime extends RiskCase {
    constructor() {
        // FUN_0041b569 (rwg_functions.c:33499): description + this+0x20 = 1
        // (text in index.html)
        super(RiskCaseType.PLUS_TIME, 'PlusTime');
        this.mAvailable = true; // +0x20
    }
    // FUN_0041b08d (rwg_functions.c:32931): +0x20 != 0 && task[0xc] > 0.
    // JS: task 0xc is mapped to fc.mTimeLimit (ms).
    canApply(fc) {
        if (!this.mAvailable) return false;
        return fc.mTimeLimit > 0;
    }
    // FUN_0041b0b3 (rwg_functions.c:32952): if task[0xc] > 0 add 3000
    // (10 ms ticks = 30 s); then +0x20 = 0 (can only happen once).
    apply(fc) {
        if (fc.mTimeLimit > 0) {
            fc.mTimeLimit += 30000; // 3000 ticks * 10 ms
        }
        this.mAvailable = false;
    }
}

export class RiskCaseRavensScared extends RiskCase {
    constructor() {
        // FUN_0041b569 (rwg_functions.c:33517); text in index.html
        super(RiskCaseType.RAVENS_SCARED, 'RavensScared');
    }
    // FUN_0041b499 (rwg_functions.c:33276): ravenController+0x14 > 0.
    // JS: mapped to mLevelConfig.hasRavens.
    canApply(fc) {
        return !!(fc.mLevelConfig && fc.mLevelConfig.hasRavens);
    }
    // FUN_0041b0dd (rwg_functions.c:32974): ravenController+0x30 =
    // max(+0x30, 12000). Only the timer is touched — the old JS also called
    // scare() on every live raven, which the original does not do here.
    apply(fc) {
        if ((fc.mRavenScaredTimer || 0) < 12000) fc.mRavenScaredTimer = 12000;
    }
}

export class RiskCaseStealChickens extends RiskCase {
    constructor() {
        super(RiskCaseType.STEAL_CHICKENS, 'StealChickens');
        this.mStolen = []; // list at +0x20 (size +0x28)
    }
    // FUN_0041b0f3 (rwg_functions.c:32994, asm 0x41b0f3):
    //   chick list size must be > 7;
    //   eligible = chicks with vtable[4] (FUN_0040325a: !inSickAction &&
    //   isActive) and vtable[5] (isActive);
    //   k = FUN_00403d6c(lo = n/10, hi = n/7), at least 1;
    //   k times: push eligible[rand() % n] (with replacement) to the list;
    //   description DAT_004ded3c with %i = list size (text: index.html).
    canApply(fc) {
        const chickens = fc.mField.mChickens.filter(c => c.mIsAlive);
        if (!(chickens.length > 7)) return false;
        // vtable[4] already includes vtable[5] (isActive)
        const eligible = chickens.filter(c => !chickInSickAction(c) && chickIsActive(c));
        const n = eligible.length;
        if (n === 0) return false;
        let k = randRange(Math.trunc(n / 10), Math.trunc(n / 7));
        if (k < 1) k = 1;
        for (; k > 0; k--) {
            this.mStolen.push(eligible[crtRand() % n]);
        }
        if (this.mStolen.length === 0) return false;
        this.mValue = this.mStolen.length; // %i
        return true;
    }
    // FUN_0041b30a (rwg_functions.c:33122): every listed chick whose state is
    // not 6 goes through FUN_0040466e (death + removal); then the list is
    // cleared (FUN_004053c1).
    apply(fc) {
        for (const c of this.mStolen) {
            if (c.mIsAlive) c.die();
        }
        this.mStolen = [];
    }
}

export class RiskCaseMinusMoney extends RiskCase {
    constructor() {
        super(RiskCaseType.MINUS_MONEY, 'MinusMoney');
        this.mAmount = 0; // +0x20
    }
    // FUN_0041b3ae (rwg_functions.c:33164, asm 0x41b3ae): money-struct flag
    // clear (UNKNOWN in JS, treated as clear) and money >= 500;
    //   amount = FUN_00403d6c(lo = money/20, hi = money*3/20);
    //   description DAT_004ded64 with %i = amount (text: index.html).
    canApply(fc) {
        const m = fc.mMoney || 0;
        if (m < 0x1f4) return false;
        this.mAmount = randRange(Math.trunc(m / 20), Math.trunc(m * 3 / 20));
        this.mValue = this.mAmount; // %i
        return true;
    }
    // FUN_0041b436 -> FUN_00403e23 (rwg_functions.c:4526): if money >= amount,
    // money -= amount (otherwise nothing).
    apply(fc) {
        if (fc.mMoney >= this.mAmount) {
            if (fc.spendMoney) fc.spendMoney(this.mAmount);
            else fc.mMoney -= this.mAmount;
        }
    }
}

// FUN_00403e3c (rwg_functions.c:4550): LayerChick vtable[3] — the chick can
// catch the flu when: not in a sick action, z == 0, food tier != 0
// (FUN_00403a3e), isActive, and !(y > _DAT_004e9168 = 61.0) (FUN_00403bbf).
// Other chick types use FUN_0040e36f (false); JS: canLayEggs() marks layers.
function chickCanCatchFlu(c) {
    if (!c || !c.canLayEggs || !c.canLayEggs()) return false;
    if (chickInSickAction(c) || c.mIsCarried) return false;
    // Food tier: JS Chick._isFed() is the port of FUN_00403a3e.
    if (c._isFed && !c._isFed()) return false;
    if (!chickIsActive(c)) return false;
    if (chickFieldY(c) > 61.0) return false;
    return true;
}

export class RiskCaseChickFlu extends RiskCase {
    constructor() {
        // FUN_0041b569 (rwg_functions.c:33563); text in index.html
        super(RiskCaseType.CHICK_FLU, 'ChickFlu');
    }
    // FUN_0041b44b -> FUN_00404e20 (rwg_functions.c:5964): true when any chick
    // passes FUN_004040ec = chickList+0x264 (sickness enabled — no JS field,
    // treated as set; it is only cleared on level 1) && chick vtable[3].
    canApply(fc) {
        return fc.mField.mChickens.some(c => chickCanCatchFlu(c));
    }
    // FUN_0041b45b (rwg_functions.c:33247): k = min(20, layerCount*4/5)
    // (FUN_00404ad0(0) counts chicks of type 0); k times FUN_00404d6d: resets
    // the chick list's epidemic timer (+0x268, FUN_00404caf — no JS
    // equivalent) and infects the FIRST chick in list order that passes
    // FUN_00404d00: plays SOUND_SICK (DAT_004fed9c) and sets state 1 (sick).
    apply(fc) {
        const chickens = fc.mField.mChickens;
        const layers = chickens.filter(c => c.mIsAlive && c.mType === 0).length;
        let k = Math.trunc((layers << 2) / 5);
        if (k > 0x14) k = 0x14;
        for (; k > 0; k--) {
            const c = chickens.find(ch => chickCanCatchFlu(ch));
            if (!c) continue;
            if (SOUNDS.SOUND_SICK) SOUNDS.SOUND_SICK.play();
            c.mIsSick = true;
        }
    }
}

export class RiskCaseRavensAttack extends RiskCase {
    constructor() {
        // FUN_0041b569 (rwg_functions.c:33579); text in index.html
        super(RiskCaseType.RAVENS_ATTACK, 'RavensAttack');
    }
    // FUN_0041b499 (rwg_functions.c:33276): ravenController+0x14 > 0
    canApply(fc) {
        return !!(fc.mLevelConfig && fc.mLevelConfig.hasRavens);
    }
    // FUN_0041b4ac (rwg_functions.c:33294): ravenController+0x30 = 0, then
    // FUN_00401491 (rwg_functions.c:534): start an attack wave right now
    // (wolf wave FUN_00401543 when no ravens / 50% when wolves exist, else
    // raven wave FUN_004014eb). Those wave functions belong to
    // FieldController; it is called when exposed as startAttackWave().
    apply(fc) {
        fc.mRavenScaredTimer = 0;
        if (typeof fc.startAttackWave === 'function') {
            fc.startAttackWave();
            return;
        }
        // UNKNOWN — not found in decompiled: no JS port of FUN_00401491 yet;
        // previous JS behaviour kept.
        for (let i = 0; i < 3; i++) fc.mField.spawnRaven();
    }
}

export class RiskController {
    // FUN_0041b569 (rwg_functions.c:33420)
    constructor() {
        this.mCooldownCounter = 0;   // +0x04
        this.mRunning = true;        // +0x08
        this.mReady = false;         // +0x09
        this.mPending = false;       // +0x0a
        this.mCaseIndex = 0;         // +0x0c
        this.mBlink = 0;             // +0x10 icon blink phase (0..1)
        this.mCases = [              // vector at +0x18
            new RiskCaseNothing(),
            new RiskCaseOffensive(),
            new RiskCasePlusMoney(),
            new RiskCasePlusTime(),
            new RiskCaseRavensScared(),
            new RiskCaseStealChickens(),
            new RiskCaseMinusMoney(),
            new RiskCaseChickFlu(),
            new RiskCaseRavensAttack(),
        ];
        this.mLastResult = null;
    }

    // FUN_0041b901 (rwg_functions.c:33629): called from the game tick while
    // not paused (asm 0x40604e). Blink phase += _DAT_004e9108 (0.007), reset
    // to 0 past 1.0; while not ready, count up to 7500 then become ready.
    update() {
        if (!this.mRunning) return;
        const b = Math.fround(this.mBlink + 0.00699999975040555);
        this.mBlink = b;
        if (1.0 < b) this.mBlink = 0;
        if (!this.mReady) {
            if (this.mCooldownCounter < COOLDOWN_TICKS) {
                this.mCooldownCounter++;
                return;
            }
            this.mReady = true;
        }
    }

    isReady() { return this.mReady; }

    // FUN_0041b94a (rwg_functions.c:33659): icon clicked while ready ->
    // counter = 0, pending = 1, ready = 0, pause the game; then either the
    // "SURPRISE!" / "Do you feel clucky?" prompt (first time, profile +0x1d)
    // or straight to vtable[0] FUN_0041b9cf.
    requestRoll() {
        if (!this.mReady) return false;
        this.mCooldownCounter = 0;
        this.mPending = true;
        this.mReady = false;
        return true;
    }

    // FUN_0041b9cf (pending branch) + FUN_0041ba27 (rwg_functions.c:33776):
    // up to 1000 tries of index = rand() % (count-1) + 1 until the case's
    // check succeeds; after 1000 failures the index is 0 (Nothing). The
    // result is shown in a "SURPRISE!" dialog whose close calls
    // FUN_0041b9cf again, which applies the case (vtable[1]) and unpauses.
    // GameView calls rollRisk() on the click and then result.apply(fc).
    rollRisk(fc) {
        if (this.mReady) this.requestRoll();
        this.mPending = false;
        const n = this.mCases.length;
        let tries = 0;
        do {
            this.mCaseIndex = crtRand() % (n - 1) + 1;
            if (this.mCases[this.mCaseIndex].canApply(fc)) break;
            this.mCaseIndex = 0;
            tries++;
        } while (tries < 1000);
        const result = this.mCases[this.mCaseIndex];
        this.mLastResult = result;
        return result;
    }

    // FUN_0041b9cf non-pending branch: apply the chosen case.
    applyResult(fc) {
        const c = this.mCases[this.mCaseIndex];
        if (c) c.apply(fc);
    }
}
