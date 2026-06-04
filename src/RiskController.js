// Sexy::RiskController (vtable 0x004def0c). Constructor FUN_0041b569 (line 33415).
// Verified per DECOMPILED_MAP.md section 9 + Risk research agent (2026-05-06).
//
// 9 cases:
//   0 RiskCaseNothing       — vtable 0x004dee7c, "Nothing happens..."
//   1 RiskCaseOffensive     — vtable 0x004dee8c, free offensive item/upgrade
//   2 RiskCasePlusMoney     — vtable 0x004dee9c, +max(500, rand(money/20))
//   3 RiskCasePlusTime      — vtable 0x004deeac, +3000 (= +30 sec in 10ms units)
//   4 RiskCaseRavensScared  — vtable 0x004deebc, scared timer = max(cur, 12000)
//   5 RiskCaseStealChickens — vtable 0x004deecc, removes max(1, rand(eligible/10))
//   6 RiskCaseMinusMoney    — vtable 0x004deedc, -rand(money/20) (needs > 499)
//   7 RiskCaseChickFlu      — vtable 0x004deeec, sick = min(20, healthy*4/5)
//   8 RiskCaseRavensAttack  — vtable 0x004deefc, forces ravens to spawn now
//
// Roll algorithm: pick index 1..8 (Nothing excluded), call vtable[0] check; retry
// up to 1000 times if check fails. After 1000 fails → Nothing (FUN_0041ba27:33806-33824).
// Cooldown: 7500 ticks (rwg_functions.c:33641 0x1d4c).
// Click-to-roll prompt: title "SURPRISE!", body "Do you feel clucky?" (lines 33711-33714).

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

const COOLDOWN_TICKS = 7500;

export class RiskCase {
    constructor(type) {
        this.mType = type;
        this.mDescription = '';
    }
    // vtable[0] check — returns true if applicable in current game state.
    canApply(fc) { return true; }
    // vtable[1] apply — performs the effect.
    apply(fc) {}
}

export class RiskCaseNothing extends RiskCase {
    constructor() {
        super(RiskCaseType.NOTHING);
        this.mDescription = 'Nothing happens...'; // line 33457 (verified literal)
    }
    canApply() { return true; }
    apply() {}
}

export class RiskCaseOffensive extends RiskCase {
    constructor() {
        super(RiskCaseType.OFFENSIVE);
        this.mDescription = 'You found a free upgrade!'; // UNKNOWN — runtime-formatted
    }
    // FUN_0041aeaf line 32755 — picks random offensive item from list at +0x20
    canApply(fc) {
        // Original: there's an items list; if non-empty, can apply
        return true;
    }
    // FUN_0041afbd → FUN_0041ebd3 (line 38003) — gives item: id 3 → +0x10=1, id 7 → +0x11=1
    apply(fc) {
        // Translate to JS: random buff — seed count, gun power, gun area
        const r = Math.random();
        if (r < 0.34) fc.mSeedCount = Math.min(10, fc.mSeedCount + 1);
        else if (r < 0.67) fc.mGunPower = Math.min(5, (fc.mGunPower || 1) + 1);
        else fc.mGunArea = true;
    }
}

export class RiskCasePlusMoney extends RiskCase {
    constructor() {
        super(RiskCaseType.PLUS_MONEY);
        this.mAmount = 0;
    }
    // FUN_0041afd1 line 32853: amount = max(500, rand() % (money/20))
    canApply(fc) {
        const m = fc.mMoney || 0;
        const max = Math.floor(m / 20);
        this.mAmount = Math.max(500, max > 1 ? Math.floor(Math.random() * max) : 500);
        this.mDescription = `Lucky! You found $${this.mAmount}!`;
        return true;
    }
    // FUN_0041b05f → FUN_00424b5d (line 45030) — adds amount to money, capped at +8 max.
    apply(fc) {
        fc.addMoney ? fc.addMoney(this.mAmount) : (fc.mMoney += this.mAmount);
    }
}

