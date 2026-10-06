// Sexy::MainMenuView (vftable 0x4dd690 / 0x4dd694).
// Constructor FUN_0040e5cb (rwg_functions.c:17785).
// Draw FUN_0040e75a (rwg_functions.c:17916; args recovered from the
//   disassembly of app/chicken_chase.RWG @0x40e75a..0x40e837).
// AddedToManager FUN_0040e83a (rwg_functions.c:17961-18030).
// RemovedFromManager FUN_0040ea3b (rwg_functions.c:18040).
// ButtonDepress FUN_0040ea92 (rwg_functions.c:18061-18150).
//
// Sexy::SelectLevelView (vftable 0x4df364) — the full-screen view behind
// SelectLevelDialog / IntroductionDialog and host of the win/credits roll.
// Its non-dialog roll logic (mode 1000 / >= 51) lives in CreditsView.js; the
// class below keeps the SelectLevelDialog (HTML) driver + the view background.

import { Widget, ButtonWidget } from './SexyApp.js';
import { IMAGES, SOUNDS } from './Res.js';
import { NewPlayerDialog } from './PlayerDialogs.js';
import { getLevelDescription } from './LevelData.js';
import { HtmlDialogs } from './HtmlDialogs.js';
import { getTintedEggCel } from './Gem.js';
import { drawFieldBackground, FONT_CSS, drawOutlinedText, FONT_ASCENT } from './CreditsView.js';

// Child widget ids (FUN_0040e5cb:17813-17836 passes 1/2/3 to FUN_0042154d;
// ButtonDepress FUN_0040ea92 dispatches 1,2,3,4 at rwg:18088-18146).
const BTN_START = 1;         // id 1 → FUN_004088d0(-1, app)             rwg:18089-18093
const BTN_OPTIONS = 2;       // id 2 → new OptionsDialog FUN_0040f57b, dialog id 6   rwg:18098-18112
const BTN_EXIT = 3;          // id 3 → App vtable[0xa0] (Shutdown)       rwg:18115-18121
const BTN_CHANGE_PLAYER = 4; // id 4 → new ChangePlayerDialog FUN_004028ca, dialog id 3  rwg:18123-18146
// Credits link: its id is compared at rwg:18126 against the widget's own id
// (+0x84); the value itself is not a constant in the decompiled. Any id that
// is distinct from 1..4 is equivalent → 5. Action: FUN_004088d0(1000, app)
// (rwg:18128) = SelectLevelView in credits mode (see CreditsView.js).
const BTN_CREDITS = 5;

// Per-level bullet hints shown below the description in the LEVEL N briefing.
// Verified against screenshots 12 (level 1), 18 (level 2), 21 (level 3),
// 27 (level 4). Each level highlights what's new — no need to repeat earlier
// entries on later levels.
function _getLevelBullets(level) {
    const bullets = [];
    if (level === 1) {
        bullets.push({ iconKey: 'IMAGE_COIN_SILVER', frame: 6, value: '20',
            text: 'silver coins can be found by young chicken.' });
        bullets.push({ iconKey: 'IMAGE_COIN_GOLD', frame: 6, value: '30',
            text: 'golden coins can be found by grown up chicken.' });
    } else if (level === 2) {
        // Screenshot 18: white and broody (deep blue) eggs, not chicken previews.
        bullets.push({ iconKey: 'IMAGE_EGG', text: 'hatches into layer chicken.' });
        bullets.push({ iconKey: 'IMAGE_EGG', eggType: 4, text: 'hatches into broody chicken.' });
    } else if (level === 3) {
        bullets.push({ iconKey: 'IMAGE_CHICK_PREVIEW_LAYER',
            text: 'layer chicken, lays eggs.' });
        bullets.push({ iconKey: 'IMAGE_CHICK_PREVIEW_BROODY',
            text: 'broody chicken, hatches eggs.' });
    } else if (level === 4 || level === 5) {
        bullets.push({ iconKey: 'IMAGE_ALIEN_DOWN',
            text: 'raven, can steal your chickens' });
        bullets.push({ iconKey: 'IMAGE_CHICK_PREVIEW_ROOSTER',
            text: 'rooster, protects your chickens' });
    } else if (level >= 9 && level <= 12) {
        bullets.push({ iconKey: 'IMAGE_CHICK_PREVIEW_MAGIC',
            text: 'magic chicken, lays magic eggs' });
        bullets.push({ iconKey: 'IMAGE_DIAMOND_BLUE',
            text: 'magic chickens drop blue gems' });
    } else if (level >= 13 && level <= 15) {
        bullets.push({ iconKey: 'IMAGE_CHICK_PREVIEW_HOLY',
            text: 'holy chicken, casts spells' });
        bullets.push({ iconKey: 'IMAGE_DIAMOND_RED',
            text: 'holy chickens turn coins into red gems' });
    } else if (level === 17 || level === 18) {
        bullets.push({ iconKey: 'IMAGE_PET_IDLE_MOUSE',
            text: 'mouse pet, picks up coins for you' });
    } else if (level === 19 || level === 20) {
        bullets.push({ iconKey: 'IMAGE_PET_IDLE_ELEPHANT',
            text: 'elephant pet, scares ravens away' });
    } else if (level >= 26 && level <= 28) {
        bullets.push({ iconKey: 'IMAGE_PET_WALK_WOLF',
            text: 'wolves attack chickens — shoot them!' });
    }
    return bullets;
}

