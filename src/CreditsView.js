// Credits / Win screen.
// Two text blocks confirmed in decompiled source:
//   - FUN_0041d723 (rwg_functions.c:35923): "Congratulations!" win text
//   - FUN_0041d828 (rwg_functions.c:35977): alien-letter credits roll
// Both add lines via FUN_0041dbfd to a shared display.
//
// All strings cited and verbatim per the binary.

import { Widget } from './SexyApp.js';
import { IMAGES, SOUNDS } from './Res.js';

// Win text — appears after completing the final level (FUN_0041d723).
export const WIN_LINES = [
    'Congratulations!',                                                       // line 35944
    '',                                                                       // line 35949
    'You have completed the game and upgraded your house successfully!',      // line 35955
    '',                                                                       // line 35960
    'You have been given the rank of Poultry-Keeping Disciple!',              // line 35966
];

// Credits — alien letter (FUN_0041d828). Shown when "Credits" link clicked.
export const CREDITS_LINES = [
    'Good day, Earth dweller!',                                               // line 35998
    '',                                                                       // line 36003 (DAT_004df1c4 — empty/separator)
    'We came to let you know important news:',                                // line 36008
    'we have been observing you very closely, and The Intergalactic',         // line 36014
    'Business Committee has declared you the best poultry farmer',            // line 36020
    'on the Planet Earth. We have brought you an invitation for',             // line 36026
    'participation in the Intergalactic Poultry Breeding tournament,',        // line 36032
    'where you will compete against the winners from other planets.',         // line 36038
    'Welcome!',                                                               // line 36043
];

export class CreditsView extends Widget {
    constructor(gameApp, mode = 'credits') {
        super();
        this.mGameApp = gameApp;
        this.mMode = mode; // 'credits' or 'win'
        this.mLines = mode === 'win' ? WIN_LINES : CREDITS_LINES;
        this.mScrollY = 600;          // start lines below the screen, scroll up
        this.mScrollSpeed = 0.5;      // pixels/tick
        this.resize(0, 0, 800, 600);
    }

    update() {
        // Slowly scroll text upward
        this.mScrollY -= this.mScrollSpeed;
        // Auto-return to main menu when finished
        const totalH = this.mLines.length * 36 + 200;
        if (this.mScrollY < -totalH) {
            this._dismiss();
        }
    }

    draw(g) {
        // Background — use IMAGE_INTRODUCTION for visual consistency or a darker bg
        const bg = IMAGES.IMAGE_MAIN_MENU;
        if (bg && bg.img) {
            g.drawImage(bg, 0, 0);
            g.setColor(0, 0, 0, 180);
            g.fillRect(0, 0, 800, 600);
        } else {
            g.setColor(20, 30, 60, 255);
            g.fillRect(0, 0, 800, 600);
        }

        const ctx = g.ctx;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 32px Arial Black, Arial, sans-serif';
        ctx.fillText(this.mMode === 'win' ? 'Game Complete' : 'Credits',
            400, 60);

        ctx.font = '18px Arial, sans-serif';
        let y = this.mScrollY;
        for (const line of this.mLines) {
            if (y > -40 && y < 600) {
                // Drop shadow
                ctx.fillStyle = 'rgba(0,0,0,0.7)';
                ctx.fillText(line, 401, y + 1);
                ctx.fillStyle = '#fff';
                ctx.fillText(line, 400, y);
            }
            y += 36;
        }

        // Footer prompt
        ctx.fillStyle = '#aaa';
        ctx.font = '12px Arial, sans-serif';
        ctx.fillText('Click anywhere to return to the main menu',
            400, 580);
        ctx.textAlign = 'left';
    }

    mouseDown(x, y, btn) {
        if (btn === 0) this._dismiss();
        return true;
    }

    keyDown(key) {
        if (key === 'Escape' || key === ' ' || key === 'Enter') this._dismiss();
        return true;
    }

    _dismiss() {
        if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
        if (this.mGameApp && this.mGameApp.showMainMenu) this.mGameApp.showMainMenu();
    }
}
