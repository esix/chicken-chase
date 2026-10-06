// ShopDialog (SELL chickens) and SpecialShopDialog (BUY special items).
// Both are HTML dialogs (js/index.html 'shop-sell' / 'shop-buy'); this module
// ports their game logic. The former canvas draw/mouse/key code was dead
// (GameView never assigns mShopDialog) and has been removed.
//
//   "ShopDialog" is the SELL UI (title "SHOP", per-row label "SELL").
//   "SpecialShopDialog" is the BUY UI (title "SPECIAL SHOP", per-row "BUY").
//   It sells the per-level special items (seed/weapon upgrades, mouse,
//   elephant — FUN_0041eae5 list, FieldController.getSpecialShopItems), NOT
//   chickens: chickens are bought from the HUD slots (FUN_0041e8f5).
//
// ShopDialog — ctor FUN_0041f031 (rwg:38491), vtable 0x4df4b4:
//   [7] AddedToManager FUN_0041f7fc, [13] Draw FUN_0041f462 (row FUN_0041f65c),
//   [25] Resize FUN_0041f889, ButtonDepress FUN_0041f94a (rwg:39043),
//   button visibility FUN_0041f325, page count FUN_0041f39f.
//   Box (200, 25, 400, 550). 10 rows / page (SELL buttons x=bx+bw-0x7c,
//   y=by+0x91+i*0x20, 100x0x1e).
//
// SpecialShopDialog — ctor FUN_00420232 (rwg:39768), vtable 0x4df600:
//   AddedToManager FUN_00420959, Draw FUN_004205e3 (row FUN_00420758),
//   Resize FUN_00420a27, ButtonDepress FUN_00420ae8 (rwg:40297),
//   refresh FUN_00420474, page count FUN_00420533.
//   Box (150, 25, 500, 550). 3 rows / page.
//
// Both: header "PAGE %i OF %i" (0x4df47c; args page+1, page count or 1 when
// 0 — asm 0x41f53a-0x41f551 / 0x420642-0x420662). Row buttons, PREV and NEXT
// are shown/hidden with Widget::SetVisible (vt+0x40 = FUN_00438b09, flag +0x50),
// not disabled. Errors open the OK-only "INFORMATION" dialog (FUN_0041efda /
// FUN_004201bd -> DoDialog FUN_00421187), not an inline line.

import { IMAGES, SOUNDS } from './Res.js';
import { HtmlDialogs } from './HtmlDialogs.js';
import { foodCap, drawWithParams } from './Chick.js';

// DAT_005352dc: process-wide "sell hint shown" flag (FUN_004227d0 asm
// 0x4227db-0x4227e4); never reset.
let sSellHintShown = false;

function playClick() {
    // DAT_004fed84 = SOUND_CLICK.
    if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
}

// "INFORMATION" OK-only dialog: FUN_0041efda (rwg:38450, via FUN_0040f491) and
// FUN_004201bd (rwg:39718); header "INFORMATION", body = message, footer "OK"
// (DoDialog FUN_00421187, id 70000). HTML: js/index.html 'information'.
function showInformation(text) {
    HtmlDialogs.open('information', {
        binds: { text },
        actions: { ok: () => HtmlDialogs.close('information') },
    });
}

// Show/hide like Widget::SetVisible (FUN_00438b09): a hidden widget is neither
// drawn nor clickable; layout is kept.
function setWidgetVisible(node, visible) {
    if (node) node.style.visibility = visible ? '' : 'hidden';
}

// Sell-row AGE column — FUN_0041f65c (asm 0x41f721-0x41f785):
//   ftol(FUN_00403c75(chick) * 10.0 (_DAT_004e90d8) + 0.5 (_DAT_004e90c8)),
//   formatted "%i" (0x4dcda8). ftol (FUN_004bed40) truncates.
function sellAge(chick) {
    return Math.trunc(chick.getSellRatio() * 10.0 + 0.5);
}
// asm 0x41f73d-0x41f75c: if chick+0x34 (food) == FUN_004058af (food cap),
// SetColor(Color(0,0,0xff)) (FUN_00450771: r=0, g=0, b=0xff, a=0xff);
// otherwise the colour stays DAT_005012a0 (white) set at 0x41f70e.
function sellAgeIsFull(chick) {
    return chick.mFoodCounter === foodCap(chick.mLevel);
}

