// Sexy::UpgradeSelectDialog (FUN_00423f8a rwg:44055), driven by UpgradesView.js.
//
// Box FUN_0042434b(this, 0x96, 0x96, 500, 300) (rwg:44153).
// Title "SELECT UPGRADE" (rwg:44085) — static text in js/index.html.
// One button per available upgrade id (Core.getAvailableUpgrades), icon
// DAT_00500614[id] = IMAGE_UPGRADE_PREVIEW<id> (rwg:44128-44131).
// Body text: this+0x35 assigned from &DAT_004e1690 (rwg:44149-44151).

import { IMAGES } from './Res.js';
import { HtmlDialogs } from './HtmlDialogs.js';

// .rdata 0x4e1690 (file offset 0xe1690), cp1252: byte 0x92 = U+2019.
export const UPGRADE_PROMPT = 'You’ve earned enough money for your farm upgrade! Please select, what you would like to improve:';

// Options for a list of upgrade ids (decoration ids 0..16).
export function upgradeOptions(ids) {
    return ids.map(id => ({ key: id, previewIconKey: 'IMAGE_UPGRADE_PREVIEW' + id }));
}

// Shared by the game (UpgradesView) and the development preview; selection
// effects stay with the caller (FUN_004244a0 in UpgradesView._onDialogSelect).
export function openUpgradeChoices(options, onSelect) {
    HtmlDialogs.open('upgrade', {
        binds: { desc: UPGRADE_PROMPT },
        actions: { select: ({ index }) => {
            if (options[index]) onSelect(options[index]);
        } },
    });
    HtmlDialogs.fillList('upgrade', 'options', options, (opt, row) => {
        const image = IMAGES[opt.previewIconKey];
        const icon = row.querySelector('.cc-slot-icon');
        if (image?.mPath) icon.src = image.mPath;
        row.querySelector('.cc-slot').setAttribute('aria-label', String(opt.key));
    });
}