// Text-only Sexy::ButtonWidget used for the "Change player" / "Credits" links.
// Built by FUN_004215ad (rwg:41075): ButtonWidget(FUN_0043d2d7), label string,
// font FONT_DLG_BUTTONS, color[0] (label) = color[1] (label hilite) =
// RGB(255,255,255). MainMenuView::AddedToManager then overrides the font with
// FONT_10 (DAT_004fff0c, rwg:18002/18009), color[1] with RGB(0,255,0)
// (rwg:18004-18005 / 18011-18012) and sets byte +0xfe = 1 (rwg:18006/18013),
// which skips the default frame drawn by ButtonWidget::Draw FUN_0043d4cc.
class LabelButton extends ButtonWidget {
    constructor(id, listener, label) {
        super(id, listener);
        this.mLabel = label;
        this.mFontKey = 'FONT_10';
        this.mColors = [[255, 255, 255], [0, 255, 0]];
    }

    draw(g) {
        // ButtonWidget::Draw FUN_0043d4cc, label position (disassembly
        // @0x43d5c9-0x43d61e, BUTTON_LABEL_CENTER):
        //   x = (mWidth - StringWidth(label)) / 2
        //   y = (mHeight + ascent - ascent/6 - 1) / 2       (integer math)
        // Color index 1 when the mouse is over the widget (+0x55 mIsOver).
        const ctx = g.ctx;
        ctx.save();
        ctx.font = FONT_CSS[this.mFontKey];
        const asc = FONT_ASCENT[this.mFontKey];
        const tw = ctx.measureText(this.mLabel).width;
        const lx = Math.trunc((this.mWidth - tw) / 2);
        const ly = Math.trunc((this.mHeight + asc - Math.trunc(asc / 6) - 1) / 2);
        const [r, gg, b] = this.mColors[this.mIsOver ? 1 : 0];
        drawOutlinedText(ctx, this.mLabel, g.mTransX + lx, g.mTransY + ly, `rgb(${r},${gg},${b})`);
        ctx.restore();
    }
}

export class MainMenuView extends Widget {
    constructor(gameApp) {
        super();
        this.mGameApp = gameApp;
        // GameApp::showMainMenu FUN_00408799 (rwg:10755) resizes the view to
        // (0, 0, app.mWidth, app.mHeight) = 800x600.
        this.resize(0, 0, 800, 600);

        // Child widgets created in FUN_0040e5cb (rwg:17813-17845), in this
        // order: Start (+0x8c), Options (+0x90), Exit (+0x94), Change player
        // (+0x98), Credits (+0x9c). FUN_0042154d gives image buttons a size
        // equal to their image (Resize(0,0,img.w,img.h), rwg:41063).
        const mkImgBtn = (id, imgKey, overKey) => {
            const b = new ButtonWidget(id, this);
            b.mButtonImage = IMAGES[imgKey];   // +0xac
            b.mOverImage = IMAGES[overKey];    // +0xb0
            this.addWidget(b);
            return b;
        };
        // DAT_00500030/34 = IMAGE_MAIN_BUTTON_START/_OVER (rwg:17813-17818)
        this.mStartButton = mkImgBtn(BTN_START, 'IMAGE_MAIN_BUTTON_START', 'IMAGE_MAIN_BUTTON_START_OVER');
        // DAT_00500038/3c = IMAGE_MAIN_BUTTON_OPTIONS/_OVER (rwg:17824-17829)
        this.mOptionsButton = mkImgBtn(BTN_OPTIONS, 'IMAGE_MAIN_BUTTON_OPTIONS', 'IMAGE_MAIN_BUTTON_OPTIONS_OVER');
        // DAT_00500040/44 = IMAGE_MAIN_BUTTON_EXIT/_OVER (rwg:17830-17836)
        this.mExitButton = mkImgBtn(BTN_EXIT, 'IMAGE_MAIN_BUTTON_EXIT', 'IMAGE_MAIN_BUTTON_EXIT_OVER');
        // "Change player" / "Credits" text buttons (rwg:17838-17845).
        this.mChangePlayerButton = new LabelButton(BTN_CHANGE_PLAYER, this, 'Change player');
        this.addWidget(this.mChangePlayerButton);
        this.mCreditsButton = new LabelButton(BTN_CREDITS, this, 'Credits');
        this.addWidget(this.mCreditsButton);

        this._layoutButtons();

        // First-launch gate (AddedToManager rwg:18016-18028): when the app has
        // no current player (*(App+8)+0x10 == 0) open NewPlayerDialog
        // (FUN_0040f117) as dialog id 1.
        if (gameApp && gameApp.mCore && !gameApp.mCore.hasCurrentPlayer()) {
            new NewPlayerDialog(gameApp.mCore, () => {}, 'firstLaunch').openHtml();
        }
    }