// Sell-row chick picture — FUN_0041f65c asm 0x41f6c9-0x41f702: image
// FUN_0040a166(chick) (Chick._getActionImage), draw params FUN_00409d5c
// (Chick._getDrawParams: cel, mirror, tint, reverse) with the scale field
// (params +0x18, [ebp-0x44]) overwritten by _DAT_004dc858 = 0.5, drawn by
// FUN_0041742b at (0x14, row*0x20+0x8c) dialog-relative. HTML: rendered once
// per refresh into an <img> (the game is paused while the dialog is open).
function chickIconSource(chick) {
    if (typeof chick._getActionImage !== 'function') return '';
    const img = chick._getActionImage();
    if (!img || !img.img) return '';
    const params = chick._getDrawParams(img);
    params.scale = 0.5; // _DAT_004dc858 (asm 0x41f6e6-0x41f6ef)
    const cols = img.mNumCols || 1;
    const celW = (params.frame >= 0 && cols > 1) ? Math.trunc(img.mWidth / cols) : img.mWidth;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.trunc(celW * params.scale + 0.5));
    canvas.height = Math.max(1, Math.trunc(img.mHeight * params.scale + 0.5));
    drawWithParams({ ctx: canvas.getContext('2d') }, img, 0, 0, params);
    return canvas.toDataURL();
}

// Special-shop row icon DAT_005005d4[id] (FUN_00420758 rwg:40136, single-cel
// resources). Resource objects do not provide the former mPath property.
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

// Chick vt[4] FUN_0040325a (rwg:3344): !FUN_00402342 (action 3/4 = sick)
// && vt[5] isActive (FUN_0040327c / Broody FUN_00403dec). JS: chicks already
// removed from the world list (mRemoved) are not in the original list.
function isSellable(c) {
    return !c.mRemoved && !c.mIsSick && c.isActive();
}

// World chick list size (app+0x14)+8 — every list entry, dying ones included
// (asm 0x41f9f4-0x41f9fc). JS keeps removed chicks until the next field
// update, so they are skipped here.
function worldChickCount(fc) {
    return fc.mField.mChickens.filter(c => !c.mRemoved).length;
}

export class ShopDialog {
    // FUN_0041e97b (rwg:37749) builds it after FUN_004227d0, then AddDialog.
    constructor(fieldController, onClose) {
        this.mFieldController = fieldController;
        this.mOnClose = onClose;
        this.mIsActive = true;
        this.mPage = 0;                       // +0x17c (ctor this[0x5f] = 0)
        // List +0x170 (ctor loop rwg:38590-38617): world chicks (app+0x14)
        // passing vt[4], in world order.
        this.mChicks = fieldController.mField.mChickens.filter(isSellable);
        // String +0x180 = FUN_004227d0 (rwg:42448, caller asm 0x41e9c2):
        // "You can sell chickens here." once per run on level 5
        // (level object game+0x34, +0x10 == 5), else "".
        this.mText = '';
        if (fieldController.mCurrentLevel === 5 && !sSellHintShown) {
            sSellHintShown = true;
            this.mText = 'You can sell chickens here.';
        }
    }

    isShown() { return this.mIsActive; }

    // FUN_0041f39f (rwg:38694): 0 when empty, else (n-1)/10 + 1.
    _pageCount() {
        const n = this.mChicks.length;
        return n === 0 ? 0 : Math.trunc((n - 1) / 10) + 1;
    }

    openHtml() {
        HtmlDialogs.open('shop-sell', {
            actions: {
                ok: () => this._buttonDepress('ok'),
                prev: () => this._buttonDepress('prev'),
                next: () => this._buttonDepress('next'),
                sell: ({ index }) => this._buttonDepress('sell', index),
            },
        });
        this._renderHtml();
        // AddedToManager FUN_0041f7fc (rwg:38958): if string +0x180 is not
        // empty (+0x194 = length), FUN_0041efda opens INFORMATION with it.
        if (this.mText.length !== 0) showInformation(this.mText);
    }

