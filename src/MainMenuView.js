// Sexy::MainMenuView (vftable 0x4dd690 / 0x4dd694).
// Constructor FUN_0040e5cb (rwg_functions.c:17785).
// AddedToManager FUN_0040e83a (button positions, line 17961-18014).
// Draw FUN_0040e75a (line 17916).
// ButtonDepress FUN_0040ea92 (line 18061).
// All positions/labels verified per DECOMPILED_MAP.md section 14.

import { Widget, ButtonWidget } from './SexyApp.js';
import { IMAGES, SOUNDS } from './Res.js';
import { NewPlayerDialog } from './PlayerDialogs.js';
import { getLevelDescription } from './LevelData.js';
import { drawFitText } from './TextUtil.js';
import { HtmlDialogs } from './HtmlDialogs.js';
import { getTintedEggCel } from './Gem.js';

const BTN_START = 1;       // ID 1 → start game (rwg_functions.c:18089)
const BTN_OPTIONS = 2;     // ID 2 → OptionsDialog (line 18098)
const BTN_EXIT = 3;        // ID 3 → Shutdown (line 18114)
const BTN_CHANGE_PLAYER = 4; // ID 4 → ChangePlayerDialog (line 18130)
const BTN_CREDITS = 5;     // dynamic ID, opens credits dialog id 1000

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

export class MainMenuView extends Widget {
    constructor(gameApp) {
        super();
        this.mGameApp = gameApp;
        this.resize(0, 0, 800, 600);

        // Start button: x=0x1b3=435, y=0xeb=235 (rwg_functions.c:17992)
        const startBtn = new ButtonWidget(BTN_START, this);
        const sw = (IMAGES.IMAGE_MAIN_BUTTON_START && IMAGES.IMAGE_MAIN_BUTTON_START.img)
            ? IMAGES.IMAGE_MAIN_BUTTON_START.img.width : 230;
        const sh = (IMAGES.IMAGE_MAIN_BUTTON_START && IMAGES.IMAGE_MAIN_BUTTON_START.img)
            ? IMAGES.IMAGE_MAIN_BUTTON_START.img.height : 64;
        startBtn.resize(435, 235, sw, sh);
        startBtn.mButtonImage = IMAGES.IMAGE_MAIN_BUTTON_START;
        startBtn.mOverImage = IMAGES.IMAGE_MAIN_BUTTON_START_OVER;
        this.addWidget(startBtn);

        // Options button: y=0x136=310, x ≈ centered with Start (rwg_functions.c:17995)
        const optBtn = new ButtonWidget(BTN_OPTIONS, this);
        const ow = (IMAGES.IMAGE_MAIN_BUTTON_OPTIONS && IMAGES.IMAGE_MAIN_BUTTON_OPTIONS.img)
            ? IMAGES.IMAGE_MAIN_BUTTON_OPTIONS.img.width : 190;
        const oh = (IMAGES.IMAGE_MAIN_BUTTON_OPTIONS && IMAGES.IMAGE_MAIN_BUTTON_OPTIONS.img)
            ? IMAGES.IMAGE_MAIN_BUTTON_OPTIONS.img.height : 64;
        optBtn.resize(435 + Math.floor((sw - ow) / 2), 310, ow, oh);
        optBtn.mButtonImage = IMAGES.IMAGE_MAIN_BUTTON_OPTIONS;
        optBtn.mOverImage = IMAGES.IMAGE_MAIN_BUTTON_OPTIONS_OVER;
        this.addWidget(optBtn);

        // Exit button: y=0x181=385 (rwg_functions.c:17999)
        const exitBtn = new ButtonWidget(BTN_EXIT, this);
        const ew = (IMAGES.IMAGE_MAIN_BUTTON_EXIT && IMAGES.IMAGE_MAIN_BUTTON_EXIT.img)
            ? IMAGES.IMAGE_MAIN_BUTTON_EXIT.img.width : 128;
        const eh = (IMAGES.IMAGE_MAIN_BUTTON_EXIT && IMAGES.IMAGE_MAIN_BUTTON_EXIT.img)
            ? IMAGES.IMAGE_MAIN_BUTTON_EXIT.img.height : 64;
        exitBtn.resize(435 + Math.floor((sw - ew) / 2), 385, ew, eh);
        exitBtn.mButtonImage = IMAGES.IMAGE_MAIN_BUTTON_EXIT;
        exitBtn.mOverImage = IMAGES.IMAGE_MAIN_BUTTON_EXIT_OVER;
        this.addWidget(exitBtn);

        // "Change player" link: top-left at (0, 48, 138, 30) (rwg_functions.c:18001-18007)
        // Hover color = green RGB(0, 0xff, 0)
        this._changePlayerRect = { x: 0, y: 48, w: 138, h: 30 };
        // "Credits" link: top-right at (640, 60, 138, 30) (rwg_functions.c:18008-18014)
        this._creditsRect = { x: 640, y: 60, w: 138, h: 30 };

        // Modal dialog state (NewPlayer / ChangePlayer)
        this.mModal = null;

        // First-launch detection (rwg_functions.c:18016-18028).
        // Original test: `*(int *)(*(int *)(App+8) + 0x10) == 0` → no current player.
        // We map this to Core.hasCurrentPlayer().
        if (gameApp && gameApp.mCore && !gameApp.mCore.hasCurrentPlayer()) {
            new NewPlayerDialog(gameApp.mCore, () => {}, 'firstLaunch').openHtml();
        }
    }

