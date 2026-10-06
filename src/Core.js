// Player-profile store. NOTE: in the original, Sexy::Core (vtable 0x004dc9f8,
// singleton DAT_004fecf8 returned by FUN_00401165:216) is the GAME-WORLD
// container (level state at +0x04, FieldController at +0x18, Hand at +0x20 …,
// built by FUN_00406069:7491, ticked by FUN_00405fcf:7439). It ALSO owns the
// player list + current-player iterator (FUN_0043fb14:76030 returns the current
// player; used e.g. at FUN_0041614b:28638). This JS module ports only the
// player-list / save-data part; the game-world part lives in GameView /
// FieldController.
//
// Original save data:
//   %APPDATA%\PosITive\Chicken Chase\game.settings  (FUN_00415a6c:28186)
//     = current player name + player-name list      (writer FUN_00415ecd:28467,
//                                                     reader FUN_00415c5f:28307)
//   one file per player                               (reader FUN_00410c42:21051,
//                                                     writer FUN_00410f28:21265)
//     = version int 100, vector<int> level times (count = completed levels),
//       bool +0x1c, bool +0x1d, set<int> upgrade ids (< 0x11)
//   Player ctor FUN_00410be5:21009: +0x1c = 1, +0x1d = 1, times vector empty,
//     upgrade set empty.
//   +0x1c = "show hints" (cleared by the hint dialog checkbox FUN_0040d875:16741,
//           tested by the hint dispatcher FUN_00422a24 rwg:42679)
//   +0x1d = "show SURPRISE! prompt" (tested FUN_0041b94a rwg:33702, cleared FUN_0041b9cf rwg:33758-33760)
//   Music / SFX volume are NOT per-player: they are app-global registry values
//   "MusicVolume"/"SfxVolume" (read FUN_0044431f rwg:80130-80146 as int/100.0,
//   written FUN_00443cd2:79767-79773). Defaults from the SexyAppBase ctor
//   FUN_00440396 rwg:77186/77188: _DAT_004e9348 = 0.6 (music),
//   _DAT_004e9340 = 0.85 (sfx) — values read from the .rdata of
//   app/chicken_chase.RWG.
//
// Web port: localStorage replaces the files/registry (format necessarily
// differs). Key "cc_players" holds the list, "cc_current_player" the active
// name, "cc_settings" the app-global volumes.

const STORAGE_KEY_LIST = 'cc_players';
const STORAGE_KEY_CURRENT = 'cc_current_player';
const STORAGE_KEY_SETTINGS = 'cc_settings';
const PLAYER_NAME_MAX = 15; // EditBox max length 0x0F=15 from rwg_functions.c:18769.

// SexyAppBase ctor FUN_00440396 rwg:77186 (_DAT_004e9348 = 0.6)
export const DEFAULT_MUSIC_VOLUME = 0.6;
// SexyAppBase ctor FUN_00440396 rwg:77188 (_DAT_004e9340 = 0.85)
export const DEFAULT_SFX_VOLUME = 0.85;

// FUN_0041605e:28586 — sentinel "no time yet" (local_30 = 1000000)
const BEST_TIME_SENTINEL = 1000000;

function makeProfile(name) {
    // Player ctor FUN_00410be5:21009 (fields set rwg:21032-21039)
    return {
        name,
        maxLevel: 1,          // = completed-level count + 1 (FUN_0041614b:28638)
        upgrades: [],         // set<int> at +0x34 (FUN_00410be5 rwg:21039); ids < 0x11 (rwg:21157)
        bestTimes: {},        // vector<int> at +0x24 (rwg:21034), index = level-1
        disabledHints: [],    // JS-only per-type opt-out (see mShowHints)
        showHints: true,      // +0x1c = 1 (FUN_00410be5 rwg:21032)
        showSurprise: true,   // +0x1d = 1 (FUN_00410be5 rwg:21033)
    };
}

export class Core {
    // Browser adapter defaults to the real save; previews inject isolated storage.
    constructor({ storage = localStorage } = {}) {
        this.mStorage = storage;
        this.mPlayers = [];          // player list (Core-owned list, FUN_00415688:27806)
        this.mCurrentName = null;    // current-player iterator
        // Active fields (point to current profile's data — kept for legacy callers)
        this.mMaxLevelReached = 1;
        this.mUpgradesPurchased = [];
        this.mPlayerName = '';
        this.mShowHints = true;
        this.mShowSurprise = true;
        // App-global volumes (registry), defaults from FUN_00440396 rwg:77186/77188
        this.mSoundVolume = DEFAULT_SFX_VOLUME;
        this.mMusicVolume = DEFAULT_MUSIC_VOLUME;
    }

