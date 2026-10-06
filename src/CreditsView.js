// Win story / credits roll — Sexy::SelectLevelView in "roll" mode
// (vftable 0x4df364, rwg_vtables.txt:5437).
//
// The original has no separate credits class. MainMenuView's "Credits" link
// and the end-of-game path both call FUN_004088d0(param, app)
// (rwg_functions.c:10835), which shows SelectLevelView with +0x9c = param.
// SelectLevelView::AddedToManager FUN_0041d22e (rwg:35539-35580) then picks:
//   param == 1000 → FUN_0041d395 (rwg:35692): roll active, pos 600,
//                   bg flag +0x94 = 1, state 4 (credits only)    → mode 'credits'
//   param >= 0x33 → roll active, pos 600, +0x94 = 0, state 0
//                   (win text → UFO → alien letter → UFO → credits) → mode 'win'
//   otherwise     → IntroductionDialog / SelectLevelDialog (not handled here)
//
// Method map (vftable slots, rwg_vtables.txt:5437-5500):
//   ctor            FUN_0041ccf8 rwg:35227   → constructor
//   AddedToManager  FUN_0041d22e rwg:35539   → constructor (mode setup)
//   Update          FUN_0041d1f8 rwg:35515   → update()
//   Draw            FUN_0041cf6f rwg:35400   → draw()
//   ButtonDepress   FUN_0041d3e0 rwg:35735   → buttonDepress()
//   roll step       FUN_0041cb58 rwg:35106   → _step()
//   set state       FUN_0041cb16 rwg:35075   → _setState()
//   next state      FUN_0041cce4 rwg:35204   → _nextState()
// Draw arguments and float constants were recovered from the disassembly /
// data of app/chicken_chase.RWG (addresses cited inline).

import { Widget, ButtonWidget } from './SexyApp.js';
import { IMAGES, SOUNDS } from './Res.js';

// ---------------------------------------------------------------------------
// Fonts. Text is rendered with canvas "Arial Black" (project convention: no
// bitmap glyphs). Pixel sizes are calibrated so canvas advance widths match
// the bitmap font WidthList in app/fonts/ArialBlack<N>.txt (median ratio vs
// the Arial Black hmtx: 10 → 13.2px, 12 → 16.5px, 16 → 21.0px, 24 → 31.8px).
// Ascents are LayerSetAscent from the same .txt files.
// Font globals: FONT_10 = DAT_004fff0c, FONT_16 = DAT_004fff14,
// FONT_24 = DAT_004fff1c, FONT_DLG_BUTTONS = DAT_004fff2c (resource loader,
// rwg:30930-30956).
export const FONT_CSS = {
    FONT_10: '13px "Arial Black", Arial, sans-serif',
    FONT_16: '21px "Arial Black", Arial, sans-serif',
    FONT_24: '32px "Arial Black", Arial, sans-serif',
    FONT_DLG_BUTTONS: '16px "Arial Black", Arial, sans-serif', // ArialBlack12
};
export const FONT_ASCENT = { FONT_10: 14, FONT_16: 23, FONT_24: 35, FONT_DLG_BUTTONS: 18 };
// ImageFont::GetHeight (font vtable +0x10) for FONT_16: every glyph rect in
// ArialBlack16.txt and the ArialBlack16.png image are 29 px tall.
const FONT_16_HEIGHT = 29;

// The bitmap fonts bake a 1px black outline around white glyphs
// (app/fonts/ArialBlack24.png + _ArialBlack24.png alpha), and the draw color
// multiplies the white part. Emulate with a 2px black stroke under the fill.
export function drawOutlinedText(ctx, text, x, y, fill) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
}

