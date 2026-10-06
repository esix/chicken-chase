// Port of Sexy::GameView — vtables at 004dce2c (Widget) / 004dcf0c (ButtonListener)
//
// Original functions (rwg_functions.c):
//   FUN_004091f9 (11682) GameView::GameView         — ctor: MENU/SELL/BUY buttons, +0xc0 = -1
//   FUN_004092e2 (11747) / FUN_00409306 (11766)      — scalar-deleting dtor / dtor
//   FUN_0040bbea (14001) GameView::AddedToManager    — Resize MENU/SELL/BUY, SELL+BUY SetVisible(0)
//   FUN_0040bc85 (14024) GameView::RemovedFromManager
//   FUN_00409372 (11804) GameView::Update            — controller Update, FUN_004093d9, FUN_004091b8
//   FUN_004093b4 (11827) GameView::UpdateF           — forwards to controller vtable[1]
//   FUN_004093d9 (11849) GameView input poll         — left-click edge -> HUD handlers, ESC, Q/W/E/R/T, A/Z
//   FUN_00409ba0 (12469) shop-slot click; FUN_00409c92 (12552) egg-row click; FUN_00409c38 (12514) risk click
//   FUN_00409ab2 (12381) egg-row slot rect; FUN_00409af0 (12412) risk-icon rect
//   FUN_004091b8 (11653) dog idle-animation tick (state at +0x88..+0x94)
//   FUN_0040a3d6 (13092) GameView::Draw              — field, dog, HUD, hint tip, GAME PAUSED
//   FUN_0040bd72 (14135) / FUN_0040bdb2 (14156)      — MouseDown / MouseUp -> button flags DAT_004fff00/01
//   FUN_0040bcc4 (14042) ButtonListener::ButtonDepress — SOUND_CLICK, +0xc0 = id
//   FUN_0040bce7 (14062) deferred button action      — 1 MENU (Options), 2 SELL (ShopDialog), 3 BUY (SpecialShopDialog)
//   FUN_0040bdf2 (14177) MouseMove (stores mouse pos), FUN_0040d554 (16482) empty, FUN_0040f0fd (18673) returns 1
//   Space pause toggle is FUN_0040907e (11479), polled from the game update (rwg:7466/7482).
//   Right-hold seed repeat / auto cursor is the Hand controller FUN_0040cc71 (15848),
//   ticked from the unpaused game update (rwg:7476); its hover + repeat parts
//   are run from GameView.update() here (_handTick).

import { Widget } from './SexyApp.js';
import { FieldController } from './FieldController.js';
import { EGG_TO_CHICK } from './Chick.js';
import { Hand, HandMode } from './Hand.js';
import { RiskController } from './RiskController.js';
import { HintController, LevelTutorial } from './HintController.js';
import { IMAGES, SOUNDS } from './Res.js';
import { ShopDialog, SpecialShopDialog } from './ShopDialogs.js';
import { HtmlDialogs } from './HtmlDialogs.js';
import { SurpriseDialog } from './SurpriseDialog.js';
import { FONT_CSS, drawOutlinedText } from './CreditsView.js';

// FONT_20 (DAT_004fff18 = ArialBlack20, resources.xml:57). Canvas size
// calibrated like FONT_CSS: the bitmap WidthList of ArialBlack20.txt gives
// "press space to continue" = 357 px; canvas Arial Black measures 13.18 px
// per px of font size for that string -> 27 px.
const FONT_20_CSS = '27px "Arial Black", Arial, sans-serif';

// Button ids handled by FUN_0040bce7 (rwg:14062-14124): case 1 opens the
// OptionsDialog (MENU), case 2 FUN_0041e97b -> ShopDialog FUN_0041f031 (SELL),
// case 3 FUN_0041e9f1 -> SpecialShopDialog FUN_00420232 (BUY).
const BTN_MENU = 1;
const BTN_SELL = 2;
const BTN_BUY = 3;

// Button rects — FUN_0040bbea rwg:14005/14007/14010 Resize(x, y, w, h).
const MENU_RECT = { x: 0x193, y: 0x27, w: 0x65, h: 0x26 }; // (403, 39, 101, 38)
const SELL_RECT = { x: 0x1fa, y: 0x27, w: 0x55, h: 0x26 }; // (506, 39, 85, 38)
const BUY_RECT  = { x: 0x1fa, y: 0x01, w: 0x55, h: 0x26 }; // (506, 1, 85, 38)

// FUN_00407ad4 (rwg:9520): x in [rx, rx+w), y in [ry, ry+h) — right/bottom exclusive.
function rectContains(r, x, y) {
    return !(x < r.x || r.x + r.w <= x || y < r.y || r.y + r.h <= y);
}

// Key name used as the mKeyDown index: letters case-folded (the original
// indexes by virtual-key code, which has no case), 'Spacebar' -> ' '.
function normKey(key) {
    if (key === 'Spacebar') return ' ';
    return (typeof key === 'string' && key.length === 1) ? key.toLowerCase() : key;
}