    // Returns true if there is a non-empty current player name.
    // Matches FUN_0040e83a:18016 first-launch test: `current_player == 0` → show NewPlayerDialog.
    hasCurrentPlayer() {
        return !!(this.mCurrentName && this._findPlayer(this.mCurrentName));
    }

    listPlayers() {
        return this.mPlayers.map(p => p.name);
    }

    _findPlayer(name) {
        return this.mPlayers.find(p => p.name === name);
    }

    // FUN_00415924:28059 — if no player with this name exists, construct one
    // (FUN_00410be5) and append it (FUN_00416306); then ALWAYS make it the
    // current player and write game.settings (FUN_0041580b:27945 →
    // FUN_00415ecd).
    addPlayer(name) {
        // Clamp to 15 chars (EditBox limit rwg:18769). The .trim() is a JS
        // addition — UNKNOWN — not found in decompiled.
        name = String(name || '').trim().slice(0, PLAYER_NAME_MAX);
        if (!name) return null;
        let p = this._findPlayer(name);
        if (!p) {
            p = makeProfile(name);
            this.mPlayers.push(p);
        }
        this.selectPlayer(p.name);   // FUN_0041580b called unconditionally, rwg:28111
        this.save();
        return p;
    }

    // FUN_0041585b:27983 — deletion only happens when the list holds MORE THAN
    // ONE player (`1 < list.size`, rwg:28008). If the deleted player was the
    // current one, current becomes the first remaining player (rwg:28025-28029,
    // 28042-28046). Then game.settings is rewritten (FUN_00415ecd, rwg:28048).
    deletePlayer(name) {
        if (this.mPlayers.length <= 1) return;
        const idx = this.mPlayers.findIndex(p => p.name === name);
        if (idx < 0) return;
        this.mPlayers.splice(idx, 1);
        if (this.mCurrentName === name) {
            this.mCurrentName = this.mPlayers.length > 0 ? this.mPlayers[0].name : null;
            if (this.mCurrentName) this.selectPlayer(this.mCurrentName);
        }
        this.save();
    }

    // Activate a player (FUN_0041580b:27945); copies their profile fields onto
    // the legacy mXxx fields. Volumes are app-global and are NOT touched.
    selectPlayer(name) {
        const p = this._findPlayer(name);
        if (!p) return false;
        this.mCurrentName = name;
        this.mPlayerName = p.name;
        this.mMaxLevelReached = p.maxLevel;
        this.mUpgradesPurchased = p.upgrades || [];
        this.mBestTimes = p.bestTimes || {};
        this.mDisabledHints = p.disabledHints || [];
        this.mShowHints = p.showHints ?? true;
        this.mShowSurprise = p.showSurprise ?? true;
        this.mStorage.setItem(STORAGE_KEY_CURRENT, name);
        return true;
    }

    // FUN_0041111b:21406 (level in EAX, time in param_2):
    //   idx = level-1; only if 0 <= idx <= completedCount:
    //     idx == completedCount → push_back(time)  (first completion)
    //     else if time < times[idx] → times[idx] = time
    //   then save the player (FUN_00410f28).
    // completedCount = maxLevel-1 in this port. Returns true if stored.
    recordLevelTime(level, ms) {
        if (!this.mCurrentName) return false;
        const p = this._findPlayer(this.mCurrentName);
        if (!p) return false;
        const idx = level - 1;
        if (idx < 0) return false;
        p.bestTimes = p.bestTimes || {};
        // FieldController calls unlockNextLevel() before this, so a first
        // completion may already have bumped maxLevel; accept idx <= maxLevel-1
        // or a level that has no stored time yet.
        const completedCount = (p.maxLevel || 1) - 1;
        const prev = p.bestTimes[level];
        if (idx > completedCount && prev == null) return false;
        let stored = false;
        if (prev == null) {
            p.bestTimes[level] = ms;            // push_back (rwg:21423-21425)
            if (idx === completedCount) p.maxLevel = level + 1;
            stored = true;
        } else if (ms < prev) {
            p.bestTimes[level] = ms;            // rwg:21430-21437
            stored = true;
        }
        this.mBestTimes = p.bestTimes;
        this.mMaxLevelReached = p.maxLevel;
        this.save();                            // FUN_00410f28 (rwg:21440)
        return stored;
    }

