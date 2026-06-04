// ShopDialog (SELL chickens) and SpecialShopDialog (BUY chickens).
// Verified per DECOMPILED_MAP.md section 13 + Shop research agent (2026-05-06).
//
// CRITICAL CORRECTION from earlier research:
//   "ShopDialog" is the SELL UI (title "SHOP", per-row label "SELL").
//   "SpecialShopDialog" is the BUY UI (title "SPECIAL SHOP", per-row label "BUY").
//   There is no separate SellDialog class.
//
// ShopDialog (FUN_0041f031:38486):
//   Box (200, 25, 400, 550). Title "SHOP". 10 rows / page (1 column).
//   Click sells a chicken; "You cannot sell your last chicken" if total alive == 1.
//
// SpecialShopDialog (FUN_00420232:39763):
//   Box (150, 25, 500, 550). Title "SPECIAL SHOP". 3 rows / page.
//   Click buys; "You don't have enough money." if can't afford.
//
// Verified price tables (rwg_functions.c:6650-6749):
//   BUY base (DAT_0050032c): LAYER=100, BROODY=200, ROOSTER=500, MAGIC=1000, HOLY=1200
//   Mid    (DAT_0050033c): LAYER= 50, BROODY=100, ROOSTER=200, MAGIC= 300, HOLY= 500
//   SELL base (DAT_0050035c): LAYER=500, BROODY=800, ROOSTER=400, MAGIC=3000, HOLY=6000
//   Buy doubles after each purchase, floor 250 (line 37992-37996).

import { IMAGES, SOUNDS } from './Res.js';
import { ChickType, createChick } from './Chick.js';
import { Mouse, Elephant } from './Pet.js';
import { drawFitText } from './TextUtil.js';
import { HtmlDialogs } from './HtmlDialogs.js';

// Sentinel item types for pets (out-of-band from ChickType 0..4).
const PET_MOUSE = 100;
const PET_ELEPHANT = 101;
const PET_PRICES = { [PET_MOUSE]: 600, [PET_ELEPHANT]: 800 };
const PET_NAMES = { [PET_MOUSE]: 'Mouse', [PET_ELEPHANT]: 'Elephant' };

const TYPE_NAMES = ['Layer', 'Broody', 'Rooster', 'Magic', 'Holy'];
const BUY_BASE  = [100, 200, 500, 1000, 1200];   // DAT_0050032c
const BUY_MID   = [ 50, 100, 200,  300,  500];   // DAT_0050033c (juvenile differential)
const SELL_BASE = [500, 800, 400, 3000, 6000];   // DAT_0050035c

// FUN_00403bd6 (line 4245): sell price = base + (juvenile ? mid : 0)
function sellPrice(chickType, isJuvenile) {
    return SELL_BASE[chickType] + (isJuvenile ? BUY_MID[chickType] : 0);
}

const SHOP_BOX = { x: 200, y: 25, w: 400, h: 550 };
const SPECIAL_BOX = { x: 150, y: 25, w: 500, h: 550 };

export class ShopDialog {
    // SELL UI. Title "SHOP", 10 chickens per page, button per row "SELL".
    constructor(fieldController, onClose) {
        this.mFieldController = fieldController;
        this.mOnClose = onClose;
        this.mIsActive = true;
        this.mPage = 0;
        this.mInfoText = null;
        this.mInfoTimer = 0;
    }

    isShown() { return this.mIsActive; }

    _aliveChickens() {
        return this.mFieldController.mField.mChickens.filter(c => c.mIsAlive);
    }

    _maxPage() {
        const n = this._aliveChickens().length;
        return Math.max(1, Math.ceil(n / 10));
    }

    // Open + drive the HTML 'shop-sell' dialog. Reuses _sell / sellPrice for the
    // real logic; rows/pagination are rendered into the HTML scaffold.
    openHtml() {
        HtmlDialogs.open('shop-sell', {
            actions: {
                ok: () => { HtmlDialogs.close('shop-sell'); if (this.mOnClose) this.mOnClose(); },
                prev: () => { this.mPage = Math.max(0, this.mPage - 1); this._renderHtml(); },
                next: () => { this.mPage = Math.min(this._maxPage() - 1, this.mPage + 1); this._renderHtml(); },
                sell: ({ index }) => {
                    const c = this._visible && this._visible[index];
                    if (c) this._sell(c, sellPrice(c.mType, !c.mIsAdult));
                    this._renderHtml();
                },
            },
        });
        this._renderHtml();
    }