export class RiskCasePlusTime extends RiskCase {
    constructor() {
        super(RiskCaseType.PLUS_TIME);
        // String confirmed at line 33499. Original raw amount = 3000 (10ms
        // ticks → 30s) per FUN_0041b0b3:32960; we apply +30000 ms directly
        // in apply() so the raw value isn't kept as a field.
        this.mDescription = 'Your watch was fast! You have 30 more seconds!';
    }
    // FUN_0041b08d line 32926: needs (+0x20 != 0) AND time-task target > 0
    canApply(fc) {
        return fc.mTimeLimit > 0;
    }
    // FUN_0041b0b3 line 32947: time field += 3000 (in 10ms units = 30s).
    apply(fc) {
        if (fc.mTimeLimit > 0) {
            // Our mTimeLimit is in ms; +30s = +30000 ms.
            fc.mTimeLimit += 30000;
        }
    }
}

export class RiskCaseRavensScared extends RiskCase {
    constructor() {
        super(RiskCaseType.RAVENS_SCARED);
        // String confirmed at line 33516-33517.
        this.mDescription = 'Your new scarecrow has frightened away all of the ravens for a few minutes.';
    }
    // FUN_0041b499 line 33271: needs raven max > 0 (i.e. ravens enabled)
    canApply(fc) {
        return fc.mLevelConfig && fc.mLevelConfig.hasRavens;
    }
    // FUN_0041b0dd line 32969: ravens-scared timer = max(current, 12000)
    apply(fc) {
        // Scare all current ravens
        for (const raven of fc.mField.mRavens) {
            raven.scare();
        }
        // Delay next spawn — original sets a timer at +0x30 to at least 12000.
        // Our equivalent: push the spawn timer back ~30s (12000 ticks at 100fps = 120s,
        // but the unit might be centiseconds → 120s. Use the larger of the two safer values.)
        fc.mRavenScaredTimer = Math.max(fc.mRavenScaredTimer || 0, 12000);
    }
}

export class RiskCaseStealChickens extends RiskCase {
    constructor() {
        super(RiskCaseType.STEAL_CHICKENS);
        this.mDescription = 'Oh no! Some of your chickens were stolen!';
        this.mNumStolen = 0;
    }
    // FUN_0041b0f3 line 32989 — only fires if chicken_count > 7 (line 33028).
    canApply(fc) {
        const eligible = fc.mField.mChickens.filter(c => c.mIsAlive).length;
        if (eligible <= 7) return false;
        // count_to_steal = max(1, rand() % (eligible/10))  (line 33066-33069)
        const max = Math.floor(eligible / 10);
        this.mNumStolen = Math.max(1, max > 1 ? Math.floor(Math.random() * max) : 1);
        this.mDescription = `Oh no! ${this.mNumStolen} chicken${this.mNumStolen > 1 ? 's' : ''} stolen!`;
        return true;
    }
    apply(fc) {
        const candidates = fc.mField.mChickens.filter(c => c.mIsAlive);
        for (let i = 0; i < this.mNumStolen && candidates.length > 0; i++) {
            const idx = Math.floor(Math.random() * candidates.length);
            candidates[idx].die();
            candidates.splice(idx, 1);
        }
    }
}

export class RiskCaseMinusMoney extends RiskCase {
    constructor() {
        super(RiskCaseType.MINUS_MONEY);
        this.mAmount = 0;
    }
    // FUN_0041b3ae line 33159: only when money > 499. amount = rand(money/20)
    canApply(fc) {
        if ((fc.mMoney || 0) <= 499) return false;
        const max = Math.floor(fc.mMoney / 20);
        this.mAmount = Math.max(1, max > 1 ? Math.floor(Math.random() * max) : 1);
        this.mDescription = `Bad luck! You lost $${this.mAmount}!`;
        return true;
    }
    // FUN_0041b436 → FUN_00403e23 line 4521 (subtract amount from player money)
    apply(fc) {
        fc.mMoney = Math.max(0, fc.mMoney - this.mAmount);
    }
}