    // FUN_0041f94a (rwg:39043) ButtonDepress.
    _buttonDepress(action, index) {
        if (action === 'ok') {
            // id 1000 (asm 0x41f981-0x41f9cb): SOUND_CLICK, KillDialog, game
            // +4 = 0 / +0xd = 0 (GameView pause hook), FUN_00408a1b.
            playClick();
            HtmlDialogs.close('shop-sell');
            this.mIsActive = false;
            if (this.mOnClose) this.mOnClose();
            return;
        }
        if (action === 'prev' || action === 'next') {
            // asm 0x41fb24-0x41fb7e: SOUND_CLICK, page -/+ 1, FUN_0041f325.
            playClick();
            this.mPage += action === 'prev' ? -1 : 1;
            this._renderHtml();
            return;
        }
        // Row button id 3+i (asm 0x41f9d5-0x41fb22).
        const fc = this.mFieldController;
        if (worldChickCount(fc) === 1) {
            // asm 0x41fa02-0x41fa15: FUN_0041efda("You cannot sell your
            // last chicken") (0x4df48c); no sound, no refresh.
            showInformation('You cannot sell your last chicken');
            return;
        }
        const i = this.mPage * 10 + index;
        const chick = this.mChicks[i];
        if (chick) {
            this._sell(chick);              // FUN_0041ea50 -> FUN_004047af
            this.mChicks.splice(i, 1);      // FUN_00405184 (asm 0x41fadd)
        }
        // asm 0x41fae2-0x41fafc: page > 0 && pageCount <= page → page--.
        if (this.mPage > 0 && this._pageCount() <= this.mPage) this.mPage--;
        this._renderHtml();                 // FUN_0041f325
        // asm 0x41fb12: DAT_004fed90 = SOUND_CHICK_SELL.
        if (SOUNDS.SOUND_CHICK_SELL) SOUNDS.SOUND_CHICK_SELL.play();
    }

    // FUN_004047af (rwg:5324): when chick state != 6: money += FUN_00403bd6
    // (FUN_00424b5d with the chick's field position — its effect only when
    // pos.x >= 0, asm 0x424b87-0x424b92), FUN_0040466e (state 6, removed from
    // the world list), world +0x260 (sold count) += 1.
    _sell(chick) {
        if (!chick.mIsAlive) return;
        const fc = this.mFieldController;
        const price = chick.getSellPrice();
        if (fc.addMoney) {
            if (chick.mPos && chick.mPos[0] >= 0) fc.addMoney(price, chick.mX, chick.mY);
            else fc.addMoney(price);
        } else {
            fc.mMoney += price;
        }
        // FUN_0040466e: FUN_0040342b (state 6, action 13, no sound) + list
        // erase. FUN_00404b3b (broody get-up / re-decide) is NOT called; only
        // the JS-side egg claim back-pointer is dropped with the chick.
        const egg = chick.mBroodingEgg;
        if (egg && egg._claimedBy === chick) egg._claimedBy = null;
        if (chick.removeFromField) chick.removeFromField();
        else chick.mIsAlive = false;
        fc.mField.mSoldCount++;              // world +0x260
    }

    // FUN_0041f325 (rwg:38656) button visibility + Draw FUN_0041f462 rows.
    _renderHtml() {
        const pageCount = this._pageCount();
        const dialog = document.querySelector('[data-dialog="shop-sell"]');
        HtmlDialogs.set('shop-sell', 'page',
            `PAGE ${this.mPage + 1} OF ${pageCount !== 0 ? pageCount : 1}`);
        if (dialog) {
            setWidgetVisible(dialog.querySelector('[data-action="prev"]'), 0 < this.mPage);
            setWidgetVisible(dialog.querySelector('[data-action="next"]'), this.mPage < pageCount - 1);
        }
        // Rows/buttons with page*10 + i < list size are visible.
        const visible = this.mChicks.slice(this.mPage * 10, this.mPage * 10 + 10);
        HtmlDialogs.fillList('shop-sell', 'rows', visible, (c, row) => {
            const ic = row.querySelector('.cc-cell-icon');
            if (ic) ic.src = chickIconSource(c);
            const a = row.querySelector('.cc-cell-age');
            if (a) {
                a.textContent = String(sellAge(c));
                a.style.color = sellAgeIsFull(c) ? 'rgb(0,0,255)' : '';
            }
            // PRICE: "%i" (0x4dcda8) of FUN_00403bd6, asm 0x41f7a5-0x41f7b2.
            const p = row.querySelector('.cc-cell-price');
            if (p) p.textContent = String(c.getSellPrice());
        });
    }
}

export class SpecialShopDialog {
    // FUN_0041e9f1 (rwg:37802) builds it and calls AddDialog.
    constructor(fieldController, onClose) {
        this.mFieldController = fieldController;
        this.mOnClose = onClose;
        this.mIsActive = true;
        this.mPage = 0;                       // +0x170 (ctor this[0x5c] = 0)
    }

    isShown() { return this.mIsActive; }

