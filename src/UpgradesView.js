// Port of Sexy::UpgradesView (vftable 0x4e1814, rwg_vtables.txt:6265).
// Shown by GameApp FUN_00408c24 (rwg:11047) from the LevelCompleted dialog
// CONTINUE (FUN_0040dd6a rwg:17101-17108, disassembly @0x40ddca: argument =
// completed level + 1) when the dialog's "upgrade" flag (+0x15c) is set.
//
// Method map:
//   ctor              FUN_0042474a rwg:44684  → constructor
//   dtor              FUN_004247d7 rwg:44737
//   AddedToManager    FUN_004249b4 rwg:44877  → constructor (button layout)
//   RemovedFromMgr    FUN_004249f5 rwg:44894
//   Update            FUN_00424838 rwg:44768  → update()
//   Draw              FUN_0042486f rwg:44793  → draw()
//   ButtonDepress     FUN_00424a1c rwg:44910  → buttonDepress()
//   setup             FUN_00424a7f rwg:44956  → setup()   (args from @0x424a7f)
//   show result       FUN_00424a32 rwg:44930  → _showResult() (args @0x424a32)
//   UpgradeSelectDialog ButtonDepress FUN_004244a0 rwg:44370 → _onDialogSelect()
//
// Fields: +0x88 CONTINUE button, +0x8c next level, +0x90 decoration list,
// +0x9c new upgrade id (-1 none), +0xa0 tick counter, +0xa4 blink flag.

import { Widget } from './SexyApp.js';
import { SOUNDS } from './Res.js';
import { HtmlDialogs } from './HtmlDialogs.js';
import { openUpgradeChoices, upgradeOptions } from './UpgradeSelectDialog.js';
import { drawFieldBackground, DialogButton } from './CreditsView.js';

// DAT_004de0f0 (int[51], .data of original-app/chicken_chase.RWG), indexed by level.
// Non-zero → completing that level for the first time offers an upgrade
// (FUN_00421948 rwg:41359-41366, disassembly @0x421992-0x4219b2).
export const UPGRADE_LEVEL_TABLE = (() => {
    const t = new Array(51).fill(0);
    for (const l of [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 34, 37, 40, 43, 46, 49, 50]) t[l] = 1;
    return t;
})();

// LevelCompletedDialog flag +0x15c (read by CONTINUE as listener+0xd8),
// computed by FUN_00421948 (@0x421987-0x4219b4) BEFORE the level time is
// recorded (FUN_0041111b @0x4219d6):
//   flag = player exists && level <= 50 && DAT_004de0f0[level] != 0
//          && FUN_0041614b() (maxUnlocked = min(50, completed+1)) <= level
// `maxUnlockedBefore` must be sampled before the completion is recorded.
export function levelOffersUpgrade(level, maxUnlockedBefore, hasPlayer = true) {
    if (!hasPlayer) return false;
    if (level > 0x32) return false;
    if (!UPGRADE_LEVEL_TABLE[level]) return false;
    return maxUnlockedBefore <= level;
}

const BLINK_PERIOD = 0x28;   // FUN_00424838 rwg:44786 (counter / 0x28) & 1
const BLINK_TICKS = 0x168;   // FUN_00424838 rwg:44782 (counter > 0x168 → steady)

export class UpgradesView extends Widget {
    // FUN_0042474a (rwg:44684-44727)
    constructor(gameApp) {
        super();
        this.mGameApp = gameApp;
        // FUN_00408c24 rwg:11089-11090 (@0x408d01-0x408d19): Resize(0, 0, app.w, app.h)
        this.resize(0, 0, 800, 600);
        this.mNextLevel = 0;          // +0x8c (ctor: +0x8c = 0, rwg:44711)
        this.mDecorations = [];       // +0x90 (empty list, rwg:44714-44715)
        this.mNewUpgrade = -1;        // +0x9c = 0xffffffff  rwg:44717
        this.mCounter = 0;            // +0xa0 = 0          rwg:44719
        this.mBlinkOn = false;        // +0xa4 = 0          rwg:44720
        // CONTINUE DialogButton (FUN_0042149b, rwg:44721-44723), +0x88.
        this.mContinueButton = new DialogButton(0, this, 'CONTINUE');
        // AddedToManager FUN_004249b4 rwg:44886: Resize(600, 0x208, 0x96, 0x28)
        this.mContinueButton.resize(600, 0x208, 0x96, 0x28);
        this.addWidget(this.mContinueButton);
    }

