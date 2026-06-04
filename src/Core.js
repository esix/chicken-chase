// Sexy::Core (vtable 0x004dc9f8). Per-player profile data.
// In the original, the App's profile manager keeps a list of players at offset 0x16c
// and a current-player pointer at offset 0x10. Save file lives at
// %APPDATA%\PosITive\Chicken Chase\game.settings (FUN_00415a6c:28191).
// Web port: localStorage replaces the file. Key "cc_players" holds the list,
// "cc_current_player" holds the active name.

const STORAGE_KEY_LIST = 'cc_players';
const STORAGE_KEY_CURRENT = 'cc_current_player';
const PLAYER_NAME_MAX = 15; // EditBox max length 0x0F=15 from rwg_functions.c:18769.

function makeProfile(name) {
    return {
        name,
        maxLevel: 1,
        upgrades: [],
        bestTimes: {},
        disabledHints: [], // hint type ids the user opted out of
        soundVolume: 0.7,
        musicVolume: 0.5,
    };
}

export class Core {
    constructor() {
        this.mPlayers = [];          // list of profiles (App's offset 0x16c)
        this.mCurrentName = null;    // current-player name (offset 0x10 indirection)
        // Active fields (point to current profile's data — kept for legacy callers)
        this.mMaxLevelReached = 1;
        this.mUpgradesPurchased = [];
        this.mPlayerName = '';
        this.mSoundVolume = 0.7;
        this.mMusicVolume = 0.5;
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

    addPlayer(name) {
        // Trim and clamp to 15 chars
        name = String(name || '').trim().slice(0, PLAYER_NAME_MAX);
        if (!name) return null;
        if (this._findPlayer(name)) return this._findPlayer(name);
        const p = makeProfile(name);
        this.mPlayers.push(p);
        this.save();
        return p;
    }

    deletePlayer(name) {
        const idx = this.mPlayers.findIndex(p => p.name === name);
        if (idx < 0) return;
        this.mPlayers.splice(idx, 1);
        if (this.mCurrentName === name) {
            this.mCurrentName = this.mPlayers.length > 0 ? this.mPlayers[0].name : null;
            if (this.mCurrentName) this.selectPlayer(this.mCurrentName);
        }
        this.save();
    }

    // Activate a player; copies their profile fields onto the legacy mXxx fields.
    selectPlayer(name) {
        const p = this._findPlayer(name);
        if (!p) return false;
        this.mCurrentName = name;
        this.mPlayerName = p.name;
        this.mMaxLevelReached = p.maxLevel;
        this.mUpgradesPurchased = p.upgrades || [];
        this.mBestTimes = p.bestTimes || {};
        this.mDisabledHints = p.disabledHints || [];
        this.mSoundVolume = p.soundVolume ?? 0.7;
        this.mMusicVolume = p.musicVolume ?? 0.5;
        localStorage.setItem(STORAGE_KEY_CURRENT, name);
        return true;
    }

    // Record best time for a level (lower = better). Returns true if new record.
    recordLevelTime(level, ms) {
        if (!this.mCurrentName) return false;
        const p = this._findPlayer(this.mCurrentName);
        if (!p) return false;
        p.bestTimes = p.bestTimes || {};
        const prev = p.bestTimes[level];
        if (prev == null || ms < prev) {
            p.bestTimes[level] = ms;
            this.mBestTimes = p.bestTimes;
            this.save();
            return true;
        }
        return false;
    }

    getBestTime(level) {
        const p = this.mCurrentName && this._findPlayer(this.mCurrentName);
        return (p && p.bestTimes && p.bestTimes[level]) || 0;
    }

    // Persist current legacy fields back to the active profile, then write list.
    save() {
        if (this.mCurrentName) {
            const p = this._findPlayer(this.mCurrentName);
            if (p) {
                p.maxLevel = this.mMaxLevelReached;
                p.upgrades = this.mUpgradesPurchased;
                p.bestTimes = this.mBestTimes || p.bestTimes || {};
                p.disabledHints = this.mDisabledHints || p.disabledHints || [];
                p.soundVolume = this.mSoundVolume;
                p.musicVolume = this.mMusicVolume;
            }
        }
        localStorage.setItem(STORAGE_KEY_LIST, JSON.stringify(this.mPlayers));
    }

    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_LIST);
            if (raw) this.mPlayers = JSON.parse(raw) || [];
        } catch { this.mPlayers = []; }
        const cur = localStorage.getItem(STORAGE_KEY_CURRENT);
        if (cur && this._findPlayer(cur)) {
            this.selectPlayer(cur);
        } else {
            this.mCurrentName = null;
        }

        // Migrate old single-player save (cc_core) into a profile if no list yet
        if (this.mPlayers.length === 0) {
            const oldRaw = localStorage.getItem('cc_core');
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
                        localStorage.removeItem('cc_core');
                    }
                } catch { /* ignore */ }
            }
        }
    }

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