    // Current player's time for `level` — FUN_0041119d:21454 (0 when the
    // level has not been completed).
    getBestTime(level) {
        const p = this.mCurrentName && this._findPlayer(this.mCurrentName);
        return (p && p.bestTimes && p.bestTimes[level]) || 0;
    }

    // FUN_0041605e:28586 — over ALL players that completed `level`, pick the
    // one with the lowest time (< 1000000). Used by the LevelCompleted dialog
    // ("Best time - by NAME", FUN_0040dde4 rwg:17165-17174). Returns
    // { name, time } or null when no player has completed the level.
    getBestTimeRecord(level) {
        let best = null;
        let bestTime = BEST_TIME_SENTINEL;
        for (const p of this.mPlayers) {
            const t = p.bestTimes && p.bestTimes[level];
            if (t == null) continue;
            if (t < bestTime) { bestTime = t; best = p; }
        }
        return best ? { name: best.name, time: bestTime } : null;
    }

    // Persist current legacy fields back to the active profile, then write
    // list + app-global settings.
    save() {
        if (this.mCurrentName) {
            const p = this._findPlayer(this.mCurrentName);
            if (p) {
                p.maxLevel = this.mMaxLevelReached;
                p.upgrades = this.mUpgradesPurchased;
                p.bestTimes = this.mBestTimes || p.bestTimes || {};
                p.disabledHints = this.mDisabledHints || p.disabledHints || [];
                p.showHints = this.mShowHints ?? true;
                p.showSurprise = this.mShowSurprise ?? true;
            }
        }
        this.mStorage.setItem(STORAGE_KEY_LIST, JSON.stringify(this.mPlayers));
        // Registry "MusicVolume"/"SfxVolume" — FUN_00443cd2:79767-79773
        this.mStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify({
            musicVolume: this.mMusicVolume,
            sfxVolume: this.mSoundVolume,
        }));
    }

    // FUN_00415c5f:28307 — read list + current name. If the stored current
    // name is not found but the list is non-empty, the FIRST player becomes
    // current (rwg:28401-28411).
    load() {
        try {
            const raw = this.mStorage.getItem(STORAGE_KEY_LIST);
            if (raw) this.mPlayers = JSON.parse(raw) || [];
        } catch { this.mPlayers = []; }

        // App-global volumes (registry read FUN_0044431f rwg:80130-80146).
        try {
            const s = JSON.parse(this.mStorage.getItem(STORAGE_KEY_SETTINGS) || 'null');
            if (s) {
                if (typeof s.musicVolume === 'number') this.mMusicVolume = s.musicVolume;
                if (typeof s.sfxVolume === 'number') this.mSoundVolume = s.sfxVolume;
            } else {
                // Migrate legacy per-profile volumes (previous JS save format).
                const cur0 = this.mStorage.getItem(STORAGE_KEY_CURRENT);
                const p0 = cur0 && this._findPlayer(cur0);
                if (p0 && typeof p0.musicVolume === 'number') this.mMusicVolume = p0.musicVolume;
                if (p0 && typeof p0.soundVolume === 'number') this.mSoundVolume = p0.soundVolume;
            }
        } catch { /* keep defaults */ }

        const cur = this.mStorage.getItem(STORAGE_KEY_CURRENT);
        if (cur && this._findPlayer(cur)) {
            this.selectPlayer(cur);
        } else if (this.mPlayers.length > 0) {
            this.selectPlayer(this.mPlayers[0].name);   // rwg:28401-28411
        } else {
            this.mCurrentName = null;
        }

        // Migrate old single-player save (cc_core) into a profile if no list yet
        if (this.mPlayers.length === 0) {
            const oldRaw = this.mStorage.getItem('cc_core');
            if (oldRaw) {
                try {
                    const data = JSON.parse(oldRaw);
                    if (data.playerName) {
                        const p = makeProfile(data.playerName);
                        p.maxLevel = data.maxLevel || 1;
                        p.upgrades = data.upgrades || [];
                        this.mPlayers.push(p);
                        this.selectPlayer(p.name);
                        this.save();
                        this.mStorage.removeItem('cc_core');
                    }
                } catch { /* ignore */ }
            }
        }
    }

    // JS-only helper (no caller in js/src). UNKNOWN — not found in decompiled.
    reset() {
        if (!this.mCurrentName) return;
        const p = this._findPlayer(this.mCurrentName);
        if (!p) return;
        p.maxLevel = 1;
        p.upgrades = [];
        this.selectPlayer(p.name);
        this.save();
    }
}

export const PLAYER_NAME_MAX_LEN = PLAYER_NAME_MAX;