    // MainMenuView::AddedToManager FUN_0040e83a (rwg:17988-18014).
    _layoutButtons() {
        const dim = (b) => {
            const im = b.mButtonImage;
            return im && im.img ? [im.mWidth || im.img.width, im.mHeight || im.img.height] : null;
        };
        const s = dim(this.mStartButton), o = dim(this.mOptionsButton), e = dim(this.mExitButton);
        if (s) {
            // iVar2 = start.w/2; iVar5 = iVar2 + 0x1b3 (rwg:17990-17991)
            const half = Math.trunc(s[0] / 2);
            const cx = half + 0x1b3;
            // Start: (iVar5 - iVar2, 0xeb=235, w, h)  rwg:17992
            this.mStartButton.resize(cx - half, 0xeb, s[0], s[1]);
            // Options: (iVar5 - w/2, 0x136=310, w, h)  rwg:17995
            if (o) this.mOptionsButton.resize(cx - Math.trunc(o[0] / 2), 0x136, o[0], o[1]);
            // Exit: (iVar5 - w/2, 0x181=385, w, h)  rwg:17998-17999
            if (e) this.mExitButton.resize(cx - Math.trunc(e[0] / 2), 0x181, e[0], e[1]);
            this._buttonsLaidOut = true;
        }
        // Change player: Resize(0, 0x30=48, 0x8a=138, 0x1e=30)  rwg:18001
        this.mChangePlayerButton.resize(0, 0x30, 0x8a, 0x1e);
        // Credits: Resize(0x280=640, 0x3c=60, 0x8a=138, 0x1e=30)  rwg:18008
        this.mCreditsButton.resize(0x280, 0x3c, 0x8a, 0x1e);
    }

    // MainMenuView::Draw FUN_0040e75a (rwg:17916-17957).
    draw(g) {
        // Images may finish loading after construction; the original lays out
        // in AddedToManager once resources exist.
        if (!this._buttonsLaidOut) this._layoutButtons();
        // JS-only: keep the HTML NewPlayer dialog up while there is no
        // current player (the original re-checks in AddedToManager,
        // rwg:18016-18028, every time the view is added).
        if (this.mGameApp && this.mGameApp.mCore
            && !this.mGameApp.mCore.hasCurrentPlayer()
            && !HtmlDialogs.isDialogOpen('new-player')) {
            new NewPlayerDialog(this.mGameApp.mCore, () => {}, 'firstLaunch').openHtml();
        }
        // DrawImage(DAT_004fff94 = IMAGE_MAIN_MENU, 0, 0)  rwg:17938
        g.drawImage(IMAGES.IMAGE_MAIN_MENU, 0, 0);

        // SetFont(DAT_004fff1c = FONT_24) rwg:17939; SetColor(DAT_005012a0 =
        // white) rwg:17940; string = "Welcome, " (0x4dd684) + player name
        // (FUN_0040285f; "" when no player) via FUN_0040e09f rwg:17941-17944;
        // DrawString(str, 0xe=14, 0x28=40) — disassembly @0x40e7dc-0x40e7e8.
        // screenshots/04.png shows the bare "Welcome," with no player yet.
        const playerName = (this.mGameApp && this.mGameApp.mPlayerName) || '';
        g.ctx.save();
        g.ctx.font = FONT_CSS.FONT_24;
        drawOutlinedText(g.ctx, 'Welcome, ' + playerName, g.mTransX + 14, g.mTransY + 40, '#fff');
        g.ctx.restore();

        // Portal logo: if (DAT_00500048) DrawImage(logo, 10, mHeight - logo.h - 10)
        // rwg:17950-17952 / disassembly @0x40e80a-0x40e820. The resource
        // ("images/portal_logo") is absent from app/images, so — as in the
        // original when DAT_00500048 == 0 — nothing is drawn.
        const logo = IMAGES.IMAGE_PORTAL_LOGO;
        if (logo && logo.img) {
            g.drawImage(logo, 10, this.mHeight - (logo.mHeight || logo.img.height) - 10);
        }

        // Children (Start, Options, Exit, Change player, Credits) are drawn by
        // the widget manager on top of the view, in AddedToManager order.
        super.draw(g);
    }

