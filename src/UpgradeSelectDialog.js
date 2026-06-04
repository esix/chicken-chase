// Sexy::UpgradeSelectDialog (FUN_00423f8a:44055).
// Verified per DECOMPILED_MAP.md section 13.
//
// Box (FUN_0042434b: 0x96=150, 0x96=150, 500, 300).
// Title "SELECT UPGRADE" (line 44085).
// 3 dynamic option buttons (lines 44114-44148).
// Body text from global &DAT_004e1690 (UNKNOWN literal — placeholder used here).
//
// Shown after level 3 (per user observation in original notes).
// Each option grants a permanent upgrade to the player profile.

import { IMAGES, SOUNDS } from './Res.js';
import { drawFitText, wrapText } from './TextUtil.js';

const BOX = { x: 150, y: 150, w: 500, h: 300 };

export class UpgradeSelectDialog {
    constructor(core, options, onSelect) {
        this.mCore = core;
        // options: array of 3 {key, label, iconKey, description}
        this.mOptions = options || [];
        this.mOnSelect = onSelect;
        this.mIsActive = true;
    }

    isShown() { return this.mIsActive; }

    draw(g) {
        if (!this.mIsActive) return;
        // Modal scrim
        g.setColor(0, 0, 0, 150);
        g.fillRect(0, 0, 800, 600);

        // 9-slice box: the baked title plate at the top IS the wood plate seen in
        // screenshot 25 — no need to draw a separate bar over it.
        const { x: bx, y: by, w: bw, h: bh } = BOX;
        const plate = g.drawDialogBox(IMAGES.IMAGE_DIALOG_BOX, bx, by, bw, bh);

        // Title 'SELECT UPGRADE' (CONFIRMED rwg:44085) centered IN the plate.
        // White text CONFIRMED rwg:40887-40891. FONT_DLG_HEADER=ArialBlack14
        // (resources.xml:61).
        g.ctx.fillStyle = '#fff';
        g.ctx.textAlign = 'center';
        g.ctx.textBaseline = 'middle';
        drawFitText(g.ctx, 'SELECT UPGRADE', bx + bw / 2, plate.plateCenterY, bw - 40,
            'bold 18px "Arial Black", Arial, sans-serif');
        g.ctx.textBaseline = 'alphabetic';

        // Instructional body. The decompiled body string (DAT_004e1690, rwg:44151)
        // literal is UNKNOWN — this text is read from screenshot 25. Hovering a
        // slot overrides it with that option's description (a usability extra).
        // FONT_DLG_LINES=ArialBlack12 (resources.xml:62), white, wrapped.
        const body = this.mHoverDescription
            || "You've earned enough money for your farm upgrade! Please select, what you would like to improve:";
        g.ctx.fillStyle = '#fff';
        g.ctx.font = 'bold 14px "Arial Black", Arial, sans-serif';
        g.ctx.textAlign = 'center';
        const bodyLines = wrapText(g.ctx, body, bw - 70);
        for (let i = 0; i < bodyLines.length; i++) {
            g.ctx.fillText(bodyLines[i], bx + bw / 2, by + 94 + i * 23);
        }

        // 3 option slots. Geometry from FUN_0042434b: slotW/slotH = icon image
        // size (rwg:44359-44360; ~98x97 measured from screenshot 25); spacing =
        // (bw - count*slotW)/(count+1) (rwg:44337); slotY = box.y + 0x96 = by+150
        // (rwg:44359); slot x advances by spacing+slotW (rwg:44361). No caption
        // label under slots (screenshot 25 shows none).
        this._optionRects = [];
        const count = Math.min(3, this.mOptions.length);
        const slotW = 98, slotH = 97;
        const spacing = Math.floor((bw - count * slotW) / (count + 1));
        const slotY = by + 150;
        for (let i = 0; i < count; i++) {
            const opt = this.mOptions[i];
            const sx = bx + spacing * (i + 1) + slotW * i;
            const slotImg = IMAGES.IMAGE_SHOP_SLOT_OPEN;
            if (slotImg && slotImg.img && g._isReady && g._isReady(slotImg.img)) {
                g.ctx.drawImage(slotImg.img, sx, slotY, slotW, slotH);
            } else {
                g.ctx.fillStyle = 'rgba(0,0,0,0.18)';
                g.ctx.fillRect(sx, slotY, slotW, slotH);
            }
            const iconImg = opt.iconKey ? IMAGES[opt.iconKey] : null;
            if (iconImg && iconImg.img && g._isReady && g._isReady(iconImg.img)) {
                g.ctx.drawImage(iconImg.img, sx + 10, slotY + 10, slotW - 20, slotH - 20);
            }
            this._optionRects.push({ x: sx, y: slotY, w: slotW, h: slotH, opt });
        }
    }

