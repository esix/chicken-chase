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
//   Right-hold seed repeat / auto cursor is the Hand controller FUN_0040cc71 (15848), not GameView.

import { Widget } from './SexyApp.js';
import { FieldController } from './FieldController.js';
import { Hand, HandMode } from './Hand.js';
import { RiskController } from './RiskController.js';
import { HintController, HintType } from './HintController.js';
import { IMAGES, SOUNDS } from './Res.js';
import { UPGRADE_TIERS, openUpgradeChoices } from './UpgradeSelectDialog.js';
import { ShopDialog, SpecialShopDialog } from './ShopDialogs.js';
import { HtmlDialogs } from './HtmlDialogs.js';
import { SurpriseDialog } from './SurpriseDialog.js';

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
        this.mShowDialog = null;
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
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('keyup', (e) => {
                if (e.key === ' ' || e.key === 'Spacebar') this._spaceHeld = false;
            });
        }

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
        // Re-apply persisted upgrades from the player profile.
        const purchased = (this.mGameApp && this.mGameApp.mCore
            && this.mGameApp.mCore.mUpgradesPurchased) || [];
        for (const key of purchased) {
            this._applyUpgradeEffect(key, /*silent*/ true);
        }
        this.mShowDialog = null;
        this.mPendingButton = -1;
        this.mPauseTextShown = false;
        this.mMouseRightDown = false;
        this.mHandTick = 0;
        this.mHandLastActionTick = 0;
        // Reset per-level hint trackers so hints fire again on restart.
        this.mShownSickHint = false;
        this.mShownEggHint = false;

        // IntroductionDialog (FUN_0040d936:16823). In the original it is opened
        // by SelectLevelView::AddedToManager FUN_0041d22e (rwg:35567-35569) when
        // FUN_0041614b() == 1, not by GameView. Kept here as HTML.
        const maxReached = (this.mGameApp.mCore && this.mGameApp.mCore.mMaxLevelReached) || 1;
        if (level === 1 && !this._introShown && maxReached <= 1) {
            this._introShown = true;
            this._showIntroHtml();
        }

        // Trigger first-time hints per decompiled hint table (rwg_functions.c:41991+)
        this._triggerLevelHint(level);
    }

    // Maps level to its initial hint, per the strings cited in DECOMPILED_MAP.md.
    // Hint dispatch is the hint controller's job (FUN_00422a24 etc.) — not audited here.
    _triggerLevelHint(level) {
        switch (level) {
            case 1: this.mHintController.showHint(HintType.FIRST_CHICKENS); break;
            case 2: this.mHintController.showHint(HintType.COLLECT_EGG); break;
            case 3: this.mHintController.showHint(HintType.HATCH_GOAL); break;
            case 4: this.mHintController.showHint(HintType.RAVEN_WARNING); break;
            case 5: this.mHintController.showHint(HintType.SELL_FOR_BONUS); break;
            case 7: this.mHintController.showHint(HintType.SURPRISE_OPTION); break;
        }
    }

    // Intro shown as HTML dialogs: letter page first (screenshot 10), then the
    // introduction panel (screenshot 11). FUN_0040d936 / FUN_0040daeb.
    _showIntroHtml() {
        HtmlDialogs.open('intro-letter', {
            actions: {
                next: () => {
                    HtmlDialogs.close('intro-letter');
                    HtmlDialogs.open('intro-panel', {
                        actions: { ok: () => HtmlDialogs.close('intro-panel') },
                    });
                },
            },
        });
    }

    // FUN_0040a3d6 (rwg_functions.c:13092) GameView::Draw
    // Order in the original: SELL/BUY visibility (13293-13299), field render
    // FUN_004248b4 (13321), dog (13330), entities, HUD, hint tip (13930-13962),
    // GAME PAUSED (13966-13982). Field + HUD are drawn by Field.draw /
    // FieldController.drawHUD in this port.
    draw(g) {
        // Screen shake — FieldController feature; no translate is visible in
        // FUN_0040a3d6. UNKNOWN — not found in decompiled (left as is).
        const shake = this.mFieldController.getShakeOffset
            ? this.mFieldController.getShakeOffset()
            : { x: 0, y: 0 };
        if (shake.x || shake.y) {
            g.ctx.save();
            g.ctx.translate(shake.x, shake.y);
        }

        // Field (FUN_004248b4 rwg:13321 + entity loops).
        // MISSING: the dog idle animation drawn right after the background at
        // (0x166, 0xe2) = (358, 226) (rwg:13330) needs a hook between the
        // background and entities inside Field.draw; frame durations come from
        // DAT_004dcd88 (rwg:11668) — UNKNOWN — not found in decompiled.
        this.mFieldController.mField.draw(g);

        if (shake.x || shake.y) g.ctx.restore();

        // HUD (drawn procedurally inside FUN_0040a3d6 in the original).
        this.mFieldController.drawHUD(g);

        // Child widgets (MENU/SELL/BUY are drawn by drawHUD in this port).
        super.draw(g);

        // FieldController effects (click ripples / floating texts / particles):
        // FieldController features, not part of FUN_0040a3d6 — left as is.
        if (this.mFieldController.drawClickRipples) {
            this.mFieldController.drawClickRipples(g);
        }
        this.mFieldController.drawFloatingTexts(g);
        if (this.mFieldController.drawParticles) {
            this.mFieldController.drawParticles(g);
        }

        // Legacy canvas dialog (mShowDialog is never set any more; kept for API).
        if (this.mShowDialog) {
            g.setColor(0, 0, 0, 150);
            g.fillRect(0, 0, 800, 600);
            this._drawDialog(g, this.mShowDialog);
        }

        // HintDialog modal (HintController).
        this.mHintController.draw(g);

        // Legacy canvas modals (never assigned by this file; kept for API).
        if (this.mOptionsDialog) this.mOptionsDialog.draw(g);
        if (this.mShopDialog) this.mShopDialog.draw(g);
        if (this.mUpgradeDialog) this.mUpgradeDialog.draw(g);

        // GAME PAUSED overlay — rwg:13966-13982. Condition: state+4 (paused)
        // && state+0xd (space pause). Colour DAT_005012a0 (rwg:13970) is the
        // same colour used for the white "Time"/"Money" labels (rwg:13873,
        // screenshots 13-32) => white. Fonts DAT_004fff1c = FONT_24 and
        // DAT_004fff18 = FONT_20 (rwg:30941-30944) = ArialBlack24 / ArialBlack20
        // (resources.xml). No FillRect/dim precedes the text in the original.
        // Each string is horizontally centred via Font::StringWidth (vtable+0x1c,
        // rwg:13975, 13981). Y positions: UNKNOWN — not found in decompiled
        // (DrawString args dropped by the decompiler); 290/330 left as is.
        const anyModal = this.mShowDialog
            || this.mShopDialog
            || this.mOptionsDialog
            || this.mUpgradeDialog
            || (this.mHintController && this.mHintController.isShown())
            || HtmlDialogs.isOpen();
        if (this.mFieldController.mIsPaused && this.mPauseTextShown && !anyModal) {
            g.ctx.fillStyle = '#fff';
            g.ctx.textAlign = 'center';
            g.ctx.font = '24px "Arial Black", Arial, sans-serif';
            g.ctx.fillText('GAME PAUSED', 400, 290);
            g.ctx.font = '20px "Arial Black", Arial, sans-serif';
            g.ctx.fillText('press space to continue', 400, 330);
            g.ctx.textAlign = 'left';
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

    _drawDialog(g, dialog) {
        const btnImg = IMAGES.IMAGE_DIALOG_BUTTON;
        const bgX = 150, bgY = 120, bgW = 500, bgH = 360;
        g.drawDialogBox(IMAGES.IMAGE_DIALOG_BOX, bgX, bgY, bgW, bgH);
        g.ctx.fillStyle = '#ffd700';
        g.ctx.textAlign = 'center';
        g.ctx.font = 'bold 18px "Arial Black", Arial, sans-serif';
        g.ctx.fillText(dialog.title || '', 400, bgY + 30);
        if (dialog.text) {
            g.ctx.fillStyle = '#fff';
            g.ctx.font = '13px Arial, sans-serif';
            this._drawWrappedText(g, dialog.text, 400, bgY + 70, 440, 18);
        }
        if (dialog.buttons) {
            const bw = 180, bh = 34;
            const startY = bgY + bgH - 50 - dialog.buttons.length * 42;
            for (let i = 0; i < dialog.buttons.length; i++) {
                const by = startY + i * 42;
                const bx = 400 - bw / 2;
                if (btnImg && btnImg.img && g._isReady(btnImg.img)) {
                    g.ctx.drawImage(btnImg.img, bx, by, bw, bh);
                } else {
                    g.setColor(140, 100, 30, 255);
                    g.fillRect(bx, by, bw, bh);
                }
                g.ctx.fillStyle = '#fff';
                g.ctx.font = 'bold 13px Arial, sans-serif';
                g.ctx.fillText(dialog.buttons[i].label, 400, by + 22);
            }
        }
        g.ctx.textAlign = 'left';
    }

    _drawWrappedText(g, text, x, y, maxWidth, lineHeight) {
        const words = text.split(' ');
        let line = '';
        let yPos = y;
        for (const word of words) {
            const testLine = line + word + ' ';
            const metrics = g.ctx.measureText(testLine);
            if (metrics.width > maxWidth && line !== '') {
                g.ctx.fillText(line.trim(), x, yPos);
                line = word + ' ';
                yPos += lineHeight;
            } else {
                line = testLine;
            }
        }
        g.ctx.fillText(line.trim(), x, yPos);
    }

    // FUN_00409372 (rwg_functions.c:11804) GameView::Update
    //   parent Update; MarkDirty; controller->Update() (+0xb8 vtable[0]);
    //   FUN_004093d9 (input poll, pending button); FUN_004091b8 (dog tick).
    update() {
        // Pause the field while an HTML / hint modal is displayed. The original
        // dialog openers set state+4 = 1 and +0xd = 0 (FUN_0040bce7 rwg:14103-14104,
        // FUN_0041e97b rwg:37769-37770, FUN_0041e9f1 rwg:37820-37821).
        const modalShown = !!((this.mHintController && this.mHintController.isShown())
            || HtmlDialogs.isOpen());
        if (modalShown) this.mPauseTextShown = false;
        if (modalShown && !this.mFieldController.mIsPaused) {
            this._pausedByHint = true;
            this.mFieldController.mIsPaused = true;
        } else if (this._pausedByHint && !modalShown) {
            this._pausedByHint = false;
            this.mFieldController.mIsPaused = false;
        }

        this.mFieldController.update();

        // Open the HTML level-end dialog once when the flag first trips.
        // (Opened by the level logic in the original, not by GameView.)
        if (this.mFieldController.mIsLevelComplete) {
            if (!this._endShown) { this._endShown = true; this._openCompleteHtml(); }
        } else if (this.mFieldController.mIsLevelFailed) {
            if (!this._endShown) { this._endShown = true; this._openFailedHtml(); }
        } else {
            this._endShown = false;
        }
        // Risk cooldown tick — RiskController FUN_0041b901 is called from the
        // unpaused game update (rwg:7477).
        if (!this.mFieldController.mIsPaused
            && !this.mFieldController.mIsLevelComplete
            && !this.mFieldController.mIsLevelFailed) {
            this.mRiskController.update();
        }
        if (this.mShopDialog && this.mShopDialog.update) this.mShopDialog.update();

        // Contextual hint triggers. These belong to the hint controller
        // (FUN_00422228 / FUN_00422990 / FUN_00422a24), not to GameView — left
        // as is, not audited here.
        if (!this.mShownSickHint) {
            for (const c of this.mFieldController.mField.mChickens) {
                if (c.mIsAlive && c.mIsSick) {
                    this.mHintController.showHint(HintType.SICK_CHICKEN);
                    this.mShownSickHint = true;
                    break;
                }
            }
        }
        if (!this.mShownEggHint) {
            for (const gem of this.mFieldController.mField.mGems) {
                if (gem.mType === 4 && gem.mIsAlive) {
                    this.mHintController.showHint(HintType.COLLECT_EGG);
                    this.mShownEggHint = true;
                    break;
                }
            }
        }
        const fc = this.mFieldController;
        const chickens = fc.mField.mChickens.filter(c => c.mIsAlive);
        if (fc.mLevelConfig && fc.mLevelConfig.hasBuy) {
            this.mHintController.showHint(HintType.BUY_CHICKEN);
        }
        if (fc.mLevelConfig && fc.mLevelConfig.hasRavens) {
            const hasRooster = chickens.some(c => c.mType === 2 /* ROOSTER */);
            if (!hasRooster && chickens.length > 0) {
                this.mHintController.showHint(HintType.BUY_ROOSTER);
            }
        }
        const hungryMagic = chickens.some(c =>
            c.mType === 3 /* MAGIC */ && c.mIsAlive && c.mFoodCounter < 1500);
        if (hungryMagic) {
            const hasMagicEgg = fc.mField.mGems.some(g =>
                g.mIsAlive && g.mType === 4 && g.mEggType === 1);
            if (!hasMagicEgg) {
                this.mHintController.showHint(HintType.NEED_MAGIC_EGGS);
            }
        }

        // Mirror the ready flag onto FieldController for HUD draw
        // (risk icon shown when risk+9 != 0, rwg:13899).
        this.mFieldController.mRiskReady = this.mRiskController.isReady();
        super.update();

        // FUN_004093d9 rwg:11947-11950: a pending button id is executed via
        // FUN_0040bce7 on the next Update, then +0xc0 = -1.
        if (this.mPendingButton !== -1) {
            const id = this.mPendingButton;
            this.mPendingButton = -1;
            this._doButtonAction(id);
        }

        // Right-hold seed repeat — Hand controller FUN_0040cc71, called only
        // from the unpaused game update (rwg:7476).
        //   rwg:15890  tick (+0xc) += 1 every update
        //   rwg:15904-15917 right flag DAT_004fff01 held: fire when
        //                   last(+0x10) + 0x14 < tick, then last = tick
        //   rwg:16199-16204 fire drops seeds only in hand mode 0 and y >= 0x15f (351)
        if (!this.mFieldController.mIsPaused
            && !this.mFieldController.mIsLevelComplete
            && !this.mFieldController.mIsLevelFailed) {
            this.mHandTick++;
            if (this.mMouseRightDown && !this.mShowDialog) {
                if (this.mHandLastActionTick + 0x14 < this.mHandTick) {
                    this.mHandLastActionTick = this.mHandTick;
                    if (this.mHand.mMode === HandMode.SEEDS && this.mHand.mY >= 0x15f) {
                        // Seed drop FUN_0041bfe2 (rwg:34299) charges the money
                        // object via FUN_00403e23; the charged amount is a
                        // float->int conversion — UNKNOWN — not found in
                        // decompiled. $1 per drop left as is.
                        if (this.mFieldController.mMoney > 0) {
                            this.mFieldController.mMoney--;
                            this.mFieldController.mField.dropSeeds(
                                this.mHand.mX, this.mHand.mY,
                                this.mFieldController.mSeedCount,
                                this.mFieldController.mSeedCalories);
                        }
                    }
                }
            }
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

    // FUN_0040bdf2 (rwg_functions.c:14177) GameView::MouseMove — stores the
    // mouse position (FUN_0040be96). The auto-cursor below is the Hand
    // controller's job (FUN_0040cc71 rwg:15924-16020) and is not audited here.
    mouseMove(x, y) {
        if (this.mUpgradeDialog && this.mUpgradeDialog.mouseMove) {
            if (this.mUpgradeDialog.mouseMove(x, y)) return;
        }
        if (this.mOptionsDialog && this.mOptionsDialog.mouseMove) {
            if (this.mOptionsDialog.mouseMove(x, y)) return;
        }
        if (this.mShopDialog && this.mShopDialog.mouseMove) {
            this.mShopDialog.mouseMove(x, y);
        }
        if (this.mHintController && this.mHintController.handleMouseMove) {
            this.mHintController.handleMouseMove(x, y);
        }
        this.mHand.move(x, y);
        // HUD button hover state read by FieldController.drawHUD.
        this.mFieldController.mHudHoverX = x;
        this.mFieldController.mHudHoverY = y;

        // Auto-cursor: only below the top panel (FUN_0040cc71 rwg:15944: 0x82 < y).
        if (y > 0x82 && !this.mShowDialog
            && !this.mFieldController.mIsLevelComplete
            && !this.mFieldController.mIsLevelFailed) {
            let newMode = HandMode.SEEDS;
            for (const c of this.mFieldController.mField.mChickens) {
                if (c.mIsAlive && c.mIsSick && !c.mIsCarried) {
                    const inX = Math.abs(c.mX - x) <= 25;
                    const inY = (y >= c.mY - 70 && y <= c.mY + 15);
                    if (inX && inY) {
                        newMode = HandMode.CURE;
                        break;
                    }
                }
            }
            const fc = this.mFieldController;
            const gunMode = (fc.mGunPower > 1 && fc.mGunArea) ? HandMode.GUN_POWER_AREA
                : fc.mGunPower > 1 ? HandMode.GUN_POWER
                : fc.mGunArea     ? HandMode.GUN_AREA
                : HandMode.GUN;
            if (newMode === HandMode.SEEDS) {
                for (const r of this.mFieldController.mField.mRavens) {
                    if (r.mIsAlive && r.mState !== 3 /* SCARED */ && r.contains(x, y)) {
                        newMode = gunMode;
                        break;
                    }
                }
            }
            if (newMode === HandMode.SEEDS) {
                for (const w of this.mFieldController.mField.mWolves || []) {
                    if (!w.mIsAlive) continue;
                    if (Math.abs(w.mX - x) <= 60 && Math.abs(w.mY - y) <= 50) {
                        newMode = gunMode;
                        break;
                    }
                }
            }
            this.mHand.setMode(newMode);
        }

        super.mouseMove(x, y);
    }

    // FUN_0040bd72 (rwg_functions.c:14135) GameView::MouseDown
    //   clickCount 1/2 -> left flag DAT_004fff00 = 1; 3/-1/-2 -> right flag DAT_004fff01 = 1.
    // The left edge is consumed by FUN_004093d9 (rwg:11870-11883):
    //   FUN_00409ba0 shop slots -> else FUN_00409c92 egg row -> else FUN_00409c38 risk icon.
    // MENU/SELL/BUY are ButtonWidgets (fire ButtonDepress) — here hit-tested directly.
    mouseDown(x, y, btn) {
        // Legacy canvas modals (never assigned now; kept for API).
        if (this.mUpgradeDialog && this.mUpgradeDialog.isShown()) {
            this.mUpgradeDialog.mouseDown(x, y, btn);
            return true;
        }
        if (this.mShopDialog && this.mShopDialog.isShown()) {
            this.mShopDialog.mouseDown(x, y, btn);
            return true;
        }
        if (this.mOptionsDialog && this.mOptionsDialog.isShown()) {
            this.mOptionsDialog.mouseDown(x, y, btn);
            return true;
        }
        // HintDialog modal — consumes all clicks while shown
        if (this.mHintController.isShown()) {
            if (btn === 0) this.mHintController.handleClick(x, y);
            return true;
        }
        // Level completed / failed: the HTML dialogs own the input.
        if (this.mFieldController.mIsLevelComplete || this.mFieldController.mIsLevelFailed) {
            return true;
        }
        if (this.mShowDialog) return true;

        if (btn === 2) {
            // FUN_0040bd72 rwg:14144-14146 -> FUN_0040be50(1). Seeds are dropped
            // by the repeat in update() (FUN_0040cc71 rwg:15904-15917).
            this.mMouseRightDown = true;
            return true;
        }
        if (btn !== 0) return true;

        const fc = this.mFieldController;
        const cfg = fc.mLevelConfig;

        // --- FUN_00409ba0 (rwg:12469) shop slots ---
        // Original: for i < FUN_0040bfa0() (shop-slot vector size), rect = slot
        // image (w x h) at (w*i, 0); FUN_0041e8f5 buys; SOUND_CHICK_BUY
        // (DAT_004fed80, rwg:31750) on success; handled either way.
        // Slot count/model follow FieldController.drawHUD (5 slots on hasBuy
        // levels, 80x81 = shop_slot_*.png size).
        if (cfg && cfg.hasBuy) {
            for (let i = 0; i < 5; i++) {
                if (rectContains({ x: 80 * i, y: 0, w: 80, h: 81 }, x, y)) {
                    fc.buyChick(i);
                    return true;
                }
            }
        }

        // --- MENU / SELL / BUY widgets (FUN_0040bbea rwg:14005-14012) ---
        // SELL/BUY visible iff level+0x18 / +0x19 (FUN_0040a3d6 rwg:13293-13299).
        if (rectContains(MENU_RECT, x, y)) {
            this.buttonDepress(BTN_MENU);
            return true;
        }
        if (cfg && cfg.hasSell && rectContains(SELL_RECT, x, y)) {
            this.buttonDepress(BTN_SELL);
            return true;
        }
        if (cfg && cfg.hasBuy && rectContains(BUY_RECT, x, y)) {
            this.buttonDepress(BTN_BUY);
            return true;
        }

        // --- FUN_00409c92 (rwg:12552) egg row ---
        const eggs = this._getEggRow();
        for (let i = 0; i < eggs.length; i++) {
            if (rectContains(this._eggSlotRect(i), x, y)) {
                // FUN_00406e6a (rwg:8574) toggles brooding for this egg.
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
        // FieldController.handleClick (not audited here).
        if (this.mHand.isOverField()
            && !fc.mIsPaused
            && !fc.mIsLevelComplete
            && !fc.mIsLevelFailed) {
            this.mHandLastActionTick = this.mHandTick;
            fc.handleClick(x, y, this.mHand.getModeString());
            if (fc.addClickRipple) {
                fc.addClickRipple(x, y, '#ffe080');
            }
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
        if (btn === 2) this.mMouseRightDown = false;
        if (this.mOptionsDialog && this.mOptionsDialog.mouseUp) {
            this.mOptionsDialog.mouseUp(x, y, btn);
        }
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
        if (this.mUpgradeDialog && this.mUpgradeDialog.isShown()) {
            this.mUpgradeDialog.keyDown(key);
            return true;
        }
        if (this.mShopDialog && this.mShopDialog.isShown()) {
            this.mShopDialog.keyDown(key);
            return true;
        }
        if (this.mOptionsDialog && this.mOptionsDialog.isShown()) {
            this.mOptionsDialog.keyDown(key);
            return true;
        }
        if (this.mHintController.isShown()) return true;
        if (this.mShowDialog) return true;

        const fc = this.mFieldController;

        // FUN_0040907e (rwg:11479-11498): edge-triggered space toggle.
        if (key === ' ' || key === 'Spacebar') {
            if (this._spaceHeld) return true;
            this._spaceHeld = true;
            if (fc.mIsLevelComplete || fc.mIsLevelFailed) return true;
            this.mPauseTextShown = false;               // +0xd = 0
            fc.mIsPaused = !fc.mIsPaused;               // +4 = !+4
            // When pausing, FUN_004090b9 -> FUN_0040cc01(hand) resets the
            // cursor mode; the mode value (EAX) is UNKNOWN — not found in
            // decompiled, so the hand mode is left unchanged.
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
            // rwg:11890-11895: Shift+ESC calls app vtable+0xa0 — target
            // UNKNOWN — not found in decompiled; not ported.
            // rwg:11897-11900: ESC -> FUN_0040bce7 (MENU). The id argument is
            // dropped by the decompiler; the MENU branch (case 1) is the only
            // one that matches an ESC "menu" key — UNKNOWN beyond that.
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
            if (!!egg.mBrooding !== on) fc.startEggBrooding(egg);
        }
    }

    // FUN_00406f87 (rwg_functions.c:8671): toggle every egg of the given type
    // that is not brooding yet.
    _broodEggsOfType(type) {
        const fc = this.mFieldController;
        for (const egg of this._getEggRow()) {
            if (this._eggChickType(egg) === type && !egg.mBrooding) {
                fc.startEggBrooding(egg);
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
            onRestart: () => { this.startLevel(this.mFieldController.mCurrentLevel); },
        });
    }

    // LEVEL COMPLETED — HTML dialog (FUN_0040dc45) opened on the flag transition.
    _openCompleteHtml() {
        const fc = this.mFieldController;
        const core = this.mGameApp.mCore;
        const isBonus = fc.mLevelConfig && fc.mLevelConfig.isBonus;
        const level = fc.mCurrentLevel;
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
                bestlabel: 'Best time - by ' + ((core && core.mCurrentName) || ''),
                besttime: fmt(core && core.getBestTime ? core.getBestTime(level) : 0),
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
    // remove dialog, then if dialog+0xd8 == 0 FUN_004088d0(level + 1) (shows
    // SelectLevelView FUN_0041ccf8 for the next level, which owns the upgrade
    // offer), else FUN_00408c24 (win view FUN_0042474a).
    // DISCREPANCY (not changed): this port starts the next level directly and
    // offers the upgrade every 3 levels; the real upgrade condition lives in
    // SelectLevelView (not ported) — UNKNOWN — not found in decompiled here.
    _onLevelContinue() {
        if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play(); // rwg:17098
        HtmlDialogs.close('level-complete');
        const finishedLvl = this.mFieldController.mCurrentLevel;
        if (finishedLvl >= 50) { if (this.mGameApp.showWin) this.mGameApp.showWin(); return; }
        const nextLvl = finishedLvl + 1;
        if ((nextLvl - 1) % 3 === 0) this._showUpgradeDialog(() => this.startLevel(nextLvl));
        else this.startLevel(nextLvl);
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
                    this.startLevel(fc.mCurrentLevel);
                },
                mainmenu: () => {
                    if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play(); // rwg:17473
                    HtmlDialogs.close('level-failed');
                    this.mGameApp.showMainMenu();
                },
            },
        });
    }

    // FUN_00423f8a UpgradeSelectDialog — HTML. See _onLevelContinue note.
    _showUpgradeDialog(onComplete) {
        const fc = this.mFieldController;
        const core = this.mGameApp.mCore;
        const tier = Math.min(UPGRADE_TIERS.length - 1, Math.floor((fc.mCurrentLevel - 1) / 3));
        const opts = UPGRADE_TIERS[tier] || UPGRADE_TIERS[0];
        openUpgradeChoices(opts, opt => {
            if (core && opt.key) {
                core.mUpgradesPurchased = core.mUpgradesPurchased || [];
                if (!core.mUpgradesPurchased.includes(opt.key)) core.mUpgradesPurchased.push(opt.key);
                if (core.save) core.save();
            }
            if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
            this._applyUpgradeEffect(opt.key);
            HtmlDialogs.close('upgrade');
            if (onComplete) onComplete();
        });
    }

    // Apply gameplay effect for the chosen upgrade (port-specific glue; the
    // effect values are not audited here). `silent` skips the jingle when
    // re-applying the saved list at level start.
    _applyUpgradeEffect(key, silent = false) {
        const fc = this.mFieldController;
        if (!fc) return;
        switch (key) {
            case 'house_1':
                fc.mPlayerHouseUpgrade = Math.max(fc.mPlayerHouseUpgrade || 0, 1);
                fc.mField.mUpgradeLevel = Math.max(fc.mField.mUpgradeLevel, 1);
                break;
            case 'house_2':
                fc.mPlayerHouseUpgrade = Math.max(fc.mPlayerHouseUpgrade || 0, 2);
                fc.mField.mUpgradeLevel = Math.max(fc.mField.mUpgradeLevel, 2);
                break;
            case 'seeds_1':
                fc.mSeedCalories = Math.max(fc.mSeedCalories, 50);
                break;
            case 'seeds_2':
                fc.mSeedCalories = Math.max(fc.mSeedCalories, 80);
                break;
            case 'gun_1':
                fc.mGunPower = Math.max(fc.mGunPower || 1, 2);
                break;
            case 'gun_area':
                fc.mGunArea = true;
                break;
        }
        if (!silent && SOUNDS && SOUNDS.SOUND_FIELD_UPGRADE) {
            SOUNDS.SOUND_FIELD_UPGRADE.play();
        }
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
