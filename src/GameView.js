// Port of Sexy::GameView - vtable at 004dce2c
// and related dialogs
//
// Key functions:
//   FUN_004091f9 - GameView constructor (56 lines)
//   FUN_00409306 - GameView::draw (29 lines)
//   FUN_0040dc45 - LevelCompletedDialog (63 lines)
//   FUN_0040e0ea - LevelFailedDialog (52 lines)
//   FUN_0040dd6a - LevelCompletedDialog::buttonDepress
//   FUN_0040e217 - LevelFailedDialog::buttonDepress

import { Widget } from './SexyApp.js';
import { FieldController } from './FieldController.js';
import { Hand, HandMode } from './Hand.js';
import { RiskController } from './RiskController.js';
import { HintController, HintType } from './HintController.js';
import { IMAGES, SOUNDS } from './Res.js';
// Static imports for the modal dialogs — eliminates the dynamic-import delay
// on first open. These modules don't form import cycles with GameView.
import { OptionsDialog } from './OptionsDialog.js';
import { UpgradeSelectDialog, UPGRADE_TIERS, openUpgradeChoices } from './UpgradeSelectDialog.js';
import { ShopDialog, SpecialShopDialog } from './ShopDialogs.js';
import { drawFitText } from './TextUtil.js';
import { HtmlDialogs } from './HtmlDialogs.js';
import { SoundManager } from './SexyApp.js';

// Button IDs matching decompiled constants. Most actions handled via direct
// modal dialog clicks now (rather than ButtonWidget routing), so most of these
// IDs are unused; keep only ones still referenced.
const BTN_MENU = 1000;

export class GameView extends Widget {
    // Port of Sexy::GameView - vtable at 004dce2c
    // Constructor: FUN_004091f9

    constructor(gameApp) {
        super();
        this.mGameApp = gameApp;
        this.mFieldController = new FieldController(gameApp);
        this.mHand = new Hand();
        this.mRiskController = new RiskController();
        this.mHintController = new HintController(gameApp && gameApp.mCore);
        this.mShowDialog = null;
        this.mShowRiskResult = null;
        this.resize(0, 0, 800, 600);

        // mMouseLeftDown was previously tracked but never read — left-click
        // actions are one-shot via mouseDown handlers. Only the right-button
        // hold-to-feed loop needs continuous-press state.
        this.mMouseRightDown = false;      // right mouse held (continuous corn)
        this.mFeedTimer = 0;               // ticks since last seed drop
        this.mFeedInterval = 20;           // drop seeds every 20 ticks while held

        // Create UI buttons
        this._createButtons();
    }

    _createButtons() {
        // No bottom toolbar — cursor auto-changes based on what's under the mouse
        // From decompiled FUN_0040cc01: cursor mode set automatically
    }

    startLevel(level) {
        this.mFieldController.startLevel(level);
        // Re-apply persisted upgrades from the player profile. Without this,
        // a player who chose `gun_1` / `house_2` / `seeds_2` in an earlier
        // session would have their list saved (Core.mUpgradesPurchased) but
        // none of the gameplay effects (mPlayerHouseUpgrade, mSeedCalories,
        // mGunPower, mGunArea) restored on FieldController.startLevel.
        const purchased = (this.mGameApp && this.mGameApp.mCore
            && this.mGameApp.mCore.mUpgradesPurchased) || [];
        for (const key of purchased) {
            this._applyUpgradeEffect(key, /*silent*/ true);
        }
        this.mShowDialog = null;
        this.mShowRiskResult = null;
        this.mLevelFadeTimer = 30;       // brief fade-in
        // Reset per-level hint trackers so hints fire again on restart.
        this.mShownSickHint = false;
        this.mShownEggHint = false;
        this.mFirstEgg = null;
        this.mFirstEggHintTimer = 0;
        this.mFirstSickChick = null;
        this.mFirstSickHintTimer = 0;
        // UFO is NOT used in regular gameplay in the original. The IMAGE_UFO
        // asset is referenced by a separate view (FUN_0041d1f8 / FUN_0041cb58
        // — probably credits or a special outro), not by FUN_004093ed
        // (GameView::draw). Our earlier "first-raven-intro UFO on L4" was a
        // JS-port speculation that didn't exist in the original.
        this.mUfoIntroProgress = 0;
        // Wolf intro warning on level 26 (first wolves) per level description.
        if (level === 26 || level === 27 || level === 28) {
            this.mWolfIntroTimer = 200;
        } else {
            this.mWolfIntroTimer = 0;
        }

        // IntroductionDialog (FUN_0040d936:16823) — gated by level == 1 AND
        // maxUnlocked == 1 per FUN_0041d22e:35567 (the SelectLevelDialog
        // gating: intro shows only when the player has never beaten L1).
        // After L1 is completed, mMaxLevelReached becomes 2+ and the intro
        // stops appearing on subsequent L1 plays — matching the original.
        const maxReached = (this.mGameApp.mCore && this.mGameApp.mCore.mMaxLevelReached) || 1;
        if (level === 1 && !this._introShown && maxReached <= 1) {
            this._introShown = true;
            // FUN_0040d936:16855 — *(this+0x15c) = 1 initially. The draw fn
            // FUN_0040d9ef:16885 shows IMAGE_INTRODUCTION_LETTER when byte!=0,
            // so the LETTER page (parchment + "One day, you receive a letter
            // from your grandparents") shows first, then click toggles to the
            // INTRODUCTION panel (chickens/coins/upgrades/enemies grid).
            // Verified vs screenshots 10 (letter, shown first) → 11 (panel).
            // Now rendered as HTML dialogs (intro-letter → intro-panel); the
            // canvas _drawIntroduction path stays disabled (mIntroPage < 0).
            this.mIntroPage = -1;
            this._showIntroHtml();
        } else {
            this.mIntroPage = -1; // no intro
        }

        // Trigger first-time hints per decompiled hint table (rwg_functions.c:41991+)
        this._triggerLevelHint(level);
    }

    // FUN_0040d936:16823 — IntroductionDialog. Box (105, 20, 590, 560).
    // Page 0: IMAGE_INTRODUCTION (DAT_00500018).
    // Page 1: IMAGE_INTRODUCTION_LETTER (DAT_0050001c) + overlay text.
    // Click toggles page; second click dismisses.
    _drawIntroduction(g) {
        if (this.mIntroPage < 0) return;
        // Modal scrim
        g.setColor(0, 0, 0, 150);
        g.fillRect(0, 0, 800, 600);

        // Page byte at this+0x15c defaults to 1 (rwg:16855): the LETTER page
        // (IMAGE_INTRODUCTION_LETTER, rwg:16891) shows FIRST; page 0
        // (IMAGE_INTRODUCTION, rwg:16886) after a click. Both images are drawn
        // at NATIVE size (letter.jpg 307x372, Introduction.jpg 616x462 — verified
        // via sips); the old code scaled them, distorting the parchment.
        const isLetter = this.mIntroPage === 1;
        const imgKey = isLetter ? 'IMAGE_INTRODUCTION_LETTER' : 'IMAGE_INTRODUCTION';
        const pageImg = IMAGES[imgKey];
        let btnX, btnY, btnW, btnH;

        if (isLetter) {
            // Letter page: dialog frame (105,20,590,560 — rwg:16856), 9-sliced so
            // the title plate stays fixed at top; caption in the plate; parchment
            // centered at native size below; wide OK bar at the bottom.
            const bx = 105, by = 20, bw = 590, bh = 560;
            const plate = g.drawDialogBox(IMAGES.IMAGE_DIALOG_BOX, bx, by, bw, bh);
            // Caption (string rwg:16894) centered IN the plate.
            // FONT_DLG_LINES = ArialBlack12 (resources.xml:62).
            g.ctx.fillStyle = '#fff';
            g.ctx.font = 'bold 13px "Arial Black", Arial, sans-serif';
            g.ctx.textAlign = 'center';
            g.ctx.textBaseline = 'middle';
            g.ctx.fillText('One day, you receive a letter from your grandparents',
                bx + bw / 2, plate.plateCenterY);
            g.ctx.textBaseline = 'alphabetic';
            // Parchment at native size, horizontally centered, below the plate.
            if (pageImg && pageImg.img && g._isReady(pageImg.img)) {
                const natW = pageImg.img.naturalWidth || 307;
                const natH = pageImg.img.naturalHeight || 372;
                const ix = bx + (bw - natW) / 2;
                const iy = plate.plateBottomY + 18;
                g.ctx.drawImage(pageImg.img, ix, iy, natW, natH);
            }
            btnW = bw - 52; btnH = 31; btnX = bx + 26; btnY = by + bh - btnH - 13;
        } else {
            // Introduction panel: the image is its own framed panel (616x462),
            // wider than the dialog frame — draw it centered on screen at native
            // size (no separate dialog frame), OK bar across its lower edge.
            let ix = 92, iy = 60, natW = 616, natH = 462;
            if (pageImg && pageImg.img && g._isReady(pageImg.img)) {
                natW = pageImg.img.naturalWidth || 616;
                natH = pageImg.img.naturalHeight || 462;
                ix = Math.round((800 - natW) / 2);
                iy = Math.round((600 - natH) / 2) - 8;
                g.ctx.drawImage(pageImg.img, ix, iy, natW, natH);
            }
            btnW = natW - 80; btnH = 32; btnX = ix + 40; btnY = iy + natH - btnH - 12;
        }

        // OK button (slot 0, "OK" rwg:16840)
        const btnImg = IMAGES.IMAGE_DIALOG_BUTTON;
        const btnOverImg = IMAGES.IMAGE_DIALOG_BUTTON_OVER;
        const hx = this.mHand.mX, hy = this.mHand.mY;
        const over = hx >= btnX && hx < btnX + btnW
            && hy >= btnY && hy < btnY + btnH;
        const useImg = (over && btnOverImg && btnOverImg.img) ? btnOverImg : btnImg;
        if (useImg && useImg.img && g._isReady(useImg.img)) {
            g.ctx.drawImage(useImg.img, btnX, btnY, btnW, btnH);
        } else {
            g.setColor(80, 160, 40, 255);
            g.fillRect(btnX, btnY, btnW, btnH);
        }
        g.ctx.fillStyle = '#fff';
        g.ctx.font = '12px "Arial Black", Arial, sans-serif'; // FONT_DLG_BUTTONS=ArialBlack12 (resources.xml:63)
        g.ctx.textAlign = 'center';
        g.ctx.fillText('OK', btnX + btnW / 2, btnY + btnH / 2 + 4);
        g.ctx.textAlign = 'left';
    }