    keyDown(key) {
        // MainMenuView vtable overrides no key handler (vftable 0x4dd694).
        return false;
    }

    // MainMenuView::ButtonDepress FUN_0040ea92 (rwg:18061-18150).
    buttonDepress(id) {
        // PlaySample(DAT_004fed84 = SOUND_CLICK) before dispatch  rwg:18087
        if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();

        switch (id) {
            case BTN_START:
                // FUN_004088d0(-1, app) rwg:18089-18093 shows SelectLevelView;
                // its AddedToManager FUN_0041d22e (rwg:35539) opens
                // IntroductionDialog FUN_0040d936 when FUN_0041614b() == 1
                // (no level completed yet, rwg:28638), else SelectLevelDialog
                // FUN_0041c48a (param < 0x33). The JS IntroductionDialog is
                // driven by GameView at level 1, hence startGame(1).
                if (this.mGameApp.mCore && this.mGameApp.mCore.mMaxLevelReached > 1
                    && this.mGameApp.showSelectLevel) {
                    this.mGameApp.showSelectLevel();
                } else {
                    this.mGameApp.startGame(1);
                }
                break;
            case BTN_OPTIONS:
                // new OptionsDialog (FUN_0040f57b), AddDialog id 6  rwg:18098-18112
                this.mGameApp.showOptions();
                break;
            case BTN_EXIT:
                // App vtable[0xa0] (Shutdown) rwg:18115-18121. A browser page
                // cannot shut itself down — intentionally a no-op.
                break;
            case BTN_CHANGE_PLAYER:
                // new ChangePlayerDialog (FUN_004028ca), AddDialog id 3  rwg:18123-18146
                if (this.mGameApp.showChangePlayer) this.mGameApp.showChangePlayer();
                break;
            case BTN_CREDITS:
                // FUN_004088d0(1000, app) rwg:18126-18128 → SelectLevelView
                // credits roll (CreditsView 'credits').
                if (this.mGameApp.showCredits) this.mGameApp.showCredits();
                break;
        }
    }
}

export class SelectLevelView extends Widget {
    // Sexy::SelectLevelDialog (FUN_0041c48a:34676). Box (178, 77, 444, 445) per
    // DECOMPILED_MAP.md section 13. Per-level intro from FUN_0042399c:43542.
    constructor(gameApp) {
        super();
        this.mGameApp = gameApp;
        // Read max level from current profile
        this.mMaxLevel = (gameApp.mCore && gameApp.mCore.mMaxLevelReached) || 1;
        this.mSelectedLevel = Math.min(this.mMaxLevel, 50);
        this.resize(0, 0, 800, 600);
    }

    // Open + drive the HTML 'select-level' dialog over the main-menu background.
    openHtml() {
        HtmlDialogs.open('select-level', {
            onBind: { selectedlevel: value => {
                // FUN_0041c907:34968-34979 clamps the slider to unlocked levels.
                this.mSelectedLevel = Math.max(1, Math.min(Math.round(value), this.mMaxLevel, 50));
                this._renderHtml();
            } },
            actions: {
                prev: () => { if (this.mSelectedLevel > 1) { this.mSelectedLevel--; this._renderHtml(); } },
                next: () => {
                    const max = Math.min(this.mMaxLevel, 50);
                    if (this.mSelectedLevel < max) { this.mSelectedLevel++; this._renderHtml(); }
                },
                start: () => { HtmlDialogs.close('select-level'); this.mGameApp.startGame(this.mSelectedLevel); },
            },
        });
        this._renderHtml();
    }

