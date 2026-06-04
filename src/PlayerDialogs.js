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

export class NewPlayerDialog {
    // mode: 'firstLaunch' (cancel hidden) or 'addPlayer'
    constructor(core, onComplete, mode = 'addPlayer') {
        this.mCore = core;
        this.mOnComplete = onComplete; // (newName | null) — null on cancel
        this.mMode = mode;
        this.mInput = '';
        this.mIsActive = true;
        // Two-button layout (OK + CANCEL, screenshot 09) when adding a player;
        // single OK on first launch. Mirrors the decompiled single-vs-two-button
        // StdDialog branch (cancel field this+0x94, rwg:74599/74612).
        this.mShowCancel = (mode !== 'firstLaunch');
    }

    isShown() { return this.mIsActive; }

    // Open + drive the HTML 'new-player' dialog. Reuses addPlayer/selectPlayer.
    openHtml() {
        HtmlDialogs.open('new-player', {
            binds: { name: this.mInput || '', error: '' },
            visible: { cancel: this.mShowCancel },
            actions: {
                ok: () => {
                    this.mInput = (HtmlDialogs.read('new-player', 'name') || '').trim();
                    this._submitHtml();
                },
                cancel: () => {
                    HtmlDialogs.close('new-player');
                    this.mIsActive = false;
                    if (this.mOnComplete) this.mOnComplete(null);
                    if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
                },
            },
        });
    }

    _submitHtml() {
        const name = this.mInput.trim();
        if (!name) { HtmlDialogs.set('new-player', 'error', 'Please enter a name'); return; }
        if (this.mCore._findPlayer && this.mCore._findPlayer(name)) {
            HtmlDialogs.set('new-player', 'error', 'That name is taken'); return;
        }
        const player = this.mCore.addPlayer(name);
        if (player) {
            this.mCore.selectPlayer(player.name);
            this.mIsActive = false;
            HtmlDialogs.close('new-player');
            if (this.mOnComplete) this.mOnComplete(player.name);
            if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
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

    keyDown(key) {
        if (!this.mIsActive) return false;
        if (key === 'Enter') { this._submit(); return true; }
        if (key === 'Escape') {
            if (this.mMode !== 'firstLaunch') {
                this.mIsActive = false;
                if (this.mOnComplete) this.mOnComplete(null);
            }
            return true;
        }
        if (key === 'Backspace') {
            this.mInput = this.mInput.slice(0, -1);
            this.mError = null;
            return true;
        }
        if (key.length === 1 && this.mInput.length < PLAYER_NAME_MAX_LEN) {
            if (/[\w \-.]/.test(key)) {
                this.mInput += key;
                this.mError = null;
                return true;
            }
        }
        return true;
    }

    mouseDown(x, y, btn) {
        if (!this.mIsActive) return false;
        if (btn !== 0) return true;
        const ok = this._okRect;
        if (ok && x >= ok.x && x <= ok.x + ok.w && y >= ok.y && y <= ok.y + ok.h) {
            this._submit();
            return true;
        }
        const c = this._cancelRect;
        if (c && x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
            this.mIsActive = false;
            if (this.mOnComplete) this.mOnComplete(null);
            if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
        }
        return true; // consume all clicks
    }

    _submit() {
        const name = this.mInput.trim();
        if (!name) {
            this.mError = 'Please enter a name';
            return;
        }
        // Reject duplicates
        if (this.mCore._findPlayer && this.mCore._findPlayer(name)) {
            this.mError = 'That name is taken';
            return;
        }
        const player = this.mCore.addPlayer(name);
        if (player) {
            this.mCore.selectPlayer(player.name);
            this.mIsActive = false;
            if (this.mOnComplete) this.mOnComplete(player.name);
            if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
        }
    }
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
                ok: () => {
                    if (this.mSelected) this.mCore.selectPlayer(this.mSelected);
                    HtmlDialogs.close('change-player');
                    this.mIsActive = false;
                    if (this.mOnComplete) this.mOnComplete(this.mSelected || null);
                    if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
                },
                new: () => {
                    // NewPlayer opens over change-player; on completion refresh the
                    // list (change-player stays open underneath).
                    const np = new NewPlayerDialog(this.mCore, (name) => {
                        if (name) this.mSelected = name;
                        this._renderHtml();
                    }, 'addPlayer');
                    np.openHtml();
                },
                delete: () => {
                    if (this.mSelected) {
                        this.mCore.deletePlayer(this.mSelected);
                        const list = this.mCore.listPlayers();
                        this.mSelected = list.length ? list[0] : null;
                    }
                    this._renderHtml();
                },
            },
        });
        this._renderHtml();
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

    keyDown(key) {
        if (this.mShowNewPlayer && this.mShowNewPlayer.isShown()) {
            return this.mShowNewPlayer.keyDown(key);
        }
        if (!this.mIsActive) return false;
        if (key === 'Enter') { this._confirm(); return true; }
        if (key === 'Escape') { this._dismiss(null); return true; }
        return true;
    }

    mouseDown(x, y, btn) {
        if (this.mShowNewPlayer && this.mShowNewPlayer.isShown()) {
            return this.mShowNewPlayer.mouseDown(x, y, btn);
        }
        if (!this.mIsActive || btn !== 0) return true;
        // Row selection
        for (const r of this._rowRects || []) {
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                this.mSelected = r.name;
                return true;
            }
        }
        // Buttons
        if (this._okRect && this._inside(x, y, this._okRect)) { this._confirm(); return true; }
        if (this._newRect && this._inside(x, y, this._newRect)) {
            this.mShowNewPlayer = new NewPlayerDialog(this.mCore, (name) => {
                if (name) this.mSelected = name;
                this.mShowNewPlayer = null;
            }, 'addPlayer');
            return true;
        }
        if (this._delRect && this._inside(x, y, this._delRect)) {
            if (this.mSelected) {
                this.mCore.deletePlayer(this.mSelected);
                const list = this.mCore.listPlayers();
                this.mSelected = list.length > 0 ? list[0] : null;
            }
            return true;
        }
        return true;
    }

    _inside(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

    _confirm() {
        if (this.mSelected) {
            this.mCore.selectPlayer(this.mSelected);
            this._dismiss(this.mSelected);
        } else {
            this._dismiss(null);
        }
    }

    _dismiss(result) {
        this.mIsActive = false;
        if (this.mOnComplete) this.mOnComplete(result);
        if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
    }
}