    // Maps level to its initial hint, per the strings cited in DECOMPILED_MAP.md
    _triggerLevelHint(level) {
        switch (level) {
            case 1: this.mHintController.showHint(HintType.FIRST_CHICKENS); break;
            case 2: this.mHintController.showHint(HintType.COLLECT_EGG); break;
            case 3: this.mHintController.showHint(HintType.HATCH_GOAL); break;
            case 4: this.mHintController.showHint(HintType.RAVEN_WARNING); break;
            // L5 task ($5000 earn) — the verbatim hint from FUN_00422a24:42718
            // explains the SELL mechanic AND the sell-then-buy-young strategy.
            // SELL_CHICKENS ("Click the button to sell chickens") is the
            // shorter general-purpose tooltip used by other levels.
            case 5: this.mHintController.showHint(HintType.SELL_FOR_BONUS); break;
            // L7 introduces the risk/surprise system (rwg_functions.c:42749).
            // The L7 description ("Feel clucky? Click on the question mark
            // button.") expects this hint to fire on first L7 entry to explain
            // what the new ? icon does.
            case 7: this.mHintController.showHint(HintType.SURPRISE_OPTION); break;
        }
    }

    // Intro shown as HTML dialogs: letter page first (screenshot 10), then the
    // introduction panel (screenshot 11). The field stays paused via the
    // HtmlDialogs.isOpen() check in update().
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

    // FUN_00409306 - GameView::draw (29 lines)
    draw(g) {
        // Apply screen shake (wolf attacks etc.). Translate the entire field
        // viewport by a small random offset proportional to mShakeMag.
        const shake = this.mFieldController.getShakeOffset
            ? this.mFieldController.getShakeOffset()
            : { x: 0, y: 0 };
        if (shake.x || shake.y) {
            g.ctx.save();
            g.ctx.translate(shake.x, shake.y);
        }

        // Draw field
        this.mFieldController.mField.draw(g);

        // Pop shake transform before drawing HUD (HUD stays steady).
        if (shake.x || shake.y) g.ctx.restore();

        // Draw HUD
        this.mFieldController.drawHUD(g);

        // Draw child widgets (slot backgrounds)
        super.draw(g);

        // No bottom toolbar — cursor auto-changes

        // Draw risk result popup. Wraps the description across lines so
        // long results (e.g. "Your new scarecrow has frightened away all
        // of the ravens for a few minutes.") don't overflow the box or
        // canvas edge.
        if (this.mShowRiskResult) {
            g.setColor(0, 0, 0, 200);
            g.fillRect(150, 200, 500, 100);
            g.ctx.fillStyle = 'yellow';
            g.ctx.font = '15px Arial Black, Arial, sans-serif';
            g.ctx.textAlign = 'center';
            this._drawWrappedText(g, this.mShowRiskResult, 400, 232, 470, 20);
            g.ctx.textAlign = 'left';
        }

        // Draw click ripples (under floating texts)
        if (this.mFieldController.drawClickRipples) {
            this.mFieldController.drawClickRipples(g);
        }
        // Draw floating score texts
        this.mFieldController.drawFloatingTexts(g);
        // Particles (collect bursts + level-complete confetti)
        if (this.mFieldController.drawParticles) {
            this.mFieldController.drawParticles(g);
        }

        // Hint pointer arrow at first sick chicken
        if (this.mFirstSickChick && this.mFirstSickChick.mIsAlive
            && this.mFirstSickChick.mIsSick && this.mFirstSickHintTimer > 0) {
            const arrow = IMAGES.IMAGE_HINT_POINTER_DOWN;
            if (arrow && arrow.img) {
                const w = arrow.mWidth || 32;
                const h = arrow.mHeight || 32;
                const bob = Math.sin(this.mFirstSickHintTimer / 6) * 3;
                g.ctx.drawImage(arrow.img, this.mFirstSickChick.mX - w / 2,
                    this.mFirstSickChick.mY - 70 + bob, w, h);
            }
        }
        // Hint pointer arrow at first egg
        if (this.mFirstEgg && this.mFirstEgg.mIsAlive && this.mFirstEggHintTimer > 0) {
            const arrow = IMAGES.IMAGE_HINT_POINTER_DOWN;
            if (arrow && arrow.img) {
                const w = arrow.mWidth || 32;
                const h = arrow.mHeight || 32;
                const bob = Math.sin(this.mFirstEggHintTimer / 6) * 3;
                g.ctx.drawImage(arrow.img, this.mFirstEgg.mX - w / 2,
                    this.mFirstEgg.mY - 60 + bob, w, h);
            } else {
                g.ctx.fillStyle = '#ffd700';
                g.ctx.font = 'bold 32px Arial Black';
                g.ctx.textAlign = 'center';
                g.ctx.fillText('▼', this.mFirstEgg.mX, this.mFirstEgg.mY - 30);
                g.ctx.textAlign = 'left';
            }
        }

        // No bottom bar — clean field view

        // Draw dialog overlays
        if (this.mShowDialog) {
            g.setColor(0, 0, 0, 150);
            g.fillRect(0, 0, 800, 600);
            this._drawDialog(g, this.mShowDialog);
        }

        // Draw HintDialog modal on top of everything except level-end overlays
        this.mHintController.draw(g);

        // Draw IntroductionDialog (gated by level==1)
        this._drawIntroduction(g);

        // OptionsDialog (in-game)
        if (this.mOptionsDialog) this.mOptionsDialog.draw(g);
        // ShopDialog / SpecialShopDialog
        if (this.mShopDialog) this.mShopDialog.draw(g);
        // UpgradeSelectDialog (after level transitions)
        if (this.mUpgradeDialog) this.mUpgradeDialog.draw(g);

        // Wolf intro warning text
        if (this.mWolfIntroTimer > 0) {
            // Timer starts at 200; fade in over first 30 ticks, fade out over
            // last 50, full opacity in between.
            const elapsed = 200 - this.mWolfIntroTimer;
            const fadeIn = Math.min(1, elapsed / 30);
            const fadeOut = Math.min(1, this.mWolfIntroTimer / 50);
            const a = Math.min(fadeIn, fadeOut);
            g.ctx.globalAlpha = a;
            g.setColor(0, 0, 0, 180);
            g.fillRect(0, 200, 800, 80);
            g.ctx.fillStyle = '#ff6644';
            g.ctx.font = 'bold 28px Arial Black, Arial, sans-serif';
            g.ctx.textAlign = 'center';
            g.ctx.fillText('Wolves are coming!', 400, 250);
            g.ctx.font = '14px Arial, sans-serif';
            g.ctx.fillStyle = '#fff';
            g.ctx.fillText('Shoot them repeatedly — they take multiple hits to kill', 400, 270);
            g.ctx.textAlign = 'left';
            g.ctx.globalAlpha = 1;
            // Tick happens in update() — keeps timings independent of display fps.
        }

        // UFO removed from gameplay — IMAGE_UFO is loaded by Res.js but only
        // referenced by a separate view in the original (FUN_0041cb58, called
        // from FUN_0041d1f8 — credits or outro screen, NOT GameView::draw).

        // First-level controls hint (small, fades out)
        if (this.mFieldController.mCurrentLevel === 1
            && this.mFieldController.mTimeElapsed < 8000
            && !this.mFieldController.mIsPaused
            && !this.mShowDialog
            && !this.mHintController.isShown()) {
            const alpha = Math.min(1, (8000 - this.mFieldController.mTimeElapsed) / 2000);
            g.ctx.globalAlpha = alpha * 0.85;
            g.ctx.fillStyle = '#fff';
            g.ctx.font = '12px Arial, sans-serif';
            g.ctx.textAlign = 'center';
            g.ctx.fillText('Right-click=corn · Left-click=collect · 1=feed 2=cure 3=gun · B=buy S=sell · Space=pause · ESC=menu',
                400, 580);
            g.ctx.textAlign = 'left';
            g.ctx.globalAlpha = 1;
        }

        // GAME PAUSED overlay (rwg_functions.c:13973-13980)
        // Hidden whenever any modal is up — those own the screen and the
        // pause is implicit (we auto-pause for hint, intro is its own modal).
        const anyModal = this.mShowDialog
            || this.mShopDialog
            || this.mOptionsDialog
            || this.mUpgradeDialog
            || (this.mHintController && this.mHintController.isShown())
            || this.mIntroPage >= 0;
        if (this.mFieldController.mIsPaused
            && !this.mFieldController.mIsLevelComplete
            && !this.mFieldController.mIsLevelFailed
            && !anyModal) {
            g.setColor(0, 0, 0, 140);
            g.fillRect(0, 0, 800, 600);
            // FONT_24 (DAT_004fff1c) for "GAME PAUSED"
            g.ctx.fillStyle = '#ffd700';
            g.ctx.font = 'bold 28px Arial Black, Arial, sans-serif';
            g.ctx.textAlign = 'center';
            g.ctx.fillText('GAME PAUSED', 400, 290);
            // FONT_20 (DAT_004fff18) for "press space to continue"
            g.ctx.fillStyle = '#fff';
            g.ctx.font = '18px Arial, sans-serif';
            g.ctx.fillText('press space to continue', 400, 330);
            g.ctx.textAlign = 'left';
        }

        // Level fade-in (timer ticks in update for display-fps independence)
        if (this.mLevelFadeTimer > 0) {
            const a = this.mLevelFadeTimer / 30;
            g.setColor(0, 0, 0, Math.floor(255 * a));
            g.fillRect(0, 0, 800, 600);
        }

        // Brief gold/red flash on level-complete or fail (first 60 ticks).
        // Use a separate `_flashFired` flag so we don't fire the flash again
        // after the timer hits 0 (`(0 || 60)` would reset it every frame and
        // loop the flash forever). Timer ticks in update().
        if (this.mFieldController.mIsLevelComplete || this.mFieldController.mIsLevelFailed) {
            if (!this._flashFired) {
                this._flashFired = true;
                this.mLevelEndFlashTimer = 60;
            }
            if (this.mLevelEndFlashTimer > 0) {
                const a = this.mLevelEndFlashTimer / 60;
                if (this.mFieldController.mIsLevelComplete) {
                    g.setColor(255, 215, 0, Math.floor(180 * a));
                } else {
                    g.setColor(255, 60, 60, Math.floor(180 * a));
                }
                g.fillRect(0, 0, 800, 600);
            }
        } else {
            this.mLevelEndFlashTimer = 0;
            this._flashFired = false;
        }

        // Level complete/failed are now HTML dialogs (opened from update() on
        // the flag transition); the canvas _drawLevelComplete/_drawLevelFailed
        // are no longer drawn. The end-of-level flash above still plays.

        // Draw hand cursor last (on top), but only when no modal is active
        // AND the mouse is over the playable field — over the HUD strip the
        // player is clicking buttons (MENU/BUY/SELL/shop slots/egg boxes),
        // so we want a regular pointer there instead of the seeds/gun icon.
        const modalShown = this.mShowDialog
            || this.mShopDialog
            || this.mOptionsDialog
            || this.mUpgradeDialog
            || (this.mHintController && this.mHintController.isShown())
            || this.mIntroPage >= 0
            || this.mFieldController.mIsLevelComplete
            || this.mFieldController.mIsLevelFailed;
        const overField = this.mHand.isOverField();
        if (!modalShown && overField) {
            this.mHand.draw(g);
        }
        // Toggle native browser cursor for clarity
        if (this.mGameApp && this.mGameApp.mCanvas) {
            this.mGameApp.mCanvas.style.cursor = (modalShown || !overField) ? 'default' : 'none';
        }
    }

