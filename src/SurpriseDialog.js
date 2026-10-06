// Risk "SURPRISE!" flow — HTML port of the RiskController dialog handling.
//
// Original (rwg_functions.c):
//   FUN_00409c38 (12514) risk-icon click -> FUN_0041b94a
//   FUN_0041b94a (33659) open:
//     risk+4 = 0, risk+10 = 1, risk+9 = 0           (33688-33690)
//     game state +4 = 1 (paused), +0xd = 0           (33692-33695)
//     FUN_004090b9 -> FUN_0040cc01(hand, 0)            (33697; asm 0x4090c4
//        xor eax,eax -> mode 0 = seeds cursor)
//     if player+0x1d ("show SURPRISE! prompt"):       (33702)
//        FUN_0040279c("SURPRISE!", "Do you feel clucky?")  (33711-33716)
//        = the same YES/NO StdDialog builder as "QUIT?" (rwg:19564-19569)
//     else: listener vtable[0] (= FUN_0041b9cf) called directly (33704)
//   Button dispatch FUN_004211e9 (40808): id 72000 -> listener vtable[0]
//     (FUN_0041b9cf), id 73000 -> listener vtable[1] (FUN_0040d4bb).
//   FUN_0040d4bb (16402) NO: game state +4 = 0, +0xd = 0 (unpause only).
//   FUN_0041b9cf (33734) YES / OK:
//     risk+10 != 0: risk+10 = 0; if player+0x1d { +0x1d = 0;
//        FUN_00410f28 (save player) }; FUN_0041ba27     (33753-33763)
//     risk+10 == 0: cases[risk+0xc]->vtable[1] (apply);
//        game state +4 = 0, +0xd = 0                     (33746-33751)
//   FUN_0041ba27 (33776) roll 1..N-1 with canApply, 1000 tries, then
//     FUN_0040f491("SURPRISE!", case description) — OK-only StdDialog
//     (FUN_0040f491 rwg:19014 "OK" footer).              (33817-33826)

import { HtmlDialogs } from './HtmlDialogs.js';
import { HandMode } from './Hand.js';

// Open the "SURPRISE!" result box showing riskCase's text. The verbatim
// strings are the [data-risk-case] templates in index.html (RiskCase+4 in the
// original); only the one matching riskCase.mKey is shown and its
// [data-value] gets riskCase.mValue (the %i / appended item name).
export function openSurpriseResult(riskCase, onOk) {
    const node = HtmlDialogs.open('surprise-result', {
        actions: { ok: onOk },
    });
    if (!node) return null;
    const key = riskCase ? riskCase.mKey : null;
    node.querySelectorAll('[data-risk-case]').forEach(p => {
        const active = p.getAttribute('data-risk-case') === key;
        p.hidden = !active;
        const v = p.querySelector('[data-value]');
        if (v) v.textContent = active && riskCase.mValue != null ? String(riskCase.mValue) : '';
    });
    return node;
}

export class SurpriseDialog {
    // riskController: RiskController; fc: FieldController; core: player Core
    // (mShowSurprise = player+0x1d, save() = FUN_00410f28);
    // setPaused(bool): game state +4 (and +0xd = 0); hand: Hand (Core+0x20).
    constructor({ riskController, fc, core, setPaused, hand }) {
        this.mRisk = riskController;
        this.mFC = fc;
        this.mCore = core;
        this.mSetPaused = setPaused;
        this.mHand = hand || null;
    }

    // FUN_0041b94a (rwg:33659, asm 0x41b94a-0x41b9ce)
    open() {
        // risk+9 == 0 -> return (asm 0x41b958); else risk+4 = 0, +0xa = 1,
        // +9 = 0 (rwg:33688-33690)
        if (!this.mRisk.requestRoll()) return false;
        // state +4 = 1, +0xd = 0 (rwg:33692-33695)
        this.mSetPaused(true);
        // FUN_004090b9 (asm 0x4090b9-0x4090cc): FUN_0040cc01(Core+0x20, 0)
        if (this.mHand) this.mHand.setMode(HandMode.SEEDS);
        if (this.mCore && this.mCore.mShowSurprise) {
            // rwg:33711-33716 FUN_0040279c(header "SURPRISE!" 0x4dee48,
            // lines "Do you feel clucky?" 0x4dee54)
            HtmlDialogs.open('surprise-ask', {
                actions: {
                    // 72000 -> vtable[0] FUN_0041b9cf (rwg:40808-40818)
                    yes: () => { HtmlDialogs.close('surprise-ask'); this._onListener(); },
                    // 73000 -> vtable[1] FUN_0040d4bb (rwg:40820-40830, 16402-16411):
                    // only +4 = 0, +0xd = 0 (risk+0xa stays set).
                    no: () => { HtmlDialogs.close('surprise-ask'); this.mSetPaused(false); },
                },
            });
        } else {
            // rwg:33704 (**(code **)*this)() -> FUN_0041b9cf
            this._onListener();
        }
        return true;
    }

    // FUN_0041b9cf (rwg:33734, asm 0x41b9cf-0x41ba26) — listener vtable[0].
    _onListener() {
        if (this.mRisk.mPending) {
            // risk+0xa != 0 branch (rwg:33753-33763): +0xa = 0
            this.mRisk.mPending = false;
            if (this.mCore && this.mCore.mShowSurprise) {
                this.mCore.mShowSurprise = false;        // rwg:33759
                if (this.mCore.save) this.mCore.save();  // FUN_00410f28 rwg:33760
            }
            this._roll();
        } else {
            // risk+0xa == 0 branch (rwg:33746-33751): cases[+0xc] apply, unpause.
            this.mRisk.applyResult(this.mFC);
            this.mSetPaused(false);
        }
    }

    // FUN_0041ba27 (rwg:33776)
    _roll() {
        // rwg:33799-33815 roll
        const riskCase = this.mRisk.rollRisk(this.mFC);
        // rwg:33817-33826 FUN_0040f491(header "SURPRISE!", lines = case+4 string)
        // OK = 72000 -> vtable[0] FUN_0041b9cf (rwg:40808-40818)
        openSurpriseResult(riskCase,
            () => { HtmlDialogs.close('surprise-result'); this._onListener(); });
    }
}