    _renderHtml() {
        HtmlDialogs.set('select-level', 'level', `LEVEL ${this.mSelectedLevel}`);
        HtmlDialogs.set('select-level', 'selectedlevel', this.mSelectedLevel);
        HtmlDialogs.set('select-level', 'desc', getLevelDescription(this.mSelectedLevel));
        HtmlDialogs.fillList('select-level', 'bullets', _getLevelBullets(this.mSelectedLevel), (b, row) => {
            const ic = row.querySelector('.cc-bullet-icon');
            const img = b.iconKey ? IMAGES[b.iconKey] : null;
            if (ic) {
                if (img?.img) {
                    // Use composited alpha and a single native cel, not the full
                    // sprite sheet. Screenshot 12 coin face is the full-size cel.
                    const width = img.getCelWidth(), height = img.getCelHeight();
                    const cel = document.createElement('canvas');
                    cel.width = width; cel.height = height;
                    const tinted = b.eggType ? getTintedEggCel(img, b.frame || 0, b.eggType) : null;
                    cel.getContext('2d').drawImage(tinted || img.img,
                        tinted ? 0 : (b.frame || 0) * width, 0, width, height, 0, 0, width, height);
                    ic.src = cel.toDataURL();
                    // User-reported level 27 overflow: large enemy/pet cels fit
                    // the legend. Native 64px eggs and smaller previews stay 1:1.
                    const scale = width > 64 || height > 64 ? Math.min(64 / width, 56 / height) : 1;
                    ic.style.width = `${width * scale}px`; ic.style.height = `${height * scale}px`;
                    ic.style.display = '';
                }
                else ic.style.display = 'none';
            }
            row.querySelector('.cc-bullet-value').textContent = b.value || '';
            const t = row.querySelector('.cc-bullet-text');
            if (t) t.textContent = '- ' + b.text;
        });
        const root = document.querySelector('[data-dialog="select-level"]');
        if (root) {
            root.querySelector('.cc-box').dataset.level = String(this.mSelectedLevel);
            const max = Math.min(this.mMaxLevel, 50);
            const p = root.querySelector('.cc-prev'); if (p) p.disabled = this.mSelectedLevel <= 1;
            const n = root.querySelector('.cc-next'); if (n) n.disabled = this.mSelectedLevel >= max;
        }
    }

    // SelectLevelView::Draw FUN_0041cf6f (rwg:35400-35512). While no roll is
    // active (+0x8c == 0, rwg:35427-35434) it draws FUN_004248b4(g,
    // playerDecorations, -1): IMAGE_GAME_BACK + the player's decoration list
    // (FUN_00408234 copies it from the current player). screenshots/18.png
    // shows this field background behind SelectLevelDialog.
    // NOTE: GameApp.showSelectLevel currently keeps mMainMenuView as the
    // current view, so this draw only runs once GameApp routes to this view.
    draw(g) {
        drawFieldBackground(g, this._playerDecorations());
    }

    // UNKNOWN — not found in decompiled: how the JS profile's upgrade keys
    // (Core.mUpgradesPurchased, e.g. 'house_1') map to the 17 decoration
    // indices (0..16) that FUN_00408234 returns. Until that mapping is
    // ported, only the bare IMAGE_GAME_BACK is drawn.
    _playerDecorations() {
        return [];
    }
}

export class IntroductionDialog extends Widget {
    // Port of Sexy::IntroductionDialog - vtable at 004dd19c
    constructor(gameApp) {
        super();
        this.mGameApp = gameApp;
        this.resize(0, 0, 800, 600);
    }

    draw(g) {
        const bg = IMAGES.IMAGE_INTRODUCTION;
        if (bg && bg.img) {
            g.drawImage(bg, 0, 0);
        } else {
            g.setColor(60, 40, 20, 255);
            g.fillRect(50, 50, 700, 500);
        }

        const letter = IMAGES.IMAGE_INTRODUCTION_LETTER;
        if (letter && letter.img) {
            g.drawImage(letter, 100, 100);
        }

        g.ctx.fillStyle = '#fff';
        g.ctx.font = '14px Arial, sans-serif';
        g.ctx.textAlign = 'center';
        g.ctx.fillText('Click anywhere to start', 400, 560);
        g.ctx.textAlign = 'left';
    }

    mouseDown(x, y, btn) {
        this.mGameApp.startGame(1);
        return true;
    }
}
