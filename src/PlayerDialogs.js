// NewPlayerDialog and ChangePlayerDialog.
// Citations from DECOMPILED_MAP.md section 13/14.
//
// NewPlayerDialog (FUN_0040f117:18703):
//   Box (250, 200, 300, 200), title "NEW PLAYER", OK button.
//   EditBox max 15 chars (rwg_functions.c:18769). Font DAT_004fff14.
//
// ChangePlayerDialog (FUN_004028ca:2598):
//   Box (200, 125, 300, 350), title "WHO ARE YOU?", buttons OK/NEW/DELETE.
//   ListBox at (50, 100, 300, 300) populated from player list.

import { IMAGES, SOUNDS } from './Res.js';
import { PLAYER_NAME_MAX_LEN } from './Core.js';
import { drawFitText } from './TextUtil.js';
import { HtmlDialogs } from './HtmlDialogs.js';

// AllowChar FUN_0040f43e: characters the name edit box rejects.
const NEWPLAYER_REJECT = /[ #$%&()*+\-.:@^]/g;

// "QUESTION" / "Delete user?" (FUN_00402ee5 rwg:3041-3044) — YES/NO dialog
// built by FUN_0040279c; static HTML node data-dialog="delete-user".
const DELETE_USER_DIALOG = 'delete-user';

export class NewPlayerDialog {
    // mode: 'firstLaunch' (cancel hidden) or 'addPlayer'
    constructor(core, onComplete, mode = 'addPlayer') {
        this.mCore = core;
        this.mOnComplete = onComplete; // (newName | null) — null on cancel
        this.mMode = mode;
        this.mInput = '';
        this.mIsActive = true;
        // FUN_0040f117 @0x40f15a-0x40f17e: StdDialog button mode =
        // (Core player list size (Core+8)+0x10 != 0) ? 2 (OK + CANCEL) : 3
        // (footer OK only) — decided by the player COUNT, not by the caller.
        this.mShowCancel = !!(core && core.mPlayers && core.mPlayers.length !== 0);
    }

    isShown() { return this.mIsActive; }

    // Open + drive the HTML 'new-player' dialog. Reuses addPlayer/selectPlayer.
    // Enter in the edit box = EditWidgetText FUN_0040f47e → ButtonDepress(1000).
    // AllowChar FUN_0040f43e (rwg:18956) rejects space and # $ % & ( ) * + - . : @ ^.
    openHtml() {
        HtmlDialogs.open('new-player', {
            binds: { name: this.mInput || '', error: '' },
            visible: { cancel: this.mShowCancel },
            actions: {
                ok: () => {
                    this.mInput = HtmlDialogs.read('new-player', 'name') || '';
                    this._submitHtml();
                },
                cancel: () => {
                    // FUN_0040f3c5: click sound first (vtable+0xc4), then 0x3e9 closes.
                    if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
                    HtmlDialogs.close('new-player');
                    this.mIsActive = false;
                    if (this.mOnComplete) this.mOnComplete(null);
                },
            },
        });
        const input = document.querySelector('[data-dialog="new-player"] input[data-bind="name"]');
        if (!input) return;
        input._ccOwner = this;   // Enter goes to the dialog instance now open
        if (!input._ccNewPlayerHooked) {
            input._ccNewPlayerHooked = true;
            input.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' || !input._ccOwner) return;
                e.preventDefault();
                const owner = input._ccOwner;
                owner.mInput = input.value;
                owner._submitHtml();
            });
            input.addEventListener('input', () => {
                const filtered = input.value.replace(NEWPLAYER_REJECT, '').slice(0, PLAYER_NAME_MAX_LEN);
                if (filtered !== input.value) input.value = filtered;
            });
        }
    }

    // ButtonDepress FUN_0040f3c5 (rwg:18887): plays the click sound for any
    // button; id 1000 with an empty name (+0xf4 == 0) does nothing more.
    // Otherwise the name goes to the listener (Core.addPlayer selects an
    // existing player of the same name, rwg:28111) and the dialog is removed.
    _submitHtml() {
        if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
        const name = this.mInput;
        if (!name) return;
        const player = this.mCore.addPlayer(name);
        if (player) {
            this.mIsActive = false;
            HtmlDialogs.close('new-player');
            if (this.mOnComplete) this.mOnComplete(player.name);
        }
    }

    draw(g) {
        if (!this.mIsActive) return;
        // Modal scrim
        g.setColor(0, 0, 0, 150);
        g.fillRect(0, 0, 800, 600);

        // Box (250, 200, 300, 200), 9-sliced so the title plate stays natural.
        const bx = 250, by = 200, bw = 300, bh = 200;
        const plate = g.drawDialogBox(IMAGES.IMAGE_DIALOG_BOX, bx, by, bw, bh);

        // Title 'NEW PLAYER' (string rwg:18729) centered IN the plate.
        // FONT_DLG_HEADER=ArialBlack14 (resources.xml:61).
        g.ctx.fillStyle = '#ffd700';
        g.ctx.textAlign = 'center';
        g.ctx.textBaseline = 'middle';
        drawFitText(g.ctx, 'NEW PLAYER', bx + bw / 2, plate.plateCenterY, bw - 40,
            'bold 14px "Arial Black", Arial, sans-serif');
        g.ctx.textBaseline = 'alphabetic';

        // Input field. EditBox Resize rwg:18893: x=bx+27 (0x1b), y=by+80 (0x50),
        // w=bw-55 (0x37), h=fontH+2≈31 (FONT_16=ArialBlack16 glyph 29+2).
        const ix = bx + 27, iy = by + 80, iw = bw - 55, ih = 31;
        g.ctx.fillStyle = '#fafaf3';  // input fill measured from screenshot 04
        g.ctx.fillRect(ix, iy, iw, ih);
        g.ctx.strokeStyle = '#000';   // 1px border measured from screenshot 04
        g.ctx.lineWidth = 1;
        g.ctx.strokeRect(ix, iy, iw, ih);

        // Input text — FONT_16 = ArialBlack16 (rwg:18762; resources.xml:56).
        g.ctx.fillStyle = '#222';
        g.ctx.font = '16px "Arial Black", Arial, sans-serif';
        g.ctx.textAlign = 'left';
        const cursor = (Math.floor(Date.now() / 500) % 2) ? '|' : ' ';
        const display = this.mInput || '';
        g.ctx.fillText(display + cursor, ix + 8, iy + 22);
        if (!this.mInput) {
            g.ctx.fillStyle = 'rgba(120,80,40,0.5)';
            g.ctx.fillText('Player name…', ix + 8, iy + 22);
        }

        // Error only (the always-on helper sentence was invented — the dialog's
        // 'lines' string is empty, rwg:18727; removed).
        if (this.mError) {
            g.ctx.fillStyle = '#ff6666';
            g.ctx.textAlign = 'center';
            drawFitText(g.ctx, this.mError, bx + bw / 2, by + 126, bw - 30,
                '11px Arial, sans-serif');
        }

        // Buttons. Single OK on first launch; OK + CANCEL when adding a player
        // (screenshot 09). Strings 'OK' rwg:18725, 'CANCEL' from data segment
        // (text measured from screenshot 09). FONT_DLG_BUTTONS=ArialBlack12.
        // Positions measured from screenshots 04/09 (framework-laid in decompiled).
        const btnH = 32, btnTopY = by + 136;
        if (this.mShowCancel) {
            const pairLeft = bx + 27, pairRight = bx + bw - 31, gap = 16;
            const eachW = Math.floor((pairRight - pairLeft - gap) / 2);
            this._okRect = this._drawNpButton(g, 'OK', pairLeft, btnTopY, eachW, btnH);
            this._cancelRect = this._drawNpButton(g, 'CANCEL', pairLeft + eachW + gap, btnTopY, eachW, btnH);
        } else {
            const okW = bw - 68;
            this._okRect = this._drawNpButton(g, 'OK', bx + 34, btnTopY, okW, btnH);
            this._cancelRect = null;
        }
        g.ctx.textAlign = 'left';
    }

    _drawNpButton(g, label, x, y, w, h) {
        const btnImg = IMAGES.IMAGE_DIALOG_BUTTON;
        if (btnImg && btnImg.img && g._isReady && g._isReady(btnImg.img)) {
            g.ctx.drawImage(btnImg.img, x, y, w, h);
        } else {
            g.setColor(80, 160, 40, 255);
            g.fillRect(x, y, w, h);
        }
        g.ctx.fillStyle = '#fff';
        g.ctx.font = '12px "Arial Black", Arial, sans-serif';
        g.ctx.textAlign = 'center';
        g.ctx.fillText(label, x + w / 2, y + h / 2 + 4);
        return { x, y, w, h };
    }

    // (The former canvas keyDown/mouseDown/_submit path was dead code with
    // invented behavior — "Please enter a name"/"That name is taken" errors,
    // Escape-to-cancel, a different char filter — and has been removed. The
    // live logic is openHtml/_submitHtml above.)
}