    mouseMove(x, y) {
        if (!this.mIsActive) return false;
        this.mHoverDescription = null;
        for (const r of this._optionRects || []) {
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                this.mHoverDescription = r.opt.description || r.opt.label || '';
                break;
            }
        }
        return true;
    }

    mouseDown(x, y, btn) {
        if (!this.mIsActive || btn !== 0) return true;
        for (const r of this._optionRects || []) {
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
                this._select(r.opt);
                return true;
            }
        }
        return true; // consume — no escape allowed (mandatory choice)
    }

    keyDown(key) {
        // Number keys 1-3 to pick option
        if (key >= '1' && key <= '3') {
            const idx = parseInt(key, 10) - 1;
            if (this.mOptions[idx]) { this._select(this.mOptions[idx]); return true; }
        }
        return true; // no Escape — must choose
    }

    _select(opt) {
        this.mIsActive = false;
        // Persist to player profile
        if (this.mCore && opt && opt.key) {
            this.mCore.mUpgradesPurchased = this.mCore.mUpgradesPurchased || [];
            // Dedupe — re-picking the same upgrade across multiple dialog
            // gates is allowed (the in-session apply is idempotent via
            // Math.max) but the saved list can grow indefinitely otherwise,
            // since upgrade dialog gates fire every 3 levels.
            if (!this.mCore.mUpgradesPurchased.includes(opt.key)) {
                this.mCore.mUpgradesPurchased.push(opt.key);
            }
            if (this.mCore.save) this.mCore.save();
        }
        if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
        if (this.mOnSelect) this.mOnSelect(opt);
    }
}

// Default upgrade options. The 3 options cycle by tier (post-level-3 has these).
// Could be expanded with verified data from FUN_00423f8a per upgrade tier.
export const UPGRADE_TIERS = [
    [
        { key: 'house_1', label: 'Coop Upgrade I', iconKey: 'IMAGE_OFFENSIVE_SEEDS_COUNT1',
          description: 'Upgrade your coop visuals (tier 1).' },
        { key: 'seeds_1', label: 'Better Seeds', iconKey: 'IMAGE_OFFENSIVE_SEEDS_CALORIES1',
          description: 'Seeds restore more hunger.' },
        { key: 'gun_1', label: 'Stronger Slingshot', iconKey: 'IMAGE_OFFENSIVE_GUN_POWER',
          description: 'Scares ravens with one hit.' },
    ],
    [
        { key: 'house_2', label: 'Coop Upgrade II', iconKey: 'IMAGE_OFFENSIVE_SEEDS_COUNT2',
          description: 'Upgrade your coop visuals (tier 2).' },
        { key: 'seeds_2', label: 'Premium Seeds', iconKey: 'IMAGE_OFFENSIVE_SEEDS_CALORIES2',
          description: 'Seeds restore even more hunger.' },
        { key: 'gun_area', label: 'Wide Slingshot', iconKey: 'IMAGE_OFFENSIVE_GUN_AREA',
          description: 'Scares all ravens in an area.' },
    ],
];