    _renderHtml() {
        const all = this._aliveChickens();
        const maxPage = this._maxPage();
        if (this.mPage >= maxPage) this.mPage = Math.max(0, maxPage - 1);
        this._visible = all.slice(this.mPage * 10, this.mPage * 10 + 10);
        HtmlDialogs.set('shop-sell', 'page', `${this.mPage + 1} / ${maxPage}`);
        HtmlDialogs.set('shop-sell', 'info', (this.mInfoText && this.mInfoTimer > 0) ? this.mInfoText : '');
        HtmlDialogs.fillList('shop-sell', 'rows', this._visible, (c, row) => {
            const isJuv = !c.mIsAdult;
            const t = row.querySelector('.cc-cell-type'); if (t) t.textContent = TYPE_NAMES[c.mType] || '?';
            const p = row.querySelector('.cc-cell-price'); if (p) p.textContent = '$' + sellPrice(c.mType, isJuv);
            const bar = row.querySelector('.cc-age-bar');
            if (bar) bar.style.width = ((isJuv ? Math.max(0, Math.min(1, (c.mGrowTimer || 0) / 800)) : 1) * 100) + '%';
        });
    }

    draw(g) {
        if (!this.mIsActive) return;
        // Modal scrim
        g.setColor(0, 0, 0, 150);
        g.fillRect(0, 0, 800, 600);

        const { x: bx, y: by, w: bw, h: bh } = SHOP_BOX;
        const plate = g.drawDialogBox(IMAGES.IMAGE_DIALOG_BOX, bx, by, bw, bh);

        // Title 'SHOP' (string rwg:38521) centered IN the top plate (no green
        // badge — consistent with the other dialogs). FONT_DLG_HEADER family.
        g.ctx.fillStyle = '#ffd700';
        g.ctx.textAlign = 'center';
        g.ctx.textBaseline = 'middle';
        drawFitText(g.ctx, 'SHOP', bx + bw / 2, plate.plateCenterY, bw - 60,
            'bold 18px "Arial Black", Arial, sans-serif');
        g.ctx.textBaseline = 'alphabetic';

        // Column headers — only AGE (rwg:38803) and PRICE (rwg:38808) exist in
        // the decompiled (the 'Type' header was invented). FONT_DLG_LINES.
        // Exact header x/y not recoverable (lost registers) — placed above the
        // first row aligned with their columns.
        g.ctx.fillStyle = '#3a1a05';
        g.ctx.font = 'bold 12px "Arial Black", Arial, sans-serif';
        g.ctx.textAlign = 'left';
        g.ctx.fillText('AGE',   bx + 150, by + 124);
        g.ctx.fillText('PRICE', bx + 230, by + 124);

        // Rows: 10/page, stride 32 (rwg:39022). SELL button CONFIRMED
        // rwg:39017/39020: x=bx+276 (200-0x7c+400=476 abs), y=by+145+i*32
        // (by+0x91), w=100 (0x64), h=30 (0x1e). Content rows aligned to it.
        const all = this._aliveChickens();
        const maxPage = this._maxPage();
        if (this.mPage >= maxPage) this.mPage = Math.max(0, maxPage - 1);
        const start = this.mPage * 10;
        const visible = all.slice(start, start + 10);
        this._rowRects = [];
        const rowH = 32;
        for (let i = 0; i < visible.length; i++) {
            const c = visible[i];
            const isJuvenile = !c.mIsAdult;
            const price = sellPrice(c.mType, isJuvenile);
            const rowY = by + 138 + i * rowH;
            // Row background
            g.ctx.fillStyle = (i % 2 === 0) ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
            g.ctx.fillRect(bx + 30, rowY, bw - 60, rowH - 2);
            // Type name
            g.ctx.fillStyle = '#3a1a05';
            g.ctx.font = '13px "Arial Black", Arial, sans-serif';
            g.ctx.textAlign = 'left';
            g.ctx.fillText(TYPE_NAMES[c.mType] || '?', bx + 40, rowY + 20);
            // Age bar (juveniles show mGrowTimer/800 growth; adults full).
            const agePct = isJuvenile
                ? Math.max(0, Math.min(1, (c.mGrowTimer || 0) / 800))
                : 1;
            g.ctx.fillStyle = '#5a3010';
            g.ctx.fillRect(bx + 150, rowY + 8, 60, 12);
            g.ctx.fillStyle = isJuvenile ? '#ffcc55' : '#5cb830';
            g.ctx.fillRect(bx + 151, rowY + 9, Math.floor(58 * agePct), 10);
            // Price (PRICE text Y = contentY+0x19, rwg:38933).
            g.ctx.fillStyle = isJuvenile ? '#3a1a05' : '#1a661a';
            g.ctx.font = '13px "Arial Black", Arial, sans-serif';
            g.ctx.fillText(`$${price}`, bx + 230, rowY + 20);
            // SELL button (rwg:39017/39020).
            const btnX = bx + 276, btnY = by + 145 + i * rowH, btnW = 100, btnH = 30;
            this._drawDialogButton(g, IMAGES.IMAGE_DIALOG_BUTTON, 'SELL', btnX, btnY, btnW, btnH);
            this._rowRects.push({ x: btnX, y: btnY, w: btnW, h: btnH, chick: c, price });
        }

        // Info text (e.g. "You cannot sell your last chicken")
        if (this.mInfoText && this.mInfoTimer > 0) {
            g.ctx.fillStyle = '#bb2222';
            g.ctx.font = 'bold 13px Arial, sans-serif';
            g.ctx.textAlign = 'center';
            g.ctx.fillText(this.mInfoText, bx + bw / 2, by + bh - 90);
        }

        // Pagination buttons
        this._drawPagination(g, bx, by, bw, bh);

        // OK button (slot 0)
        const okW = 100, okH = 36;
        const okX = bx + (bw - okW) / 2;
        const okY = by + bh - okH - 38;
        this._okRect = this._drawDialogButton(g, IMAGES.IMAGE_DIALOG_BUTTON, 'OK', okX, okY, okW, okH);
    }