// ---------------------------------------------------------------------------
// FUN_004248b4 (rwg:44818; disassembly @0x4248b4-0x4249b3):
//   DrawImage(DAT_004fff30 = IMAGE_GAME_BACK, 0, 0)
//   for each index i in the list:
//       DrawImage(DAT_00500564[i] = IMAGE_GAME_BACK_UPGRADE<i>, X[i], Y[i])
//   if (extra != -1) DrawImage(DAT_00500564[extra], X[extra], Y[extra])
// X/Y come from the int pair table at 0x4fc430/0x4fc434 (8 bytes per entry,
// .data of app/chicken_chase.RWG). The 17 images are loaded at rwg:30965-30977.
export const DECORATION_POS = [
    [217, 127], [359, 158], [0, 0], [14, 139], [0, 29], [544, 257],
    [544, 0], [587, 111], [650, 21], [734, 127], [689, 113], [509, 0],
    [514, 0], [322, 293], [394, 226], [0, 0], [0, 299],
];

export function drawFieldBackground(g, decorations, extra = -1) {
    g.drawImage(IMAGES.IMAGE_GAME_BACK, 0, 0);
    const one = (i) => {
        const p = DECORATION_POS[i];
        if (p) g.drawImage(IMAGES['IMAGE_GAME_BACK_UPGRADE' + i], p[0], p[1]);
    };
    for (const i of decorations) one(i);
    if (extra !== -1) one(extra);
}

// ---------------------------------------------------------------------------
// Text blocks (SelectLevelView +0xa4 block vector, +0xb4 names, +0xc4 roles).

// Block 0 — FUN_0041d723 (rwg:35923), assigned in ctor rwg:35301-35305.
export const WIN_LINES = [
    'Congratulations!',                                                       // rwg:35944
    '',                                                                       // rwg:35949
    'You have completed the game and upgraded your house successfully!',      // rwg:35954
    '',                                                                       // rwg:35960
    'You have been given the rank of Poultry-Keeping Disciple!',              // rwg:35965
];

// Block 2 — FUN_0041d828 (rwg:35977), assigned in ctor rwg:35310-35314.
export const LETTER_LINES = [
    'Good day, Earth dweller!',                                               // rwg:35998
    // rwg:36003 &DAT_004df1c4 — string read from app/chicken_chase.RWG .rdata:
    // "We are from the planet Omicron Persey \x96 8." (0x96 = cp1252 en dash).
    'We are from the planet Omicron Persey – 8.',
    'We came to let you know important news:',                                // rwg:36008
    'we have been observing you very closely, and The Intergalactic',         // rwg:36013
    'Business Committee has declared you the best poultry farmer',            // rwg:36019
    'on the Planet Earth. We have brought you an invitation for',             // rwg:36025
    'participation in the Intergalactic Poultry Breeding tournament,',        // rwg:36031
    'where you will compete against the winners from other planets.',         // rwg:36037
    'Welcome!',                                                               // rwg:36043
];
// Backwards-compatible alias (this export used to hold the letter text).
export const CREDITS_LINES = LETTER_LINES;

// +0xc4 — FUN_0041d469 (rwg:35799), drawn at x = 0x64 = 100.
export const CREDITS_ROLES = [
    'Game Design',   // rwg:35820
    'Producer',      // rwg:35825
    'Programming',   // rwg:35830
    'Art',           // rwg:35835
    'Music',         // rwg:35840
    'Sound',         // rwg:35845
    'QA',            // rwg:35850
];
// +0xb4 — FUN_0041d5c6 (rwg:35861), drawn at x = 0x12c = 300.
export const CREDITS_NAMES = [
    'Ludmila Valentova, Oleg Shutov',   // rwg:35882
    'Melissa DiGioia',                  // rwg:35887
    'Oleg Shutov',                      // rwg:35892
    'Anna Shum, Dmitry Berestennikov',  // rwg:35897
    'Denis Gurgutsa',                   // rwg:35902
    'Artem Azarskov',                   // rwg:35907
    'Alexander Komissarov',             // rwg:35912
];

// Block vector +0xa4: Draw indexes it with the current state 0..4
// (FUN_0041da0f, rwg:36084), so it has >= 5 entries; only 0 and 2 are filled.
const BLOCKS = [WIN_LINES, [], LETTER_LINES, [], []];