export class GameView extends Widget {
    // FUN_004091f9 (rwg_functions.c:11682) GameView::GameView
    constructor(gameApp) {
        super();
        this.mGameApp = gameApp;
        this.mFieldController = new FieldController(gameApp);
        // Level update FUN_00421b21 runs last in the tick (rwg:7479) — after
        // the hand tick — and MENU/SELL/BUY are child widgets drawn after
        // GameView::Draw, i.e. over the hint bar and GAME PAUSED.
        this.mFieldController.mDeferTaskCheck = true;
        this.mFieldController.mDeferHudButtons = true;
        this.mHand = new Hand();
        this.mRiskController = new RiskController();
        this.mHintController = new HintController(gameApp && gameApp.mCore);
        this.resize(0, 0, 800, 600);

        // +0xc0 pending button id, -1 = none (rwg:11718). Set by ButtonDepress
        // (FUN_0040bcc4 rwg:14050: listener+0x3c == GameView+0xc0), consumed on
        // the next Update by FUN_004093d9 (rwg:11947-11950).
        this.mPendingButton = -1;
        // Mirror of game-state +0xd: "GAME PAUSED" text is drawn only when the
        // pause came from the space toggle (FUN_0040907e rwg:11488-11496 sets it
        // to 1); the dialog openers (FUN_0040bce7 rwg:14104, FUN_0041e97b,
        // FUN_0041e9f1, FUN_0041b94a) pause with +0xd = 0.
        this.mPauseTextShown = false;
        // Game state +0xc: previous space key state, edge-detected by
        // FUN_0040907e (rwg:11487-11497); zeroed by Core::StartLevel
        // FUN_00406069 (rwg:7524).
        this.mSpacePrev = false;
        // WidgetManager::mKeyDown[] (base +0xd0): FUN_00438a14 (rwg:68182-
        // 68190) sets the entry on every key down, before (and regardless
        // of) dispatching to the focus widget — so keys are recorded while a
        // dialog has the focus, too; FUN_00438a45 (rwg:68205-68215) clears it
        // on key up. The game polls it (FUN_0040907e, FUN_004093d9).
        // Entries are the normalised DOM key names ('a', ' ', 'Escape',
        // 'Shift'); mKeyDown[VK] <-> key name, see _inputPoll.
        this.mKeyDown = new Set();
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('keydown', (e) => this.mKeyDown.add(normKey(e.key)));
            window.addEventListener('keyup', (e) => this.mKeyDown.delete(normKey(e.key)));
            // FUN_00445818 (rwg:81203) -> FUN_00446cef (rwg:82160-82168):
            // every mKeyDown entry cleared when the app loses focus.
            window.addEventListener('blur', () => this.mKeyDown.clear());
        }
        // Last seen "a modal dialog is open" state — see _syncModalPause.
        this._modalWasShown = false;

        // MENU/SELL/BUY are ButtonWidgets: ButtonDepress fires on MouseUp
        // (ButtonWidget::MouseUp FUN_0043dbb3 rwg:73862: if mIsOver (+0x55)
        // -> listener vtable[2] = FUN_0040bcc4). Button id pressed, or -1.
        this._pressedButton = -1;