    _drawPagination(g, bx, by, bw, bh) {
        // Nav row at the TOP (rwg:39026-39031): navY=by+0x4b=by+75; PREV x=bx+0x1e
        // =bx+30, NEXT x=bx+bw-nextW-0x1e. Arrows 74x36 (image-native).
        const ctx = g.ctx;
        const prevImg = IMAGES.IMAGE_BUTTON_PREV;
        const nextImg = IMAGES.IMAGE_BUTTON_NEXT;
        const navY = by + 75;
        const prevW = (prevImg && prevImg.img) ? prevImg.mWidth : 74;
        const prevH = (prevImg && prevImg.img) ? prevImg.mHeight : 36;
        const nextW = (nextImg && nextImg.img) ? nextImg.mWidth : 74;
        const nextH = (nextImg && nextImg.img) ? nextImg.mHeight : 36;

        const prevX = bx + 30, nextX = bx + bw - 30 - nextW;
        if (prevImg && prevImg.img && g._isReady && g._isReady(prevImg.img)) {
            ctx.drawImage(prevImg.img, prevX, navY, prevW, prevH);
        } else {
            ctx.fillStyle = '#5cb830';
            ctx.fillRect(prevX, navY, prevW, prevH);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 18px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('<', prevX + prevW / 2, navY + prevH / 2 + 6);
        }
        if (nextImg && nextImg.img && g._isReady && g._isReady(nextImg.img)) {
            ctx.drawImage(nextImg.img, nextX, navY, nextW, nextH);
        } else {
            ctx.fillStyle = '#5cb830';
            ctx.fillRect(nextX, navY, nextW, nextH);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 18px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('>', nextX + nextW / 2, navY + nextH / 2 + 6);
        }
        // Page indicator
        ctx.fillStyle = '#3a1a05';
        ctx.font = '13px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${this.mPage + 1} / ${this._maxPage()}`, bx + bw / 2, navY + 22);

        this._prevRect = { x: prevX, y: navY, w: prevW, h: prevH };
        this._nextRect = { x: nextX, y: navY, w: nextW, h: nextH };
    }

