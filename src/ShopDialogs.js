// ShopDialog (SELL chickens) and SpecialShopDialog (BUY special items).
// Verified per DECOMPILED_MAP.md section 13 + Shop research agent (2026-05-06).
//
// CRITICAL CORRECTION from earlier research:
//   "ShopDialog" is the SELL UI (title "SHOP", per-row label "SELL").
//   "SpecialShopDialog" is the BUY UI (title "SPECIAL SHOP", per-row label "BUY").
//   It sells the per-level special items (seed/weapon upgrades, mouse,
//   elephant — FUN_0041eae5 list, FieldController.getSpecialShopItems), NOT
//   chickens: chickens are bought from the HUD slots (FUN_0041e8f5).
//   There is no separate SellDialog class.
//
// ShopDialog (FUN_0041f031:38486):
//   Box (200, 25, 400, 550). Title "SHOP". 10 rows / page (1 column).
//   Click sells a chicken; "You cannot sell your last chicken" if total alive == 1.
//
// SpecialShopDialog (FUN_00420232:39763):
//   Box (150, 25, 500, 550). Title "SPECIAL SHOP". 3 rows / page.
//   Row (FUN_00420758:40114-40150): image DAT_005005d4[id], description
//   DAT_005003a0[id], price = store +0 ("FREE" when < 1).
//   Click → FUN_0041eb94 (rwg:40385); false → "You don't have enough money."
//   (rwg:40388); success → SOUND_CLICK (DAT_004fed84, asm 0x420caf).
//
// Verified price tables (rwg_functions.c:6650-6749):
//   BUY base (DAT_0050032c): LAYER=100, BROODY=200, ROOSTER=500, MAGIC=1000, HOLY=1200
//   Mid    (DAT_0050033c): LAYER= 50, BROODY=100, ROOSTER=200, MAGIC= 300, HOLY= 500
//   SELL base (DAT_0050035c): LAYER=500, BROODY=800, ROOSTER=400, MAGIC=3000, HOLY=6000
//   Chicken buy prices never double (FUN_004058e7 = base × inflation).
//   The SPECIAL item price (store +0 = 250) doubles after each purchase,
//   floor 250 (FUN_0041eb94:37992-37996) — held by FieldController.

import { IMAGES, SOUNDS } from './Res.js';
import { drawFitText } from './TextUtil.js';
import { HtmlDialogs } from './HtmlDialogs.js';
import { foodCap } from './Chick.js';

const TYPE_NAMES = ['Layer', 'Broody', 'Rooster', 'Magic', 'Holy'];

// FUN_00403bd6 (asm 0x403bd6-0x403c72; called at rwg_functions.c:5340 and in
// the sell-row draw FUN_0041f5xx): price from SELL base DAT_0050035c × food
// ratio FUN_00403c75 — ported as Chick.getSellPrice().
function sellPrice(chick) {
    return chick.getSellPrice();
}

// Sell-row AGE column — FUN_0041f65c (asm 0x41f721-0x41f785):
//   ftol(FUN_00403c75(chick) * 10.0 (_DAT_004e90d8) + 0.5 (_DAT_004e90c8)),
//   formatted "%i" (0x4dcda8). ftol (FUN_004bed40) truncates.
function sellAge(chick) {
    return Math.trunc(chick.getSellRatio() * 10.0 + 0.5);
}
// asm 0x41f73d-0x41f75c: if chick+0x34 (food) == FUN_004058af (food cap),
// SetColor(Color(0,0,0xff)) (FUN_00450771: r=ECX=0, g=0, b=0xff, a=0xff);
// otherwise the colour stays DAT_005012a0 (white) set at 0x41f70e.
function sellAgeIsFull(chick) {
    return chick.mFoodCounter === foodCap(chick.mLevel);
}

const SHOP_BOX = { x: 200, y: 25, w: 400, h: 550 };
const SPECIAL_BOX = { x: 150, y: 25, w: 500, h: 550 };