    // FUN_0040dc45 (rwg_functions.c:17009). DECOMPILED_MAP.md section 13.
    // Box normal: (150, 100, 500, 400). Bonus: (175, 150, 450, 300).
    // Title: "LEVEL COMPLETED" or "BONUS LEVEL COMPLETED".
    // Body labels: "Your time" + "Ace time" (drawn by FUN_0040dde4 line 17117).
    // Slot 0 button: "CONTINUE".
    _drawLevelComplete(g) {
        g.setColor(0, 0, 0, 150);
        g.fillRect(0, 0, 800, 600);

        const isBonus = this.mFieldController.mLevelConfig
            && this.mFieldController.mLevelConfig.isBonus;
        const bx = isBonus ? 175 : 150;
        const by = isBonus ? 150 : 100;
        const bw = isBonus ? 450 : 500;
        const bh = isBonus ? 300 : 400;

        // Box background — 9-sliced so the title plate stays a fixed size at top.
        const plate = g.drawDialogBox(IMAGES.IMAGE_DIALOG_BOX, bx, by, bw, bh);

        // Title centered IN the top plate. Strings CONFIRMED rwg:17038
        // 'LEVEL COMPLETED' / 17036 'BONUS LEVEL COMPLETED'. FONT_DLG_HEADER
        // = ArialBlack14 (resources.xml:61). Gold measured from screenshot 17.
        g.ctx.fillStyle = '#ffd700';
        g.ctx.textAlign = 'center';
        g.ctx.textBaseline = 'middle';
        const title = isBonus ? 'BONUS LEVEL COMPLETED' : 'LEVEL COMPLETED';
        drawFitText(g.ctx, title, bx + bw / 2, plate.plateCenterY, bw - 50,
            'bold 18px "Arial Black", Arial, sans-serif');
        g.ctx.textBaseline = 'alphabetic';

        const fmt = (ms) => {
            if (!ms || ms <= 0) return '--:--';
            const s = Math.floor(ms / 1000);
            const m = Math.floor(s / 60);
            const r = s % 60;
            return m.toString().padStart(2, '0') + ':' + r.toString().padStart(2, '0');
        };

        if (isBonus) {
            // Bonus levels show a message instead of the time rows
            // (rwg_functions.c:17057-17068).
            const bonusText = this.mFieldController.mBonusAchieved
                ? "Perfect! You have got a bonus for the next level: one of special shop upgrades will be allowed at half price!"
                : "You haven't got a bonus";
            g.ctx.fillStyle = '#fff';
            g.ctx.font = '13px Arial, sans-serif';
            this._drawWrappedText(g, bonusText, bx + bw / 2, by + 120, bw - 60, 18);
        } else {
            // Three time rows: left label + right-aligned value.
            // Labels 'Your time' (rwg:17214), 'Ace time' (rwg:17223),
            // 'Best time - by <name>' (label text measured from screenshot 17 —
            // the "Best time - by " prefix is not a literal in FUN_0040dde4).
            // Value right edge = boxWidth - StringWidth - 0x32(50)
            // (rwg:17248/17258) => right-align at bx+bw-50. Line-3 label x literal
            // = 0xb6=182 = bx+32 (rwg:17264). Row y/step measured from screenshot 17.
            const core = this.mGameApp && this.mGameApp.mCore;
            const level = this.mFieldController.mCurrentLevel;
            const playerName = (core && core.mCurrentName) || '';
            const yourMs = this.mFieldController.mTimeElapsed || 0;
            const aceMs = this.mFieldController.mLevelAceTime || 0; // par UNKNOWN (table not ported)
            const bestMs = (core && core.getBestTime) ? core.getBestTime(level) : 0;
            const rows = [
                ['Your time', fmt(yourMs)],
                ['Ace time', fmt(aceMs)],
                ['Best time - by ' + playerName, fmt(bestMs)],
            ];
            const labelX = bx + 32;           // rwg:17264 line-3 label x=0xb6=182=bx+32
            const valueRight = bx + bw - 50;  // rwg:17248/17258 width-StringWidth-0x32
            const row0Y = by + 92, rowStep = 41; // screenshot 17
            g.ctx.font = '12px "Arial Black", Arial, sans-serif'; // FONT_DLG_LINES=ArialBlack12 (resources.xml:62)
            g.ctx.fillStyle = '#fff';
            for (let i = 0; i < rows.length; i++) {
                const y = row0Y + i * rowStep + 5;
                g.ctx.textAlign = 'left';
                g.ctx.fillText(rows[i][0], labelX, y);
                g.ctx.textAlign = 'right';
                g.ctx.fillText(rows[i][1], valueRight, y);
            }
        }
        g.ctx.textAlign = 'left';

        // CONTINUE button (slot 0, rwg:17032). Wide bottom bar; w/h/y measured
        // from screenshot 17 (green core spans box width minus ~30px margins).
        const btnW = bw - 60, btnH = 40;
        const btnX = bx + (bw - btnW) / 2;
        const btnY = by + bh - btnH - 24;
        const btnImg = IMAGES.IMAGE_DIALOG_BUTTON;
        const btnOverImg = IMAGES.IMAGE_DIALOG_BUTTON_OVER;
        const hx = this.mHand.mX, hy = this.mHand.mY;
        const overBtn = hx >= btnX && hx < btnX + btnW
            && hy >= btnY && hy < btnY + btnH;
        const useImg = (overBtn && btnOverImg && btnOverImg.img) ? btnOverImg : btnImg;
        if (useImg && useImg.img && g._isReady(useImg.img)) {
            g.ctx.drawImage(useImg.img, btnX, btnY, btnW, btnH);
        } else {
            g.setColor(80, 160, 40, 255);
            g.fillRect(btnX, btnY, btnW, btnH);
        }
        g.ctx.fillStyle = '#fff';
        g.ctx.font = '12px "Arial Black", Arial, sans-serif'; // FONT_DLG_BUTTONS=ArialBlack12 (resources.xml:63)
        g.ctx.textAlign = 'center';
        g.ctx.fillText('CONTINUE', btnX + btnW / 2, btnY + btnH / 2 + 4);
        g.ctx.textAlign = 'left';

        this._completeBtnRect = { x: btnX, y: btnY, w: btnW, h: btnH };
    }