    _drawDialogButton(g, img, label, x, y, w, h) {
        const ctx = g.ctx;
        // Hover state — swap to IMAGE_DIALOG_BUTTON_OVER when mouse is over
        // this button rect. mMouseX/Y updated by mouseMove routing from
        // GameView; -1 default means no false hover before first mouseMove.
        const mx = (typeof this._mouseX === 'number') ? this._mouseX : -1;
        const my = (typeof this._mouseY === 'number') ? this._mouseY : -1;
        const hover = mx >= x && mx < x + w && my >= y && my < y + h;
        const overImg = hover ? IMAGES.IMAGE_DIALOG_BUTTON_OVER : null;
        const useImg = (overImg && overImg.img && g._isReady && g._isReady(overImg.img))
            ? overImg : img;
        if (useImg && useImg.img && g._isReady && g._isReady(useImg.img)) {
            ctx.drawImage(useImg.img, x, y, w, h);
        } else {
            ctx.fillStyle = '#5cb830';
            ctx.fillRect(x, y, w, h);
        }
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, x + w / 2, y + h / 2 + 5);
        return { x, y, w, h };
    }

    mouseMove(x, y) {
        // Track for button-hover state.
        this._mouseX = x;
        this._mouseY = y;
        return false; // don't absorb — let other handlers run
    }

    update() {
        if (this.mInfoTimer > 0) this.mInfoTimer--;
    }

    mouseDown(x, y, btn) {
        if (!this.mIsActive || btn !== 0) return true;
        if (this._inside(x, y, this._okRect)) { this._dismiss(); return true; }
        if (this._inside(x, y, this._prevRect)) {
            this.mPage = Math.max(0, this.mPage - 1);
            return true;
        }
        if (this._inside(x, y, this._nextRect)) {
            this.mPage = Math.min(this._maxPage() - 1, this.mPage + 1);
            return true;
        }
        for (const r of this._rowRects || []) {
            if (this._inside(x, y, r)) {
                this._sell(r.chick, r.price);
                return true;
            }
        }
        return true;
    }

    keyDown(key) {
        if (key === 'Escape') { this._dismiss(); return true; }
        // Arrow keys for pagination — useful since the SELL dialog can have
        // multiple pages when the player has 11+ chickens.
        if (key === 'ArrowRight' || key === 'PageDown') {
            if (this.mPage + 1 < this._maxPage()) this.mPage++;
            return true;
        }
        if (key === 'ArrowLeft' || key === 'PageUp') {
            if (this.mPage > 0) this.mPage--;
            return true;
        }
        return true;
    }

    _inside(x, y, r) { return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

    _sell(chick, price) {
        const fc = this.mFieldController;
        const aliveCount = fc.mField.mChickens.filter(c => c.mIsAlive).length;
        if (aliveCount <= 1) {
            // Verified string at rwg_functions.c:39115-39117
            this.mInfoText = 'You cannot sell your last chicken';
            this.mInfoTimer = 200;
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
            return;
        }
        // Floating text at chick's position
        if (fc.addFloatingText) {
            fc.addFloatingText(chick.mX, chick.mY - 30, `Sold +$${price}`, '#5cff5c');
        }
        // Clean up brood state if broody chick was sitting on an egg
        if (chick._endBrooding) chick._endBrooding();
        chick.mIsAlive = false;
        if (fc.addMoney) fc.addMoney(price); else fc.mMoney += price;
        if (SOUNDS.SOUND_CHICK_SELL) SOUNDS.SOUND_CHICK_SELL.play();
    }

    _dismiss() {
        this.mIsActive = false;
        if (this.mOnClose) this.mOnClose();
    }
}

export class SpecialShopDialog {
    // BUY UI. Title "SPECIAL SHOP", 3 rows per page.
    // Each row shows a chick type with name, image, price; click "BUY" to purchase.
    constructor(fieldController, onClose) {
        this.mFieldController = fieldController;
        this.mOnClose = onClose;
        this.mIsActive = true;
        this.mPage = 0;
        this.mInfoText = null;
        this.mInfoTimer = 0;
        // Per-type purchase counter for price doubling — lives on the
        // FieldController so it persists across shop open/close cycles.
        // Initialized lazily so existing FCs without it don't crash.
        if (!fieldController._specialShopBoughtCount) {
            fieldController._specialShopBoughtCount = [0, 0, 0, 0, 0];
        }
        this.mBoughtCount = fieldController._specialShopBoughtCount;
    }

    isShown() { return this.mIsActive; }

    _availableTypes() {
        const cfg = this.mFieldController.mLevelConfig;
        const list = [];
        if (!cfg || !cfg.hasBuy) return list;
        const bt = cfg.buyableTypes || { layer: true, broody: true, rooster: true };
        if (bt.layer !== false)   list.push(ChickType.LAYER);
        if (bt.broody !== false)  list.push(ChickType.BROODY);
        if (bt.rooster !== false) list.push(ChickType.ROOSTER);
        if (cfg.hasMagicHoly && bt.magic !== false) list.push(ChickType.MAGIC);
        if (cfg.hasMagicHoly && bt.holy !== false)  list.push(ChickType.HOLY);
        // Pets — Mouse from level 9+, Elephant from level 17+ per descriptions.
        const lvl = this.mFieldController.mCurrentLevel || 1;
        const fc = this.mFieldController;
        if (lvl >= 9 && !this._petAlive(0))  list.push(PET_MOUSE);
        if (lvl >= 17 && !this._petAlive(1)) list.push(PET_ELEPHANT);
        return list;
    }