        // Left-button flag DAT_004fff00 (FUN_0040bd72 rwg:14140-14142,
        // FUN_0040be11) and right-button flag DAT_004fff01 (rwg:14144-14146,
        // FUN_0040be50). Both are polled: the left edge by FUN_004093d9 with
        // the latch GameView+0xbc (rwg:11869-11883) and by the hand tick
        // FUN_0040cc71 with the latch Hand+8 (rwg:15893-15902).
        this.mMouseLeftDown = false;
        this.mMouseRightDown = false;
        this.mPollLeftLatch = false;   // GameView +0xbc
        this.mHandLeftLatch = false;   // Hand +0x08
        // MouseUp reaches the widget that got the MouseDown (GameView) even
        // when the button is released elsewhere; the canvas only sees ups
        // over itself, so clear the flags from a window listener too.
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('mouseup', (e) => {
                if (e.button === 0) this.mMouseLeftDown = false;
                if (e.button === 1 || e.button === 2) this.mMouseRightDown = false;
            });
        }
        // Hand controller tick (+0xc) and last-action tick (+0x10) used by the
        // right-hold repeat in FUN_0040cc71 (rwg:15890, 15900-15917).
        this.mHandTick = 0;
        this.mHandLastActionTick = 0;
    }

    // Level start. The original has no GameView::StartLevel; the level is set
    // up by the app (FUN_00408dae / SelectLevelView) before FUN_00408a1b shows
    // the GameView. Kept as the JS entry point used by GameApp.startGame.
    startLevel(level) {
        this.mFieldController.startLevel(level);
        // FUN_00406069 rwg:7661-7664 builds a NEW RiskController (Core+0x48)
        // per level start; FUN_00422d10 writes +0x08 = 0 for levels 1-6
        // (asm 0x422dad/0x422df3/0x422e53/0x422e8b/0x422f00) -> riskEnabled.
        const lc = this.mFieldController.mLevelConfig;
        this.mRiskController = new RiskController(lc ? lc.riskEnabled : true);
        // Field decorations = player's upgrade ids (FUN_004248b4 called with
        // FUN_00408234 at rwg:13310-13321). Drawn by Field.draw — see report.
        const core = this.mGameApp && this.mGameApp.mCore;
        this.mFieldController.mField.mDecorations =
            (core && core.getUpgradeIds) ? core.getUpgradeIds() : [];
        this.mPendingButton = -1;
        this._pressedButton = -1;
        // FUN_00406069 rwg:7521-7525: new game state, +4 (paused) = 0,
        // +0xc (space prev) = 0, +0xd = 0. (FieldController.startLevel
        // clears mIsPaused.)
        this.mPauseTextShown = false;
        this.mSpacePrev = false;
        // New Hand object (rwg:7582-7596): FUN_0040cc01 with mode 0 (asm
        // 0x40617d `xorl %eax,%eax`), +8 / +0xc / +0x10 = 0 (below).
        this.mHand.setMode(HandMode.SEEDS);
        this.mMouseLeftDown = false;
        this.mMouseRightDown = false;
        this.mPollLeftLatch = false;
        this.mHandLeftLatch = false;
        this.mHandTick = 0;
        this.mHandLastActionTick = 0;
        this._endShown = false;
        this._offersUpgrade = false;

        // Core::StartLevel FUN_00406069 allocates a fresh HintController
        // (game+0x2c, rwg_functions.c:7621-7635: empty text, no pointer) and
        // a fresh level object whose tutorial fields are zeroed by
        // FUN_0042166f (rwg_functions.c:41196-41221).
        if (this.mHintController && this.mHintController.isShown()) {
            this.mHintController.dismiss();
        }
        this.mHintController = new HintController(core);
        this.mLevelTutorial = new LevelTutorial(level);
        // The IntroductionDialog is opened by SelectLevelView::AddedToManager
        // FUN_0041d22e (rwg:35567-35569) before the level starts (GameApp).
        // No hint is opened here: all level hints come from the tutorial
        // dispatcher ticked in update() (FUN_00421b21 -> FUN_00422036).

        // A dialog still open now does not pause the new state (+4 = 0):
        // take its open state as already seen (see _syncModalPause).
        this._modalWasShown = this._isModalShown();
    }

    // FUN_0040a3d6 (rwg_functions.c:13092) GameView::Draw
    // Order in the original: SELL/BUY visibility (13293-13299), field render
    // FUN_004248b4 (13321), dog (13330), entities, HUD, hint tip (13930-13962),
    // GAME PAUSED (13966-13982). Field + HUD are drawn by Field.draw /
    // FieldController.drawHUD in this port.
    draw(g) {
        // Field (FUN_004248b4 rwg:13321 + entity loops). Field.draw also
        // draws the dog (rwg:13318-13330) and the depth-sorted chicks; the dog
        // tick FUN_004091b8 runs inside Field.update.
        // (The former JS screen-shake translate, click ripples and particle
        // bursts were removed: FieldController marks them "JS-only VFX — no
        // original counterpart" and FUN_0040a3d6 has nothing like them.)
        this.mFieldController.mField.draw(g);

        // HUD (drawn procedurally inside FUN_0040a3d6 in the original).
        this.mFieldController.drawHUD(g);

        // Child widgets (MENU/SELL/BUY are drawn by drawHUD in this port).
        super.draw(g);

        // Hint text bar + pointer (rwg:13934-13965, asm 0x40b973-0x40ba8f):
        // after the HUD, before GAME PAUSED. No background is drawn there.
        this.mHintController.draw(g);

        const anyModal = this._isModalShown();

        // GAME PAUSED — rwg:13966-13982, asm 0x40baad-0x40bb90. Condition:
        // state+4 (paused) && state+0xd (space pause) only — also with a
        // dialog open (space toggles under dialogs, see update()); dialogs
        // are drawn over the GameView. Colour DAT_005012a0 (white). No
        // FillRect/dim precedes the text.
        //   "GAME PAUSED" (0x4dcde0), FONT_24 (DAT_004fff1c):
        //       x = (width(+0x38) - StringWidth)/2, y = height(+0x3c)/2 = 300
        //   "press space to continue" (0x4dcdec), FONT_20 (DAT_004fff18):
        //       x = (width - StringWidth)/2, y = height/2 + 0x64 = 400
        // (asm 0x40bb0b-0x40bb29 / 0x40bb5f-0x40bb80; Sexy DrawString y = baseline.)
        if (this.mFieldController.mIsPaused && this.mPauseTextShown) {
            const ctx = g.ctx;
            ctx.save();
            ctx.font = FONT_CSS.FONT_24;
            let w = ctx.measureText('GAME PAUSED').width;
            drawOutlinedText(ctx, 'GAME PAUSED', Math.trunc((800 - w) / 2), 300, '#fff');
            ctx.font = FONT_20_CSS;
            w = ctx.measureText('press space to continue').width;
            drawOutlinedText(ctx, 'press space to continue', Math.trunc((800 - w) / 2), 300 + 0x64, '#fff');
            ctx.restore();
        }

        // MENU/SELL/BUY child widgets: drawn after GameView::Draw (Widget
        // children paint after their parent), over the hint bar and GAME PAUSED.
        this.mFieldController.drawHudButtons(g);

        // Cursor. The hand image is the app's CURSOR_POINTER image
        // (FUN_0040cc01 -> FUN_004422b3: app[0xde] = app+0x378 = slot 0 of
        // the cursor-image table read by EnforceCursor FUN_00448cbe), drawn by
        // the software cursor wherever the pointer cursor is active — over the
        // whole GameView, HUD included. Over the MENU/SELL/BUY DialogButtons
        // (mDoFinger, FUN_0043e9f1 writes +0x78 = 1) the cursor is CURSOR_HAND,
        // whose image slot is empty -> system finger cursor. HTML dialogs own
        // their cursor.
        const modalShown = anyModal
            || this.mFieldController.mIsLevelComplete
            || this.mFieldController.mIsLevelFailed;
        const overButton = this._buttonAt(this.mHand.mX, this.mHand.mY) !== -1;
        if (!modalShown && !overButton) {
            this.mHand.draw(g);
        }
        if (this.mGameApp && this.mGameApp.mCanvas) {
            this.mGameApp.mCanvas.style.cursor = modalShown ? 'default'
                : overButton ? 'pointer' : 'none';
        }
    }

    // FUN_00409372 (rwg_functions.c:11804, asm 0x409372-0x4093b3)
    // GameView::Update: Widget::Update (thunk_FUN_0043f784), MarkDirty,
    // controller vtable[0] = FUN_00408e06 -> game tick FUN_00405fcf, input
    // poll FUN_004093d9, then the dog tick FUN_004091b8 (asm 0x4093ac) —
    // every Update, paused or not.
    update() {
        super.update();
        const fc = this.mFieldController;
        // Dialogs closed between frames unpause (their close handlers).
        this._syncModalPause();

        // ---- game tick FUN_00405fcf (rwg:7464-7480) ----
        // state+4 == 0: +8 tick++, FUN_0040907e, ravens .. pets, hint
        // FUN_0040d281 (7472), risk FUN_0041b901 (7477), hand FUN_0040cc71
        // (7478), level FUN_00421b21 (7479). state+4 != 0: FUN_0040907e only.
        const wasPaused = fc.mIsPaused;
        const spaceEdge = this._pollSpace();
        let level = 0, maxUnlockedBefore = 1;
        if (wasPaused) {
            if (spaceEdge) this._togglePause(true);
        } else {
            // FUN_00421948 computes the LevelCompleted "upgrade" flag BEFORE
            // the time is recorded (FUN_0041111b @0x4219d6), which the level
            // update below does: sample maxUnlocked first.
            maxUnlockedBefore = (this.mGameApp && this.mGameApp.getMaxUnlocked)
                ? this.mGameApp.getMaxUnlocked() : 1;
            level = fc.mCurrentLevel;
            // The port freezes a finished level (FieldController skips its
            // tick once mIsLevelComplete / mIsLevelFailed is set).
            const running = !fc.mIsLevelComplete && !fc.mIsLevelFailed;
            // +8 tick, ravens, world, seeds, eggs, gems, store, money
            // effects, pets.
            fc.update();
            if (running) {
                // FUN_0040d281 hint bar tick (rwg:7472).
                this.mHintController.update();
                // Risk cooldown tick — RiskController FUN_0041b901 (rwg:7477).
                this.mRiskController.update();
                // Hand controller FUN_0040cc71 (rwg:7478): hover + click dispatch.
                this._handTick();
                // FUN_00421b21 task progress + level end (rwg:7479), last.
                fc.runLevelUpdate();
                // FUN_00421b21 rwg:41522-41530: while a task is open and the
                // level is not lost it runs the L1 slot unlock and the
                // tutorial dispatcher FUN_00422036 (= the complete/failed
                // branches did not trip).
                if (!fc.mIsLevelComplete && !fc.mIsLevelFailed && this.mLevelTutorial) {
                    this.mLevelTutorial.tick({
                        fc,
                        hint: this.mHintController,
                        core: this.mGameApp && this.mGameApp.mCore,
                        riskReady: this.mRiskController.isReady(),
                        // FUN_0041eae5(0): list of special-shop items not empty.
                        specialShopAvailable: () => (typeof fc.getSpecialShopItems === 'function')
                            && fc.getSpecialShopItems().length > 0,
                    });
                }
            }
            // FUN_0040907e runs FIRST in the original tick, but no call of
            // the tick body reads state+4 while the port's FieldController
            // returns early when mIsPaused is set — so the toggle's write is
            // applied after the body. Its FUN_004090b9 hand reset is skipped
            // when the hand tick ran (it re-picks the mode at asm 0x40cd04).
            if (spaceEdge) this._togglePause(!running);
        }

        // Level end: FUN_00421948 / FUN_00421a66 open the dialog (and pause,
        // see _syncModalPause) inside the level update.
        if (fc.mIsLevelComplete) {
            if (!this._endShown) {
                this._endShown = true;
                this._offersUpgrade = !!(this.mGameApp && this.mGameApp.levelOffersUpgrade
                    && this.mGameApp.levelOffersUpgrade(level, maxUnlockedBefore));
                this._openCompleteHtml();
            }
        } else if (fc.mIsLevelFailed) {
            if (!this._endShown) { this._endShown = true; this._openFailedHtml(); }
        } else {
            this._endShown = false;
        }
        // Dialogs opened by the tick paused at once in the original.
        this._syncModalPause();

        // Mirror the ready flag onto FieldController for HUD draw
        // (risk icon shown when risk+9 != 0, rwg:13899).
        fc.mRiskReady = this.mRiskController.isReady();
        fc.mRiskController = this.mRiskController; // icon cel phase (+0x10)

        // ---- input poll FUN_004093d9 (rwg:11869-11950), paused or not ----
        this._inputPoll();
        this._syncModalPause();

        // Dog tick FUN_004091b8 (asm 0x4093ac), every GameView Update.
        const dog = fc.mField && fc.mField.mDog;
        if (dog) dog.update();
    }

    // Any modal dialog of the port shown (HTML dialogs incl. the HintDialog).
    _isModalShown() {
        return !!((this.mHintController && this.mHintController.isShown())
            || HtmlDialogs.isOpen());
    }

    // Every dialog opener of the game pauses (state +4 = 1, +0xd = 0,
    // FUN_004090b9 -> hand mode 0): FUN_0040bce7 rwg:14103-14105 (Options),
    // FUN_0041e97b rwg:37769-37771 (Shop), FUN_0041e9f1 rwg:37820-37822
    // (Special shop), FUN_0040d435 rwg:16367-16369 (HintDialog),
    // FUN_0041b94a rwg:33692-33697 (SURPRISE), FUN_00421948 rwg:41348-41351
    // (Level completed), FUN_00421a66 rwg:41431-41434 (Level failed); and
    // every closer back to the game unpauses (+4 = 0, +0xd = 0) whatever
    // paused it before: FUN_0040fd44 rwg:19545-19550 (Options), FUN_0041f94a
    // rwg:39086-39088 (Shop), FUN_00420ae8 rwg:40439-40441 (Special shop),
    // FUN_0040d821 rwg:16716-16719 (HintDialog OK), FUN_0040d4bb
    // rwg:16408-16411 / FUN_0041b9cf rwg:33746-33751 (SURPRISE).
    // The HTML dialogs open/close outside this class, so the port applies
    // those writes on the open/close transitions.
    _syncModalPause() {
        const shown = this._isModalShown();
        if (shown === this._modalWasShown) return;
        this._modalWasShown = shown;
        const fc = this.mFieldController;
        fc.mIsPaused = shown;
        this.mPauseTextShown = false;
        if (shown) this.mHand.setMode(HandMode.SEEDS);
    }

    // FUN_0040907e (rwg:11485-11497) edge part: cVar1 = mKeyDown[VK_SPACE]
    // (WidgetManager +0xf0); fires when +0xc was 0 and the key is down;
    // +0xc = cVar1 every call. Called from both branches of the game tick,
    // so space works while a dialog is open (the dialog does not stop the
    // key from being recorded, FUN_00438a14, nor the GameView update).
    _pollSpace() {
        const down = this.mKeyDown.has(' ');
        const edge = !this.mSpacePrev && down;
        this.mSpacePrev = down;
        return edge;
    }

    // FUN_0040907e (rwg:11489-11496) toggle: +0xd = 0; +4 = !+4; when it
    // now pauses, FUN_004090b9 -> FUN_0040cc01(hand, 0) (asm 0x4090c4
    // `xorl %eax,%eax`); +0xd = 1.
    _togglePause(resetHand) {
        const fc = this.mFieldController;
        this.mPauseTextShown = false;
        fc.mIsPaused = !fc.mIsPaused;
        if (fc.mIsPaused && resetHand) this.mHand.setMode(HandMode.SEEDS);
        this.mPauseTextShown = true;
    }

    // FUN_004093d9 (rwg:11849-11950, asm 0x4093d9-0x409532).
    //   Left flag edge (latch +0xbc): FUN_00409ba0 shop slots -> else
    //   FUN_00409c92 egg row -> else FUN_00409c38 risk icon.
    //   +0xc0 != -1: FUN_0040bce7(+0xc0), +0xc0 = -1.
    //   +0xc0 == -1 and state+4 == 0: polled keys (mKeyDown):
    //     ESC (+0xeb): with Shift (+0xe0) app vtable+0xa0 and return; else
    //       mKeyDown[ESC] = 0 and FUN_0040bce7(MENU) — then on to the
    //       letters (no return).
    //     A (+0x111) FUN_00406eed(eggs, 1); else Z (+0x12a) (eggs, 0);
    //     else Q/W/E/R/T (+0x121/+0x127/+0x115/+0x122/+0x124)
    //     FUN_00406f87(eggs, 0..4). One of them per call, every call
    //     while held.
    _inputPoll() {
        if (!this.mMouseLeftDown) {
            this.mPollLeftLatch = false;
        } else if (!this.mPollLeftLatch) {
            // FUN_0040be6f: current mouse position.
            const x = this.mHand.mX, y = this.mHand.mY;
            if (!this._clickShopSlot(x, y) && !this._clickEggRow(x, y)) {
                this._clickRiskIcon(x, y);
            }
            this.mPollLeftLatch = true;
        }
        if (this.mPendingButton !== -1) {
            this._doButtonAction(this.mPendingButton);
            this.mPendingButton = -1;
            return;
        }
        if (this.mFieldController.mIsPaused) return;
        const keys = this.mKeyDown;
        if (keys.has('Escape')) {
            // asm 0x40946b-0x409487: with Shift held, app vtable+0xa0 =
            // FUN_00408f0e (GameApp vtable 004dcbfc [40]): ShellExecute of
            // an optional URL then SexyAppBase::Shutdown FUN_00444943, and
            // return. A browser page cannot shut down (same as MainMenuView
            // EXIT) — only the return is kept.
            if (keys.has('Shift')) return;
            // asm 0x409490-0x4094a5: mKeyDown[ESC] = 0, then FUN_0040bce7
            // with the MENU button's id (push [+0xac]+0x84) -> case 1.
            // No SOUND_CLICK (ButtonDepress is not involved).
            keys.delete('Escape');
            this._doButtonAction(BTN_MENU);
        }
        if (keys.has('a')) { this._setAllEggsBrooding(true); return; }    // FUN_00406eed(.., 1)
        if (keys.has('z')) { this._setAllEggsBrooding(false); return; }   // FUN_00406eed(.., 0)
        const typeKeys = ['q', 'w', 'e', 'r', 't'];                        // FUN_00406f87(.., 0..4)
        for (let i = 0; i < typeKeys.length; i++) {
            if (keys.has(typeKeys[i])) { this._broodEggsOfType(i); return; }
        }
    }

    // FUN_00409ba0 (rwg:12469, asm 0x409ba0-0x409c36) shop slots: for
    // i < slot-vector size (store+8, FUN_0040bfa0): rect = slot image
    // DAT_004fff88 (IMAGE_SHOP_SLOT_OPEN, 80x81) w x h at (w*i, 0);
    // FUN_0041e8f5 buys; on success (al != 0) THIS function plays
    // SOUND_CHICK_BUY (DAT_004fed80, asm 0x409c16-0x409c2e). Handled either
    // way. The vector always has 5 entries (FUN_0041e7f2 ctor loop,
    // rwg_functions.c:37640-37660).
    _clickShopSlot(x, y) {
        const fc = this.mFieldController;
        const img = IMAGES.IMAGE_SHOP_SLOT_OPEN;
        const w = (img && img.mWidth > 1) ? img.mWidth : 80;
        const h = (img && img.mHeight > 1) ? img.mHeight : 81;
        const n = Array.isArray(fc.mBuySlots) ? fc.mBuySlots.length : 5;
        for (let i = 0; i < n; i++) {
            if (rectContains({ x: w * i, y: 0, w, h }, x, y)) {
                if (fc.buyChick(i) && SOUNDS.SOUND_CHICK_BUY) SOUNDS.SOUND_CHICK_BUY.play();
                return true;
            }
        }
        return false;
    }

    // FUN_00409c92 (rwg:12552, asm 0x409c92-0x409d59) egg row: first slot
    // FUN_00409ab2(i) containing the point -> FUN_00406e6a toggles brooding
    // for that egg, then SOUND_EGG_REF (DAT_004fed78, asm 0x409d3e) — played
    // by FieldController.startEggBrooding.
    _clickEggRow(x, y) {
        const eggs = this._getEggRow();
        for (let i = 0; i < eggs.length; i++) {
            if (rectContains(this._eggSlotRect(i), x, y)) {
                this.mFieldController.startEggBrooding(eggs[i]);
                return true;
            }
        }
        return false;
    }

    // FUN_00409c38 (rwg:12514, asm 0x409c38-0x409c91) risk icon: needs risk+9
    // (ready); rect = FUN_00409af0; plays SOUND_CLICK (DAT_004fed84) then
    // FUN_0041b94a (rwg:33659): pause + "SURPRISE!" HTML dialog(s); the case
    // is applied when the result dialog's OK is pressed (FUN_0041b9cf
    // rwg:33746-33751). See SurpriseDialog.js.
    _clickRiskIcon(x, y) {
        const fc = this.mFieldController;
        if (this.mRiskController.isReady() && fc._riskIconRect
            && rectContains(fc._riskIconRect, x, y)) {
            if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
            this._openSurprise();
            return true;
        }
        return false;
    }

    // Hand controller FUN_0040cc71 (rwg:15848-16220, asm 0x40cc71-0x40d240),
    // ticked from the unpaused game update (rwg:7478).
    _handTick() {
        const fc = this.mFieldController;
        const x = this.mHand.mX, y = this.mHand.mY;
        // rwg:15890: tick (+0xc) += 1 every call.
        this.mHandTick++;
        // rwg:15893-15902: left flag DAT_004fff00; latch +8 cleared while it
        // is up; on the edge: latch = 1, fire, repeat-ok, last (+0x10) = tick.
        let fire = false, right = false, repeatOk = false;
        if (!this.mMouseLeftDown) this.mHandLeftLatch = false;
        if (this.mMouseLeftDown && !this.mHandLeftLatch) {
            this.mHandLeftLatch = true;
            fire = true;
            repeatOk = true;
            this.mHandLastActionTick = this.mHandTick;
        }
        // rwg:15904-15917: only without a left edge: right flag DAT_004fff01
        // held -> fire (right); repeat-ok when last + 0x14 < tick (then
        // last = tick).
        if (!fire && this.mMouseRightDown) {
            fire = true;
            right = true;
            if (this.mHandLastActionTick + 0x14 < this.mHandTick) {
                this.mHandLastActionTick = this.mHandTick;
                repeatOk = true;
            }
        }

        // asm 0x40cd04-0x40cd08: FUN_0040cc01(hand, 0) — mode reset to seeds
        // every tick, then re-picked below.
        let mode = HandMode.SEEDS;
        // asm 0x40cd2b-0x40cd6c: crosshair rect (x - (aim>>1), y - aim/2,
        // aim, aim), aim = 8, or 0x14 with the gun-area flag (app+0x40)+0x10.
        const aim = fc.mGunArea ? 0x14 : 8;
        // FUN_0040cc01 mode 2 cursor (asm 0x40cc22-0x40cc52): area (+0x10) /
        // power (+0x11) flags pick DAT_004fff54/58/5c/60.
        const gunMode = (fc.mGunPower > 1 && fc.mGunArea) ? HandMode.GUN_POWER_AREA
            : fc.mGunPower > 1 ? HandMode.GUN_POWER
            : fc.mGunArea     ? HandMode.GUN_AREA
            : HandMode.GUN;
        // asm 0x40cd8e: only when mouse y > 0x82.
        if (y > 0x82) {
            // Raven list (game+0x10): rect FUN_00409a2d overlapping the
            // crosshair (FUN_0040d241, asm 0x40ce11) -> FUN_0040cc01(2)
            // (asm 0x40ce27). No raven state filter. Raven.contains(x, y, aim)
            // is that overlap test (Field.js).
            let hit = false;
            for (const r of fc.mField.mRavens) {
                if (r.mIsAlive && r.contains(x, y, aim)) { hit = true; break; }
            }
            if (!hit) {
                // Pet list (app+0x44)+0xc: type-2 pets (wolves) whose rect
                // FUN_00409800 (Pet.getRect) overlaps the crosshair (asm
                // 0x40ceb3-0x40cedb) -> FUN_0040cc01(2).
                const cross = { x: x - (aim >> 1), y: y - Math.trunc(aim / 2), w: aim, h: aim };
                for (const w of fc.mField.mWolves || []) {
                    if (!w.mIsAlive || !w.getRect) continue;
                    const r = w.getRect();
                    if (cross.x < r.x + r.w && cross.y < r.y + r.h
                        && r.x < cross.x + cross.w && r.y < cross.y + cross.h) {
                        hit = true;
                        break;
                    }
                }
            }
            if (hit) mode = gunMode;
        }
        // LAB_0040cf88 (asm 0x40cf88-0x40d040): only while the mode is still 0
        // (no y gate): first chick in action 3/4 (FUN_00402342) whose rect
        // FUN_00409956 (Chick.getRect) contains the point (FUN_00407ad4)
        // -> FUN_0040cc01(1) (cure).
        if (mode === HandMode.SEEDS) {
            for (const c of fc.mField.mChickens) {
                if (!c.mRemoved && c.mIsSick) {
                    const r = c.getRect();
                    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
                        mode = HandMode.CURE;
                        break;
                    }
                }
            }
        }
        this.mHand.setMode(mode);

        // LAB_0040d05a (rwg:16096-16180): no fire -> done.
        if (!fire) return;
        if (!right) {
            // Left edge: mode 2 -> shoot the raven / wolf; mode 1 -> gem
            // FUN_0040c6a5 else cure FUN_0040490a; mode 0 -> gem FUN_0040c6a5,
            // else egg FUN_004072fa, else seeds FUN_0041bfe2 when y >= 0x15f
            // (repeat-ok is always set on a left edge). No y gate besides
            // those inside the dispatch (FieldController.handleClick).
            fc.handleClick(x, y, this.mHand.getModeString());
            return;
        }
        // Right hold (rwg:16164-16180): seeds only, mode 0, repeat-ok and
        // y >= 0x15f (checked inside dropSeedsAt) via FUN_0041bfe2.
        if (repeatOk && mode === HandMode.SEEDS) {
            fc.dropSeedsAt(x, y);
        }
    }

    // FUN_0040bcc4 (rwg_functions.c:14042) ButtonListener::ButtonDepress
    // Plays SOUND_CLICK (DAT_004fed84, rwg:31741) and stores the id in +0xc0;
    // the action runs on the next Update (FUN_004093d9 rwg:11947).
    buttonDepress(id) {
        if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
        this.mPendingButton = id;
    }

    // FUN_0040bce7 (rwg_functions.c:14062) — deferred button action.
    _doButtonAction(id) {
        switch (id) {
            case BTN_SELL: this._openSellDialog(); break;   // rwg:14088-14093 FUN_0041e97b
            case BTN_BUY: this._openShopDialog(); break;    // rwg:14094-14099 FUN_0041e9f1
            case BTN_MENU: this._openPauseMenu(); break;    // rwg:14100-14120 OptionsDialog
        }
    }

    // FUN_0040bdf2 (rwg_functions.c:14177) GameView::MouseMove — only stores
    // the mouse position (FUN_0040be96). The hand mode is re-picked every
    // unpaused tick by _handTick (FUN_0040cc71).
    mouseMove(x, y) {
        this.mHand.move(x, y);
        // HUD button hover state read by FieldController.drawHUD.
        this.mFieldController.mHudHoverX = x;
        this.mFieldController.mHudHoverY = y;
        super.mouseMove(x, y);
    }

    // MENU/SELL/BUY button under (x, y), or -1. Rects: FUN_0040bbea
    // rwg:14005-14012. SELL/BUY are visible iff store (game+0x30) +0x18 /
    // +0x19 (FUN_0040a3d6 rwg:13293-13299) = LevelData sellButton /
    // specialShopButton.
    _buttonAt(x, y) {
        const cfg = this.mFieldController.mLevelConfig;
        if (rectContains(MENU_RECT, x, y)) return BTN_MENU;
        if (cfg && cfg.sellButton && rectContains(SELL_RECT, x, y)) return BTN_SELL;
        if (cfg && cfg.specialShopButton && rectContains(BUY_RECT, x, y)) return BTN_BUY;
        return -1;
    }

    // FUN_0040bd72 (rwg_functions.c:14135) GameView::MouseDown
    //   clickCount 1/2 (left) -> left flag DAT_004fff00 = 1;
    //   3 (middle) / -1 / -2 (right) -> right flag DAT_004fff01 = 1.
    // Nothing else happens here: the left edge is consumed in Update by the
    // hand tick FUN_0040cc71 (field click, unpaused only) and by the input
    // poll FUN_004093d9 (HUD: shop slots / egg row / risk icon, paused or
    // not) — both see the same click.
    // A press on a MENU/SELL/BUY ButtonWidget never reaches GameView.
    mouseDown(x, y, btn) {
        // HintDialog modal — consumes all clicks while shown
        if (this.mHintController.isShown()) {
            if (btn === 0) this.mHintController.handleClick(x, y);
            return true;
        }
        // Level completed / failed: the HTML dialogs own the input.
        if (this.mFieldController.mIsLevelComplete || this.mFieldController.mIsLevelFailed) {
            return true;
        }

        // A press over MENU/SELL/BUY goes to that ButtonWidget, whatever the
        // mouse button: ButtonWidget::MouseDown FUN_0043db80 (rwg:73845-
        // 73852) has no click-count test — ButtonPress only; ButtonDepress
        // waits for MouseUp (see mouseUp).
        const b = this._buttonAt(x, y);
        if (b !== -1) {
            this._pressedButton = b;
            return true;
        }

        // Mouse position as stored by MouseMove (FUN_0040be96) and read by
        // FUN_0040be6f in the polls.
        this.mHand.move(x, y);
        if (btn === 0) {
            this.mMouseLeftDown = true;               // FUN_0040be11(1)
        } else if (btn === 2 || btn === 1) {
            // DOM button 2 = right, 1 = middle: FUN_0040be50(1).
            this.mMouseRightDown = true;
        }
        return true;
    }

    // Eggs listed in the HUD egg row (original list game+0x24, rwg:12572).
    // Uses the same egg list FieldController.drawHUD renders.
    _getEggRow() {
        return this.mFieldController.mField.mGems.filter(
            gem => gem.mType === 4 && gem.mIsAlive);
    }

    // FUN_00409ab2 (rwg_functions.c:12381): slot i of the egg row.
    //   w,h = IMAGE_EGG_REF size (DAT_004fff74; egg_ref.png = 54x54)
    //   x = w*i, y = 0x50; if i > 10: x -= 11*w, y = h + 0x50.
    _eggSlotRect(i) {
        const img = IMAGES.IMAGE_EGG_REF;
        const w = (img && img.mWidth > 1) ? img.mWidth : 54;
        const h = (img && img.mHeight > 1) ? img.mHeight : 54;
        let x = w * i;
        let y = 0x50;
        if (i > 10) {
            x -= w * 11;
            y = h + 0x50;
        }
        return { x, y, w, h };
    }

    // FUN_0040bdb2 (rwg_functions.c:14156) GameView::MouseUp — clears the flags.
    mouseUp(x, y, btn) {
        if (this._pressedButton !== -1) {
            // ButtonWidget::MouseUp FUN_0043dbb3 (rwg:73862-73868): ButtonDepress
            // (FUN_0040bcc4) when the cursor is still over the button
            // (+0x55) — no click-count (mouse button) test either.
            const b = this._pressedButton;
            this._pressedButton = -1;
            if (this._buttonAt(x, y) === b) this.buttonDepress(b);
            return;
        }
        // FUN_0040be11(0) / FUN_0040be50(0)
        if (btn === 0) this.mMouseLeftDown = false;
        if (btn === 2 || btn === 1) this.mMouseRightDown = false;
        super.mouseUp(x, y, btn);
    }

    // Keyboard. The original has no GameView::KeyDown: keys are recorded in
    // WidgetManager::mKeyDown[] (FUN_00438a14, see the constructor's window
    // listeners) and polled every Update — space by FUN_0040907e in the game
    // tick, ESC / A / Z / Q..T by FUN_004093d9 (_inputPoll). Called by
    // GameApp for the current view only to let the browser default be
    // suppressed: space (page scroll / activating a focused HTML button —
    // neither exists in the original).
    keyDown(key) {
        return normKey(key) === ' ';
    }

    // Egg type +0x10 (rwg:8697) in chick-type numbering 0 layer .. 4 holy,
    // as compared by FUN_00406f87 (rwg:8692). JS eggs use EggType; Chick.js
    // EGG_TO_CHICK is the same table Field uses to hatch them.
    _eggChickType(egg) {
        const t = EGG_TO_CHICK[egg.mEggType];
        return t === undefined ? -1 : t;
    }

    // FUN_00406eed (rwg_functions.c:8623): toggle (FUN_00406e6a) every egg whose
    // brooding state (FUN_00406e0d) differs from `on`.
    _setAllEggsBrooding(on) {
        const fc = this.mFieldController;
        for (const egg of this._getEggRow()) {
            if (!!egg.mBrooding !== on) fc.toggleEggBrooding(egg);   // silent (no SOUND_EGG_REF)
        }
    }

    // FUN_00406f87 (rwg_functions.c:8671): toggle every egg of the given type
    // that is not brooding yet.
    _broodEggsOfType(type) {
        const fc = this.mFieldController;
        for (const egg of this._getEggRow()) {
            if (this._eggChickType(egg) === type && !egg.mBrooding) {
                fc.toggleEggBrooding(egg);   // silent: only the egg-row click plays SOUND_EGG_REF (asm 0x409d3e)
            }
        }
    }

    // The original shows no splash after START LEVEL — level text lives in
    // SelectLevelDialog (FUN_0042399c). Kept as a no-op for GameApp.startGame.
    showLevelIntro(level) {}

    // FUN_0041b94a (rwg:33659) risk dialog. Pause/unpause are explicit, as in
    // the original: open sets state +4 = 1, +0xd = 0 (rwg:33692-33695); NO
    // (FUN_0040d4bb rwg:16402-16411) and the result OK (FUN_0041b9cf
    // rwg:33750-33751) set +4 = 0, +0xd = 0.
    _openSurprise() {
        const fc = this.mFieldController;
        new SurpriseDialog({
            riskController: this.mRiskController,
            fc,
            // Core+0x20 hand, reset by FUN_004090b9 (rwg:33697)
            hand: this.mHand,
            core: this.mGameApp && this.mGameApp.mCore,
            setPaused: (paused) => {
                fc.mIsPaused = paused;        // state +4
                this.mPauseTextShown = false; // state +0xd = 0
            },
        }).open();
    }

    // FUN_0040bce7 case 1 (rwg:14100-14120): pause (+4 = 1, +0xd = 0) and open
    // the OptionsDialog (FUN_0040f57b, AddDialog id 6). HTML in this port; the
    // pause is applied on the open transition (_syncModalPause).
    _openPauseMenu() {
        this.mPauseTextShown = false;
        this.mGameApp.openOptions({
            inGame: true,
            onMainMenu: () => { if (this.mGameApp.showMainMenu) this.mGameApp.showMainMenu(); },
            // OptionsDialog RESTART FUN_0040fe56 (rwg:19603-19609): FUN_00406389
            // + Core::StartLevel FUN_00406069 only — no FUN_00408dae, so the
            // music is not re-rolled.
            onRestart: () => { this.startLevel(this.mFieldController.mCurrentLevel); },
        });
    }

    // LEVEL COMPLETED — HTML dialog (FUN_0040dc45) opened on the flag transition.
    _openCompleteHtml() {
        const fc = this.mFieldController;
        const core = this.mGameApp.mCore;
        const isBonus = fc.mLevelConfig && fc.mLevelConfig.isBonus;
        const level = fc.mCurrentLevel;
        const best = (core && core.getBestTimeRecord) ? core.getBestTimeRecord(level) : null;
        const fmt = (ms) => {
            if (!ms || ms <= 0) return '--:--';
            const s = Math.floor(ms / 1000), m = Math.floor(s / 60), r = s % 60;
            return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
        };
        HtmlDialogs.open('level-complete', {
            binds: {
                title: isBonus ? 'BONUS LEVEL COMPLETED' : 'LEVEL COMPLETED',
                yourtime: fmt(fc.mTimeElapsed || 0),
                acetime: fmt(fc.mLevelAceTime || 0),
                // FUN_0040dde4 rwg:17165-17200: best record over all players
                // FUN_0041605e; none -> empty name and time.
                bestlabel: 'Best time - by ' + (best ? best.name : ''),
                besttime: best ? fmt(best.time) : '',
                bonus: isBonus
                    ? (fc.mBonusAchieved
                        ? "Perfect! You have got a bonus for the next level: one of special shop upgrades will be allowed at half price!"
                        : "You haven't got a bonus")
                    : '',
            },
            visible: { times: !isBonus, bonus: !!isBonus },
            actions: { continue: () => this._onLevelContinue() },
        });
    }

    // LevelCompletedDialog CONTINUE — FUN_0040dd6a (rwg:17086-17107): SOUND_CLICK,
    // remove dialog, then flag +0xd8 == 0 -> FUN_004088d0(level + 1)
    // (SelectLevelView; level 51 -> win) else FUN_00408c24(level + 1)
    // (UpgradesView). The flag is sampled at completion (see update()).
    _onLevelContinue() {
        if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play(); // rwg:17098
        HtmlDialogs.close('level-complete');
        this.mGameApp.continueAfterLevel(this.mFieldController.mCurrentLevel, this._offersUpgrade);
    }

    // LEVEL FAILED — HTML dialog (FUN_0040e0ea). Buttons per FUN_0040e217
    // (rwg:17461-17482): SOUND_CLICK, remove dialog, then FUN_00408799 (main
    // menu view) or FUN_00408dae (reset game + show GameView = restart).
    _openFailedHtml() {
        const fc = this.mFieldController;
        HtmlDialogs.open('level-failed', {
            // FUN_0040e0ea, rwg:17418-17427: one body with an explicit newline.
            binds: { reason: (fc.mFailReason === 'time' ? 'Time up' : 'You lost all your chickens')
                + '\nPress main menu or restart' },
            actions: {
                restart: () => {
                    if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play(); // rwg:17473
                    HtmlDialogs.close('level-failed');
                    // FUN_00408dae: Core::StartLevel + GameView + music re-roll.
                    this.mGameApp.startGame(fc.mCurrentLevel);
                },
                mainmenu: () => {
                    if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play(); // rwg:17473
                    HtmlDialogs.close('level-failed');
                    this.mGameApp.showMainMenu();
                },
            },
        });
    }

    // FUN_0040bce7 case 2 -> FUN_0041e97b (rwg:37749): pause (+4 = 1, +0xd = 0),
    // ShopDialog FUN_0041f031 — HTML 'shop-sell'.
    _openSellDialog() {
        this.mPauseTextShown = false;
        new ShopDialog(this.mFieldController, null).openHtml();
    }

    // FUN_0040bce7 case 3 -> FUN_0041e9f1 (rwg:37802): pause (+4 = 1, +0xd = 0),
    // SpecialShopDialog FUN_00420232 — HTML 'shop-buy'.
    _openShopDialog() {
        this.mPauseTextShown = false;
        new SpecialShopDialog(this.mFieldController, null).openHtml();
    }
}
