// Sexy::UpgradeSelectDialog (FUN_00423f8a rwg:44055), driven by UpgradesView.js.
//
// Box FUN_0042434b(this, 0x96, 0x96, 500, 300) (rwg:44153).
// Title "SELECT UPGRADE" (rwg:44085) — static text in js/index.html.
// One button per picked upgrade id (up to 3 random ids of
// Core.getAvailableUpgrades, see pickUpgradeChoices), icon
// DAT_00500614[id] = IMAGE_UPGRADE_PREVIEW<id> (rwg:44128-44131).
// Body text: this+0x35 assigned from &DAT_004e1690 (rwg:44149-44151).

import { IMAGES } from './Res.js';
import { HtmlDialogs } from './HtmlDialogs.js';

// .rdata 0x4e1690 (file offset 0xe1690), cp1252: byte 0x92 = U+2019.
export const UPGRADE_PROMPT = 'You’ve earned enough money for your farm upgrade! Please select, what you would like to improve:';

// MSVC rand() (FUN_004a082c @0x4a082c: LCG, (seed >> 16) & 0x7fff).
function crtRand() { return Math.floor(Math.random() * 0x8000); }

// FUN_004245c2 (rwg:44532, @0x4245c2-0x424660), called from the dialog ctor
// FUN_00423f8a (@0x42404e) on the available-upgrade list: copy the list;
// while (copy not empty && result.size != 3) { n = rand() % copy.size;
// advance n nodes; result.push_back(*it) (FUN_004065e0); copy.erase(it) }.
// The result (at most 3 ids, in pick order) replaces the dialog's list
// +0x16c (FUN_00424663 @0x42405f) — one button per entry. This is why
// screenshots/25.png shows 3 of the 4 upgrades a new player can get
// (FUN_00416162 → {0, 1, 2, 5}), in the order 5, 1, 2.
export function pickUpgradeChoices(ids) {
    const copy = ids.slice();
    const out = [];
    while (copy.length !== 0 && out.length !== 3) {
        const n = crtRand() % copy.length;
        out.push(copy[n]);
        copy.splice(n, 1);
    }
    return out;
}

// Dialog options for a list of available upgrade ids (decoration ids 0..16):
// the ctor's random pick (pickUpgradeChoices) of up to 3.
export function upgradeOptions(ids) {
    return pickUpgradeChoices(ids).map(id => ({ key: id, previewIconKey: 'IMAGE_UPGRADE_PREVIEW' + id }));
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