    _petAlive(petType) {
        const fc = this.mFieldController;
        if (!fc || !fc.mField || !fc.mField.mPets) return false;
        // Pets are never removed from mPets after spawn, so existence in the
        // list is enough. (Previous version checked `p.mIsActive` but that
        // field was removed as dead state; the check turned into `&& undefined`
        // and always returned false, letting the player re-buy the same pet.)
        return fc.mField.mPets.some(p => p.mType === petType);
    }

    _priceFor(type) {
        // Pets have fixed prices (UNKNOWN exact — using estimates from research).
        if (type === PET_MOUSE || type === PET_ELEPHANT) return PET_PRICES[type];
        // Buy price doubles per purchase, floor 250 (rwg_functions.c:37992-37996)
        const base = BUY_BASE[type];
        let price = base;
        for (let i = 0; i < this.mBoughtCount[type]; i++) {
            price = Math.max(250, price * 2);
        }
        // Apply level multiplier (mChickenPriceMultiplier or 1)
        const mult = (this.mFieldController.mLevelConfig
            && this.mFieldController.mLevelConfig.chickenPriceMultiplier) || 1;
        return Math.round(price * mult);
    }

    // Open + drive the HTML 'shop-buy' dialog. Reuses _availableTypes / _priceFor
    // / _buy for the real logic.
    openHtml() {
        HtmlDialogs.open('shop-buy', {
            actions: {
                ok: () => { HtmlDialogs.close('shop-buy'); if (this.mOnClose) this.mOnClose(); },
                prev: () => { this.mPage = Math.max(0, this.mPage - 1); this._renderHtml(); },
                next: () => {
                    const maxPage = Math.max(1, Math.ceil(this._availableTypes().length / 3));
                    this.mPage = Math.min(maxPage - 1, this.mPage + 1); this._renderHtml();
                },
                buy: ({ index }) => {
                    const type = this._visible && this._visible[index];
                    if (type !== undefined) this._buy(type, this._priceFor(type));
                    this._renderHtml();
                },
            },
        });
        this._renderHtml();
    }

    _renderHtml() {
        const types = this._availableTypes();
        const maxPage = Math.max(1, Math.ceil(types.length / 3));
        if (this.mPage >= maxPage) this.mPage = Math.max(0, maxPage - 1);
        this._visible = types.slice(this.mPage * 3, this.mPage * 3 + 3);
        const previewKeys = ['IMAGE_CHICK_PREVIEW_LAYER', 'IMAGE_CHICK_PREVIEW_BROODY',
            'IMAGE_CHICK_PREVIEW_ROOSTER', 'IMAGE_CHICK_PREVIEW_MAGIC', 'IMAGE_CHICK_PREVIEW_HOLY'];
        HtmlDialogs.set('shop-buy', 'page', `${this.mPage + 1} / ${maxPage}`);
        HtmlDialogs.set('shop-buy', 'info', (this.mInfoText && this.mInfoTimer > 0) ? this.mInfoText : '');
        HtmlDialogs.fillList('shop-buy', 'rows', this._visible, (type, row) => {
            const isPet = type === PET_MOUSE || type === PET_ELEPHANT;
            let imgKey;
            if (type === PET_MOUSE) imgKey = 'IMAGE_OFFENSIVE_MOUSE';
            else if (type === PET_ELEPHANT) imgKey = 'IMAGE_OFFENSIVE_ELEPHANT';
            else imgKey = previewKeys[type];
            const img = IMAGES[imgKey];
            const ic = row.querySelector('.cc-buy-icon'); if (ic && img && img.mPath) ic.src = img.mPath;
            const nm = row.querySelector('.cc-buy-name'); if (nm) nm.textContent = isPet ? PET_NAMES[type] : TYPE_NAMES[type];
            const price = this._priceFor(type);
            const pr = row.querySelector('.cc-buy-price'); if (pr) pr.textContent = price < 1 ? 'FREE' : '$' + price;
        });
    }