export class RiskCaseChickFlu extends RiskCase {
    constructor() {
        super(RiskCaseType.CHICK_FLU);
        // String confirmed at line 33563.
        this.mDescription = 'An epidemic of the flu has begun!';
    }
    // FUN_0041b44b line 33226 → FUN_00404e20 line 5959 (count healthy chickens)
    // Filter excludes juveniles — mIsAdult required. Force-sickening a
    // juvenile traps them sick forever (their mAge is frozen at 3300-3696,
    // below the 4500/5000 recovery threshold). Matches the original's
    // vtable[5] NEWBORN exclusion (FUN_0040327c:3371).
    canApply(fc) {
        return fc.mField.mChickens.filter(
            c => c.mIsAlive && c.mIsAdult && !c.mIsSick
        ).length >= 8;
    }
    // FUN_0041b45b line 33242: sick = min(20, healthy * 4/5)
    apply(fc) {
        const healthy = fc.mField.mChickens.filter(
            c => c.mIsAlive && c.mIsAdult && !c.mIsSick
        );
        const num = Math.min(20, Math.floor((healthy.length << 2) / 5));
        for (let i = 0; i < num && healthy.length > 0; i++) {
            const idx = Math.floor(Math.random() * healthy.length);
            healthy[idx].mIsSick = true;
            healthy.splice(idx, 1);
        }
        if (SOUNDS.SOUND_SICK) SOUNDS.SOUND_SICK.play();
    }
}

export class RiskCaseRavensAttack extends RiskCase {
    constructor() {
        super(RiskCaseType.RAVENS_ATTACK);
        // String confirmed at line 33579.
        this.mDescription = 'Acht! They are back!';
    }
    canApply(fc) {
        return fc.mLevelConfig && fc.mLevelConfig.hasRavens;
    }
    // FUN_0041b4ac line 33289: scared timer = 0 → ravens spawn immediately.
    apply(fc) {
        fc.mRavenScaredTimer = 0;
        // Force a wave: spawn 2-3 immediately.
        for (let i = 0; i < 3; i++) fc.mField.spawnRaven();
    }
}

const ALL_CASES = [
    RiskCaseNothing,
    RiskCaseOffensive,
    RiskCasePlusMoney,
    RiskCasePlusTime,
    RiskCaseRavensScared,
    RiskCaseStealChickens,
    RiskCaseMinusMoney,
    RiskCaseChickFlu,
    RiskCaseRavensAttack,
];

export class RiskController {
    constructor() {
        this.mCooldownCounter = 0;       // +0x04 cooldown counter
        this.mRunning = true;            // +0x08
        this.mReady = false;             // +0x09
        this.mPending = false;           // +0x0a
        this.mLastResult = null;
    }

    // Per-tick. Increments cooldown until threshold.
    update() {
        if (this.mRunning && !this.mReady) {
            this.mCooldownCounter++;
            if (this.mCooldownCounter >= COOLDOWN_TICKS) {
                this.mReady = true;
            }
        }
    }

    isReady() { return this.mReady; }

    // FUN_0041b94a (line 33654): user clicked '?' icon. Sets pending; reroll happens next tick.
    requestRoll() {
        if (!this.mReady) return false;
        this.mPending = true;
        this.mReady = false;
        this.mCooldownCounter = 0;
        return true;
    }

    // FUN_0041ba27 (line 33771): pick random non-Nothing case, retry on canApply fail.
    // Returns the picked case (or RiskCaseNothing as fallback).
    rollRisk(fc) {
        // Consume the ready state — rollRisk being called directly means
        // the click handler already verified mReady. Without this, the
        // handler could re-roll on every subsequent click since mReady
        // stayed true after rollRisk returned.
        this.mReady = false;
        this.mPending = false;
        this.mCooldownCounter = 0;
        for (let i = 0; i < 1000; i++) {
            const idx = 1 + Math.floor(Math.random() * 8); // 1..8 (exclude Nothing)
            const Klass = ALL_CASES[idx];
            const c = new Klass();
            if (c.canApply(fc)) {
                this.mLastResult = c;
                return c;
            }
        }
        // After 1000 failures: Nothing.
        const fallback = new RiskCaseNothing();
        this.mLastResult = fallback;
        return fallback;
    }
}
