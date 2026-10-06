// Development preview of the real index.html dialogs, over the real menu.
// Player edits persist in this tab only; the real game save is isolated.
// /dialog-preview.html?dialog=options&ingame=1 selects the larger options box.
import { GameApp } from './GameApp.js';
import { HtmlDialogs } from './HtmlDialogs.js';
import { Core } from './Core.js';
import { ChangePlayerDialog } from './PlayerDialogs.js';
import { HintController, HintType } from './HintController.js';
import { openUpgradeChoices, UPGRADE_TIERS } from './UpgradeSelectDialog.js';
import { SelectLevelView } from './MainMenuView.js';
import { ShopDialog, SpecialShopDialog } from './ShopDialogs.js';

const response = await fetch('./index.html');
if (!response.ok) throw new Error(`Cannot load dialog markup: ${response.status}`);
const markup = new DOMParser().parseFromString(await response.text(), 'text/html');
document.body.prepend(document.importNode(markup.getElementById('game-wrap'), true));
// sessionStorage survives reloads, while the prefix prevents access to real
// cc_players / cc_current_player / legacy cc_core, including migrations.
const previewStorage = {
    getItem: key => sessionStorage.getItem(`cc_dialog_preview:${key}`),
    setItem: (key, value) => sessionStorage.setItem(`cc_dialog_preview:${key}`, value),
    removeItem: key => sessionStorage.removeItem(`cc_dialog_preview:${key}`),
};
const previewCore = new Core({ storage: previewStorage });
previewCore.load();
if (!previewStorage.getItem('cc_players')) {
    previewCore.addPlayer('111'); // Initial screenshot 08 fixture, only once.
    previewCore.selectPlayer('111');
}
const app = new GameApp('gameCanvas', { core: previewCore });
await app.init();
HtmlDialogs.closeAll();
const params = new URLSearchParams(location.search);
const name = params.get('dialog') || 'options';
const inGame = params.get('ingame') === '1';
// Developer-only catalog. The actual index.html/game has no preview controls.
const previews = [
    ['OPTIONS', 'dialog=options'],
    ['OPTIONS — во время игры', 'dialog=options&ingame=1'],
    ['QUIT?', 'dialog=quit-confirm'],
    ['NEW PLAYER', 'dialog=new-player'],
    ['NEW PLAYER — с отменой', 'dialog=new-player&cancel=1'],
    ['WHO ARE YOU?', 'dialog=change-player'],
    ['HINT', 'dialog=hint'],
    ['SELECT UPGRADE', 'dialog=upgrade'],
    ['SHOP', 'dialog=shop-sell'],
    ['SHOP — последняя курица', 'dialog=shop-sell&count=1'],
    ['SPECIAL SHOP', 'dialog=shop-buy'],
    ['SPECIAL SHOP — нет денег', 'dialog=shop-buy&money=0'],
    ['LEVEL COMPLETED', 'dialog=level-complete'],
    ['BONUS LEVEL COMPLETED', 'dialog=level-complete&bonus=1'],
    ['BONUS LEVEL — без награды', 'dialog=level-complete&bonus=1&reward=0'],
    ['LEVEL FAILED — время', 'dialog=level-failed'],
    ['LEVEL FAILED — курицы', 'dialog=level-failed&reason=chickens'],
    ['Вступление — письмо', 'dialog=intro-letter'],
    ['Вступление — иллюстрация', 'dialog=intro-panel'],
    ['SELECT LEVEL', 'dialog=select-level'],
];
const picker = document.getElementById('preview-picker');
const choice = picker.elements.dialog;
const levelInput = picker.elements.level;
const hintChoice = picker.elements.hint;
for (const [key, value] of Object.entries(HintType)) {
    hintChoice.add(new Option(`${value + 1} — ${key.toLowerCase().replaceAll('_', ' ')}`, value));
}
hintChoice.value = Object.values(HintType).includes(Number(params.get('hint'))) && params.has('hint')
    ? params.get('hint') : String(HintType.COLLECT_COINS);
for (const [label, query] of previews) choice.add(new Option(label, query));
// Ignore unrelated parameters; prefer the most specific matching variant.
const current = previews.filter(([, query]) => [...new URLSearchParams(query)]
    .every(([key, value]) => (params.get(key) || (key === 'dialog' ? 'options' : '')) === value))
    .sort((a, b) => b[1].length - a[1].length)[0] || previews[0];
choice.value = current[1];
levelInput.value = Math.max(1, Math.min(50, Number(params.get('level')) || 1));
function updatePicker() {
    document.getElementById('preview-level-row').hidden = new URLSearchParams(choice.value).get('dialog') !== 'select-level';
    document.getElementById('preview-hint-row').hidden = new URLSearchParams(choice.value).get('dialog') !== 'hint';
}
choice.addEventListener('change', updatePicker);
updatePicker();
picker.addEventListener('submit', event => {
    event.preventDefault();
    const next = new URLSearchParams(choice.value);
    if (next.get('dialog') === 'select-level') next.set('level', levelInput.value);
    if (next.get('dialog') === 'hint') next.set('hint', hintChoice.value);
    location.search = next.toString();
});
if (!document.querySelector(`[data-dialog="${CSS.escape(name)}"]`)) {
    throw new Error(`Unknown preview dialog: ${name}`);
}
if (name === 'quit-confirm') {
    HtmlDialogs.open('options', { visible: {ingame: true}, binds: {music: 0.5, sfx: 0.7, fullscreen: false, hwaccel: true} });
}
HtmlDialogs.open(name, {
    binds: {
        music: app.mCore.mMusicVolume ?? 0.5,
        sfx: app.mCore.mSoundVolume ?? 0.7,
        fullscreen: false,
        hwaccel: true,
        name: '111', // screenshot 04
        error: '',
    },
    visible: { ingame: inGame, cancel: params.get('cancel') === '1' },
    actions: {
        close: () => HtmlDialogs.close(name),
        cancel: () => HtmlDialogs.close(name),
        restart: confirmQuit,
        mainmenu: confirmQuit,
        yes: () => HtmlDialogs.closeAll(),
        no: () => HtmlDialogs.close('quit-confirm'),
        ok: () => HtmlDialogs.close(name),
    },
});