    draw(g) {
        // If the player has no profile (first launch, or deleted their last one
        // via ChangePlayerDialog), keep the HTML NewPlayer dialog open. Guarded
        // by isDialogOpen so it isn't re-created every frame.
        if (this.mGameApp && this.mGameApp.mCore
            && !this.mGameApp.mCore.hasCurrentPlayer()
            && !HtmlDialogs.isDialogOpen('new-player')) {
            new NewPlayerDialog(this.mGameApp.mCore, () => {}, 'firstLaunch').openHtml();
        }
        // Background image: DAT_004fff94 = IMAGE_MAIN_MENU (rwg_functions.c:17938)
        const bg = IMAGES.IMAGE_MAIN_MENU;
        if (bg && bg.img) {
            g.drawImage(bg, 0, 0);
        } else {
            g.setColor(40, 80, 30, 255);
            g.fillRect(0, 0, 800, 600);
            g.ctx.fillStyle = '#ffd700';
            g.ctx.font = 'bold 48px Arial Black, Arial, sans-serif';
            g.ctx.textAlign = 'center';
            g.ctx.fillText('Chicken Chase', 400, 200);
            g.ctx.textAlign = 'left';
        }

        // Player name with "Welcome, " prefix.
        // String "Welcome, " confirmed in chicken_chase.RWG binary (CORRECTION:
        // earlier extraction missed this — it doesn't appear as a literal in the
        // Ghidra .c export but is present in the binary string table).
        // Font DAT_004fff1c (FONT_24), color DAT_005012a0 (white).
        const playerName = (this.mGameApp && this.mGameApp.mPlayerName) || '';
        // Bigger font with dark stroke per screenshot 06 — each letter has a
        // black/grey outline for readability against the bright background.
        g.ctx.font = 'bold 28px Arial Black, Arial, sans-serif';
        g.ctx.textAlign = 'left';
        // Drop the trailing ", " when no name is set yet (very first launch
        // before NewPlayerDialog completes), so it doesn't read "Welcome,".
        const welcomeText = playerName ? 'Welcome, ' + playerName : 'Welcome!';
        g.ctx.lineWidth = 4;
        g.ctx.strokeStyle = '#333';
        g.ctx.strokeText(welcomeText, 12, 38);
        g.ctx.fillStyle = '#fff';
        g.ctx.fillText(welcomeText, 12, 38);
        // Show progress under the welcome line. mMaxLevelReached is bumped
        // to 51 after the win screen (unlockNextLevel(level+1)), so use that
        // as the "fully completed" signal.
        const maxLevel = (this.mGameApp.mCore && this.mGameApp.mCore.mMaxLevelReached) || 1;
        if (maxLevel > 1) {
            g.ctx.fillStyle = '#ffd700';
            g.ctx.font = '12px Arial, sans-serif';
            const progressText = maxLevel > 50
                ? 'All levels complete!'
                : `Progress: Level ${maxLevel}`;
            g.ctx.fillText(progressText, 12, 44);
        }

        // Portal logo top-right (rwg_functions.c:17950-17952)
        const logo = IMAGES.IMAGE_PORTAL_LOGO;
        if (logo && logo.img) {
            const lw = logo.img.width;
            g.ctx.drawImage(logo.img, 800 - lw - 10, 0);
        }

        // Screenshot 06: white text with a black outline, like Welcome.
        // Keep browser-rendered text; 14px bold is an approximation of FONT_12.
        // Hover color = green RGB(0, 0xff, 0) per rwg_functions.c:18001-18007.
        const cpColor = this._changePlayerHover ? '#0f0' : '#fff';
        g.ctx.save();
        g.ctx.fillStyle = cpColor;
        g.ctx.font = 'bold 14px Arial, sans-serif';
        const cpText = 'Change player';
        const cpX = this._changePlayerRect.x + 16; // screenshots/06.png: left ink at x=16
        const cpY = this._changePlayerRect.y + 18;
        g.ctx.strokeStyle = '#000';
        g.ctx.lineWidth = 2;
        g.ctx.lineJoin = 'round';
        g.ctx.strokeText(cpText, cpX, cpY);
        g.ctx.fillText(cpText, cpX, cpY);
        g.ctx.restore();

        // "Credits" link (top-right)
        const crColor = this._creditsHover ? '#0f0' : '#fff';
        g.ctx.fillStyle = crColor;
        g.ctx.font = '13px Arial, sans-serif';
        g.ctx.lineWidth = 1;
        g.ctx.textAlign = 'right';
        const crText = 'Credits';
        const crRightX = this._creditsRect.x + this._creditsRect.w - 4;
        const crY = this._creditsRect.y + 18;
        g.ctx.fillText(crText, crRightX, crY);
        const crW = g.ctx.measureText(crText).width;
        g.ctx.strokeStyle = crColor;
        g.ctx.beginPath();
        g.ctx.moveTo(crRightX - crW, crY + 2);
        g.ctx.lineTo(crRightX, crY + 2);
        g.ctx.stroke();
        g.ctx.textAlign = 'left';

        // Draw child widgets (buttons)
        super.draw(g);

        // Modal overlay (NewPlayer / ChangePlayer) on top of everything
        if (this.mModal) this.mModal.draw(g);
    }