    // FUN_0040e0ea (rwg_functions.c:17376). DECOMPILED_MAP.md section 13.
    // Box: (200, 0xb9=185, 400, 0xe6=230). Title: "LEVEL FAILED".
    // Body: "Time up" or "You lost all your chickens" + "\nPress main menu or restart".
    // Buttons (this+0x24, +0x25): "RESTART LEVEL" and "MAIN MENU".
    _drawLevelFailed(g) {
        g.setColor(0, 0, 0, 150);
        g.fillRect(0, 0, 800, 600);

        const bx = 200, by = 185, bw = 400, bh = 230;

        // Box background — 9-sliced so the title plate stays fixed at top.
        const plate = g.drawDialogBox(IMAGES.IMAGE_DIALOG_BOX, bx, by, bw, bh);

        // Title 'LEVEL FAILED' (CONFIRMED rwg:17400) centered IN the plate.
        // FONT_DLG_HEADER = ArialBlack14 (resources.xml:61). Title color is NOT
        // set per-dialog (only button text is forced white, rwg:40887-40891) =>
        // matched to the LEVEL COMPLETED sibling (gold), not the invented red.
        g.ctx.fillStyle = '#ffd700';
        g.ctx.textAlign = 'center';
        g.ctx.textBaseline = 'middle';
        drawFitText(g.ctx, 'LEVEL FAILED', bx + bw / 2, plate.plateCenterY, bw - 50,
            'bold 14px "Arial Black", Arial, sans-serif');
        g.ctx.textBaseline = 'alphabetic';

        // Body: exactly two reason strings in the decompiled —
        // 'Time up' (rwg:17417-17418) else 'You lost all your chickens'
        // (rwg:17420-17421); the source appends '\nPress main menu or restart'
        // (rwg:17426-17427) and draws it as ONE FONT_DLG_LINES block (rwg:74498).
        // (The earlier 'A chicken was lost' bonus branch was invented — removed.)
        g.ctx.fillStyle = '#fff';
        g.ctx.font = '12px "Arial Black", Arial, sans-serif';
        const fc = this.mFieldController;
        const reason = (fc.mFailReason === 'time') ? 'Time up' : 'You lost all your chickens';
        g.ctx.fillText(reason, bx + bw / 2, by + 80);
        g.ctx.fillText('Press main menu or restart', bx + bw / 2, by + 105);

        // Buttons — green dialog_btn images (FUN_0040e0ea:17413, 17416)
        const btnImg = IMAGES.IMAGE_DIALOG_BUTTON;
        const btnOverImg = IMAGES.IMAGE_DIALOG_BUTTON_OVER;
        const btnW = 140, btnH = 38;
        const restartX = bx + 30;
        const menuX = bx + bw - btnW - 30;
        const btnY = by + bh - btnH - 25;
        // Hover state — swap to OVER variant when cursor is over the button.
        // mHand.mX/mY is the live cursor position (mouseMove keeps it current).
        // Without this, IMAGE_DIALOG_BUTTON_OVER was loaded but only used by
        // the HUD; the level-failed dialog (where the player sits longest)
        // had no hover feedback on its two key choices.
        const hx = this.mHand.mX, hy = this.mHand.mY;
        const overRestart = hx >= restartX && hx < restartX + btnW
            && hy >= btnY && hy < btnY + btnH;
        const overMenu = hx >= menuX && hx < menuX + btnW
            && hy >= btnY && hy < btnY + btnH;
        const restartImg = (overRestart && btnOverImg && btnOverImg.img) ? btnOverImg : btnImg;
        const menuImg = (overMenu && btnOverImg && btnOverImg.img) ? btnOverImg : btnImg;
        if (btnImg && btnImg.img && g._isReady(btnImg.img)) {
            g.ctx.drawImage(restartImg.img, restartX, btnY, btnW, btnH);
            g.ctx.drawImage(menuImg.img, menuX, btnY, btnW, btnH);
        } else {
            g.setColor(80, 160, 40, 255);
            g.fillRect(restartX, btnY, btnW, btnH);
            g.fillRect(menuX, btnY, btnW, btnH);
        }
        // Button labels CONFIRMED 'RESTART LEVEL' (rwg:17413) / 'MAIN MENU'
        // (rwg:17416); font FONT_DLG_BUTTONS=ArialBlack12 (resources.xml:63);
        // white text CONFIRMED (rwg:40887-40891).
        g.ctx.fillStyle = '#fff';
        g.ctx.font = '12px "Arial Black", Arial, sans-serif';
        g.ctx.textAlign = 'center';
        g.ctx.fillText('RESTART LEVEL', restartX + btnW / 2, btnY + btnH / 2 + 4);
        g.ctx.fillText('MAIN MENU', menuX + btnW / 2, btnY + btnH / 2 + 4);
        g.ctx.textAlign = 'left';

        this._failRestartRect = { x: restartX, y: btnY, w: btnW, h: btnH };
        this._failMenuRect = { x: menuX, y: btnY, w: btnW, h: btnH };
    }