export class ChangePlayerDialog {
    constructor(core, onComplete) {
        this.mCore = core;
        this.mOnComplete = onComplete;
        this.mIsActive = true;
        this.mSelected = core.mCurrentName || (core.mPlayers[0] && core.mPlayers[0].name) || null;
        this.mShowNewPlayer = null;
    }

    isShown() { return this.mIsActive || (this.mShowNewPlayer && this.mShowNewPlayer.isShown()); }

    // Open + drive the HTML 'change-player' dialog. Reuses core player methods.
    openHtml() {
        HtmlDialogs.open('change-player', {
            actions: {
                select: ({ index }) => {
                    const list = this.mCore.listPlayers();
                    if (list[index] != null) this.mSelected = list[index];
                    this._renderHtml();
                },
                // ButtonDepress FUN_00402ee5 (rwg:2963): SOUND_CLICK
                // (DAT_004fed84, @0x402f09) for EVERY button, then:
                //   1000 (OK): FUN_0041580b(selected name +0x174), remove dialog.
                ok: () => {
                    if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
                    if (this.mSelected) this.mCore.selectPlayer(this.mSelected);
                    HtmlDialogs.close('change-player');
                    this.mIsActive = false;
                    if (this.mOnComplete) this.mOnComplete(this.mSelected || null);
                },
                //   NEW: NewPlayerDialog(listener = this) added as dialog 1.
                //   Its listener FUN_004030d3: Core addPlayer FUN_00415924 (also
                //   makes it current), list refresh FUN_00402b44, then select
                //   the new name FUN_00402c43.
                new: () => {
                    if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
                    const np = new NewPlayerDialog(this.mCore, (name) => {
                        if (name) this.mSelected = name;
                        this._renderHtml();
                    }, 'addPlayer');
                    np.openHtml();
                },
                //   DELETE: YES/NO "QUESTION" / "Delete user?" via FUN_0040279c
                //   (rwg:3041-3046). YES (72000, FUN_004211e9) → FUN_00403008:
                //   Core delete FUN_0041585b (no-op unless > 1 player), then
                //   refresh FUN_00402b44 which re-selects the CURRENT player
                //   (FUN_0040285f → FUN_00402c43). NO → nothing.
                delete: () => {
                    if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
                    this._openDeleteConfirm();
                },
            },
        });
        this._renderHtml();
    }