    mouseMove(x, y) {
        const cp = this._changePlayerRect, cr = this._creditsRect;
        this._changePlayerHover = x >= cp.x && x <= cp.x + cp.w && y >= cp.y && y <= cp.y + cp.h;
        this._creditsHover = x >= cr.x && x <= cr.x + cr.w && y >= cr.y && y <= cr.y + cr.h;
        super.mouseMove(x, y);
    }

    mouseDown(x, y, btn) {
        // Modal eats clicks first
        if (this.mModal && this.mModal.isShown()) {
            this.mModal.mouseDown(x, y, btn);
            return true;
        }
        // Change player link
        const cp = this._changePlayerRect;
        if (x >= cp.x && x <= cp.x + cp.w && y >= cp.y && y <= cp.y + cp.h) {
            this.buttonDepress(BTN_CHANGE_PLAYER);
            return true;
        }
        // Credits link
        const cr = this._creditsRect;
        if (x >= cr.x && x <= cr.x + cr.w && y >= cr.y && y <= cr.y + cr.h) {
            this.buttonDepress(BTN_CREDITS);
            return true;
        }
        return super.mouseDown(x, y, btn);
    }

    keyDown(key) {
        if (this.mModal && this.mModal.isShown()) {
            this.mModal.keyDown(key);
            return true;
        }
        return false;
    }