// Float constants (.rdata/.data of app/chicken_chase.RWG).
const POS_START = 600.0;          // _DAT_004e9100
const UFO_STOP_Y = 180.0;         // _DAT_004e9104
const SPEED_TEXT = 0.5;           // _DAT_004fc420 (states 0 and 4)
const SPEED_LETTER = 0.3;         // _DAT_004fc424 (state 2)
const SPEED_UFO = 1.0;            // _DAT_004fc428 (states 1 and 3)
const CREDITS_STOP = 50.0;        // (float)_DAT_004e92f8 (double 50.0)
const LINE_FACTOR = 1.399999976158142; // double @0x4e9110, Draw line step = GetHeight * this
const SCREEN_W = 0x320;           // 800, Draw @0x41cfe9

// FUN_004bed40 = float→int conversion (_ftol, truncation).
const ftol = Math.trunc;

// ---------------------------------------------------------------------------
// Sexy::DialogButton (vftable 0x4e47e4) as built by FUN_0042149b (rwg:41034+):
// component image DAT_004fff9c = IMAGE_DIALOG_BUTTON (+0x128), over image
// DAT_004fffa0 = IMAGE_DIALOG_BUTTON_OVER (+0xb0), font FONT_DLG_BUTTONS,
// label colors 0/1 = white. Ctor FUN_0043e9f1: text offset (0,0), down
// translate (1,1). Draw FUN_0043ea73 (disassembly @0x43ea73-0x43ed17):
// DrawImageBox((0,0,w,h), over ? overImg : componentImg); label at
//   x = (w - StringWidth)/2, y = (h - asc/6 - ascentPadding(0) - 1 + asc)/2.
export class DialogButton extends ButtonWidget {
    constructor(id, listener, label) {
        super(id, listener);
        this.mLabel = label;
        this.mButtonImage = IMAGES.IMAGE_DIALOG_BUTTON;
        this.mOverImage = IMAGES.IMAGE_DIALOG_BUTTON_OVER;
    }

    draw(g) {
        const down = this.mIsDown && this.mIsOver;
        const t = down ? 1 : 0;
        const img = (this.mIsOver && this.mOverImage) ? this.mOverImage : this.mButtonImage;
        _drawImageBox(g, img, t, t, this.mWidth, this.mHeight);
        const ctx = g.ctx;
        ctx.save();
        ctx.font = FONT_CSS.FONT_DLG_BUTTONS;
        const asc = FONT_ASCENT.FONT_DLG_BUTTONS;
        const tw = ctx.measureText(this.mLabel).width;
        const lx = Math.trunc((this.mWidth - tw) / 2);
        const ly = Math.trunc((this.mHeight - Math.trunc(asc / 6) - 0 - 1 + asc) / 2);
        drawOutlinedText(ctx, this.mLabel, g.mTransX + t + lx, g.mTransY + t + ly, '#fff');
        ctx.restore();
    }
}

// Graphics::DrawImageBox (FUN_004669d7) — image split into a 3x3 grid of
// thirds; corners native, edges/center fill the remaining span.
// UNKNOWN — not found in decompiled: whether the framework tiles or stretches
// the edge/center cells (identical result for the flat-colored button art).
function _drawImageBox(g, image, x, y, w, h) {
    if (!image || !image.img || !g._isReady(image.img)) return;
    const img = image.img;
    const iw = image.mWidth || img.width, ih = image.mHeight || img.height;
    const cw = Math.trunc(iw / 3), ch = Math.trunc(ih / 3);
    const mw = iw - cw * 2, mh = ih - ch * 2;
    const dx = g.mTransX + x, dy = g.mTransY + y;
    const dmw = Math.max(0, w - cw * 2), dmh = Math.max(0, h - ch * 2);
    const c = g.ctx;
    const cols = [[0, cw, dx, cw], [cw, mw, dx + cw, dmw], [iw - cw, cw, dx + w - cw, cw]];
    const rows = [[0, ch, dy, ch], [ch, mh, dy + ch, dmh], [ih - ch, ch, dy + h - ch, ch]];
    for (const [sy, sh, ty, th] of rows) {
        for (const [sx, sw, tx, tw] of cols) {
            if (tw > 0 && th > 0) c.drawImage(img, sx, sy, sw, sh, tx, ty, tw, th);
        }
    }
}