// HTML icons use the already composited resource and one native cel, including
// its alpha mask. Resource objects do not provide the former mPath property.
const htmlIconCache = new WeakMap();
function htmlIconSource(resource) {
    if (!resource?.img) return '';
    if (!htmlIconCache.has(resource)) {
        const cel = document.createElement('canvas');
        cel.width = resource.getCelWidth(); cel.height = resource.getCelHeight();
        cel.getContext('2d').drawImage(resource.img, 0, 0, cel.width, cel.height, 0, 0, cel.width, cel.height);
        htmlIconCache.set(resource, cel.toDataURL());
    }
    return htmlIconCache.get(resource);
}

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
                    if (c) this._sell(c, sellPrice(c));
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
        const dialog = document.querySelector('[data-dialog="shop-sell"]');
        // Original pagination boundaries; keep keyboard-visible native buttons.
        dialog.querySelector('[data-action="prev"]').disabled = this.mPage === 0;
        dialog.querySelector('[data-action="next"]').disabled = this.mPage === maxPage - 1;
        HtmlDialogs.fillList('shop-sell', 'rows', this._visible, (c, row) => {
            const t = row.querySelector('.cc-cell-type'); if (t) t.textContent = TYPE_NAMES[c.mType] || '?';
            const p = row.querySelector('.cc-cell-price'); if (p) p.textContent = String(sellPrice(c)); // "%i" (0x4dcda8), asm 0x41f7a5-0x41f7b2
            // AGE: "%i" of ftol(ratio*10+0.5), blue (0,0,255) at food cap
            // (FUN_0041f65c asm 0x41f721-0x41f785); else inherited white.
            const a = row.querySelector('.cc-cell-age');
            if (a) {
                a.textContent = String(sellAge(c));
                a.style.color = sellAgeIsFull(c) ? 'rgb(0,0,255)' : '';
            }
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
            const price = sellPrice(c);
            const rowY = by + 138 + i * rowH;
            // Row background
            g.ctx.fillStyle = (i % 2 === 0) ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
            g.ctx.fillRect(bx + 30, rowY, bw - 60, rowH - 2);
            // Type name
            g.ctx.fillStyle = '#3a1a05';
            g.ctx.font = '13px "Arial Black", Arial, sans-serif';
            g.ctx.textAlign = 'left';
            g.ctx.fillText(TYPE_NAMES[c.mType] || '?', bx + 40, rowY + 20);
            // AGE number — FUN_0041f65c asm 0x41f66d-0x41f785: rowTop =
            // i*0x20+0x8c, DrawString("%i", x=0x64, y=rowTop+0x19), font
            // DAT_004fff28, colour blue (0,0,255) when food == cap else white
            // DAT_005012a0.
            const textY = by + i * 0x20 + 0x8c + 0x19;
            g.ctx.font = '13px "Arial Black", Arial, sans-serif';
            g.ctx.textAlign = 'left';
            g.ctx.fillStyle = sellAgeIsFull(c) ? 'rgb(0,0,255)' : '#ffffff';
            g.ctx.fillText(String(sellAge(c)), bx + 0x64, textY);
            // Price — asm 0x41f799-0x41f7d8: white DAT_005012a0, "%i" of
            // FUN_00403bd6, right-aligned: x = 0xe6 - font.StringWidth.
            g.ctx.fillStyle = '#ffffff';
            g.ctx.textAlign = 'right';
            g.ctx.fillText(String(price), bx + 0xe6, textY);
            g.ctx.textAlign = 'left';
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
        // rwg:5348 (sell path after FUN_00424b5d money add): world+0x260 += 1
        // (Field ctor sets mSoldCount = 0; this is the only increment.)
        fc.mField.mSoldCount++;
        if (SOUNDS.SOUND_CHICK_SELL) SOUNDS.SOUND_CHICK_SELL.play();
    }

    _dismiss() {
        this.mIsActive = false;
        if (this.mOnClose) this.mOnClose();
    }
}

export class SpecialShopDialog {
    // BUY UI. Title "SPECIAL SHOP", 3 rows per page.
    // Each row shows a special item (image, description, price); "BUY" purchases it.
    constructor(fieldController, onClose) {
        this.mFieldController = fieldController;
        this.mOnClose = onClose;
        this.mIsActive = true;
        this.mPage = 0;
        this.mInfoText = null;
        this.mInfoTimer = 0;
    }

    isShown() { return this.mIsActive; }

    // Rows = FUN_0041eae5 list, rebuilt on every refresh by FUN_00420474
    // (rwg_functions.c:39881) → FieldController.getSpecialShopItems(). Entries are item objects
    // {id, name, desc, image}.
    _availableTypes() {
        const fc = this.mFieldController;
        if (!fc || typeof fc.getSpecialShopItems !== 'function') return [];
        return fc.getSpecialShopItems();
    }

