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

export class GameView extends Widget {
    // FUN_004091f9 (rwg_functions.c:11682) GameView::GameView
    constructor(gameApp) {
        super();
        this.mGameApp = gameApp;
        this.mFieldController = new FieldController(gameApp);
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
        // FUN_0040907e (rwg:11487-11497) edge-detects space against its previous
        // key state (+0xc), so holding space toggles once. The browser repeats
        // keydown while held; track the held state via keyup to match.
        this._spaceHeld = false;
        // Shift key state (mKeyDown[VK_SHIFT] = WidgetManager +0xe0, read by
        // FUN_004093d9 asm 0x40946b together with ESC).
        this._shiftHeld = false;
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('keyup', (e) => {
                if (e.key === ' ' || e.key === 'Spacebar') this._spaceHeld = false;
                if (e.key === 'Shift') this._shiftHeld = false;
            });
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Shift') this._shiftHeld = true;
            });
        }

        // MENU/SELL/BUY are ButtonWidgets: ButtonDepress fires on MouseUp
        // (ButtonWidget::MouseUp FUN_0043dbb3 rwg:73862: if mIsOver (+0x55)
        // -> listener vtable[2] = FUN_0040bcc4). Button id pressed, or -1.
        this._pressedButton = -1;

        // Right-button flag DAT_004fff01 (FUN_0040bd72 rwg:14144-14146).
        this.mMouseRightDown = false;
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
        this.mPauseTextShown = false;
        this.mMouseRightDown = false;
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

        // Money pop-up texts (FUN_0040693f money effect, FieldController).
        this.mFieldController.drawFloatingTexts(g);

        const anyModal = (this.mHintController && this.mHintController.isShown())
            || HtmlDialogs.isOpen();

        // GAME PAUSED — rwg:13966-13982, asm 0x40baad-0x40bb90. Condition:
        // state+4 (paused) && state+0xd (space pause). Colour DAT_005012a0
        // (white). No FillRect/dim precedes the text.
        //   "GAME PAUSED" (0x4dcde0), FONT_24 (DAT_004fff1c):
        //       x = (width(+0x38) - StringWidth)/2, y = height(+0x3c)/2 = 300
        //   "press space to continue" (0x4dcdec), FONT_20 (DAT_004fff18):
        //       x = (width - StringWidth)/2, y = height/2 + 0x64 = 400
        // (asm 0x40bb0b-0x40bb29 / 0x40bb5f-0x40bb80; Sexy DrawString y = baseline.)
        if (this.mFieldController.mIsPaused && this.mPauseTextShown && !anyModal) {
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

        // Hand cursor last (on top) when no modal is up and the cursor is over
        // the field. Framework substitute for the Sexy custom cursor.
        const modalShown = anyModal
            || this.mFieldController.mIsLevelComplete
            || this.mFieldController.mIsLevelFailed;
        const overField = this.mHand.isOverField();
        if (!modalShown && overField) {
            this.mHand.draw(g);
        }
        if (this.mGameApp && this.mGameApp.mCanvas) {
            this.mGameApp.mCanvas.style.cursor = (modalShown || !overField) ? 'default' : 'none';
        }
    }

    // FUN_00409372 (rwg_functions.c:11804) GameView::Update
    //   parent Update; MarkDirty; controller->Update() (+0xb8 vtable[0]);
    //   FUN_004093d9 (input poll, pending button); FUN_004091b8 (dog tick).
    update() {
        // Pause the field while an HTML / hint modal is displayed. The original
        // dialog openers set state+4 = 1 and +0xd = 0 and call FUN_004090b9
        // (hand mode 0): FUN_0040bce7 rwg:14103-14105, FUN_0041e97b
        // rwg:37769-37771, FUN_0041e9f1 rwg:37820-37822, HintDialog
        // FUN_0040d435 asm 0x40d44d-0x40d455, FUN_0041b94a rwg:33692-33697.
        const fc = this.mFieldController;
        const modalShown = !!((this.mHintController && this.mHintController.isShown())
            || HtmlDialogs.isOpen());
        if (modalShown) this.mPauseTextShown = false;
        if (modalShown && !this._modalWasShown) this.mHand.setMode(HandMode.SEEDS);
        this._modalWasShown = modalShown;
        if (modalShown && !fc.mIsPaused) {
            this._pausedByHint = true;
            fc.mIsPaused = true;
        } else if (this._pausedByHint && !modalShown) {
            this._pausedByHint = false;
            fc.mIsPaused = false;
        }

        // Game tick FUN_00405fcf (rwg:7464-7480) runs only when state+4 == 0;
        // FieldController.update covers ravens/field/seeds/eggs/gems/inflation.
        const running = !fc.mIsPaused && !fc.mIsLevelComplete && !fc.mIsLevelFailed;
        // FUN_00421948 computes the LevelCompleted "upgrade" flag BEFORE the
        // time is recorded (FUN_0041111b @0x4219d6), which FieldController
        // does inside update(): sample maxUnlocked first.
        const maxUnlockedBefore = (this.mGameApp && this.mGameApp.getMaxUnlocked)
            ? this.mGameApp.getMaxUnlocked() : 1;
        const level = fc.mCurrentLevel;
        fc.update();
        if (running) {
            // FUN_0040d281 hint bar tick (rwg:7472).
            this.mHintController.update();
        }

        // Open the HTML level-end dialog once when the flag first trips.
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
        // Risk cooldown tick — RiskController FUN_0041b901 (rwg:7477).
        if (running) {
            this.mRiskController.update();
        }

        // Mirror the ready flag onto FieldController for HUD draw
        // (risk icon shown when risk+9 != 0, rwg:13899).
        fc.mRiskReady = this.mRiskController.isReady();
        fc.mRiskController = this.mRiskController; // icon cel phase (+0x10)
        super.update();

        // FUN_004093d9 rwg:11947-11950: a pending button id is executed via
        // FUN_0040bce7 on the next Update, then +0xc0 = -1.
        if (this.mPendingButton !== -1) {
            const id = this.mPendingButton;
            this.mPendingButton = -1;
            this._doButtonAction(id);
        }

        // Hand controller FUN_0040cc71 (rwg:15848), called only from the
        // unpaused game update (rwg:7476), before the level update.
        if (running) this._handTick();

        // Level update FUN_00421b21 (rwg:7479, last in the tick): while a task
        // is open and the level is not lost it runs the tutorial dispatcher
        // FUN_00422036 (rwg:41522-41530). FieldController._checkTasks covers
        // the complete/failed branches, so: running before and after.
        if (running && !fc.mIsLevelComplete && !fc.mIsLevelFailed && this.mLevelTutorial) {
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

    // Hover / right-hold part of the Hand controller FUN_0040cc71
    // (rwg:15848-16220). The left-click "fire" part is FieldController.handleClick,
    // called from mouseDown.
    _handTick() {
        const fc = this.mFieldController;
        const x = this.mHand.mX, y = this.mHand.mY;
        // rwg:15890: tick (+0xc) += 1 every call.
        this.mHandTick++;
        // rwg:15904-15917: right flag DAT_004fff01 held (and no left edge):
        // fire when last(+0x10) + 0x14 < tick, then last = tick.
        let rightFire = false;
        if (this.mMouseRightDown && this.mHandLastActionTick + 0x14 < this.mHandTick) {
            this.mHandLastActionTick = this.mHandTick;
            rightFire = true;
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
                if (c.mIsAlive && c.mIsSick) {
                    const r = c.getRect();
                    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
                        mode = HandMode.CURE;
                        break;
                    }
                }
            }
        }
        this.mHand.setMode(mode);

        // rwg:16164-16180: right-hold fire drops seeds only in mode 0 and
        // y >= 0x15f (checked inside dropSeedsAt) via FUN_0041bfe2.
        if (rightFire && mode === HandMode.SEEDS) {
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
    // The left edge is consumed by FUN_004093d9 (rwg:11870-11883):
    //   FUN_00409ba0 shop slots -> else FUN_00409c92 egg row -> else FUN_00409c38 risk icon.
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

        if (btn === 0) {
            const b = this._buttonAt(x, y);
            if (b !== -1) {
                // ButtonWidget::MouseDown FUN_0043db80: ButtonPress only;
                // ButtonDepress waits for MouseUp (see mouseUp).
                this._pressedButton = b;
                return true;
            }
        }

        if (btn === 2 || btn === 1) {
            // DOM button 2 = right, 1 = middle: FUN_0040bd72 rwg:14144-14146
            // -> FUN_0040be50(1). Seeds are dropped by the repeat in
            // _handTick (FUN_0040cc71 rwg:15904-15917).
            this.mMouseRightDown = true;
            return true;
        }
        if (btn !== 0) return true;

        const fc = this.mFieldController;

        // --- FUN_00409ba0 (rwg:12469, asm 0x409bab-0x409c36) shop slots ---
        // for i < slot-vector size (store+8, FUN_0040bfa0): rect = slot image
        // DAT_004fff88 (IMAGE_SHOP_SLOT_OPEN, 80x81) w x h at (w*i, 0);
        // FUN_0041e8f5 buys; on success (al != 0) THIS function plays
        // SOUND_CHICK_BUY (DAT_004fed80, asm 0x409c16-0x409c2e) — FUN_0041e8f5
        // itself plays none. Handled either way. The vector always has 5
        // entries (FUN_0041e7f2 ctor loop, rwg_functions.c:37640-37660).
        for (let i = 0; i < 5; i++) {
            if (rectContains({ x: 80 * i, y: 0, w: 80, h: 81 }, x, y)) {
                if (fc.buyChick(i) && SOUNDS.SOUND_CHICK_BUY) SOUNDS.SOUND_CHICK_BUY.play();
                return true;
            }
        }

        // --- FUN_00409c92 (rwg:12552, asm 0x409c92-0x409d59) egg row ---
        // FUN_00406e6a toggles brooding for the egg, then SOUND_EGG_REF
        // (DAT_004fed78, asm 0x409d3e) — played by FieldController.startEggBrooding.
        const eggs = this._getEggRow();
        for (let i = 0; i < eggs.length; i++) {
            if (rectContains(this._eggSlotRect(i), x, y)) {
                fc.startEggBrooding(eggs[i]);
                return true;
            }
        }

        // --- FUN_00409c38 (rwg:12514) risk icon ---
        // Needs risk+9 (ready); rect = FUN_00409af0; plays SOUND_CLICK then
        // FUN_0041b94a (rwg:33659): pause + "SURPRISE!" HTML dialog(s); the
        // case is applied when the result dialog's OK is pressed (FUN_0041b9cf
        // rwg:33746-33751). See SurpriseDialog.js.
        if (this.mRiskController.isReady() && fc._riskIconRect
            && rectContains(fc._riskIconRect, x, y)) {
            if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
            this._openSurprise();
            return true;
        }

        // Left click on field — Hand controller FUN_0040cc71 (rwg:15893-15902:
        // left edge records +0x10 = tick). Field action dispatch is
        // FieldController.handleClick.
        if (this.mHand.isOverField()
            && !fc.mIsPaused
            && !fc.mIsLevelComplete
            && !fc.mIsLevelFailed) {
            this.mHandLastActionTick = this.mHandTick;
            fc.handleClick(x, y, this.mHand.getModeString());
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
        if (this._pressedButton !== -1 && btn === 0) {
            // ButtonWidget::MouseUp FUN_0043dbb3 (rwg:73862): ButtonDepress
            // (FUN_0040bcc4) only if the cursor is still over the button.
            const b = this._pressedButton;
            this._pressedButton = -1;
            if (this._buttonAt(x, y) === b) this.buttonDepress(b);
            return;
        }
        if (btn === 2 || btn === 1) this.mMouseRightDown = false;
        super.mouseUp(x, y, btn);
    }

    // Keyboard. The original polls WidgetManager::mKeyDown[] (base +0xd0,
    // FUN_00438a14 rwg:68189) every Update instead of handling KeyDown:
    //   space  +0xf0  (VK 0x20) FUN_0040907e pause toggle (rwg:11489)
    //   ESC    +0xeb  (VK 0x1B) MENU action; with Shift (+0xe0, VK 0x10) app vtable+0xa0
    //   A +0x111 / Z +0x12a  -> FUN_00406eed(eggs, 1 / 0)
    //   Q +0x121 / W +0x127 / E +0x115 / R +0x122 / T +0x124 -> FUN_00406f87(eggs, 0..4)
    // (FUN_004093d9 rwg:11884-11946; only when +0xc0 == -1 and the game is not paused.)
    keyDown(key) {
        // HTML dialogs (options, shop, level end, intro...) own the keyboard.
        if (HtmlDialogs.isOpen()) return false;
        if (this.mHintController.isShown()) return true;

        const fc = this.mFieldController;

        // FUN_0040907e (rwg:11479-11498): edge-triggered space toggle.
        if (key === ' ' || key === 'Spacebar') {
            if (this._spaceHeld) return true;
            this._spaceHeld = true;
            if (fc.mIsLevelComplete || fc.mIsLevelFailed) return true;
            this.mPauseTextShown = false;               // +0xd = 0
            fc.mIsPaused = !fc.mIsPaused;               // +4 = !+4
            // When pausing (rwg:11494-11495), FUN_004090b9 -> FUN_0040cc01
            // (Core+0x20 hand) with mode 0: asm 0x4090c4 `xorl %eax,%eax`.
            if (fc.mIsPaused) this.mHand.setMode(HandMode.SEEDS);
            this.mPauseTextShown = true;                // +0xd = 1
            return true;
        }

        // FUN_004093d9 rwg:11884-11887: rest only when no button is pending
        // and state+4 (paused) == 0.
        if (this.mPendingButton !== -1 || fc.mIsPaused
            || fc.mIsLevelComplete || fc.mIsLevelFailed) {
            return false;
        }

        if (key === 'Escape') {
            // asm 0x40946b-0x409487: with Shift (+0xe0) held, app vtable+0xa0
            // = FUN_00408f0e (GameApp vtable 004dcbfc [40]): ShellExecute of
            // an optional URL then SexyAppBase::Shutdown FUN_00444943, and
            // return. A browser page cannot shut down (same as MainMenuView
            // EXIT) — no-op, and the MENU branch is NOT taken.
            if (this._shiftHeld) return true;
            // asm 0x409490-0x4094a5: mKeyDown[ESC] = 0, then FUN_0040bce7 with
            // the MENU button's id (push [+0xac]+0x84, MENU = +0xac) -> case 1.
            // No SOUND_CLICK (ButtonDepress is not involved).
            this._doButtonAction(BTN_MENU);
            return true;
        }

        const k = key.length === 1 ? key.toLowerCase() : key;
        // rwg:11901-11943
        if (k === 'a') { this._setAllEggsBrooding(true); return true; }   // FUN_00406eed(.., 1)
        if (k === 'z') { this._setAllEggsBrooding(false); return true; }  // FUN_00406eed(.., 0)
        const typeKeys = { q: 0, w: 1, e: 2, r: 3, t: 4 };
        if (k in typeKeys) { this._broodEggsOfType(typeKeys[k]); return true; } // FUN_00406f87
        return false;
    }

    // Chick type an egg hatches into. The original egg type (+0x10, rwg:8697)
    // uses chick-type numbering 0 layer .. 4 holy (mission egg overlays
    // rwg:13842-13849). JS eggs use EggType; mapping mirrors Field.hatchEgg
    // (Field.js EggType -> ChickType switch). Keep in sync with Field.js.
    _eggChickType(egg) {
        switch (egg.mEggType) {
            case 0: return 0; // WHITE  -> LAYER
            case 1: return 3; // BLUE   -> MAGIC
            case 2: return 4; // RED    -> HOLY
            case 3: return 2; // BLACK  -> ROOSTER
            case 4: return 1; // GOLDEN -> BROODY
            default: return -1;
        }
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
                this._pausedByHint = false;
                fc.mIsPaused = paused;        // state +4
                this.mPauseTextShown = false; // state +0xd = 0
            },
        }).open();
    }

    // FUN_0040bce7 case 1 (rwg:14100-14120): pause (+4 = 1, +0xd = 0) and open
    // the OptionsDialog (FUN_0040f57b, AddDialog id 6). HTML in this port; the
    // field auto-pauses via the HtmlDialogs.isOpen() check in update().
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