// ---------------------------------------------------------------------------
export class CreditsView extends Widget {
    // mode: 'credits' (FUN_004088d0(1000)) or 'win' (FUN_004088d0(>= 0x33)).
    constructor(gameApp, mode = 'credits') {
        super();
        this.mGameApp = gameApp;
        this.mMode = mode;
        // FUN_004088d0 resizes the view to (0,0,app.w,app.h) rwg:10877-10878.
        this.resize(0, 0, 800, 600);

        // OK button (+0xa0): FUN_0042149b("OK") rwg:35291-35295;
        // Resize(0x12c, 0x1f4, 0xc8, 0x20) = (300, 500, 200, 32) and
        // SetVisible(false) — disassembly @0x41cdd3-0x41cdf8.
        this.mOkButton = new DialogButton(0, this, 'OK');
        this.mOkButton.resize(0x12c, 0x1f4, 0xc8, 0x20);
        this.mOkButton.mVisible = false;
        this.addWidget(this.mOkButton);

        // Roll struct at +0x88: +0x8c active, +0x90 pos, +0x94 bg flag,
        // +0x98 state.
        this.mActive = true;
        this.mPos = POS_START;
        if (mode === 'win') {
            // FUN_0041d22e rwg:35571-35587 (param >= 0x33): state 0, flag 0.
            this.mUseBareBack = false;
            this.mState = 0;
        } else {
            // FUN_0041d395 rwg:35692-35733 (param == 1000): state 4, flag 1.
            this.mUseBareBack = true;
            this.mState = 4;
        }
        // Background lists: +0xd4 is left empty; +0xe0 receives 0..16 in the
        // ctor loop (FUN_0040ca85 x 0x11, rwg:35331-35337).
        this.mAllDecorations = Array.from({ length: 0x11 }, (_, i) => i);
    }

    // FUN_0041cb16 (rwg:35075): set state and its start position.
    _setState(s) {
        this.mState = s;
        let p = POS_START;                                  // s == 0
        if (s === 1) p = -this._ufoHeight();                // -(UFO.h)
        else if (s === 2) p = POS_START;
        else if (s === 3) p = UFO_STOP_Y;
        else if (s === 4) p = POS_START;
        else if (s !== 0) p = 0.0;
        this.mPos = p;
    }

    // FUN_0041cce4 (rwg:35204): advance; false once past state 4.
    _nextState() {
        const s = this.mState + 1;
        if (s > 4) return false;
        this._setState(s);
        return true;
    }

    // FUN_0041d44d (rwg:35780): block height = FONT_16 GetHeight * lines.
    _blockHeight(lines) {
        return FONT_16_HEIGHT * lines.length;
    }

    _ufoHeight() {
        const u = IMAGES.IMAGE_UFO;
        return (u && (u.mHeight || (u.img && u.img.height))) || 0;
    }

    _ufoWidth() {
        const u = IMAGES.IMAGE_UFO;
        return (u && (u.mWidth || (u.img && u.img.width))) || 0;
    }

    // FUN_0041cb58 (rwg:35106-35200): one roll tick. Returns false when the
    // roll is finished (or parked), which makes Update show the OK button.
    _step() {
        switch (this.mState) {
            case 0:
                this.mPos -= SPEED_TEXT;
                if (this.mPos < -this._blockHeight(BLOCKS[0])) return this._nextState();
                return true;
            case 1:
                this.mPos += SPEED_UFO;
                if (UFO_STOP_Y < this.mPos) return this._nextState();
                return true;
            case 2:
                this.mPos -= SPEED_LETTER;
                if (this.mPos < -this._blockHeight(BLOCKS[2])) return this._nextState();
                return true;
            case 3: {
                this.mPos -= SPEED_UFO;
                const lim = -this._ufoHeight();
                if (lim < this.mPos || lim === this.mPos) return true;
                return this._nextState();
            }
            case 4:
                // Credits stop once pos < 50 (returns false every tick after).
                if (this.mPos < CREDITS_STOP) return false;
                this.mPos -= SPEED_TEXT;
                if (this.mPos < -this._blockHeight(BLOCKS[4])) return this._nextState();
                return true;
            default:
                return false;
        }
    }