    // Price shown on every row = store +0 (FUN_00420758:40144).
    _priceFor() {
        const fc = this.mFieldController;
        return (fc && typeof fc.getSpecialShopPrice === 'function') ? fc.getSpecialShopPrice() : 0;
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
                    if (type !== undefined) this._buy(type);
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
        HtmlDialogs.set('shop-buy', 'page', `${this.mPage + 1} / ${maxPage}`);
        HtmlDialogs.set('shop-buy', 'info', (this.mInfoText && this.mInfoTimer > 0) ? this.mInfoText : '');
        const dialog = document.querySelector('[data-dialog="shop-buy"]');
        dialog.querySelector('[data-action="prev"]').disabled = this.mPage === 0;
        dialog.querySelector('[data-action="next"]').disabled = this.mPage === maxPage - 1;
        HtmlDialogs.fillList('shop-buy', 'rows', this._visible, (item, row) => {
            // Image DAT_005005d4[id] (rwg:40136), text DAT_005003a0[id] (rwg:40142).
            const img = IMAGES[item.image];
            const ic = row.querySelector('.cc-buy-icon'); if (ic) ic.src = htmlIconSource(img);
            const nm = row.querySelector('.cc-buy-name');
            if (nm) nm.textContent = item.desc; // DAT_005003a0 = descriptions (names are DAT_00500480, used by RiskCaseOffensive asm 0x41af7f)
            const price = this._priceFor(item);
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

        // 3 rows per page (rwg:39949). Row stride 0x74=116, rowBaseY = i*116+130
        // (abs) = by+105+i*116 (rwg:40114). Clamp page if types shrank.
        const types = this._availableTypes();
        const maxPage = Math.max(1, Math.ceil(types.length / 3));
        if (this.mPage >= maxPage) this.mPage = Math.max(0, maxPage - 1);
        const start = this.mPage * 3;
        const visible = types.slice(start, start + 3);
        this._rowRects = [];

        const rowH = 116; // 0x74 (rwg:40114/40276)
        for (let i = 0; i < visible.length; i++) {
            const item = visible[i];
            const rowY = by + 105 + i * rowH; // rwg:40114
            g.ctx.fillStyle = (i % 2 === 0) ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)';
            g.ctx.fillRect(bx + 30, rowY, bw - 60, rowH - 8);
            // Item image DAT_005005d4[id] (rwg:40136).
            const img = IMAGES[item.image];
            if (img && img.img && g._isReady && g._isReady(img.img)) {
                g.ctx.drawImage(img.img, bx + 55, rowY + 26, 56, 56);
            }
            g.ctx.fillStyle = '#3a1a05';
            g.ctx.font = 'bold 14px "Arial Black", Arial, sans-serif';
            g.ctx.textAlign = 'left';
            drawFitText(g.ctx, item.desc, bx + 135, rowY + 42, 220, 'bold 14px "Arial Black", Arial, sans-serif');
            g.ctx.textAlign = 'left';
            // Price — 'FREE' when price < 1 (rwg:40145-40146).
            const price = this._priceFor(item);
            g.ctx.font = '14px "Arial Black", Arial, sans-serif';
            g.ctx.fillText(price < 1 ? 'FREE' : `$${price}`, bx + 135, rowY + 70);
            // BUY button — x=526 abs=bx+376, y=190+i*116 abs=by+165+i*116, 100x30
            // (rwg:40271/40274/40276).
            const btnW = 100, btnH = 30;
            const btnX = bx + 376;
            const btnY = by + 165 + i * rowH;
            const r = this._drawDialogButton(g, IMAGES.IMAGE_DIALOG_BUTTON, 'BUY', btnX, btnY, btnW, btnH);
            r.type = item; r.price = price;
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
                this._buy(r.type);
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

    // FUN_00420ae8 click handler (rwg:40360-40395): FUN_0041eb94 (price check,
    // apply, spend, double) — FieldController.buySpecialItem.
    _buy(item) {
        const fc = this.mFieldController;
        if (!item || !fc || typeof fc.buySpecialItem !== 'function') return;
        if (!fc.buySpecialItem(item.id)) {
            // rwg:40388 "You don't have enough money." (INFORMATION dialog
            // FUN_004201bd; shown here as the info line).
            this.mInfoText = "You don't have enough money.";
            this.mInfoTimer = 200;
            return;
        }
        // asm 0x420caa-0x420cb9: SOUND_CLICK (DAT_004fed84).
        if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
    }

    _dismiss() {
        this.mIsActive = false;
        if (this.mOnClose) this.mOnClose();
    }
}