    // List +0x174 = FUN_0041eae5, rebuilt by every FUN_00420474 refresh.
    _items() {
        const fc = this.mFieldController;
        if (!fc || typeof fc.getSpecialShopItems !== 'function') return [];
        return fc.getSpecialShopItems();
    }

    // FUN_00420533 (rwg:39941): 0 when empty, else (n-1)/3 + 1.
    _pageCount(n) {
        return n === 0 ? 0 : Math.trunc((n - 1) / 3) + 1;
    }

    // Price shown on every row = store +0 (FUN_00420758:40144).
    _price() {
        const fc = this.mFieldController;
        return (fc && typeof fc.getSpecialShopPrice === 'function') ? fc.getSpecialShopPrice() : 0;
    }

    openHtml() {
        HtmlDialogs.open('shop-buy', {
            actions: {
                ok: () => this._buttonDepress('ok'),
                prev: () => this._buttonDepress('prev'),
                next: () => this._buttonDepress('next'),
                buy: ({ index }) => this._buttonDepress('buy', index),
            },
        });
        this._renderHtml();
    }

    // FUN_00420ae8 (rwg:40297) ButtonDepress.
    _buttonDepress(action, index) {
        const fc = this.mFieldController;
        if (action === 'ok') {
            // id 1000 (asm 0x420b10-0x420b9e): SOUND_CLICK, KillDialog;
            // store +0x19 (BUY widget) = row button 0 visible (page*3 < list
            // size); store +0x18 unchanged; game +4 = 0 / +0xd = 0 (GameView
            // pause hook); FUN_00408a1b.
            playClick();
            HtmlDialogs.close('shop-buy');
            if (fc && fc.mLevelConfig) {
                fc.mLevelConfig.specialShopButton = this.mPage * 3 < this._items().length;
            }
            this.mIsActive = false;
            if (this.mOnClose) this.mOnClose();
            return;
        }
        if (action === 'prev' || action === 'next') {
            // asm 0x420cd4-0x420d21: SOUND_CLICK, page -/+ 1, FUN_00420474.
            playClick();
            this.mPage += action === 'prev' ? -1 : 1;
            this._renderHtml();
            return;
        }
        // Row button id 3+i: item page*3 + i of list +0x174.
        const item = this._items()[this.mPage * 3 + index];
        if (item && fc && typeof fc.buySpecialItem === 'function') {
            // FUN_0041eb94 (price check, apply, spend, double).
            if (!fc.buySpecialItem(item.id)) {
                // rwg:40388: FUN_004201bd("You don't have enough money.");
                // return without refresh or sound.
                showInformation("You don't have enough money.");
                return;
            }
        }
        // asm 0x420c7e-0x420cbf: clamp page, FUN_00420474, SOUND_CLICK.
        const n = this._items().length;
        if (this.mPage > 0 && this._pageCount(n) <= this.mPage) this.mPage--;
        this._renderHtml();
        playClick();
    }

    // FUN_00420474 (rwg:39887) visibility + Draw FUN_004205e3 rows.
    _renderHtml() {
        const items = this._items();
        const pageCount = this._pageCount(items.length);
        const dialog = document.querySelector('[data-dialog="shop-buy"]');
        HtmlDialogs.set('shop-buy', 'page',
            `PAGE ${this.mPage + 1} OF ${pageCount !== 0 ? pageCount : 1}`);
        if (dialog) {
            setWidgetVisible(dialog.querySelector('[data-action="prev"]'), 0 < this.mPage);
            setWidgetVisible(dialog.querySelector('[data-action="next"]'), this.mPage < pageCount - 1);
        }
        const visible = items.slice(this.mPage * 3, this.mPage * 3 + 3);
        const price = this._price();
        HtmlDialogs.fillList('shop-buy', 'rows', visible, (item, row) => {
            // Image DAT_005005d4[id] (rwg:40136), text DAT_005003a0[id] (rwg:40142).
            const ic = row.querySelector('.cc-buy-icon'); if (ic) ic.src = htmlIconSource(IMAGES[item.image]);
            const nm = row.querySelector('.cc-buy-name');
            if (nm) nm.textContent = item.desc; // DAT_005003a0 = descriptions (names are DAT_00500480, used by RiskCaseOffensive asm 0x41af7f)
            // Price: "FREE" when store +0 < 1 (rwg:40144-40146), else "%i"
            // (0x4dcda8, asm 0x420855-0x420861).
            const pr = row.querySelector('.cc-buy-price');
            if (pr) pr.textContent = price < 1 ? 'FREE' : String(price);
        });
    }
}