    _drawDialog(g, dialog) {
        const btnImg = IMAGES.IMAGE_DIALOG_BUTTON;
        const btnOverImg = IMAGES.IMAGE_DIALOG_BUTTON_OVER;

        // Dialog background — shop is bigger (150,25,500,550), normal is (150,120,500,360)
        const isShop = dialog.isShop;
        const bgX = 150, bgY = isShop ? 25 : 120;
        const bgW = 500, bgH = isShop ? 550 : 360;
        // 9-slice so the title plate stays a fixed size at the top.
        const plate = g.drawDialogBox(IMAGES.IMAGE_DIALOG_BOX, bgX, bgY, bgW, bgH);

        // Title centered IN the plate.
        g.ctx.fillStyle = '#ffd700';
        g.ctx.textAlign = 'center';
        g.ctx.textBaseline = 'middle';
        drawFitText(g.ctx, dialog.title || '', 400, plate.plateCenterY, bgW - 60,
            'bold 18px "Arial Black", Arial, sans-serif');
        g.ctx.textBaseline = 'alphabetic';

        // Text
        if (dialog.text) {
            g.ctx.fillStyle = '#fff';
            g.ctx.font = '13px Arial, sans-serif';
            this._drawWrappedText(g, dialog.text, 180, bgY + 55, 440, 18);
        }

        // Shop items with pagination (3 per page, from decompiled FUN_00420533/FUN_00420758)
        // Dialog at screen (150, 25, 500, 550)
        // Item Y = slot*116 + 130 (relative to dialog top), content at (145, itemY+25, 220, 100)
        // BUY button at (width-124, 165+slot*116, 100, 30) relative to dialog
        if (dialog.isShop && dialog.shopItems) {
            const slotBig = IMAGES.IMAGE_SHOP_SLOT_BIG;
            const page = dialog.shopPage || 0;
            const perPage = dialog.shopPerPage || 3;
            const totalPages = Math.ceil(dialog.shopItems.length / perPage);
            const startIdx = page * perPage;
            const dlgX = 150, dlgY = 25; // dialog screen position

            for (let i = 0; i < perPage && startIdx + i < dialog.shopItems.length; i++) {
                const item = dialog.shopItems[startIdx + i];
                // Item Y from decompiled: slot * 0x74 + 0x82 = slot * 116 + 130
                const itemY = dlgY + 130 + i * 116;

                // Shop slot big background (111x111)
                const slotX = dlgX + 20;
                if (slotBig && slotBig.img && g._isReady(slotBig.img)) {
                    g.ctx.drawImage(slotBig.img, slotX, itemY, 111, 111);
                } else {
                    g.setColor(160, 120, 40, 255);
                    g.fillRect(slotX, itemY, 111, 111);
                }

                // Item icon (98x98, centered in 111x111 slot)
                const iconImg = IMAGES[item.icon];
                if (iconImg && iconImg.img && g._isReady(iconImg.img)) {
                    g.ctx.drawImage(iconImg.img, slotX + 6, itemY + 6, 98, 98);
                }

                // Content area: (145, itemY+25, 220, 100) relative to dialog
                const textX = dlgX + 145;
                const textY = itemY + 25;

                // Item label
                g.ctx.fillStyle = '#fff';
                g.ctx.font = 'bold 14px Arial, sans-serif';
                g.ctx.textAlign = 'left';
                g.ctx.fillText(item.label, textX, textY + 15);

                // Price
                g.ctx.fillStyle = '#ffd700';
                g.ctx.font = '13px Arial, sans-serif';
                g.ctx.fillText(`$${item.cost}`, textX, textY + 35);

                // BUY button: (width-124, 165+slot*116, 100, 30) relative to dialog
                const bbx = dlgX + 500 - 124;
                const bby = dlgY + 165 + i * 116;
                if (btnImg && btnImg.img && g._isReady(btnImg.img)) {
                    g.ctx.drawImage(btnImg.img, bbx, bby, 100, 30);
                } else {
                    g.setColor(140, 100, 30, 255);
                    g.fillRect(bbx, bby, 100, 30);
                }
                g.ctx.fillStyle = '#fff';
                g.ctx.font = 'bold 12px Arial, sans-serif';
                g.ctx.textAlign = 'center';
                g.ctx.fillText('BUY', bbx + 50, bby + 20);
            }

            // Prev/Next buttons at (30, 75) and (right-30, 75) relative to dialog
            if (totalPages > 1) {
                const prevImg = IMAGES.IMAGE_BUTTON_PREV;
                const nextImg = IMAGES.IMAGE_BUTTON_NEXT;
                const navY = dlgY + 75;

                if (page > 0 && prevImg && prevImg.img && g._isReady(prevImg.img)) {
                    g.ctx.drawImage(prevImg.img, dlgX + 30, navY);
                } else if (page > 0) {
                    g.setColor(80, 140, 40, 255);
                    g.fillRect(dlgX + 30, navY, 80, 30);
                    g.ctx.fillStyle = '#fff';
                    g.ctx.textAlign = 'center';
                    g.ctx.fillText('<', dlgX + 70, navY + 20);
                }

                // Page number
                g.ctx.fillStyle = '#ccc';
                g.ctx.font = '12px Arial, sans-serif';
                g.ctx.textAlign = 'center';
                g.ctx.fillText(`${page + 1} / ${totalPages}`, dlgX + 250, navY + 20);

                if (page < totalPages - 1 && nextImg && nextImg.img && g._isReady(nextImg.img)) {
                    const nw = nextImg.mWidth || 80;
                    g.ctx.drawImage(nextImg.img, dlgX + 500 - 30 - nw, navY);
                } else if (page < totalPages - 1) {
                    g.setColor(80, 140, 40, 255);
                    g.fillRect(dlgX + 390, navY, 80, 30);
                    g.ctx.fillStyle = '#fff';
                    g.ctx.textAlign = 'center';
                    g.ctx.fillText('>', dlgX + 430, navY + 20);
                }
            }
        }

        // Standard buttons (OK/Close at bottom)
        if (dialog.buttons) {
            const bw = 180;
            const bh = 34;
            const startY = bgY + bgH - 50 - dialog.buttons.length * 42;
            for (let i = 0; i < dialog.buttons.length; i++) {
                const btn = dialog.buttons[i];
                const bx = 400 - bw / 2;
                const by = startY + i * 42;

                if (btnImg && btnImg.img && g._isReady(btnImg.img)) {
                    g.ctx.drawImage(btnImg.img, bx, by, bw, bh);
                } else {
                    g.setColor(140, 100, 30, 255);
                    g.fillRect(bx, by, bw, bh);
                }

                g.ctx.fillStyle = '#fff';
                g.ctx.font = 'bold 13px Arial, sans-serif';
                g.ctx.textAlign = 'center';
                g.ctx.fillText(btn.label, 400, by + 22);
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

    update() {
        // Pause the field while a hint or intro modal is displayed. This
        // keeps the game in a stable state while the player reads the modal
        // — otherwise chicks keep wandering, getting hungry, and laying eggs
        // behind the popup.
        const modalShown = !!((this.mHintController && this.mHintController.isShown())
            || this.mIntroPage >= 0
            || HtmlDialogs.isOpen());
        if (modalShown && !this.mFieldController.mIsPaused) {
            this._pausedByHint = true;
            this.mFieldController.mIsPaused = true;
        } else if (this._pausedByHint && !modalShown) {
            this._pausedByHint = false;
            this.mFieldController.mIsPaused = false;
        }
        // Level fade-in ticks regardless of pause — it's a brief one-time
        // visual transition (30 ticks = 0.3s), not gameplay. Without this,
        // an intro dialog on L1 sets mIsPaused=true (auto-pause for modals
        // above), which blocked the fade tick and left an OPAQUE BLACK
        // overlay covering the intro dialog → black-screen bug.
        if (this.mLevelFadeTimer > 0) this.mLevelFadeTimer--;
        // Tick intro/warning overlay timers in update (100 ticks/sec) rather
        // than draw (display-dependent refresh) so timings don't shift
        // between 60Hz and 144Hz displays. Skip during pause so the player
        // can read the intro at their own pace.
        if (!this.mFieldController.mIsPaused) {
            if (this.mWolfIntroTimer > 0) this.mWolfIntroTimer--;
            if (this.mLevelEndFlashTimer > 0
                && (this.mFieldController.mIsLevelComplete
                    || this.mFieldController.mIsLevelFailed)) {
                this.mLevelEndFlashTimer--;
            }
        }
        this.mFieldController.update();
        // Open the HTML level-end dialog once when the flag first trips.
        if (this.mFieldController.mIsLevelComplete) {
            if (!this._endShown) { this._endShown = true; this._openCompleteHtml(); }
        } else if (this.mFieldController.mIsLevelFailed) {
            if (!this._endShown) { this._endShown = true; this._openFailedHtml(); }
        } else {
            this._endShown = false;
        }
        // Don't tick the risk cooldown while game is paused / level over
        if (!this.mFieldController.mIsPaused
            && !this.mFieldController.mIsLevelComplete
            && !this.mFieldController.mIsLevelFailed) {
            this.mRiskController.update();
        }
        // Risk-result toast timer — pause stops it so the player can read it.
        if (!this.mFieldController.mIsPaused && this.mRiskResultTimer > 0) {
            this.mRiskResultTimer--;
            if (this.mRiskResultTimer <= 0) this.mShowRiskResult = null;
        }
        // Tick modal dialogs that have an info-text timeout
        if (this.mShopDialog && this.mShopDialog.update) this.mShopDialog.update();
        // First sick chicken → SICK_CHICKEN hint (per FUN_00422228 first-sick check)
        if (!this.mShownSickHint) {
            for (const c of this.mFieldController.mField.mChickens) {
                if (c.mIsAlive && c.mIsSick) {
                    this.mHintController.showHint(HintType.SICK_CHICKEN);
                    this.mShownSickHint = true;
                    this.mFirstSickChick = c;
                    this.mFirstSickHintTimer = 240;
                    break;
                }
            }
        }
        if (!this.mFieldController.mIsPaused && this.mFirstSickHintTimer > 0) {
            this.mFirstSickHintTimer--;
        }
        // First egg laid → COLLECT_EGG hint + visual pointer to the egg.
        if (!this.mShownEggHint) {
            for (const g of this.mFieldController.mField.mGems) {
                if (g.mType === 4 && g.mIsAlive) {
                    this.mHintController.showHint(HintType.COLLECT_EGG);
                    this.mShownEggHint = true;
                    this.mFirstEgg = g;
                    this.mFirstEggHintTimer = 240;
                    break;
                }
            }
        }
        if (!this.mFieldController.mIsPaused && this.mFirstEggHintTimer > 0) {
            this.mFirstEggHintTimer--;
        }

        // Contextual hints (per-level dispatch resembles FUN_00422a24).
        // Hint strings exist verbatim in the binary; the original game shows
        // them once when the matching condition fires.
        const fc = this.mFieldController;
        const chickens = fc.mField.mChickens.filter(c => c.mIsAlive);
        // FARM_CROWDED removed from per-frame check. Per the original at
        // rwg_functions.c:42526, the hint is gated on a level >= 0x97 (151)
        // check that NEVER fires in normal gameplay (levels go 1-50). The
        // hint is instead surfaced when the player tries to buy past the
        // cap — see FieldController.buyChick's cap-reached branch.
        // BUY_CHICKEN — first level where buy shop is available.
        if (fc.mLevelConfig && fc.mLevelConfig.hasBuy) {
            this.mHintController.showHint(HintType.BUY_CHICKEN);
        }
        // BUY_ROOSTER — ravens active and player has no rooster.
        // Bug: this used mType === 4 which is HOLY in ChickType (ROOSTER is 2)
        // — so the rooster check was actually a holy-chick check, firing the
        // BUY_ROOSTER hint on virtually every raven level regardless of
        // whether the player had roosters.
        if (fc.mLevelConfig && fc.mLevelConfig.hasRavens) {
            const hasRooster = chickens.some(c => c.mType === 2 /* ROOSTER */);
            if (!hasRooster && chickens.length > 0) {
                this.mHintController.showHint(HintType.BUY_ROOSTER);
            }
        }
        // NEED_MAGIC_EGGS — only fire when there's a HUNGRY magic chick AND
        // no magic egg available. Per FUN_00422990 (rwg_functions.c:42631-
        // 42636): the original checks chick type == 3 (MAGIC) AND chick's
        // food counter < 0x5dc (1500). Hungry magic chicks need blue eggs to
        // restore food. Previously we fired on any magic chick + no egg,
        // which spammed the hint even when the magic chick was well-fed
        // (chick happily walking with full belly → "need more eggs" felt
        // contradictory). Match the original food-gated trigger.
        const hungryMagic = chickens.some(c =>
            c.mType === 3 /* MAGIC */ && c.mIsAlive
            && c.mFoodCounter < 1500);
        if (hungryMagic) {
            const hasMagicEgg = fc.mField.mGems.some(g =>
                g.mIsAlive && g.mType === 4 && g.mEggType === 1 /* BLUE */);
            if (!hasMagicEgg) {
                this.mHintController.showHint(HintType.NEED_MAGIC_EGGS);
            }
        }

        // Mirror the ready flag onto FieldController for HUD draw
        this.mFieldController.mRiskReady = this.mRiskController.isReady();
        super.update();

        // RIGHT mouse = continuous corn dropping (DAT_004fff01)
        // Costs $1 per drop from decompiled FUN_004015f8.
        // Pause gates the loop — otherwise holding right-click and pausing
        // would keep deducting money/dropping seeds in the background.
        if (this.mMouseRightDown
            && this.mHand.isOverField()
            && !this.mFieldController.mIsPaused
            && !this.mFieldController.mIsLevelComplete
            && !this.mFieldController.mIsLevelFailed
            && !this.mShowDialog) {
            this.mFeedTimer++;
            if (this.mFeedTimer >= this.mFeedInterval) {
                this.mFeedTimer = 0;
                if (this.mFieldController.mMoney > 0) {
                    this.mFieldController.mMoney--;
                    this.mFieldController.mField.dropSeeds(
                        this.mHand.mX, this.mHand.mY,
                        this.mFieldController.mSeedCount,
                        this.mFieldController.mSeedCalories);
                }
            }
        }

        // (Risk-result toast timer ticks earlier in update — removed the
        // duplicate decrement that was halving the visible duration.)
    }

    // FUN_0043e9be + FUN_0040dd6a/FUN_0040e217 - buttonDepress handler
    buttonDepress(id) {
        if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();

        switch (id) {
            case BTN_MENU:
                this.mGameApp.showMainMenu();
                break;

            // Buy buttons handled in top panel click, not here
        }
    }

    mouseMove(x, y) {
        // UpgradeSelectDialog hover description
        if (this.mUpgradeDialog && this.mUpgradeDialog.mouseMove) {
            if (this.mUpgradeDialog.mouseMove(x, y)) return;
        }
        // OptionsDialog in-game absorbs mousemove for slider drag
        if (this.mOptionsDialog && this.mOptionsDialog.mouseMove) {
            if (this.mOptionsDialog.mouseMove(x, y)) return;
        }
        // ShopDialog (SELL/SpecialShop BUY) tracks mouse position for button
        // hover state. Doesn't absorb the event — passing false from its
        // mouseMove lets the rest of the chain run (no slider drag to handle).
        if (this.mShopDialog && this.mShopDialog.mouseMove) {
            this.mShopDialog.mouseMove(x, y);
        }
        // HintController OK button hover state.
        if (this.mHintController && this.mHintController.handleMouseMove) {
            this.mHintController.handleMouseMove(x, y);
        }
        this.mHand.move(x, y);
        // Track mouse position for HUD button hover state. FieldController
        // reads these in drawHUD to swap to IMAGE_DIALOG_BUTTON_OVER when the
        // cursor is over MENU/BUY/SELL. Updating here (not in draw) keeps
        // hover state in sync with input rather than the render cadence.
        this.mFieldController.mHudHoverX = x;
        this.mFieldController.mHudHoverY = y;

        // Auto-cursor from decompiled FUN_0040cc01: cursor changes based on what's under mouse
        // Only below top panel (y > 0x82 = 130)
        if (y > 130 && !this.mShowDialog
            && !this.mFieldController.mIsLevelComplete
            && !this.mFieldController.mIsLevelFailed) {
            let newMode = HandMode.SEEDS; // default: seeds cursor

            // Check if hovering a sick chicken → cure cursor. Hit-box must
            // match FieldController.handleClick (chick body extends ~70px
            // above mY=feet) — otherwise the cursor flips back to seeds
            // when over the chick's head, even though the click would cure.
            for (const c of this.mFieldController.mField.mChickens) {
                // Match cure click gate (skip carried — cure does nothing).
                if (c.mIsAlive && c.mIsSick && !c.mIsCarried) {
                    const inX = Math.abs(c.mX - x) <= 25;
                    const inY = (y >= c.mY - 70 && y <= c.mY + 15);
                    if (inX && inY) {
                        newMode = HandMode.CURE;
                        break;
                    }
                }
            }

            // Gun mode reflects the player's purchased slingshot upgrades
            // (gun_1 → GUN_POWER, gun_area → GUN_AREA, both → GUN_POWER_AREA).
            // Matches the key-3 shortcut logic below — cursor must visually
            // signal what the player will actually shoot with.
            const fc = this.mFieldController;
            const gunMode = (fc.mGunPower > 1 && fc.mGunArea) ? HandMode.GUN_POWER_AREA
                : fc.mGunPower > 1 ? HandMode.GUN_POWER
                : fc.mGunArea     ? HandMode.GUN_AREA
                : HandMode.GUN;

            // Check if hovering a raven → gun cursor
            if (newMode === HandMode.SEEDS) {
                for (const r of this.mFieldController.mField.mRavens) {
                    // Skip already-scared ravens — clicking them does nothing
                    // (FieldController.handleClick now guards on the same),
                    // so the cursor shouldn't suggest a clickable target.
                    if (r.mIsAlive && r.mState !== 3 /* SCARED */
                        && r.contains(x, y)) {
                        newMode = gunMode;
                        break;
                    }
                }
            }

            // Check if hovering a wolf → gun cursor. Hit-box must match
            // FieldController.handleClick (wolf sprite is ~135x130 px;
            // anything tighter and the cursor doesn't flip over the wolf's
            // edges even though clicking there would still hit).
            if (newMode === HandMode.SEEDS) {
                for (const w of this.mFieldController.mField.mWolves || []) {
                    if (!w.mIsAlive) continue;
                    const dx = w.mX - x;
                    const dy = w.mY - y;
                    if (Math.abs(dx) <= 60 && Math.abs(dy) <= 50) {
                        newMode = gunMode;
                        break;
                    }
                }
            }

            this.mHand.setMode(newMode);
        }

        super.mouseMove(x, y);
    }

    mouseDown(x, y, btn) {
        // If paused (and no other modal), any click unpauses
        if (this.mFieldController.mIsPaused
            && !this.mShowDialog
            && !this.mShopDialog
            && !this.mOptionsDialog
            && !this.mUpgradeDialog
            && !(this.mHintController && this.mHintController.isShown())
            && this.mIntroPage < 0) {
            this.mFieldController.mIsPaused = false;
            return true;
        }
        // UpgradeSelectDialog blocks until choice
        if (this.mUpgradeDialog && this.mUpgradeDialog.isShown()) {
            this.mUpgradeDialog.mouseDown(x, y, btn);
            return true;
        }
        // ShopDialog (BUY/SELL) eats clicks first
        if (this.mShopDialog && this.mShopDialog.isShown()) {
            this.mShopDialog.mouseDown(x, y, btn);
            return true;
        }
        // OptionsDialog modal (in-game) — eats clicks
        if (this.mOptionsDialog && this.mOptionsDialog.isShown()) {
            this.mOptionsDialog.mouseDown(x, y, btn);
            return true;
        }
        // IntroductionDialog modal (FUN_0040daeb:16910). Sequence per the
        // original draw fn (FUN_0040d9ef:16885): byte 0x15c starts at 1
        // (letter, shown first), click toggles to 0 (intro panel), next
        // click dismisses.
        if (this.mIntroPage >= 0) {
            if (btn !== 0) return true; // only left-click acts
            if (this.mIntroPage === 1) {
                this.mIntroPage = 0; // letter → intro panel
            } else {
                this.mIntroPage = -1; // intro panel → dismiss
            }
            return true;
        }
        // HintDialog modal — consumes all clicks while shown
        if (this.mHintController.isShown()) {
            if (btn === 0) this.mHintController.handleClick(x, y);
            return true;
        }
        if (btn === 2) {
            this.mMouseRightDown = true;
            this.mFeedTimer = 0; // drop immediately on first right-click
            // First right-click drop
            if (this.mHand.isOverField() && !this.mShowDialog
                && !this.mFieldController.mIsLevelComplete
                && !this.mFieldController.mIsLevelFailed
                && this.mFieldController.mMoney > 0) {
                this.mFieldController.mMoney--;
                this.mFieldController.mField.dropSeeds(x, y,
                    this.mFieldController.mSeedCount,
                    this.mFieldController.mSeedCalories);
            }
        }

        // Handle level complete/failed click — use the rects computed during draw
        if (this.mFieldController.mIsLevelComplete) {
            const r = this._completeBtnRect;
            if (!r || (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) {
                const finishedLvl = this.mFieldController.mCurrentLevel;
                // Final level = 50 → win screen (FUN_0041d723).
                if (finishedLvl >= 50) {
                    if (this.mGameApp.showWin) this.mGameApp.showWin();
                    return true;
                }
                const nextLvl = finishedLvl + 1;
                // Upgrade dialog gates: after level 3, 6, 9... (every 3 levels).
                // Original gating per FUN_00423d75 progression — exact triggers
                // UNKNOWN here. finishedLvl ≥ 1 here (level-complete path), so
                // nextLvl ≥ 2 and the `nextLvl > 1` guard was always true —
                // dropped it for clarity. The modulo check is the real gate.
                if ((nextLvl - 1) % 3 === 0) {
                    this._showUpgradeDialog(() => {
                        this.startLevel(nextLvl);
                    });
                } else {
                    this.startLevel(nextLvl);
                }
            }
            return true;
        }

        if (this.mFieldController.mIsLevelFailed) {
            const rR = this._failRestartRect, rM = this._failMenuRect;
            if (rR && x >= rR.x && x <= rR.x + rR.w && y >= rR.y && y <= rR.y + rR.h) {
                // Reset GameView per-level UI state (intro page, hint trackers,
                // fade timer) along with the field reset.
                this.startLevel(this.mFieldController.mCurrentLevel);
                return true;
            }
            if (rM && x >= rM.x && x <= rM.x + rM.w && y >= rM.y && y <= rM.y + rM.h) {
                this.mGameApp.showMainMenu();
                return true;
            }
            return true;
        }

        // Dialog button clicks
        if (this.mShowDialog) {
            // Shop: paginated BUY buttons and prev/next
            // Exact positions from decompiled: dialog at (150, 25, 500, 550)
            if (this.mShowDialog.isShop && this.mShowDialog.shopItems) {
                const dlg = this.mShowDialog;
                const page = dlg.shopPage || 0;
                const perPage = dlg.shopPerPage || 3;
                const totalPages = Math.ceil(dlg.shopItems.length / perPage);
                const startIdx = page * perPage;
                const dlgX = 150, dlgY = 25;

                // BUY buttons: (dlgX + 500-124, dlgY + 165 + i*116, 100, 30)
                for (let i = 0; i < perPage && startIdx + i < dlg.shopItems.length; i++) {
                    const bbx = dlgX + 500 - 124;
                    const bby = dlgY + 165 + i * 116;
                    if (x >= bbx && x <= bbx + 100 && y >= bby && y <= bby + 30) {
                        const item = dlg.shopItems[startIdx + i];
                        this._handleDialogButton(item.action, item.cost);
                        return true;
                    }
                }

                // Prev button: (dlgX+30, dlgY+75, 80, 30)
                const navY = dlgY + 75;
                if (page > 0 && x >= dlgX + 30 && x <= dlgX + 110 && y >= navY && y <= navY + 30) {
                    dlg.shopPage = page - 1;
                    return true;
                }
                // Next button: (dlgX+390, dlgY+75, 80, 30)
                if (page < totalPages - 1 && x >= dlgX + 390 && x <= dlgX + 470 && y >= navY && y <= navY + 30) {
                    dlg.shopPage = page + 1;
                    return true;
                }
            }
            // Standard buttons
            if (this.mShowDialog.buttons) {
                const bw = 180;
                const isShopDlg = this.mShowDialog.isShop;
                const bgYY = isShopDlg ? 25 : 120;
                const bgHH = isShopDlg ? 550 : 360;
                const startY = bgYY + bgHH - 50 - this.mShowDialog.buttons.length * 42;
                for (let i = 0; i < this.mShowDialog.buttons.length; i++) {
                    const bx = 400 - bw / 2;
                    const by = startY + i * 42;
                    if (x >= bx && x <= bx + bw && y >= by && y <= by + 34) {
                        const btn = this.mShowDialog.buttons[i];
                        this._handleDialogButton(btn.action, btn.cost);
                        return true;
                    }
                }
            }
            // Click outside dialog area dismisses it (dialog at 150,120,500,360 or shop at 150,25,500,550)
            const dlgX = 150, dlgW = 500;
            const dlgY = this.mShowDialog.isShop ? 25 : 120;
            const dlgH = this.mShowDialog.isShop ? 550 : 360;
            if (x < dlgX || x > dlgX + dlgW || y < dlgY || y > dlgY + dlgH) {
                this.mFieldController.mIsPaused = false;
                this.mShowDialog = null;
            }
            return true;
        }

        // === Top panel click handling (exact positions from decompiled code) ===

        // Shop buy slots (x=80*i, y=0, 80x81 each) — only clickable on shop
        // levels. Non-shop levels render just the leftmost slot as a Level
        // badge (FieldController.drawHUD), so clicks elsewhere shouldn't fire
        // the error blip from buyChick.
        if (y >= 0 && y <= 81) {
            const cfg = this.mFieldController.mLevelConfig;
            if (cfg && cfg.hasBuy) {
                for (let i = 0; i < 5; i++) {
                    const bx = 80 * i;
                    if (x >= bx && x <= bx + 80) {
                        this.mFieldController.buyChick(i);
                        return true;
                    }
                }
            }
            // MENU button: (403, 39, 101, 38) from decompiled
            if (x >= 403 && x <= 504 && y >= 39 && y <= 77) {
                if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
                this._openPauseMenu();
                return true;
            }
            // SELL button: (506, 39, 85, 38) — only if level allows
            if (this.mFieldController.mLevelConfig && this.mFieldController.mLevelConfig.hasSell
                && x >= 506 && x <= 591 && y >= 39 && y <= 77) {
                if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
                this._openSellDialog();
                return true;
            }
            // BUY button: (506, 1, 85, 38) — only if level allows
            if (this.mFieldController.mLevelConfig && this.mFieldController.mLevelConfig.hasBuy
                && x >= 506 && x <= 591 && y >= 1 && y <= 39) {
                if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
                this._openShopDialog();
                return true;
            }
        }

        // Egg incubation boxes — one per egg, wrapping to row 2 when overflowing
        // the left half (mirrors FUN_00409ab2:12396-12399 wrap at index >10).
        // Each box is 54x54; click handling must match drawHUD's 2-row layout.
        const sz = 54;
        const maxBoxes = Math.max(1, Math.floor(400 / sz));
        const totalMax = maxBoxes * 2;
        if (y >= 80 && y <= 80 + sz * 2) {
            const fieldEggs = this.mFieldController.mField.mGems.filter(
                gem => gem.mType === 4 && gem.mIsAlive
            );
            for (let i = 0; i < fieldEggs.length && i < totalMax; i++) {
                const col = i % maxBoxes;
                const row = Math.floor(i / maxBoxes);
                const ex = sz * col;
                const ey = 80 + row * sz;
                if (x >= ex && x <= ex + sz && y >= ey && y <= ey + sz) {
                    this.mFieldController.startEggBrooding(fieldEggs[i]);
                    return true;
                }
            }
        }

        // Risk icon click — '?' surprise (FUN_0041b94a:33654)
        if (btn === 0 && this.mFieldController._riskIconRect) {
            const r = this.mFieldController._riskIconRect;
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                if (this.mRiskController.isReady()) {
                    if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
                    const result = this.mRiskController.rollRisk(this.mFieldController);
                    if (result) {
                        result.apply(this.mFieldController);
                        // Show result via HintController as a modal info dialog
                        // (original uses a custom info dialog with title "SURPRISE!")
                        this.mShowRiskResult = result.mDescription;
                        this.mRiskResultTimer = 200;
                    }
                }
                return true;
            }
        }

        // Left click on field — action based on auto-cursor mode.
        // handleClick has its own pause/complete/fail guard, but the click
        // ripple was firing unconditionally — producing a "tap" visual even
        // though the underlying action was no-oped. Gate both together.
        if (btn === 0 && this.mHand.isOverField()
            && !this.mFieldController.mIsPaused
            && !this.mFieldController.mIsLevelComplete
            && !this.mFieldController.mIsLevelFailed) {
            this.mFieldController.handleClick(x, y, this.mHand.getModeString());
            if (this.mFieldController.addClickRipple) {
                this.mFieldController.addClickRipple(x, y, '#ffe080');
            }
        }

        return true;
    }

    mouseUp(x, y, btn) {
        if (btn === 2) this.mMouseRightDown = false;
        if (this.mOptionsDialog && this.mOptionsDialog.mouseUp) {
            this.mOptionsDialog.mouseUp(x, y, btn);
        }
        super.mouseUp(x, y, btn);
    }

    // Keyboard handler — space-bar pauses (rwg_functions.c:13980 "press space to continue")
    keyDown(key) {
        // Level-end overlays — Enter/Space/Escape advance/restart/menu
        if (this.mFieldController.mIsLevelComplete) {
            if (key === 'Enter' || key === ' ' || key === 'Escape') {
                const finished = this.mFieldController.mCurrentLevel;
                if (finished >= 50) {
                    if (this.mGameApp.showWin) this.mGameApp.showWin();
                    return true;
                }
                const nextLvl = finished + 1;
                // Mirror the mouse-click path: show upgrade dialog at the
                // appropriate gates (every 3 levels). Previously the keyboard
                // shortcut bypassed the upgrade dialog entirely, so a player
                // who hit Enter/Space at level-complete skipped a permanent
                // upgrade choice for that level.
                if ((nextLvl - 1) % 3 === 0) {
                    this._showUpgradeDialog(() => this.startLevel(nextLvl));
                } else {
                    this.startLevel(nextLvl);
                }
                return true;
            }
            return true;
        }
        if (this.mFieldController.mIsLevelFailed) {
            if (key === 'Enter' || key === ' ') {
                // GameView.startLevel handles full reset; restartLevel here
                // would double-initialize the field.
                this.startLevel(this.mFieldController.mCurrentLevel);
                return true;
            }
            if (key === 'Escape') {
                if (this.mGameApp.showMainMenu) this.mGameApp.showMainMenu();
                return true;
            }
            return true;
        }
        // UpgradeSelectDialog eats keys (numeric 1/2/3 selects)
        if (this.mUpgradeDialog && this.mUpgradeDialog.isShown()) {
            this.mUpgradeDialog.keyDown(key);
            return true;
        }
        // ShopDialog eats keys
        if (this.mShopDialog && this.mShopDialog.isShown()) {
            this.mShopDialog.keyDown(key);
            return true;
        }
        // OptionsDialog in-game eats keys
        if (this.mOptionsDialog && this.mOptionsDialog.isShown()) {
            this.mOptionsDialog.keyDown(key);
            return true;
        }
        // IntroductionDialog modal absorbs keys
        if (this.mIntroPage >= 0) return true;
        // HintDialog modal
        if (this.mHintController.isShown()) return true;
        // Other modals
        if (this.mShowDialog) return true;

        if (key === ' ' || key === 'Spacebar') {
            this.mFieldController.mIsPaused = !this.mFieldController.mIsPaused;
            return true;
        }
        if (key === 'Escape') {
            // Original: ESC opens the in-game options/menu (FUN_0040bce7 case 1).
            this._openPauseMenu();
            return true;
        }
        // Number keys override auto-cursor (per FUN_004093d9 keyboard flag mapping).
        // Mode index in original (FUN_00406f87): 0=seeds, 1=cure, 2=gun, etc.
        if (key === '1') { this.mHand.setMode(HandMode.SEEDS); return true; }
        if (key === '2') { this.mHand.setMode(HandMode.CURE); return true; }
        if (key === '3') {
            const fc = this.mFieldController;
            const mode = (fc.mGunPower > 1 && fc.mGunArea) ? HandMode.GUN_POWER_AREA
                : fc.mGunPower > 1 ? HandMode.GUN_POWER
                : fc.mGunArea     ? HandMode.GUN_AREA
                : HandMode.GUN;
            this.mHand.setMode(mode);
            return true;
        }
        // S = Sell, B = Buy
        if (key === 's' || key === 'S') {
            if (this.mFieldController.mLevelConfig && this.mFieldController.mLevelConfig.hasSell) {
                this._openSellDialog();
                return true;
            }
        }
        if (key === 'b' || key === 'B') {
            if (this.mFieldController.mLevelConfig && this.mFieldController.mLevelConfig.hasBuy) {
                this._openShopDialog();
                return true;
            }
        }
        return false;
    }

    // CORRECTION (per agent research 2026-05-06): the original game does NOT show
    // a separate level-intro splash after START LEVEL is clicked. The per-level
    // text from FUN_0042399c is rendered inside SelectLevelDialog itself, before
    // gameplay begins. So this is a no-op when the player came from SelectLevelDialog.
    // We keep an optional pop only when starting directly to a level (no select-level
    // dialog seen) — useful for direct-link / dev access.
    showLevelIntro(level) {
        // No-op — instructions are shown in SelectLevelDialog. To re-enable a
        // post-start splash, uncomment the body below.
        // if (this._levelIntrosShown && this._levelIntrosShown.has(level)) return;
        // this._levelIntrosShown = this._levelIntrosShown || new Set();
        // this._levelIntrosShown.add(level);
        // this.mShowDialog = {
        //     title: `Level ${level}`,
        //     text: getLevelDescription(level),
        //     buttons: [{ label: 'OK', action: 'close' }],
        // };
        // this.mFieldController.mIsPaused = true;
    }

    // Button 1 (MENU) — FUN_0040bce7 case 1: open the in-game Options (HTML).
    // The field auto-pauses via the HtmlDialogs.isOpen() check in update().
    _openPauseMenu() {
        this.mGameApp.openOptions({
            inGame: true,
            onMainMenu: () => { if (this.mGameApp.showMainMenu) this.mGameApp.showMainMenu(); },
            // GameView.startLevel re-inits the field internally; restartLevel
            // here would double-initialize it.
            onRestart: () => { this.startLevel(this.mFieldController.mCurrentLevel); },
        });
    }

    // LEVEL COMPLETED — HTML dialog opened on the flag transition (update()).
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

    _onLevelContinue() {
        HtmlDialogs.close('level-complete');
        const finishedLvl = this.mFieldController.mCurrentLevel;
        if (finishedLvl >= 50) { if (this.mGameApp.showWin) this.mGameApp.showWin(); return; }
        const nextLvl = finishedLvl + 1;
        // Upgrade gate every 3 levels (after 3, 6, 9...).
        if ((nextLvl - 1) % 3 === 0) this._showUpgradeDialog(() => this.startLevel(nextLvl));
        else this.startLevel(nextLvl);
    }

    // LEVEL FAILED — HTML dialog.
    _openFailedHtml() {
        const fc = this.mFieldController;
        HtmlDialogs.open('level-failed', {
            // FUN_0040e0ea, rwg:17418-17427: one body with an explicit newline.
            binds: { reason: (fc.mFailReason === 'time' ? 'Time up' : 'You lost all your chickens')
                + '\nPress main menu or restart' },
            actions: {
                restart: () => { HtmlDialogs.close('level-failed'); this.startLevel(fc.mCurrentLevel); },
                mainmenu: () => { HtmlDialogs.close('level-failed'); this.mGameApp.showMainMenu(); },
            },
        });
    }

    // FUN_00423f8a UpgradeSelectDialog — HTML. Opens after some level transitions.
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

    // Apply gameplay effect for the chosen upgrade. Persistence happens in
    // UpgradeSelectDialog._select; this method wires the in-session effect.
    // `silent` skips the upgrade-applied jingle — used when re-applying the
    // saved upgrade list at level start (don't play one sound per upgrade).
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
        // Play upgrade-applied jingle (sounds/field_upgrade.ogg). The asset
        // is loaded and was previously unused — fire it on every applied
        // upgrade so the player gets audible reinforcement. Skip when
        // re-applying the saved list at level start.
        if (!silent && SOUNDS && SOUNDS.SOUND_FIELD_UPGRADE) {
            SOUNDS.SOUND_FIELD_UPGRADE.play();
        }
    }

    // Sexy::ShopDialog (FUN_0041f031:38486) — HTML 'shop-sell'. The field
    // auto-pauses via the HtmlDialogs.isOpen() check in update().
    _openSellDialog() {
        new ShopDialog(this.mFieldController, null).openHtml();
    }

    // Sexy::SpecialShopDialog (FUN_00420232:39763) — HTML 'shop-buy'.
    _openShopDialog() {
        new SpecialShopDialog(this.mFieldController, null).openHtml();
    }

    // Handle dialog button clicks
    // Generic dialog button dispatch — pause/restart/menu/close.
    // Shop-specific actions are now handled by ShopDialog/SpecialShopDialog directly.
    _handleDialogButton(action, cost) {
        const fc = this.mFieldController;
        switch (action) {
            case 'restart':
                fc.mIsPaused = false;
                this.mShowDialog = null;
                this.startLevel(fc.mCurrentLevel);
                break;
            case 'mainmenu':
                fc.mIsPaused = false;
                this.mShowDialog = null;
                this.mGameApp.showMainMenu();
                break;
            // 'continue', 'close', and unknown all just dismiss the dialog.
            case 'continue':
            case 'close':
            default:
                fc.mIsPaused = false;
                this.mShowDialog = null;
        }
    }
}