    draw(g) {
        if (!this.mIsActive) return;
        g.setColor(0, 0, 0, 150);
        g.fillRect(0, 0, 800, 600);

        const { x: bx, y: by, w: bw, h: bh } = SPECIAL_BOX;
        const plate = g.drawDialogBox(IMAGES.IMAGE_DIALOG_BOX, bx, by, bw, bh);
        // Title 'SPECIAL SHOP' (string rwg:39791) centered IN the top plate (no
        // green badge — consistent with the other dialogs). FONT_DLG_HEADER family.
        g.ctx.fillStyle = '#ffd700';
        g.ctx.textAlign = 'center';
        g.ctx.textBaseline = 'middle';
        drawFitText(g.ctx, 'SPECIAL SHOP', bx + bw / 2, plate.plateCenterY, bw - 60,
            'bold 18px "Arial Black", Arial, sans-serif');
        g.ctx.textBaseline = 'alphabetic';

        // Price multiplier indicator
        const mult = (this.mFieldController.mLevelConfig
            && this.mFieldController.mLevelConfig.chickenPriceMultiplier) || 1;
        if (mult > 1) {
            g.ctx.fillStyle = '#bb2222';
            g.ctx.font = 'bold 12px Arial, sans-serif';
            g.ctx.fillText(`Prices x${mult}`, bx + bw / 2, by + 88);
        }

        // 3 rows per page (rwg:39949). Row stride 0x74=116, rowBaseY = i*116+130
        // (abs) = by+105+i*116 (rwg:40114). Clamp page if types shrank.
        const types = this._availableTypes();
        const maxPage = Math.max(1, Math.ceil(types.length / 3));
        if (this.mPage >= maxPage) this.mPage = Math.max(0, maxPage - 1);
        const start = this.mPage * 3;
        const visible = types.slice(start, start + 3);
        this._rowRects = [];

        const rowH = 116; // 0x74 (rwg:40114/40276)
        const previewKeys = [
            'IMAGE_CHICK_PREVIEW_LAYER',
            'IMAGE_CHICK_PREVIEW_BROODY',
            'IMAGE_CHICK_PREVIEW_ROOSTER',
            'IMAGE_CHICK_PREVIEW_MAGIC',
            'IMAGE_CHICK_PREVIEW_HOLY',
        ];
        for (let i = 0; i < visible.length; i++) {
            const type = visible[i];
            const isPet = type === PET_MOUSE || type === PET_ELEPHANT;
            const rowY = by + 105 + i * rowH; // rwg:40114
            // Row background
            g.ctx.fillStyle = (i % 2 === 0) ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
            g.ctx.fillRect(bx + 30, rowY, bw - 60, rowH - 8);
            // Preview image at NATIVE 56x56 (image-native; was 64x64).
            let imgKey;
            if (type === PET_MOUSE) imgKey = 'IMAGE_OFFENSIVE_MOUSE';
            else if (type === PET_ELEPHANT) imgKey = 'IMAGE_OFFENSIVE_ELEPHANT';
            else imgKey = previewKeys[type];
            const img = IMAGES[imgKey];
            if (img && img.img && g._isReady && g._isReady(img.img)) {
                g.ctx.drawImage(img.img, bx + 55, rowY + 26, 56, 56);
            }
            // Name + price, left-aligned text column.
            g.ctx.fillStyle = '#3a1a05';
            g.ctx.font = 'bold 16px "Arial Black", Arial, sans-serif';
            g.ctx.textAlign = 'left';
            const name = isPet ? PET_NAMES[type] : TYPE_NAMES[type];
            g.ctx.fillText(name, bx + 135, rowY + 42);
            // Price — 'FREE' when computed price < 1 (rwg:40145-40146).
            const price = this._priceFor(type);
            g.ctx.font = '14px "Arial Black", Arial, sans-serif';
            g.ctx.fillText(price < 1 ? 'FREE' : `$${price}`, bx + 135, rowY + 70);
            // BUY button — x=526 abs=bx+376, y=190+i*116 abs=by+165+i*116, 100x30
            // (rwg:40271/40274/40276).
            const btnW = 100, btnH = 30;
            const btnX = bx + 376;
            const btnY = by + 165 + i * rowH;
            const r = this._drawDialogButton(g, IMAGES.IMAGE_DIALOG_BUTTON, 'BUY', btnX, btnY, btnW, btnH);
            r.type = type; r.price = price;
            this._rowRects.push(r);
        }

        // Info text — "You don't have enough money."
        if (this.mInfoText && this.mInfoTimer > 0) {
            g.ctx.fillStyle = '#bb2222';
            g.ctx.font = 'bold 13px Arial, sans-serif';
            g.ctx.textAlign = 'center';
            g.ctx.fillText(this.mInfoText, bx + bw / 2, by + bh - 90);
        }

        // Pagination
        this._drawPagination(g, bx, by, bw, bh, types.length);

        // OK button
        const okW = 100, okH = 36;
        const okX = bx + (bw - okW) / 2;
        const okY = by + bh - okH - 38;
        this._okRect = this._drawDialogButton(g, IMAGES.IMAGE_DIALOG_BUTTON, 'OK', okX, okY, okW, okH);
    }

