// Port of Sexy::Res / Sexy::ResourceManager
// Original: vtable at 004dcd84 / 004e3dd8
// Resources defined in properties/resources.xml
// Paths verified against actual extracted filesystem

import { Image, SoundInstance } from './SexyApp.js';

const BASE_PATH = 'app/';

export const IMAGES = {};
export const SOUNDS = {};
export const FONTS = {};

// Set of image paths (relative to app/) that have a "_" alpha mask file
const HAS_ALPHA_MASK = new Set([
    'images/alien_catch.jpg','images/alien_down.jpg','images/alien_up.jpg',
    'images/button_next.png','images/button_prev.png','images/chick_hungry.png',
    'images/chicken/broody/death.jpg','images/chicken/broody/dig.jpg',
    'images/chicken/broody/idle.jpg','images/chicken/broody/on_nest.jpg',
    'images/chicken/broody/peck.jpg','images/chicken/broody/sit_down.jpg',
    'images/chicken/broody/walk.jpg',
    'images/chicken/holy/death.jpg','images/chicken/holy/dig.jpg',
    'images/chicken/holy/idle.jpg','images/chicken/holy/peck.jpg',
    'images/chicken/holy/spell.jpg','images/chicken/holy/walk.jpg',
    'images/chicken/layer/death.jpg','images/chicken/layer/dig.jpg',
    'images/chicken/layer/idle.jpg','images/chicken/layer/layer.jpg',
    'images/chicken/layer/peck.jpg','images/chicken/layer/sick_idle.png',
    'images/chicken/layer/sick_start.jpg','images/chicken/layer/walk.jpg',
    'images/chicken/magic/death.jpg','images/chicken/magic/dig.jpg',
    'images/chicken/magic/idle.jpg','images/chicken/magic/peck.jpg',
    'images/chicken/magic/walk.jpg',
    'images/chicken/rooster/death.jpg','images/chicken/rooster/dig.jpg',
    'images/chicken/rooster/idle.jpg','images/chicken/rooster/peck.jpg',
    'images/chicken/rooster/walk.jpg',
    'images/dialog_btn_highlight_over.png','images/dialog_btn_highlight.png',
    'images/dialog_btn_over.png','images/dialog_btn.png','images/dialog.png',
    'images/diamond_blue.png','images/diamond_red.jpg','images/egg.png',
    'images/hand_cure.PNG','images/hand_gun.png','images/hand_gun1.png',
    'images/hand_gun2.png','images/hand_gun3.png','images/hand_seeds.png',
    'images/hint_pointer_down.png','images/hint_pointer_up.png',
    'images/icon_risk.jpg','images/in_game_down.png','images/in_game_up.png',
    'images/letter.jpg',
    'images/main_button_exit_over.png','images/main_button_exit.png',
    'images/main_button_options_over.png','images/main_button_options.png',
    'images/main_button_start_over.png','images/main_button_start.png',
    'images/mission_chickens_holy.png','images/mission_chickens_layer.png',
    'images/mission_chickens_magic.png','images/mission_chickens_rooster.png',
    'images/mission_chickens.png','images/mission_coin.png',
    'images/mission_diamonds_blue.png','images/mission_diamonds_red.png',
    'images/mission_eggs_broody.png','images/mission_eggs_holy.png',
    'images/mission_eggs_layer.png','images/mission_eggs_magic.png',
    'images/mission_eggs_rooster.png','images/mission_eggs.png',
    'images/mission_money.png','images/mission_time.png',
    'images/monet_gold.jpg','images/monet_silver.jpg',
    'images/number_slot_task.png','images/number_slot.png',
    'images/pets/wolf/eat.jpg','images/pets/wolf/walk.jpg',
    'images/shadow.png','images/shop_slot_big.png','images/shop_slot_closed.png',
    'images/shop_slot_open.PNG' /* mask is shop_slot_open_.png, see MASK_PATH_OVERRIDE */,
    'images/slider_thumb.png','images/slider.png',
    'images/specials/elephant.png','images/specials/gun_area.png',
    'images/specials/gun_power.png','images/specials/mouse.png',
    'images/specials/seeds_calories1.png','images/specials/seeds_calories2.png',
    'images/specials/seeds_count1.png','images/specials/seeds_count2.png',
    'images/spell_flash.png','images/ufo.jpg',
    'images/up0.jpg','images/up1.jpg','images/up2.jpg','images/up3.jpg',
    'images/up4.jpg','images/up5.jpg','images/up6.jpg','images/up7.jpg',
    'images/up8.jpg','images/up9.jpg','images/up10.jpg','images/up11.jpg',
    'images/up12.jpg','images/up13.jpg','images/up14.jpg','images/up15.jpg',
    'images/up16.jpg',
]);