    buttonDepress(id) {
        if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();

        switch (id) {
            case BTN_START:
                // Original opens SelectLevelDialog (FUN_0041c48a). If max-level == 1, jump straight to level 1.
                if (this.mGameApp.mCore && this.mGameApp.mCore.mMaxLevelReached > 1
                    && this.mGameApp.showSelectLevel) {
                    this.mGameApp.showSelectLevel();
                } else {
                    this.mGameApp.startGame(1);
                }
                break;
            case BTN_OPTIONS:
                this.mGameApp.showOptions();
                break;
            case BTN_EXIT:
                // Can't exit in browser, just show message
                break;
            case BTN_CHANGE_PLAYER:
                if (this.mGameApp.showChangePlayer) this.mGameApp.showChangePlayer();
                break;
            case BTN_CREDITS:
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

    draw(g) {
        // Background — main menu image (the dialog overlays it)
        const bg = IMAGES.IMAGE_MAIN_MENU;
        if (bg && bg.img) {
            g.drawImage(bg, 0, 0);
            g.setColor(0, 0, 0, 100);
            g.fillRect(0, 0, 800, 600);
        } else {
            g.setColor(40, 60, 30, 255);
            g.fillRect(0, 0, 800, 600);
        }

        // Box (178, 77, 444, 445) — verified from FUN_0041c860:34755. 9-sliced so
        // the baked title plate stays a fixed size at the top.
        const bx = 178, by = 77, bw = 444, bh = 445;
        const plate = g.drawDialogBox(IMAGES.IMAGE_DIALOG_BOX, bx, by, bw, bh);

        // Title — green plate with white text (screenshot 18 shows a GREEN plate,
        // matching the START LEVEL button), drawn over the box's title-plate band.
        // The 'LEVEL N' text is not a decompiled literal (header formatter args
        // unresolved) — read from screenshot 18. FONT_DLG_HEADER (resources.xml:61).
        const titleCx = bx + bw / 2, titleCy = plate.plateCenterY;
        g.ctx.fillStyle = '#4caf26';
        g.ctx.strokeStyle = '#2a6a18';
        g.ctx.lineWidth = 2;
        const badgeW = 190, badgeH = 34;
        g.ctx.fillRect(titleCx - badgeW / 2, titleCy - badgeH / 2, badgeW, badgeH);
        g.ctx.strokeRect(titleCx - badgeW / 2, titleCy - badgeH / 2, badgeW, badgeH);
        g.ctx.fillStyle = '#fff';
        g.ctx.textAlign = 'center';
        g.ctx.textBaseline = 'middle';
        drawFitText(g.ctx, `LEVEL ${this.mSelectedLevel}`, titleCx, titleCy, badgeW - 20,
            'bold 18px "Arial Black", Arial, sans-serif');
        g.ctx.textBaseline = 'alphabetic';

        // Description — per-level intro (FUN_0042399c assigns this+0x35;
        // strings CONFIRMED, e.g. rwg:43557/43561). FONT_DLG_LINES (resources.xml:62),
        // dark text on the tan box (screenshot 18).
        const desc = getLevelDescription(this.mSelectedLevel);
        g.ctx.fillStyle = '#3a1a05';
        g.ctx.font = 'bold 13px "Arial Black", Arial, sans-serif';
        g.ctx.textAlign = 'center';
        const wrapW = bw - 80;
        const words = desc.split(' ');
        let line = '';
        let y = by + 120;
        for (const word of words) {
            const test = line ? line + ' ' + word : word;
            if (g.ctx.measureText(test).width > wrapW && line) {
                g.ctx.fillText(line, bx + bw / 2, y);
                line = word;
                y += 18;
                if (y > by + bh - 200) break;
            } else {
                line = test;
            }
        }
        if (line) {
            g.ctx.fillText(line, bx + bw / 2, y);
            y += 18;
        }

        // Per-level bullet hints (per screenshots 12/18/21/27) — small icon +
        // short note for each new entity introduced at this level.
        // Bullet rows: blue dot + icon + caption (screenshot 18). Caption strings
        // are NOT in the decompiled — read from screenshots 12/18/21/27.
        const bullets = _getLevelBullets(this.mSelectedLevel);
        y += 12;
        for (const b of bullets) {
            // Blue round marker (screenshot 18)
            const markX = bx + 50;
            g.ctx.fillStyle = '#2f6fd0';
            g.ctx.beginPath();
            g.ctx.arc(markX + 4, y + 8, 5, 0, Math.PI * 2);
            g.ctx.fill();
            // Icon (chick preview or raven sprite)
            const iconImg = b.iconKey ? IMAGES[b.iconKey] : null;
            const iconX = markX + 18;
            if (iconImg && iconImg.img && g._isReady && g._isReady(iconImg.img)) {
                g.ctx.drawImage(iconImg.img, iconX, y - 4, 24, 24);
            }
            // Text — FONT_DLG_LINES (resources.xml:62), dark.
            g.ctx.fillStyle = '#3a1a05';
            g.ctx.font = '12px "Arial Black", Arial, sans-serif';
            g.ctx.textAlign = 'left';
            g.ctx.fillText(b.text, iconX + 30, y + 14);
            y += 28;
            if (y > by + bh - 130) break;
        }
        g.ctx.textAlign = 'center';

        // Prev/Next nav buttons. CONFIRMED rwg:34942/34945/34937:
        //   prevX = bx+0x17 = 201; nextX = bx-0x62+bw = 524; navY = 415.
        // Arrows 74x36 (image-native). Prev disabled at level 1 (rwg:34810),
        // next disabled past 50 (rwg:34812).
        const navY = 415;
        const prevImg = IMAGES.IMAGE_BUTTON_PREV;
        const nextImg = IMAGES.IMAGE_BUTTON_NEXT;
        const prevW = (prevImg && prevImg.img) ? prevImg.mWidth : 74;
        const prevH = (prevImg && prevImg.img) ? prevImg.mHeight : 36;
        const nextW = (nextImg && nextImg.img) ? nextImg.mWidth : 74;
        const nextH = (nextImg && nextImg.img) ? nextImg.mHeight : 36;
        const prevX = 201, nextX = 524;
        const prevEnabled = this.mSelectedLevel > 1;
        const nextEnabled = this.mSelectedLevel < Math.min(this.mMaxLevel, 50);
        g.ctx.globalAlpha = prevEnabled ? 1 : 0.4;
        if (prevImg && prevImg.img && g._isReady && g._isReady(prevImg.img)) {
            g.ctx.drawImage(prevImg.img, prevX, navY, prevW, prevH);
        } else {
            g.setColor(100, 60, 20, 255);
            g.fillRect(prevX, navY, prevW, prevH);
        }
        g.ctx.globalAlpha = nextEnabled ? 1 : 0.4;
        if (nextImg && nextImg.img && g._isReady && g._isReady(nextImg.img)) {
            g.ctx.drawImage(nextImg.img, nextX, navY, nextW, nextH);
        } else {
            g.setColor(100, 60, 20, 255);
            g.fillRect(nextX, navY, nextW, nextH);
        }
        g.ctx.globalAlpha = 1;
        this._prevRect = { x: prevX, y: navY, w: prevW, h: prevH };
        this._nextRect = { x: nextX, y: navY, w: nextW, h: nextH };

        // START LEVEL button (string CONFIRMED rwg:34699). Wide bar near the
        // bottom (screenshot 18). FONT_DLG_BUTTONS (resources.xml:63).
        const btnImg = IMAGES.IMAGE_DIALOG_BUTTON;
        const btnW = bw - 56, btnH = 30;
        const btnX = bx + (bw - btnW) / 2;
        const btnY = by + bh - btnH - 30;
        if (btnImg && btnImg.img && g._isReady && g._isReady(btnImg.img)) {
            g.ctx.drawImage(btnImg.img, btnX, btnY, btnW, btnH);
        } else {
            g.setColor(80, 160, 40, 255);
            g.fillRect(btnX, btnY, btnW, btnH);
        }
        g.ctx.fillStyle = '#fff';
        g.ctx.font = '12px "Arial Black", Arial, sans-serif';
        g.ctx.textAlign = 'center';
        g.ctx.fillText('START LEVEL', btnX + btnW / 2, btnY + btnH / 2 + 4);
        this._startRect = { x: btnX, y: btnY, w: btnW, h: btnH };
        // No '< BACK' link — not present in screenshots 12/18/21/27 (Escape
        // still returns to the main menu via keyDown).
        this._backRect = null;
        g.ctx.textAlign = 'left';
    }

    mouseDown(x, y, btn) {
        if (btn !== 0) return false;
        // Back link
        if (this._backRect && x >= this._backRect.x && x <= this._backRect.x + this._backRect.w
            && y >= this._backRect.y && y <= this._backRect.y + this._backRect.h) {
            this.mGameApp.showMainMenu();
            return true;
        }
        // Prev (FUN_0041c98e: level >= 2 → level--)
        if (this._prevRect && x >= this._prevRect.x && x <= this._prevRect.x + this._prevRect.w
            && y >= this._prevRect.y && y <= this._prevRect.y + this._prevRect.h) {
            if (this.mSelectedLevel > 1) this.mSelectedLevel--;
            return true;
        }
        // Next (FUN_0041c98e: level < maxUnlocked → level++). Cap at 50 —
        // mMaxLevelReached is bumped to 51 after the player beats the final
        // level (unlockNextLevel +1), which would otherwise let the player
        // navigate to a nonexistent level 51 via the next arrow.
        const navMax = Math.min(this.mMaxLevel, 50);
        if (this._nextRect && x >= this._nextRect.x && x <= this._nextRect.x + this._nextRect.w
            && y >= this._nextRect.y && y <= this._nextRect.y + this._nextRect.h) {
            if (this.mSelectedLevel < navMax) this.mSelectedLevel++;
            return true;
        }
        // START LEVEL
        if (this._startRect && x >= this._startRect.x && x <= this._startRect.x + this._startRect.w
            && y >= this._startRect.y && y <= this._startRect.y + this._startRect.h) {
            if (this.mSelectedLevel <= navMax) {
                this.mGameApp.startGame(this.mSelectedLevel);
            }
            return true;
        }
        return false;
    }

    keyDown(key) {
        const navMax = Math.min(this.mMaxLevel, 50);
        if (key === 'Escape') {
            this.mGameApp.showMainMenu();
            return true;
        }
        if (key === 'ArrowLeft' && this.mSelectedLevel > 1) {
            this.mSelectedLevel--;
            return true;
        }
        if (key === 'ArrowRight' && this.mSelectedLevel < navMax) {
            this.mSelectedLevel++;
            return true;
        }
        if ((key === 'Enter' || key === ' ') && this.mSelectedLevel <= navMax) {
            this.mGameApp.startGame(this.mSelectedLevel);
            return true;
        }
        return false;
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