    _drawPagination(g, bx, by, bw, bh, total) {
        // Nav row at the TOP (rwg:40280-40285): navY=by+0x4b=by+75; PREV x=bx+0x1e
        // =bx+30, NEXT x=bx+bw-nextW-0x1e. Arrows are 74x36 (image-native).
        const navY = by + 75;
        const ctx = g.ctx;
        const prevImg = IMAGES.IMAGE_BUTTON_PREV;
        const nextImg = IMAGES.IMAGE_BUTTON_NEXT;
        const prevW = (prevImg && prevImg.img) ? prevImg.mWidth : 74;
        const prevH = (prevImg && prevImg.img) ? prevImg.mHeight : 36;
        const nextW = (nextImg && nextImg.img) ? nextImg.mWidth : 74;
        const nextH = (nextImg && nextImg.img) ? nextImg.mHeight : 36;
        const prevX = bx + 30;
        const nextX = bx + bw - 30 - nextW;
        if (prevImg && prevImg.img && g._isReady && g._isReady(prevImg.img)) {
            ctx.drawImage(prevImg.img, prevX, navY, prevW, prevH);
        } else {
            ctx.fillStyle = '#5cb830';
            ctx.fillRect(prevX, navY, prevW, prevH);
        }
        if (nextImg && nextImg.img && g._isReady && g._isReady(nextImg.img)) {
            ctx.drawImage(nextImg.img, nextX, navY, nextW, nextH);
        } else {
            ctx.fillStyle = '#5cb830';
            ctx.fillRect(nextX, navY, nextW, nextH);
        }
        const maxPage = Math.max(1, Math.ceil(total / 3));
        ctx.fillStyle = '#3a1a05';
        ctx.font = '13px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${this.mPage + 1} / ${maxPage}`, bx + bw / 2, navY + 22);
        this._prevRect = { x: prevX, y: navY, w: prevW, h: prevH };
        this._nextRect = { x: nextX, y: navY, w: nextW, h: nextH };
    }

    _drawDialogButton(g, img, label, x, y, w, h) {
        const ctx = g.ctx;
        // Hover state — swap to IMAGE_DIALOG_BUTTON_OVER when mouse is over
        // this button rect. mMouseX/Y updated by mouseMove routing from
        // GameView; -1 default means no false hover before first mouseMove.
        const mx = (typeof this._mouseX === 'number') ? this._mouseX : -1;
        const my = (typeof this._mouseY === 'number') ? this._mouseY : -1;
        const hover = mx >= x && mx < x + w && my >= y && my < y + h;
        const overImg = hover ? IMAGES.IMAGE_DIALOG_BUTTON_OVER : null;
        const useImg = (overImg && overImg.img && g._isReady && g._isReady(overImg.img))
            ? overImg : img;
        if (useImg && useImg.img && g._isReady && g._isReady(useImg.img)) {
            ctx.drawImage(useImg.img, x, y, w, h);
        } else {
            ctx.fillStyle = '#5cb830';
            ctx.fillRect(x, y, w, h);
        }
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(label, x + w / 2, y + h / 2 + 5);
        return { x, y, w, h };
    }

    mouseMove(x, y) {
        // Track for button-hover state.
        this._mouseX = x;
        this._mouseY = y;
        return false; // don't absorb — let other handlers run
    }

    update() {
        if (this.mInfoTimer > 0) this.mInfoTimer--;
    }

    mouseDown(x, y, btn) {
        if (!this.mIsActive || btn !== 0) return true;
        if (this._inside(x, y, this._okRect)) { this._dismiss(); return true; }
        if (this._inside(x, y, this._prevRect)) {
            this.mPage = Math.max(0, this.mPage - 1);
            return true;
        }
        if (this._inside(x, y, this._nextRect)) {
            const total = this._availableTypes().length;
            const maxPage = Math.max(1, Math.ceil(total / 3));
            this.mPage = Math.min(maxPage - 1, this.mPage + 1);
            return true;
        }
        for (const r of this._rowRects || []) {
            if (this._inside(x, y, r)) {
                this._buy(r.type, r.price);
                return true;
            }
        }
        return true;
    }