// The only image whose "_" mask file uses a different extension case than the
// colour file (app/images/shop_slot_open.PNG + app/images/shop_slot_open_.png).
// Sexy's image loader resolves the mask by base name, independent of the
// extension; a case-sensitive web server needs the exact name.
const MASK_PATH_OVERRIDE = {
    'images/shop_slot_open.PNG': 'images/shop_slot_open_.png',
};

export class Res {
    static loaded = false;

    static async loadAll(progressCallback) {
        // Exact paths from extracted filesystem (case-sensitive, with correct extensions)
        // resources.xml group "Init" — loaded synchronously by GameApp::Init
        // (FUN_004084d8 rwg:10622) before the TitleScreen is created.
        const initList = [
            ['IMAGE_PROGRESSBAR', 'images/progressbar.png'],
            ['IMAGE_PROGRESSBAR_BACK', 'images/progressbar_back.png'],
        ];
        // resources.xml group "Game" — loaded by LoadingThreadProc
        // (FUN_0040860b rwg:10678). The FONT_* entries of this group are not
        // loaded: the port draws text with browser fonts.
        const imageList = [
            // Backgrounds
            ['IMAGE_GAME_BACK', 'images/back.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE0', 'images/up0.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE1', 'images/up1.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE2', 'images/up2.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE3', 'images/up3.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE4', 'images/up4.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE5', 'images/up5.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE6', 'images/up6.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE7', 'images/up7.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE8', 'images/up8.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE9', 'images/up9.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE10', 'images/up10.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE11', 'images/up11.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE12', 'images/up12.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE13', 'images/up13.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE14', 'images/up14.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE15', 'images/up15.jpg'],
            ['IMAGE_GAME_BACK_UPGRADE16', 'images/up16.jpg'],
            // Seeds
            ['IMAGE_SEED', 'images/seed.png'],
            ['IMAGE_SEED_CALORIES1', 'images/seed_calories1.png'],
            ['IMAGE_SEED_CALORIES2', 'images/seed_calories2.png'],
            ['IMAGE_CHECKBOX', 'images/checkbox.png'],
            ['IMAGE_SLIDER_TRACK', 'images/slider.png'],
            ['IMAGE_SLIDER_THUMB', 'images/slider_thumb.png'],
            // Layer chicken (lowercase dir)
            ['IMAGE_CHICK_IDLE0_LAYER', 'images/chicken/layer/idle.jpg'],
            ['IMAGE_CHICK_IDLE1_LAYER', 'images/chicken/layer/dig.jpg'],
            ['IMAGE_CHICK_PECK_LAYER', 'images/chicken/layer/peck.jpg'],
            ['IMAGE_CHICK_WALK_LAYER', 'images/chicken/layer/walk.jpg'],
            ['IMAGE_CHICK_SICK_START_LAYER', 'images/chicken/layer/sick_start.jpg'],
            ['IMAGE_CHICK_SICK_IDLE_LAYER', 'images/chicken/layer/sick_idle.png'],
            ['IMAGE_CHICK_LAYER_LAYER', 'images/chicken/layer/layer.jpg'],
            ['IMAGE_CHICK_DEATH_LAYER', 'images/chicken/layer/death.jpg'],
            // Broody chicken (lowercase dir)
            ['IMAGE_CHICK_IDLE0_BROODY', 'images/chicken/broody/idle.jpg'],
            ['IMAGE_CHICK_IDLE1_BROODY', 'images/chicken/broody/dig.jpg'],
            ['IMAGE_CHICK_PECK_BROODY', 'images/chicken/broody/peck.jpg'],
            ['IMAGE_CHICK_WALK_BROODY', 'images/chicken/broody/walk.jpg'],
            ['IMAGE_CHICK_BROOD_IDLE_BROODY', 'images/chicken/broody/on_nest.jpg'],
            ['IMAGE_CHICK_BROOD_START_BROODY', 'images/chicken/broody/sit_down.jpg'],
            ['IMAGE_CHICK_DEATH_BROODY', 'images/chicken/broody/death.jpg'],
            // Rooster (lowercase dir)
            ['IMAGE_CHICK_IDLE0_ROOSTER', 'images/chicken/rooster/idle.jpg'],
            ['IMAGE_CHICK_IDLE1_ROOSTER', 'images/chicken/rooster/dig.jpg'],
            ['IMAGE_CHICK_PECK_ROOSTER', 'images/chicken/rooster/peck.jpg'],
            ['IMAGE_CHICK_WALK_ROOSTER', 'images/chicken/rooster/walk.jpg'],
            ['IMAGE_CHICK_DEATH_ROOSTER', 'images/chicken/rooster/death.jpg'],
            // Magic (lowercase dir)
            ['IMAGE_CHICK_IDLE0_MAGIC', 'images/chicken/magic/idle.jpg'],
            ['IMAGE_CHICK_IDLE1_MAGIC', 'images/chicken/magic/dig.jpg'],
            ['IMAGE_CHICK_PECK_MAGIC', 'images/chicken/magic/peck.jpg'],
            ['IMAGE_CHICK_WALK_MAGIC', 'images/chicken/magic/walk.jpg'],
            ['IMAGE_CHICK_DEATH_MAGIC', 'images/chicken/magic/death.jpg'],
            // Holy (lowercase dir)
            ['IMAGE_CHICK_IDLE0_HOLY', 'images/chicken/holy/idle.jpg'],
            ['IMAGE_CHICK_IDLE1_HOLY', 'images/chicken/holy/dig.jpg'],
            ['IMAGE_CHICK_PECK_HOLY', 'images/chicken/holy/peck.jpg'],
            ['IMAGE_CHICK_WALK_HOLY', 'images/chicken/holy/walk.jpg'],
            ['IMAGE_CHICK_DEATH_HOLY', 'images/chicken/holy/death.jpg'],
            // spell.jpg — 15-frame holy-spell cast animation.
            ['IMAGE_CHICK_HOLY_SPELL', 'images/chicken/holy/spell.jpg', 15],
            // Previews (mixed .png/.PNG)
            ['IMAGE_CHICK_PREVIEW_LAYER', 'images/chicken/layer/preview.PNG'],
            ['IMAGE_CHICK_PREVIEW_BROODY', 'images/chicken/broody/preview.png'],
            ['IMAGE_CHICK_PREVIEW_ROOSTER', 'images/chicken/rooster/preview.PNG'],
            ['IMAGE_CHICK_PREVIEW_MAGIC', 'images/chicken/magic/preview.PNG'],
            ['IMAGE_CHICK_PREVIEW_HOLY', 'images/chicken/holy/preview.PNG'],
            // Hands/cursors
            ['IMAGE_HAND_SEEDS', 'images/hand_seeds.png'],
            ['IMAGE_HAND_CURE', 'images/hand_cure.PNG'],
            ['IMAGE_HAND_GUN', 'images/hand_gun.png'],
            ['IMAGE_HAND_GUN_POWER', 'images/hand_gun1.png'],
            ['IMAGE_HAND_GUN_AREA', 'images/hand_gun2.png'],
            ['IMAGE_HAND_GUN_POWER_AREA', 'images/hand_gun3.png'],
            // Aliens/ravens
            ['IMAGE_ALIEN_DOWN', 'images/alien_down.jpg'],
            ['IMAGE_ALIEN_CATCH', 'images/alien_catch.jpg'],
            ['IMAGE_ALIEN_UP', 'images/alien_up.jpg'],
            // Items
            // egg.png is a 5-frame cracking strip (320x64 = 5 × 64-wide cells):
            // frame 0 = whole egg, frame 4 = fully cracked. Egg.draw advances
            // frames as the egg's lifetime ticks down. Explicit cols omitted
            // so Image.load's width/height auto-detect picks 5 — matches the
            // original's mNumCols = mWidth / mHeight calc (FUN_xxxxxxxx:31176,
            // `*piVar7 / *piVar1`). Previously hard-coded 6, producing
            // mis-aligned 53.33×64 cells that straddled actual frame
            // boundaries (so the "whole egg" frame 0 showed 53px of frame 0
            // plus 11px of frame 1, and the last frame ran off the image).
            ['IMAGE_EGG', 'images/egg.png'],
            ['IMAGE_EGG_REF', 'images/egg_ref.png'],
            ['IMAGE_EGG_REF_FOR_BROOD', 'images/egg_ref_for_brood.png'],
            ['IMAGE_EGG_REF_BROOD_PROGRESS', 'images/egg_ref_brood_progress.png'],
            ['IMAGE_COIN_GOLD', 'images/monet_gold.jpg'],
            ['IMAGE_COIN_SILVER', 'images/monet_silver.jpg'],
            ['IMAGE_DIAMOND_BLUE', 'images/diamond_blue.png'],
            ['IMAGE_DIAMOND_RED', 'images/diamond_red.jpg'],
            ['IMAGE_HINT_POINTER_DOWN', 'images/hint_pointer_down.png'],
            ['IMAGE_HINT_POINTER_UP', 'images/hint_pointer_up.png'],
            ['IMAGE_SHOP_SLOT_OPEN', 'images/shop_slot_open.PNG'],
            ['IMAGE_SHOP_SLOT_CLOSED', 'images/shop_slot_closed.png'],
            ['IMAGE_SHOP_SLOT_BIG', 'images/shop_slot_big.png'],
            // UI
            ['IMAGE_MAIN_MENU', 'images/Main_menu.jpg'],
            ['IMAGE_DIALOG_BOX', 'images/dialog.png'],
            ['IMAGE_DIALOG_BUTTON', 'images/dialog_btn.png'],
            ['IMAGE_DIALOG_BUTTON_OVER', 'images/dialog_btn_over.png'],
            ['IMAGE_DIALOG_BUTTON_HIGHLIGHT', 'images/dialog_btn_highlight.png'],
            ['IMAGE_DIALOG_BUTTON_HIGHLIGHT_OVER', 'images/dialog_btn_highlight_over.png'],
            ['IMAGE_IN_GAME_UP', 'images/in_game_up.png'],
            ['IMAGE_IN_GAME_DOWN', 'images/in_game_down.png'],
            ['IMAGE_NUMBER_SLOT', 'images/number_slot.png'],
            ['IMAGE_NUMBER_SLOT_TASK', 'images/number_slot_task.png'],
            // Missions
            ['IMAGE_MISSION_COIN', 'images/mission_coin.png'],
            ['IMAGE_MISSION_DIAMONDS_BLUE', 'images/mission_diamonds_blue.png'],
            ['IMAGE_MISSION_DIAMONDS_RED', 'images/mission_diamonds_red.png'],
            ['IMAGE_MISSION_MONEY', 'images/mission_money.png'],
            ['IMAGE_MISSION_EGGS', 'images/mission_eggs.png'],
            ['IMAGE_MISSION_EGGS_LAYER', 'images/mission_eggs_layer.png'],
            ['IMAGE_MISSION_EGGS_BROODY', 'images/mission_eggs_broody.png'],
            ['IMAGE_MISSION_EGGS_ROOSTER', 'images/mission_eggs_rooster.png'],
            ['IMAGE_MISSION_EGGS_MAGIC', 'images/mission_eggs_magic.png'],
            ['IMAGE_MISSION_EGGS_HOLY', 'images/mission_eggs_holy.png'],
            ['IMAGE_MISSION_CHICKENS', 'images/mission_chickens.png'],
            ['IMAGE_MISSION_CHICKENS_MAGIC', 'images/mission_chickens_magic.png'],
            ['IMAGE_MISSION_CHICKENS_HOLY', 'images/mission_chickens_holy.png'],
            ['IMAGE_MISSION_CHICKENS_ROOSTER', 'images/mission_chickens_rooster.png'],
            ['IMAGE_MISSION_TIME', 'images/mission_time.png'],
            ['IMAGE_BUTTON_PREV', 'images/button_prev.png'],
            ['IMAGE_BUTTON_NEXT', 'images/button_next.png'],
            ['IMAGE_SPELL', 'images/spell_flash.png'],
            ['IMAGE_SHADOW', 'images/shadow.png'],
            // Offensives/specials (lowercase dir and filenames)
            ['IMAGE_OFFENSIVE_SEEDS_COUNT1', 'images/specials/seeds_count1.png'],
            ['IMAGE_OFFENSIVE_MOUSE', 'images/specials/mouse.png'],
            ['IMAGE_OFFENSIVE_SEEDS_CALORIES1', 'images/specials/seeds_calories1.png'],
            ['IMAGE_OFFENSIVE_GUN_AREA', 'images/specials/gun_area.png'],
            ['IMAGE_OFFENSIVE_ELEPHANT', 'images/specials/elephant.png'],
            ['IMAGE_OFFENSIVE_SEEDS_COUNT2', 'images/specials/seeds_count2.png'],
            ['IMAGE_OFFENSIVE_SEEDS_CALORIES2', 'images/specials/seeds_calories2.png'],
            ['IMAGE_OFFENSIVE_GUN_POWER', 'images/specials/gun_power.png'],
            ['IMAGE_ICON_RISK', 'images/icon_risk.jpg'],
            // Pets (non-square frames, explicit column counts)
            ['IMAGE_PET_IDLE_MOUSE', 'images/pets/mouse/idle.png', 7],
            ['IMAGE_PET_WALK_MOUSE', 'images/pets/mouse/walk.png', 14],
            ['IMAGE_PET_IDLE_ELEPHANT', 'images/pets/elephant/idle.png', 10],
            ['IMAGE_PET_WALK_ELEPHANT', 'images/pets/elephant/walk.png', 10],
            // Native wolf cels are 135x110: walk 1350px = 10 frames,
            // eat 1755px = 13 frames. The old 9-column split leaked adjacent cels.
            ['IMAGE_PET_WALK_WOLF', 'images/pets/wolf/walk.jpg', 10],
            ['IMAGE_PET_SPECIAL_WOLF', 'images/pets/wolf/eat.jpg', 13],
            // Additional
            ['IMAGE_INTRODUCTION', 'images/Introduction.jpg'],
            ['IMAGE_INTRODUCTION_LETTER', 'images/letter.jpg'],
            // chick_hungry.png is 450x50 — auto-detect picks 9 frames at 50x50,
            // matching the original's mNumCols = width/height calc per
            // FUN_xxxxxxxx:31626 (`*piVar7 / *piVar1`). Previously hardcoded
            // as 6 frames, producing 75x50 mis-aligned cells that straddled
            // actual frame boundaries — the thought-bubble animation showed
            // half-frames bleeding into each other instead of clean transitions.
            ['IMAGE_CHICK_HUNGRY', 'images/chick_hungry.png'],
            ['IMAGE_UFO', 'images/ufo.jpg'],
            // Main menu buttons
            ['IMAGE_MAIN_BUTTON_START', 'images/main_button_start.png'],
            ['IMAGE_MAIN_BUTTON_START_OVER', 'images/main_button_start_over.png'],
            ['IMAGE_MAIN_BUTTON_OPTIONS', 'images/main_button_options.png'],
            ['IMAGE_MAIN_BUTTON_OPTIONS_OVER', 'images/main_button_options_over.png'],
            ['IMAGE_MAIN_BUTTON_EXIT', 'images/main_button_exit.png'],
            ['IMAGE_MAIN_BUTTON_EXIT_OVER', 'images/main_button_exit_over.png'],
            // Level descriptions
            ['IMAGE_LEVEL_DESC_1', 'images/descriptions/1.png'],
            ['IMAGE_LEVEL_DESC_2', 'images/descriptions/2.png'],
            ['IMAGE_LEVEL_DESC_3', 'images/descriptions/3.png'],
            ['IMAGE_LEVEL_DESC_4', 'images/descriptions/4.png'],
            ['IMAGE_LEVEL_DESC_5', 'images/descriptions/5.png'],
            ['IMAGE_LEVEL_DESC_6', 'images/descriptions/6.png'],
            ['IMAGE_LEVEL_DESC_7', 'images/descriptions/7.png'],
            ['IMAGE_LEVEL_DESC_9', 'images/descriptions/9.png'],
            ['IMAGE_LEVEL_DESC_10', 'images/descriptions/10.png'],
            ['IMAGE_LEVEL_DESC_12', 'images/descriptions/12.png'],
            ['IMAGE_LEVEL_DESC_15', 'images/descriptions/15.png'],
            ['IMAGE_LEVEL_DESC_17', 'images/descriptions/17.png'],
            ['IMAGE_LEVEL_DESC_19', 'images/descriptions/19.png'],
            ['IMAGE_LEVEL_DESC_21', 'images/descriptions/21.png'],
            ['IMAGE_LEVEL_DESC_22', 'images/descriptions/22.png'],
            ['IMAGE_LEVEL_DESC_24', 'images/descriptions/24.png'],
            ['IMAGE_LEVEL_DESC_26', 'images/descriptions/26.png'],
            ['IMAGE_LEVEL_DESC_27', 'images/descriptions/27.png'],
            // Upgrade icons
            ['IMAGE_UPGRADE_PREVIEW0', 'images/upgrade icons/icon0.png'],
            ['IMAGE_UPGRADE_PREVIEW1', 'images/upgrade icons/icon1.png'],
            ['IMAGE_UPGRADE_PREVIEW2', 'images/upgrade icons/icon2.png'],
            ['IMAGE_UPGRADE_PREVIEW3', 'images/upgrade icons/icon3.png'],
            ['IMAGE_UPGRADE_PREVIEW4', 'images/upgrade icons/icon4.png'],
            ['IMAGE_UPGRADE_PREVIEW5', 'images/upgrade icons/icon5.png'],
            ['IMAGE_UPGRADE_PREVIEW6', 'images/upgrade icons/icon6.png'],
            ['IMAGE_UPGRADE_PREVIEW7', 'images/upgrade icons/icon7.png'],
            ['IMAGE_UPGRADE_PREVIEW8', 'images/upgrade icons/icon8.png'],
            ['IMAGE_UPGRADE_PREVIEW9', 'images/upgrade icons/icon9.png'],
            ['IMAGE_UPGRADE_PREVIEW10', 'images/upgrade icons/icon10.png'],
            ['IMAGE_UPGRADE_PREVIEW11', 'images/upgrade icons/icon11.png'],
            ['IMAGE_UPGRADE_PREVIEW12', 'images/upgrade icons/icon12.png'],
            ['IMAGE_UPGRADE_PREVIEW13', 'images/upgrade icons/icon13.png'],
            ['IMAGE_UPGRADE_PREVIEW14', 'images/upgrade icons/icon14.png'],
            ['IMAGE_UPGRADE_PREVIEW15', 'images/upgrade icons/icon15.png'],
            ['IMAGE_UPGRADE_PREVIEW16', 'images/upgrade icons/icon16.png'],
            // Dog (non-square frames)
            ['IMAGE_DOG', 'images/dog.png', 3],
            ['IMAGE_DOG_IDLE0', 'images/dog_idle0.png', 12],
            ['IMAGE_DOG_IDLE1', 'images/dog_idle1.png', 6],
        ];

        const soundList = [
            ['SOUND_CLICK', 'sounds/click.ogg'],
            ['SOUND_LEVEL_COMPLETED', 'sounds/level_completed.ogg'],
            ['SOUND_LEVEL_FAILED', 'sounds/level_failed.ogg'],
            ['SOUND_CHICK_BUY', 'sounds/chick_buy.ogg'],
            ['SOUND_CHICK_SELL', 'sounds/chick_sell.ogg'],
            ['SOUND_EGG_REF', 'sounds/EGG_REF.ogg'],
            ['SOUND_ERROR', 'sounds/error.ogg'],
            ['SOUND_SHOOT', 'sounds/shoot.ogg'],
            ['SOUND_SICK', 'sounds/sick.ogg'],
            ['SOUND_CURED', 'sounds/cured.ogg'],
            ['SOUND_EGG_LAYERED1', 'sounds/egg_layered1.ogg'],
            ['SOUND_EGG_LAYERED2', 'sounds/egg_layered2.ogg'],
            ['SOUND_EGG_BROODED', 'sounds/egg_brooded.ogg'],
            ['SOUND_CHICK_DEATH', 'sounds/chick_death.ogg'],
            ['SOUND_CHICK_TO_RED_DIAMOND', 'sounds/chick_to_red_diamond.ogg'],
            ['SOUND_EAT_EGG', 'sounds/eat_egg.ogg'],
            ['SOUND_COLLECT_COIN', 'sounds/collect_coin.ogg'],
            ['SOUND_COLLECT_BLUE_DIAMOND', 'sounds/collect_blue_diamond.ogg'],
            ['SOUND_COLLECT_RED_DIAMOND', 'sounds/collect_red_diamond.ogg'],
            ['SOUND_COLLECT_EGG', 'sounds/collect_egg.ogg'],
            ['SOUND_KAR_KAR', 'sounds/kar_kar.ogg'],
            ['SOUND_GAV_GAV', 'sounds/gav_gav.ogg'],
            ['SOUND_WOLF', 'sounds/wolf.ogg'],
            ['SOUND_FIELD_UPGRADE', 'sounds/field_upgrade.ogg'],
            // NOT in resources.xml and never loaded by the original code
            // (no "elephant" sound string in rwg_functions.c). Kept only
            // because Pet.js references it — UNKNOWN — not found in decompiled.
            ['SOUND_ELEPHANT', 'sounds/elephant.ogg'],
        ];

        // Music is loaded AFTER the Game group finished, outside the progress
        // count: FUN_0040860b rwg:10688-10703 — LoadMusic(0,"music/main.ogg"),
        // LoadMusic(1,"music/game0.ogg"), LoadMusic(2,"music/game1.ogg").
        const musicList = [
            ['MUSIC_MAIN', 'music/main.ogg'],     // music id 0
            ['MUSIC_GAME0', 'music/game0.ogg'],   // music id 1
            ['MUSIC_GAME1', 'music/game1.ogg'],   // music id 2
        ];

        // Progress = loaded / total of the Game group, stored into
        // TitleScreen+0x84 (FUN_0040860b rwg:10710-10721).
        const total = imageList.length + soundList.length;
        let loaded = 0;

        const loadImage = async ([id, path, cols]) => {
            const img = new Image(BASE_PATH + path, 1, cols || undefined);
            try {
                await img.load();
            } catch (e) {
                console.warn(`[Res] image load failed: ${path}`, e);
                // Insert a stub so callers don't crash
                IMAGES[id] = { img: null, mWidth: 1, mHeight: 1, mNumCols: 1, mNumRows: 1,
                    getCelWidth() { return 1; }, getCelHeight() { return 1; } };
                loaded++;
                if (progressCallback) progressCallback(loaded / total);
                return;
            }

            // PopCap alpha mask: file "foo_.ext" is the alpha mask for "foo.ext"
            if (HAS_ALPHA_MASK.has(path)) {
                const dotIdx = path.lastIndexOf('.');
                const maskPath = BASE_PATH + (MASK_PATH_OVERRIDE[path]
                    || (path.slice(0, dotIdx) + '_' + path.slice(dotIdx)));
                const maskEl = new window.Image();
                try {
                    await new Promise((resolve, reject) => {
                        maskEl.onload = resolve;
                        maskEl.onerror = reject;
                        maskEl.src = maskPath;
                    });
                    img.applyAlphaMask(maskEl);
                } catch (e) {
                    // mask load failed — use image as-is
                }
            }

            IMAGES[id] = img;
            loaded++;
            if (progressCallback) progressCallback(loaded / total);
        };

        const loadSound = async ([id, path]) => {
            const snd = new SoundInstance(BASE_PATH + path);
            try {
                await snd.load();
                SOUNDS[id] = snd;
            } catch (e) {
                console.warn(`[Res] sound load failed: ${path}`, e);
                // Insert a no-op placeholder so callers can still call .play() safely
                SOUNDS[id] = { play() {} };
            }
            loaded++;
            if (progressCallback) progressCallback(loaded / total);
        };

        // "Init" group first (FUN_004084d8 rwg:10622-10627); these do not
        // count toward the Game-group progress.
        const savedCb = progressCallback;
        progressCallback = null;
        await Promise.all(initList.map(item => loadImage(item)));
        loaded = 0;
        progressCallback = savedCb;

        // Load in batches for performance
        const batchSize = 15;
        const allTasks = [
            ...imageList.map(item => () => loadImage(item)),
            ...soundList.map(item => () => loadSound(item)),
        ];

        for (let i = 0; i < allTasks.length; i += batchSize) {
            await Promise.all(allTasks.slice(i, i + batchSize).map(fn => fn()));
        }

        // Music after the Game group (FUN_0040860b rwg:10688-10703).
        progressCallback = null;
        await Promise.all(musicList.map(item => loadSound(item)));

        Res.loaded = true;
    }
}
