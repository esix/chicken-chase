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
import { ChickState } from './Chick.js';

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
// FUN_00401148 (asm 0x401148): rand() / _DAT_004e9178 (32767.0), stored
// through a float (fstps/flds) -> float32.
function rand01() { return Math.fround(crtRand() / 32767.0); }
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
// JS: ChickState.SICK_START / SICK_IDLE (Chick.js "action 3/5" / 4).
function chickInSickAction(c) {
    return c.mState === ChickState.SICK_START || c.mState === ChickState.SICK_IDLE;
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
    // FUN_0041aeaf (rwg_functions.c:32762, asm 0x41aeaf-0x41afb8):
    //   list = FUN_0041eae5() (= FieldController.getRiskOffensiveItems(), the
    //   special-shop list); empty -> false; else node = list[rand() % size]
    //   (unsigned divl, asm 0x41af2d-0x41af34), +0x20 = item id,
    //   description = DAT_004decf4 "You've earned a free upgrade: " +
    //   name std::string at 0x500480 + id*0x1c (asm 0x41af79-0x41af8f).
    //   The prefix is in index.html; mValue = the appended name. The
    //   0x500480 initializer is UNKNOWN — not found in decompiled; names come
    //   from LevelData.SHOP_ITEM_LIST (item 5's name is an assumption there).
    canApply(fc) {
        const list = fc.getRiskOffensiveItems();
        if (!list || list.length === 0) return false;
        const item = list[crtRand() % list.length];
        this.mItemId = item.id;
        this.mValue = item.name || '';
        return true;
    }
    // FUN_0041afbd (asm 0x41afbd-0x41afc9): FUN_0041ebd3(+0x20) — free item
    // (= FieldController.giveRiskOffensiveItem(id)).
    apply(fc) {
        fc.giveRiskOffensiveItem(this.mItemId);
    }
}