function confirmQuit() {
    HtmlDialogs.open('quit-confirm', {
        actions: {
            yes: () => HtmlDialogs.closeAll(),
            no: () => HtmlDialogs.close('quit-confirm'),
        },
    });
}

// Use the same player dialogs as the game, with the isolated preview Core.
if (name === 'change-player') {
    new ChangePlayerDialog(previewCore, () => {}).openHtml();
}
// Screenshot 15 uses COLLECT_COINS. &hint=<HintType number> previews other
// original strings through the same controller and isolated player save.
if (name === 'hint') {
    const requestedHint = params.has('hint') ? Number(params.get('hint')) : HintType.COLLECT_COINS;
    const hint = Object.values(HintType).includes(requestedHint) ? requestedHint : HintType.COLLECT_COINS;
    new HintController(previewCore).forceHint(hint);
}
if (name === 'level-complete') {
    const isBonus = params.get('bonus') === '1';
    // Screenshot 17: Your time 00:48, Ace time 00:44, Best time by 222.
    // Bonus literals: FUN_0040dc45, rwg:17036-17064; no gameplay/save changes.
    HtmlDialogs.open(name, {
        binds: {
            title: isBonus ? 'BONUS LEVEL COMPLETED' : 'LEVEL COMPLETED',
            yourtime: '00:48', acetime: '00:44',
            bestlabel: 'Best time - by 222', besttime: '00:48',
            bonus: isBonus ? (params.get('reward') === '0'
                ? "You haven't got a bonus"
                : 'Perfect! You have got a bonus for the next level: one of special shop upgrades will be allowed at half price!') : '',
        },
        visible: { times: !isBonus, bonus: isBonus },
        actions: { continue: () => HtmlDialogs.close(name) },
    });
}
if (name === 'level-failed') {
    // Original reasons/body: FUN_0040e0ea, rwg:17418-17427.
    // Preview actions dismiss only; the actual game keeps restart/menu callbacks.
    HtmlDialogs.open(name, {
        binds: { reason: (params.get('reason') === 'chickens' ? 'You lost all your chickens' : 'Time up')
            + '\nPress main menu or restart' },
        actions: {
            restart: () => HtmlDialogs.close(name),
            mainmenu: () => HtmlDialogs.close(name),
        },
    });
}
if (name === 'upgrade') {
    openUpgradeChoices(UPGRADE_TIERS[0], () => HtmlDialogs.close(name));
}
if (name === 'select-level') {
    // Preview every original level without changing real or isolated progression.
    const view = new SelectLevelView({
        mCore: { mMaxLevelReached: 50 },
        startGame: () => HtmlDialogs.close(name),
    });
    view.mSelectedLevel = Math.max(1, Math.min(50, Math.round(Number(params.get('level')) || 1)));
    view.openHtml();
}
if (name === 'intro-letter') {
    // Use the game's original letter -> illustrated page -> dismiss handlers.
    app.mGameView._showIntroHtml();
}
if (name === 'shop-sell') {
    // Development fixture only: 13 chickens exercise both 10-row pages.
    // The real ShopDialog drives prices, selling and the last-chicken guard.
    // No field, progression or player save is shared with the game.
    const count = params.has('count') ? Math.max(0, Math.min(100, Number(params.get('count')) || 0)) : 13;
    const field = {
        mMoney: 0,
        mField: { mChickens: Array.from({ length: count }, (_, i) => ({
            mType: i % 5, mIsAlive: true, mIsAdult: i % 3 !== 0,
            mGrowTimer: 200 + (i % 3) * 200, mX: 0, mY: 0,
        })) },
    };
    new ShopDialog(field, () => {}).openHtml();
}
if (name === 'shop-buy') {
    // Separate in-memory field: real purchase/price/pagination callbacks,
    // with no gameplay progression or save writes. &money=0 tests rejection.
    const field = {
        mMoney: params.has('money') ? Math.max(0, Number(params.get('money')) || 0) : 5000,
        mCurrentLevel: 17,
        mLevelConfig: { hasBuy: true, hasMagicHoly: true },
        mTotalRaisedChicks: 0, mHatchedMagic: 0, mHatchedHoly: 0,
        mField: {
            mChickens: [], mPets: [],
            addChick(chick) { this.mChickens.push(chick); },
            addPet(pet) { this.mPets.push(pet); },
        },
        spendMoney(price) { this.mMoney -= price; },
    };
    new SpecialShopDialog(field, () => {}).openHtml();
}