    keyDown(key) {
        if (key === 'Escape') { this._dismiss(); return true; }
        // Pagination — SpecialShop has 3 rows/page; 5 chick types + 2 pets
        // span 3 pages once unlocked.
        const total = this._availableTypes().length;
        const maxPage = Math.max(1, Math.ceil(total / 3));
        if (key === 'ArrowRight' || key === 'PageDown') {
            if (this.mPage + 1 < maxPage) this.mPage++;
            return true;
        }
        if (key === 'ArrowLeft' || key === 'PageUp') {
            if (this.mPage > 0) this.mPage--;
            return true;
        }
        return true;
    }

    _inside(x, y, r) { return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

    _buy(type, price) {
        const fc = this.mFieldController;
        // Bonus-level reward: next purchase from Special Shop is half price.
        const finalPrice = fc.mNextUpgradeHalfPrice
            ? Math.floor(price / 2)
            : price;
        if ((fc.mMoney || 0) < finalPrice) {
            this.mInfoText = "You don't have enough money.";
            this.mInfoTimer = 200;
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
            return;
        }
        // Pet purchase
        if (type === PET_MOUSE || type === PET_ELEPHANT) {
            if (fc.mNextUpgradeHalfPrice) fc.mNextUpgradeHalfPrice = false;
            fc.spendMoney(finalPrice);  // red flash on HUD money
            const pet = type === PET_MOUSE ? new Mouse() : new Elephant();
            pet.mX = 100 + Math.random() * 600;
            pet.mY = 380 + Math.random() * 180;
            // Face toward field center — same fix as the level-start pet
            // spawn (FieldController.startLevel). Pet base default
            // mDirection=1 (right) would have right-half spawns facing
            // away from the action until first _updateWalk flip.
            pet.mDirection = pet.mX < 400 ? 1 : 0;
            fc.mField.addPet(pet);
            if (type === PET_MOUSE) fc.mHasMouse = true;
            else fc.mHasElephant = true;
            if (SOUNDS.SOUND_CHICK_BUY) SOUNDS.SOUND_CHICK_BUY.play();
            return;
        }
        // No alive-chicken cap — the original BuyChick path (FUN_0041eb94)
        // only validates money. DAT_0050034c {5,9,12} is the hen-house
        // auto-spawn count per upgrade tier (FUN_xxx:34313-34329), NOT a
        // permanent buy cap. Mirrors the FieldController.buyChick fix.
        // Per-type purchase cap (e.g. L48 description: "no more than 10 layer
        // chickens"). Per-type limits come from the level config's
        // maxBuyPerType map. Without this, the cap is unenforced and the
        // player can spam-buy layers past the level's intended restriction.
        const maxBuyByKey = (fc.mLevelConfig && fc.mLevelConfig.maxBuyPerType) || {};
        const typeKeysArr = ['layer', 'broody', 'rooster', 'magic', 'holy'];
        const maxBuy = maxBuyByKey[typeKeysArr[type]];
        if (typeof maxBuy === 'number' && this.mBoughtCount[type] >= maxBuy) {
            this.mInfoText = `Cap reached — only ${maxBuy} of this type per level.`;
            this.mInfoTimer = 200;
            if (SOUNDS.SOUND_ERROR) SOUNDS.SOUND_ERROR.play();
            return;
        }
        if (fc.mNextUpgradeHalfPrice) fc.mNextUpgradeHalfPrice = false;
        fc.spendMoney(finalPrice);  // red flash on HUD money
        this.mBoughtCount[type]++;
        const x = 100 + Math.random() * 600;
        const y = 380 + Math.random() * 180;
        const chick = createChick(type, x, y);
        chick.mIsAdult = true;
        chick.mScale = 1.0;
        chick.mFoodCounter = 30;
        chick.mHunger = 2000;
        fc.mField.addChick(chick);
        fc.mTotalRaisedChicks++;
        // L26-style "grow or buy N magic/holy/rooster" tasks count purchases.
        // Mirror the HUD buyChick path so dialog and slot buys behave the same.
        if (type === 3 /* MAGIC */) fc.mHatchedMagic++;
        else if (type === 4 /* HOLY */) fc.mHatchedHoly++;
        else if (type === 2 /* ROOSTER */) fc.mHatchedRooster = (fc.mHatchedRooster || 0) + 1;
        if (SOUNDS.SOUND_CHICK_BUY) SOUNDS.SOUND_CHICK_BUY.play();
    }

    _dismiss() {
        this.mIsActive = false;
        if (this.mOnClose) this.mOnClose();
    }
}