    // SelectLevelView::Update FUN_0041d1f8 (rwg:35515-35530).
    update() {
        super.update();
        if (this.mActive && !this._step()) {
            this.mOkButton.mVisible = true;
        }
    }

    // SelectLevelView::Draw FUN_0041cf6f (rwg:35400; disassembly
    // @0x41cf6f-0x41d1f5).
    draw(g) {
        // +0x94 != 0 → list +0xd4 (empty), else list +0xe0 (all 17).
        drawFieldBackground(g, this.mUseBareBack ? [] : this.mAllDecorations, -1);
        const ctx = g.ctx;
        const ufo = IMAGES.IMAGE_UFO;
        const ufoX = Math.trunc((SCREEN_W - this._ufoWidth()) / 2);
        const step = FONT_16_HEIGHT * LINE_FACTOR;

        if (this.mState === 1 || this.mState === 3) {
            // DrawImage(UFO, (800 - w)/2, ftol(pos))  @0x41d18b-0x41d1ac
            g.drawImage(ufo, ufoX, ftol(this.mPos));
        } else if (this.mState === 0 || this.mState === 2) {
            // State 2 first draws the UFO parked at y = 0xb4 = 180 (@0x41d0cb).
            if (this.mState === 2) g.drawImage(ufo, ufoX, 0xb4);
            // FONT_16, white (DAT_005012a0). Each line centered:
            // x = (800 - StringWidth)/2, y = ftol(yf); yf += H * 1.4
            // (@0x41d0ea-0x41d187).
            ctx.save();
            ctx.font = FONT_CSS.FONT_16;
            let yf = this.mPos;
            for (const line of BLOCKS[this.mState]) {
                const w = ctx.measureText(line).width;
                const x = Math.trunc((SCREEN_W - w) / 2);
                drawOutlinedText(ctx, line, g.mTransX + x, g.mTransY + ftol(yf), '#fff');
                yf += step;
            }
            ctx.restore();
        } else if (this.mState === 4) {
            // FONT_16, white. Roles (+0xc4) at x = 0x64, names (+0xb4) at
            // x = 0x12c, same y = ftol(yf); yf += H * 1.4 (@0x41d010-0x41d0c6).
            ctx.save();
            ctx.font = FONT_CSS.FONT_16;
            let yf = this.mPos;
            for (let i = 0; i < CREDITS_ROLES.length; i++) {
                const y = ftol(yf);
                drawOutlinedText(ctx, CREDITS_ROLES[i], g.mTransX + 0x64, g.mTransY + y, '#fff');
                drawOutlinedText(ctx, CREDITS_NAMES[i], g.mTransX + 0x12c, g.mTransY + y, '#fff');
                yf += step;
            }
            ctx.restore();
        }

        // OK button (child) on top once visible.
        super.draw(g);
    }

    // SelectLevelView::ButtonDepress FUN_0041d3e0 (rwg:35735-35758):
    // PlaySample(DAT_004fed84 = SOUND_CLICK); if OK: roll inactive, hide OK,
    // GameApp::showMainMenu FUN_00408799.
    buttonDepress(id) {
        if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
        if (id === this.mOkButton.mId) {
            this.mActive = false;
            this.mOkButton.mVisible = false;
            if (this.mGameApp && this.mGameApp.showMainMenu) this.mGameApp.showMainMenu();
        }
    }

    // SelectLevelView overrides no key handler (vftable 0x4df364); mouse
    // input only reaches the OK button through the base Widget dispatch.
    keyDown(key) {
        return false;
    }
}