    _openDeleteConfirm() {
        HtmlDialogs.open(DELETE_USER_DIALOG, {
            actions: {
                yes: () => {
                    HtmlDialogs.close(DELETE_USER_DIALOG);   // KillDialog(70000)
                    if (this.mSelected) this.mCore.deletePlayer(this.mSelected);
                    this._refreshSelection();
                    this._renderHtml();
                },
                no: () => HtmlDialogs.close(DELETE_USER_DIALOG),
            },
        });
    }

    // FUN_00402b44 (rwg:2738): rebuild the list, select row 0 when non-empty,
    // then select the current player's row (FUN_0040285f + FUN_00402c43).
    _refreshSelection() {
        const list = this.mCore.listPlayers();
        const cur = this.mCore.mCurrentName;
        if (cur && list.includes(cur)) this.mSelected = cur;
        else this.mSelected = list.length ? list[0] : null;
    }

    _renderHtml() {
        const players = this.mCore.listPlayers();
        HtmlDialogs.fillList('change-player', 'players', players, (name, row) => {
            const n = row.querySelector('[data-bind="name"]');
            if (n) n.textContent = name;
            row.classList.toggle('cc-selected', name === this.mSelected);
        });
    }

    draw(g) {
        if (!this.mIsActive && !(this.mShowNewPlayer && this.mShowNewPlayer.isShown())) return;
        // Modal scrim
        g.setColor(0, 0, 0, 150);
        g.fillRect(0, 0, 800, 600);

        if (this.mShowNewPlayer && this.mShowNewPlayer.isShown()) {
            this.mShowNewPlayer.draw(g);
            return;
        }

        // Box (200, 125, 300, 350), 9-sliced so the title plate stays natural.
        const bx = 200, by = 125, bw = 300, bh = 350;
        const plate = g.drawDialogBox(IMAGES.IMAGE_DIALOG_BOX, bx, by, bw, bh);

        // Title 'WHO ARE YOU?' (string rwg:2625) centered IN the plate.
        // FONT_DLG_HEADER=ArialBlack14 (resources.xml:61).
        g.ctx.fillStyle = '#ffd700';
        g.ctx.textAlign = 'center';
        g.ctx.textBaseline = 'middle';
        drawFitText(g.ctx, 'WHO ARE YOU?', bx + bw / 2, plate.plateCenterY, bw - 40,
            'bold 14px "Arial Black", Arial, sans-serif');
        g.ctx.textBaseline = 'alphabetic';

        // Player list box. ListBox Resize CONFIRMED rwg:2951-2952:
        //   x=bx+26 (0x1a), y=by+80 (0x50), w=bw-56 (0x38), h=bh-195 (0xc3).
        const listX = bx + 26, listY = by + 80, listW = bw - 56, listH = bh - 195;
        g.ctx.fillStyle = '#fff';
        g.ctx.fillRect(listX, listY, listW, listH);
        g.ctx.strokeStyle = '#222';
        g.ctx.lineWidth = 2;
        g.ctx.strokeRect(listX, listY, listW, listH);

        // Rows. FONT_DLG_LINES=ArialBlack12 (resources.xml:62). Selected gray band
        // + teal name color measured from screenshot 08. 20px scrollbar gutter.
        g.ctx.font = '12px "Arial Black", Arial, sans-serif';
        g.ctx.textAlign = 'left';
        const rowH = 22;
        const textW = listW - 20;
        const players = this.mCore.listPlayers();
        this._rowRects = [];
        for (let i = 0; i < players.length; i++) {
            const ry = listY + i * rowH;
            if (ry + rowH > listY + listH) break;
            const isSelected = players[i] === this.mSelected;
            if (isSelected) {
                g.ctx.fillStyle = '#c8c8c8';
                g.ctx.fillRect(listX + 1, ry + 1, textW - 1, rowH - 1);
            }
            g.ctx.fillStyle = isSelected ? '#127a7a' : '#1aa0a0';
            g.ctx.fillText(players[i], listX + 8, ry + 16);
            this._rowRects.push({ name: players[i], x: listX, y: ry, w: textW, h: rowH });
        }

        // Scrollbar gutter (rwg:2954-2956: x=list.x+list.w-0x14, w=0x14=20).
        const sbX = listX + listW - 20;
        g.ctx.fillStyle = 'rgba(0,0,0,0.10)';
        g.ctx.fillRect(sbX, listY, 20, listH);

        // Buttons. NEW/DELETE row CONFIRMED rwg:2947-2950 (both 122x34 at
        // y=bx+0x7d... abs 370 = by+245); OK row below (252x34, y abs 410 =
        // by+285) measured from screenshot 08. Strings 'NEW' rwg:2647,
        // 'DELETE' rwg:2651, 'OK' rwg:2621. FONT_DLG_BUTTONS=ArialBlack12.
        this._newRect = this._drawCpButton(g, 'NEW', bx + 24, by + 245, 122, 34);
        this._delRect = this._drawCpButton(g, 'DELETE', bx + 153, by + 245, 122, 34);
        this._okRect = this._drawCpButton(g, 'OK', bx + 24, by + 285, 252, 34);
        g.ctx.textAlign = 'left';
    }

    _drawCpButton(g, label, x, y, w, h) {
        const btnImg = IMAGES.IMAGE_DIALOG_BUTTON;
        if (btnImg && btnImg.img && g._isReady && g._isReady(btnImg.img)) {
            g.ctx.drawImage(btnImg.img, x, y, w, h);
        } else {
            g.setColor(80, 160, 40, 255);
            g.fillRect(x, y, w, h);
        }
        g.ctx.fillStyle = '#fff';
        g.ctx.font = '12px "Arial Black", Arial, sans-serif';
        g.ctx.textAlign = 'center';
        g.ctx.fillText(label, x + w / 2, y + h / 2 + 4);
        return { x, y, w, h };
    }

    // (The former canvas keyDown/mouseDown path — Enter/Escape shortcuts,
    // unconfirmed delete selecting row 0 — was dead code and has been removed.)
}