export class RiskCasePlusMoney extends RiskCase {
    constructor() {
        super(RiskCaseType.PLUS_MONEY, 'PlusMoney');
        this.mAmount = 0; // +0x20
    }
    // FUN_0041afd1 (rwg_functions.c:32858, asm 0x41afd1-0x41b05e):
    //   money-struct (Core+0xc) byte 0 set -> false;
    //   amount = FUN_00403d6c(lo = money/20, hi = money*3/20); if < 500 -> 500;
    //   description = DAT_004ded14 with %i = amount (text: index.html).
    // Money byte 0: 0 at creation (FUN_00406069:7531), set to 1 only by
    // FUN_00423e5a (asm 0x423e5a-0x423e65, levels 0x22/0x25) =
    // FieldController.mMoneyFrozen.
    canApply(fc) {
        if (fc.mMoneyFrozen) return false;
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

// Raven controller (Core+0x10) +0x14 = ravens per wave
// (FieldController.mRavenCtl.waveSize, LevelData raven.perWave).
function ravensPerWave(fc) {
    if (fc.mRavenCtl) return fc.mRavenCtl.waveSize || 0;
    return (fc.mLevelConfig && fc.mLevelConfig.hasRavens) ? 1 : 0;
}

export class RiskCaseRavensScared extends RiskCase {
    constructor() {
        // FUN_0041b569 (rwg_functions.c:33517); text in index.html
        super(RiskCaseType.RAVENS_SCARED, 'RavensScared');
    }
    // FUN_0041b499 (rwg_functions.c:33276): ravenController+0x14 > 0.
    canApply(fc) {
        return ravensPerWave(fc) > 0;
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
        // List size (+8) counts every chick object in the list, dying ones
        // (state 6) included — FUN_0041b30a skips those explicitly.
        const chickens = fc.mField.mChickens;
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
    // FUN_0041b3ae (rwg_functions.c:33164, asm 0x41b3ae-0x41b435): money
    // byte 0 clear (fc.mMoneyFrozen, see PlusMoney) and money >= 500;
    //   amount = FUN_00403d6c(lo = money/20, hi = money*3/20);
    //   description DAT_004ded64 with %i = amount (text: index.html).
    canApply(fc) {
        if (fc.mMoneyFrozen) return false;
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

function fluFlag(fc) {
    const lc = fc.mLevelConfig;
    return !(lc && lc.field264 === 0);
}

export class RiskCaseChickFlu extends RiskCase {
    constructor() {
        // FUN_0041b569 (rwg_functions.c:33563); text in index.html
        super(RiskCaseType.CHICK_FLU, 'ChickFlu');
    }
    // FUN_0041b44b -> FUN_00404e20 (rwg_functions.c:5964): true when any chick
    // passes FUN_004040ec (rwg:4822) = chickList+0x264 != 0 (LevelData
    // field264: ctor 1, level 1 writes 0) && chick vtable[3].
    canApply(fc) {
        if (!fluFlag(fc)) return false;
        return fc.mField.mChickens.some(c => chickCanCatchFlu(c));
    }
    // FUN_0041b45b (rwg_functions.c:33247): k = min(20, layerCount*4/5)
    // (FUN_00404ad0(0) counts chicks of type 0); k times FUN_00404d6d: resets
    // the chick list's epidemic timer (+0x268 = FUN_00404caf — no JS
    // equivalent yet: FieldController only has a sickness stand-in) and
    // infects the FIRST chick in list order that passes FUN_00404d00
    // (rwg:5815): flag +0x264 && vtable[3] -> PlaySample(DAT_004fed9c
    // SOUND_SICK); if state != 0: state = 1 and vtable +0x20.
    apply(fc) {
        if (!fluFlag(fc)) return;
        const chickens = fc.mField.mChickens;
        // FUN_00404ad0 (rwg:5614): every list entry with type (+4) == 0.
        const layers = chickens.filter(c => c.mType === 0).length;
        let k = Math.trunc((layers << 2) / 5);
        if (k > 0x14) k = 0x14;
        for (; k > 0; k--) {
            const c = chickens.find(ch => chickCanCatchFlu(ch));
            if (!c) continue;
            if (SOUNDS.SOUND_SICK) SOUNDS.SOUND_SICK.play();
            // state = 1 (+ vtable +0x20 = new action): JS sick flag + the
            // SICK_START pose right away, so the next iteration's
            // FUN_00402342 test skips this chick as in the original.
            c.mIsSick = true;
            if (c.entersSickPose && c.entersSickPose()) c.setState(ChickState.SICK_START);
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
        return ravensPerWave(fc) > 0;
    }
    // FUN_0041b4ac (rwg_functions.c:33294): ravenController+0x30 = 0, then
    // FUN_00401491 (rwg_functions.c:527) start an attack wave now
    // (= FieldController.startAttackWave, which also zeroes +0x30).
    apply(fc) {
        fc.mRavenScaredTimer = 0;
        fc.startAttackWave();
    }
}

export class RiskController {
    // FUN_0041b569 (rwg_functions.c:33420). The original builds a NEW
    // RiskController in FUN_00406069 (rwg:7661-7664, Core+0x48) on every
    // level start/restart, then the level setup FUN_00422d10 writes
    // +0x08 = 0 for levels 1-6 (asm 0x422dad/0x422df3/0x422e53/0x422e8b/
    // 0x422f00; case 4 jumps to 0x422e7f). `enabled` = LevelData riskEnabled.
    constructor(enabled = true) {
        this.mCooldownCounter = 0;   // +0x04
        this.mRunning = !!enabled;   // +0x08 (ctor 1)
        this.mReady = false;         // +0x09
        this.mPending = false;       // +0x0a
        this.mCaseIndex = 0;         // +0x0c
        this.mBlink = 0;             // +0x10 icon frame phase (float, 0..1)
        this.mCases = [              // std::vector (begin at +0x18)
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
    }

    // FUN_0041b901 (rwg_functions.c:33629, asm 0x41b901-0x41b949): called
    // from the unpaused game tick FUN_00405fcf (rwg:7477). Only while +8:
    // phase += _DAT_004e9108 (double 0.00699999975040555), stored as float;
    // phase >= 1.0 -> 0 (fcomp/test 0x41: reset on greater OR equal);
    // while not ready count to 0x1d4c (7500) then ready = 1.
    update() {
        if (!this.mRunning) return;
        const b = Math.fround(this.mBlink + 0.00699999975040555);
        this.mBlink = b;
        if (b >= 1.0) this.mBlink = 0;
        if (!this.mReady) {
            if (this.mCooldownCounter < COOLDOWN_TICKS) {
                this.mCooldownCounter++;
                return;
            }
            this.mReady = true;
        }
    }

    isReady() { return this.mReady; }

    // Icon cel for FUN_0041742b (draw at rwg:13899-13905, asm 0x40b83a-
    // 0x40b84e): cel = (int)(phase * image+0x10), image+0x10 = numCols =
    // width / height (set at load, asm 0x4196e8-0x4196fd; icon_risk.jpg
    // 900x60 -> 15).
    getIconCel(numCols) {
        return Math.trunc(Math.fround(this.mBlink) * numCols);
    }

    // FUN_0041b94a (rwg_functions.c:33659, asm 0x41b94a-0x41b9ce) first part:
    // nothing unless ready (+9); counter = 0, pending (+0xa) = 1, ready = 0.
    // (Pause, hand reset and the dialogs are in SurpriseDialog.js.)
    requestRoll() {
        if (!this.mReady) return false;
        this.mCooldownCounter = 0;
        this.mPending = true;
        this.mReady = false;
        return true;
    }

    // FUN_0041ba27 (rwg_functions.c:33776, asm 0x41ba27-0x41babb): up to
    // 1000 tries of index = rand() % (count-1) + 1 until the case's check
    // succeeds; a failed try sets index 0, so after 1000 failures the result
    // is Nothing. Caller (FUN_0041b9cf pending branch) clears +0xa first.
    rollRisk(fc) {
        const n = this.mCases.length;
        let tries = 0;
        do {
            this.mCaseIndex = crtRand() % (n - 1) + 1;
            if (this.mCases[this.mCaseIndex].canApply(fc)) break;
            this.mCaseIndex = 0;
            tries++;
        } while (tries < 1000);
        return this.mCases[this.mCaseIndex];
    }

    // FUN_0041b9cf non-pending branch (asm 0x41ba03-0x41ba12): cases[+0xc]
    // vtable[1] (apply).
    applyResult(fc) {
        this.mCases[this.mCaseIndex].apply(fc);
    }
}