    // FUN_00424a7f(view, nextLevel, decorations, available) — @0x424a7f-0x424b5a.
    setup(nextLevel, decorations, available) {
        const core = this.mGameApp && this.mGameApp.mCore;
        // CONTINUE hidden (SetVisible(0)) @0x424a96
        this.mContinueButton.mVisible = false;
        if (available.length === 0) {
            // @0x424aa2: FUN_00424a32(nextLevel, -1)
            this._showResult(nextLevel, decorations, -1);
        } else if (available.length === 1) {
            // @0x424aab-0x424aed: give the only option (FUN_00423f5c adds it
            // to the player and saves), then FUN_00424a32(nextLevel, id) with
            // the decoration list copied BEFORE the add → new item blinks.
            const id = available[0];
            if (core) core.addUpgrade(id);
            this._showResult(nextLevel, decorations, id);
        } else {
            // @0x424af4-0x424b4f: +0x8c = nextLevel, +0x90 = list, +0x9c = -1,
            // +0xa0 = 0, then AddDialog(0, new UpgradeSelectDialog(view,
            // nextLevel, available)) (FUN_00423f8a). The dialog is HTML.
            this.mNextLevel = nextLevel;
            this.mDecorations = decorations.slice();
            this.mNewUpgrade = -1;
            this.mCounter = 0;
            this._openDialog(available);
        }
    }

    // UpgradeSelectDialog (FUN_00423f8a rwg:44058): the ctor keeps up to 3
    // random ids of the available list (FUN_004245c2, see
    // UpgradeSelectDialog.pickUpgradeChoices) and makes one button per kept
    // id, icon DAT_00500614[id] = IMAGE_UPGRADE_PREVIEW<id> (rwg:44128-44131;
    // names from the loader rwg:31686-31700 + binary string
    // "IMAGE_UPGRADE_PREVIEW%i"). Button id = upgrade id + 1 (@0x4240b9;
    // FUN_004244a0 matches it against the kept list).
    _openDialog(available) {
        const options = upgradeOptions(available);
        openUpgradeChoices(options, opt => this._onDialogSelect(opt.key));
    }

    // FUN_004244a0 (rwg:44375-44420): SOUND_CLICK (DAT_004fed84), remove the
    // dialog, copy the player's decorations (FUN_00408234, before the add),
    // FUN_00424a32(nextLevel (+0xe4 = dialog+0x168), id), then FUN_00423f5c
    // (add id to the player + save).
    _onDialogSelect(id) {
        if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
        HtmlDialogs.close('upgrade');
        const core = this.mGameApp && this.mGameApp.mCore;
        const decorations = core ? core.getUpgradeIds() : [];
        this._showResult(this.mNextLevel, decorations, id);
        if (core) core.addUpgrade(id);
    }

    // FUN_00424a32 (@0x424a32-0x424a7c): CONTINUE visible, +0x8c = nextLevel,
    // +0x90 = decorations, +0xa0 = 0, +0x9c = newId,
    // PlaySample(DAT_004fed8c = SOUND_FIELD_UPGRADE, loader rwg:31820-31821).
    _showResult(nextLevel, decorations, newId) {
        this.mContinueButton.mVisible = true;
        this.mNextLevel = nextLevel;
        this.mDecorations = decorations.slice();
        this.mCounter = 0;
        this.mNewUpgrade = newId;
        if (SOUNDS.SOUND_FIELD_UPGRADE) SOUNDS.SOUND_FIELD_UPGRADE.play();
    }

    // FUN_00424838 (rwg:44773-44788): base Update, MarkDirty, ++counter;
    // counter > 0x168 → flag = 1, else flag = (counter / 0x28) & 1.
    update() {
        super.update();
        this.mCounter++;
        if (this.mCounter > BLINK_TICKS) {
            this.mBlinkOn = true;
            return;
        }
        this.mBlinkOn = ((Math.trunc(this.mCounter / BLINK_PERIOD)) & 1) === 1;
    }

    // FUN_0042486f (rwg:44798-44812): FUN_004248b4(list +0x90,
    // extra = +0xa4 ? +0x9c : -1); then SetFont(FONT_16) / SetColor(white)
    // with nothing drawn after. Children (CONTINUE) on top.
    draw(g) {
        drawFieldBackground(g, this.mDecorations, this.mBlinkOn ? this.mNewUpgrade : -1);
        super.draw(g);
    }

    // FUN_00424a1c (rwg:44915-44925): FUN_004088d0(+0x8c, app) — show
    // SelectLevelView for the next level. No sound here.
    buttonDepress(id) {
        if (this.mGameApp && this.mGameApp.showSelectLevel) {
            this.mGameApp.showSelectLevel(this.mNextLevel);
        }
    }

    // UpgradesView overrides no key handler (vftable 0x4e1814).
    keyDown(key) {
        return false;
    }
}
