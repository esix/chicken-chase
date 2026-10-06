// Port of Sexy::GameApp - vtable at 004dcbfc
// Constructor: FUN_0040826e (rwg:10436) - "Chicken Chase", "1.0",
//   registry "PosITive\\Chicken Chase", 800x600 (rwg:10462-10475)
// Destructor: FUN_00408394 (rwg:10516)
//
// Key functions (view slots on the app object):
//   FUN_004084d8 (rwg:10593) Init: load "Init" group, create TitleScreen (+0x5f8)
//   FUN_0040860b (rwg:10657) LoadingThreadProc: load "Game" group, progress,
//                            then LoadMusic 0/1/2 = main/game0/game1
//   FUN_0040874e (rwg:10730) LoadingThreadCompleted: remove TitleScreen,
//                            FUN_00408799
//   FUN_00408799 (rwg:10760) show MainMenuView (+0x5e4), main music
//   FUN_004088d0 (rwg:10840) show SelectLevelView (+0x5e8) with a level arg
//                            (-1 = max unlocked, 1000 = credits, >=51 = win)
//   FUN_00408a1b (rwg:10921) show GameView (+0x5ec)
//   FUN_00408c24 (rwg:11047) show UpgradesView (+0x5f0) → showUpgrades()
//   FUN_00408dae (rwg:11129) start level: Core::StartLevel (FUN_00406069),
//                            FUN_00408a1b, random game music
//   FUN_00408e2f (rwg:11193) vtable[76] — pause level (focus lost)
//   FUN_00408e62 (rwg:11220) vtable[75] — resume level (focus regained)
//   FUN_00423e95 (rwg:43997) TitleScreen::Draw

import { SexyAppBase, SoundManager } from './SexyApp.js';
import { Res, SOUNDS, IMAGES } from './Res.js';
import { GameView } from './GameView.js';
import { HandMode } from './Hand.js';
import { MainMenuView, SelectLevelView } from './MainMenuView.js';
import { Core, DEFAULT_MUSIC_VOLUME, DEFAULT_SFX_VOLUME } from './Core.js';
import { OptionsDialog } from './OptionsDialog.js';
import { ChangePlayerDialog, NewPlayerDialog } from './PlayerDialogs.js';
import { CreditsView } from './CreditsView.js';
import { HtmlDialogs } from './HtmlDialogs.js';
import { UpgradesView, levelOffersUpgrade } from './UpgradesView.js';

// Game states matching the decompiled flow
const GameState = {
    LOADING: 0,
    TITLE: 1,
    INTRODUCTION: 2,
    MAIN_MENU: 3,
    SELECT_LEVEL: 4,
    PLAYING: 5,
    OPTIONS: 6,
    UPGRADES: 7,
};

export class GameApp extends SexyAppBase {
    // Port of Sexy::GameApp - vtable at 004dcbfc
    // Constructor: FUN_0040826e

    constructor(canvasId, { core = new Core() } = {}) {
        super(canvasId);
        this.mState = GameState.LOADING;
        this.mGameView = null;
        this.mMainMenuView = null;
        this.mCurrentView = null;
        this.mLoadProgress = 0;
        // Core+4 level object exists: created by StartLevel FUN_00406069
        // (rwg:7514), freed + nulled only by FUN_00406389 (@0x406563), i.e.
        // the Options MAIN MENU confirm FUN_0040fe56 (rwg:19601). A level that
        // ended (completed/failed → menus) still exists.
        this.mLevelExists = false;

        // Player profile data — Sexy::Core (DECOMPILED_MAP.md section 14)
        this.mCore = core;
        this.mCore.load();

        // Registry values - DAT_004fecbc-DAT_004feccc
    }

    // Forward player name reads to Core for the main-menu draw
    get mPlayerName() {
        return (this.mCore && this.mCore.mPlayerName) || '';
    }

    // FUN_004084d8 (Init) + FUN_0040860b (LoadingThreadProc) +
    // FUN_0040874e (LoadingThreadCompleted).
    async init() {
        // App-global volumes (registry MusicVolume/SfxVolume, read by
        // FUN_0044431f rwg:80130-80146; defaults FUN_00440396 rwg:77186/77188).
        if (this.mCore) {
            SoundManager.setMusicVolume(this.mCore.mMusicVolume ?? DEFAULT_MUSIC_VOLUME);
            SoundManager.setSfxVolume(this.mCore.mSoundVolume ?? DEFAULT_SFX_VOLUME);
        }

        // The TitleScreen is shown WHILE the Game group loads
        // (FUN_004084d8 rwg:10644 adds it before the loader runs), so
        // the loop starts now and draws the loading state.
        this.mState = GameState.LOADING;
        this.mRunning = true;
        this.mLastTime = performance.now();
        this._gameLoop();

        // Load all resources ("Init", then "Game", then music — see Res.js)
        await Res.loadAll((progress) => {
            this.mLoadProgress = progress;   // TitleScreen+0x84 (rwg:10721)
        });

        // Create views
        this.mMainMenuView = new MainMenuView(this);
        this.mGameView = new GameView(this);

        // FUN_0040874e rwg:10744-10748: remove TitleScreen, show main menu.
        this.showMainMenu();

        this._setupFocusPause();
    }

    // FUN_00408e2f (vtable[76], rwg:11193) / FUN_00408e62 (vtable[75],
    // rwg:11220). The slots are identified as LostFocus/GotFocus by Sexy's
    // SexyAppBase declaration order (GotFocus then LostFocus); the bodies are:
    //   LostFocus: if a level exists (Core+4) and it is NOT paused (+4 == 0):
    //              paused = 1, +0xd = 0, FUN_004090b9(0), app+0x5f4 = 1;
    //              else app+0x5f4 = 0.
    //   GotFocus:  if a level exists and app+0x5f4: paused = 0, +0xd = 0.
    //              app+0x5f4 = 0.
    // Port: Core+4 "paused" == FieldController.mIsPaused, +0xd ==
    // GameView.mPauseTextShown. FUN_004090b9 → FUN_0040cc01(Core+0x20 hand)
    // always passes mode 0 (asm 0x4090c4 `xorl %eax,%eax`) = HandMode.SEEDS.
    _setupFocusPause() {
        if (typeof window === 'undefined' || this._focusPauseInstalled) return;
        this._focusPauseInstalled = true;
        this.mPausedByFocus = false;   // app+0x5f4
        // SexyAppBase::RehupFocus FUN_00446c61: on a focus change, with
        // mMuteOnLostFocus (+0x3f9 = DAT_004fead1 = 1, FUN_00440396
        // rwg:77210): lost → Mute(true) then LostFocus (vt+0x130);
        // gained → Unmute(true) then GotFocus (vt+0x12c).
        this.mHasFocus = true;   // app+0x498
        window.addEventListener('blur', () => {
            if (!this.mHasFocus) return;
            this.mHasFocus = false;
            SoundManager.mute();
            this.lostFocus();
        });
        window.addEventListener('focus', () => {
            if (this.mHasFocus) return;
            this.mHasFocus = true;
            SoundManager.unmute();
            this.gotFocus();
        });
    }

    // FUN_00408e2f rwg:11204-11214
    lostFocus() {
        const fc = this.mGameView && this.mGameView.mFieldController;
        const levelExists = !!(fc && this.mLevelExists);
        if (levelExists && !fc.mIsPaused) {
            fc.mIsPaused = true;          // rwg:11207
            this.mGameView.mPauseTextShown = false;            // rwg:11208 +0xd = 0
            this.mGameView.mHand.setMode(HandMode.SEEDS);      // rwg:11209 FUN_004090b9(0)
            this.mPausedByFocus = true;   // rwg:11210
            return;
        }
        this.mPausedByFocus = false;      // rwg:11213
    }

    // FUN_00408e62 rwg:11231-11238
    gotFocus() {
        const fc = this.mGameView && this.mGameView.mFieldController;
        if (fc && this.mLevelExists && this.mPausedByFocus) {
            fc.mIsPaused = false;         // rwg:11234
            this.mGameView.mPauseTextShown = false;   // rwg:11235 +0xd = 0
        }
        this.mPausedByFocus = false;      // rwg:11237
    }

    // Override _gameLoop to handle loading screen
    _gameLoop() {
        if (!this.mRunning) return;

        const now = performance.now();
        const delta = now - this.mLastTime;
        this.mLastTime = now;

        if (this.mState === GameState.LOADING) {
            this._drawLoadingScreen();
            requestAnimationFrame(() => this._gameLoop());
            return;
        }

        // SexyAppBase::Process FUN_00448fd5 (non-vsynced path; windowed):
        //   UpdateFTimeAcc FUN_00448f74: acc = min(acc + elapsed, 200.0)
        //     (_DAT_004e90b8 = 200.0 — backlog beyond 200 ms is dropped);
        //   per Process step: if (++mNonDrawCount (+0x418) < ceil(1.0 * 10.0)
        //     (_DAT_004e90d8 = 10.0, asm 0x449263-0x44928c) && acc >= frameTime)
        //     → one update, acc -= frameTime;
        //   otherwise draw and reset mNonDrawCount → at most 9 updates per draw.
        // frameTime = 1000 / mSyncRefreshRate (+0x574) because mVSyncUpdates
        // (+0x578 = DAT_004fec50 = 1, FUN_0040826e) is set; +0x574 defaults to
        // 100 (DAT_004fec4c, FUN_00440396 rwg:77226) = 10 ms, 1 update per
        // step. The real value comes from the display mode at run time
        // (rwg:86031) — not knowable here, so the ctor default is used.
        this.mAccumDelta = Math.min(this.mAccumDelta + delta, 200.0);
        const tickMs = 1000 / this.mFrameRate;
        let nonDrawCount = 0;
        while (++nonDrawCount < 10 && this.mAccumDelta >= tickMs) {
            if (this.mCurrentView) {
                this.mCurrentView.update();
            }
            this.mAccumDelta -= tickMs;
        }

        // Draw
        this.mCtx.clearRect(0, 0, this.mWidth, this.mHeight);
        if (this.mCurrentView) {
            this.mCurrentView.draw(this.mGraphics);
        }

        requestAnimationFrame(() => this._gameLoop());
    }

    // TitleScreen::Draw — FUN_00423e95 (rwg:43997-44028; disassembly
    // @0x423e95-0x423f59, w/h = widget +0x38/+0x3c = 800x600):
    //   SetColor(DAT_005012b0 = Color::Black); FillRect(0, 0, w, h)
    //   DrawImage(IMAGE_PROGRESSBAR_BACK, (w - back.w) / 2, h / 2 - 0x1e)
    //   n = ftol(progress(+0x84) * 14.0 + 0.5)    (_DAT_004e9270 = 14.0,
    //                                               _DAT_004e90c8 = 0.5)
    //   step = bar.w + 3; x = w / 2 - (step * 14) / 2; y = h / 2
    //   repeat n: DrawImage(IMAGE_PROGRESSBAR, x, y); x += step
    // All divisions are C signed int division (cltd/sub/sar).
    _drawLoadingScreen() {
        const ctx = this.mCtx;
        const w = this.mWidth, h = this.mHeight;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        const back = IMAGES.IMAGE_PROGRESSBAR_BACK;
        const bar = IMAGES.IMAGE_PROGRESSBAR;
        if (back && back.img) {
            this.mGraphics.drawImage(back, Math.trunc((w - back.mWidth) / 2),
                Math.trunc(h / 2) - 0x1e);
        }
        if (bar && bar.img) {
            const n = Math.trunc(this.mLoadProgress * 14.0 + 0.5);
            const step = bar.mWidth + 3;
            let x = Math.trunc(w / 2) - Math.trunc((step * 0xe) / 2);
            const y = Math.trunc(h / 2);
            for (let i = 0; i < n; i++, x += step) this.mGraphics.drawImage(bar, x, y);
        }
    }

    // FUN_00408799 (rwg:10760) - show MainMenuView. Music (rwg:10801-10805):
    //   if (!music->IsPlaying(0)) { music->StopAllMusic(); music->PlayMusic(0,0,false); }
    // SoundManager.playMusic is a no-op when that track is already playing.
    // MainMenuView::AddedToManager FUN_0040e83a (rwg:18016-18028) runs only
    // when the view is (re)added — FUN_00408799 skips the add when it is
    // already visible (piVar4[0x14] != 0) — and opens NewPlayerDialog
    // (FUN_0040f117) as dialog 1 when there is no current player.
    showMainMenu() {
        const wasShown = this.mCurrentView === this.mMainMenuView;
        this.mState = GameState.MAIN_MENU;
        this.mCurrentView = this.mMainMenuView;
        this.mCanvas.style.cursor = 'default';
        if (!wasShown && this.mCore && !this.mCore.hasCurrentPlayer()
            && !HtmlDialogs.isDialogOpen('new-player')) {
            new NewPlayerDialog(this.mCore, () => {}, 'firstLaunch').openHtml();
        }
        if (SOUNDS.MUSIC_MAIN) SoundManager.playMusic(SOUNDS.MUSIC_MAIN);   // music id 0
    }

    // FUN_00408dae (rwg:11129) - start a level: Core::StartLevel
    // (FUN_00406069), show GameView (FUN_00408a1b), then game music.
    // Callers: SelectLevelDialog START (FUN_0041c98e rwg:35012) and the
    // LevelFailed RESTART button (FUN_0040e217 rwg:17482).
    startGame(level) {
        this.mState = GameState.PLAYING;
        this.mCurrentView = this.mGameView;
        this.mCanvas.style.cursor = 'none';
        this.mGameView.startLevel(level);
        this.mLevelExists = true;   // Core+4 = new level (FUN_00406069)
        this.playGameMusic();
    }

    // Music part of FUN_00408dae (rwg:11141-11147):
    //   id = 2 - ((rand() & 1) != 0)   → odd: id 1 (game0.ogg), even: id 2 (game1.ogg)
    //   if (!music->IsPlaying(id)) { StopAllMusic(); PlayMusic(id, 0, false); }
    // rand = thunk_FUN_00429891 (PRNG, rwg:49219). Previously the port chose
    // the track by level parity — not in the source.
    playGameMusic() {
        const odd = (Math.floor(Math.random() * 0x80000000) & 1) !== 0;   // MT & 0x7fffffff
        const track = odd ? SOUNDS.MUSIC_GAME0 : SOUNDS.MUSIC_GAME1;
        if (track) SoundManager.playMusic(track);
    }

    // FUN_0041614b (rwg:28638): maxUnlocked = min(50, completedCount + 1).
    // completedCount + 1 == Core.mMaxLevelReached in this port.
    getMaxUnlocked() {
        return Math.min(50, (this.mCore && this.mCore.mMaxLevelReached) || 1);
    }

    // FUN_004088d0 (rwg:10840) - show SelectLevelView with a level argument
    // (stored at view+0x9c). It hides the UpgradesView (+0x5f0, rwg:10858-10861)
    // and the GameView (FUN_00408b04), then adds SelectLevelView (+0x5e8).
    // FUN_004088d0 does NOT touch music.
    // SelectLevelView::AddedToManager FUN_0041d22e (rwg:35539-35580,
    // @0x41d252-0x41d2b3) dispatches, in this order:
    //   +0x9c == 1000            → credits roll (FUN_0041d395)
    //   FUN_0041614b() == 1      → IntroductionDialog (FUN_0041d346)
    //   +0x9c <= 0x32 (50)       → SelectLevelDialog (FUN_0041d2f4)
    //   otherwise (>= 51)        → win sequence
    // Callers: main-menu START with -1 (FUN_0040ea92 rwg:18089-18093), CREDITS
    // with 1000 (rwg:18128-18129), LevelCompleted CONTINUE with level+1
    // (FUN_0040dd6a rwg:17101-17104), UpgradesView CONTINUE (FUN_00424a1c
    // rwg:44923).
    // Port: credits/win use the separate CreditsView class (same widget in
    // the original); the select-level and intro dialogs are HTML over the
    // SelectLevelView field background (screenshot 18).
    showSelectLevel(level = -1) {
        // rwg:10880-10885: an already visible SelectLevelView is left as is
        // (no +0x9c update, no AddedToManager dispatch).
        if (this.mSelectLevelView && this.mCurrentView === this.mSelectLevelView) return;
        if (level === 1000) { this.showCredits(); return; }
        if (!this.mSelectLevelView) {
            this.mSelectLevelView = new SelectLevelView(this);
        }
        this.mSelectLevelView.mLevelParam = level;   // view+0x9c
        this.mState = GameState.SELECT_LEVEL;
        this.mCurrentView = this.mSelectLevelView;
        this.mCanvas.style.cursor = 'default';
        if (this.getMaxUnlocked() === 1) { this._openIntroduction(level); return; }
        if (level < 0x33) { this._openSelectLevelDialog(level); return; }
        this.showWin();
    }

    // FUN_0041d2f4 (rwg:35617, @0x41d317-0x41d338): AddDialog(3,
    // new SelectLevelDialog(view+0x9c)). FUN_0041c48a (rwg:34742-34752):
    // level -1 → FUN_0041614b(); then clamp to <= 0x32.
    _openSelectLevelDialog(level) {
        const v = this.mSelectLevelView;
        const maxUnlocked = this.getMaxUnlocked();
        v.mMaxLevel = maxUnlocked;
        let sel = (level === -1) ? maxUnlocked : level;
        if (sel > 0x32) sel = 0x32;
        v.mSelectedLevel = sel;
        v.openHtml();
    }

    // FUN_0041d346 (rwg:35656): AddDialog(0, new IntroductionDialog(view))
    // (FUN_0040d936 rwg:16828). Its ButtonDepress FUN_0040daeb (rwg:16915-16940):
    //   1st OK: page flag +0x15c cleared → letter page becomes the
    //           introduction picture (FUN_0040d9ef), no sound;
    //   2nd OK: SOUND_CLICK (DAT_004fed84), remove dialog, FUN_0041d2f4 →
    //           SelectLevelDialog. The level only starts from its START.
    // The two pages are the HTML dialogs 'intro-letter' and 'intro-panel'.
    _openIntroduction(level) {
        HtmlDialogs.open('intro-letter', {
            actions: {
                next: () => {
                    HtmlDialogs.close('intro-letter');
                    HtmlDialogs.open('intro-panel', {
                        actions: {
                            ok: () => {
                                if (SOUNDS.SOUND_CLICK) SOUNDS.SOUND_CLICK.play();
                                HtmlDialogs.close('intro-panel');
                                this._openSelectLevelDialog(level);
                            },
                        },
                    });
                },
            },
        });
    }

    // FUN_00408c24 (rwg:11047; argument = next level, @0x408cb2/0x408d5f;
    // caller FUN_0040dd6a @0x40ddca passes completed level + 1).
    // Hides the GameView (FUN_00408b04), creates/adds UpgradesView (+0x5f0,
    // FUN_0042474a), then FUN_00424a7f(view, nextLevel, player decorations
    // (FUN_00408234), available upgrades (FUN_00416162)). No music change.
    showUpgrades(nextLevel) {
        // rwg:11101: an already visible UpgradesView skips the setup.
        if (this.mUpgradesView && this.mCurrentView === this.mUpgradesView) return;
        if (!this.mUpgradesView) {
            this.mUpgradesView = new UpgradesView(this);
        }
        this.mState = GameState.UPGRADES;
        this.mCurrentView = this.mUpgradesView;
        this.mCanvas.style.cursor = 'default';
        const core = this.mCore;
        const available = core ? core.getAvailableUpgrades() : [];
        const decorations = core ? core.getUpgradeIds() : [];
        this.mUpgradesView.setup(nextLevel, decorations, available);
    }

    // LevelCompletedDialog "upgrade" flag (FUN_00421948 @0x421987-0x4219b4).
    // Must be evaluated BEFORE the completion time is recorded. See
    // UpgradesView.levelOffersUpgrade.
    levelOffersUpgrade(level, maxUnlockedBefore = this.getMaxUnlocked()) {
        return levelOffersUpgrade(level, maxUnlockedBefore,
            !!(this.mCore && this.mCore.hasCurrentPlayer && this.mCore.hasCurrentPlayer()));
    }

    // LevelCompletedDialog CONTINUE — FUN_0040dd6a (rwg:17086-17107):
    //   flag == 0 → FUN_004088d0(level + 1); else FUN_00408c24(level + 1).
    continueAfterLevel(level, offersUpgrade) {
        if (offersUpgrade) this.showUpgrades(level + 1);
        else this.showSelectLevel(level + 1);
    }

    // Main-menu OPTIONS (FUN_0040ea92 rwg:18098-18112): OptionsDialog
    // FUN_0040f57b (HTML) as dialog id 6.
    showOptions() {
        this.openOptions({ inGame: false });
    }

    // Shared opener for the Options dialog (menu + in-game): the logic lives
    // in OptionsDialog.js (FUN_0040f57b / ButtonDepress FUN_0040fd44, QUIT?
    // confirm FUN_0040279c → FUN_0040fe56). opts: { inGame, onClose,
    // onMainMenu, onRestart }.
    // FUN_0040fe56 (rwg:19581-19611): MAIN MENU → FUN_00408799 then free the
    // level FUN_00406389 (Core+4 = 0); RESTART → only if a level exists
    // (Core+4 != 0): free + StartLevel FUN_00406069 (no view/music change).
    openOptions(opts = {}) {
        new OptionsDialog(this, {
            ...opts,
            onMainMenu: () => {
                if (opts.onMainMenu) opts.onMainMenu();
                this.mLevelExists = false;
            },
            onRestart: () => {
                if (this.mLevelExists && opts.onRestart) opts.onRestart();
            },
        }).openHtml();
    }

    // ChangePlayerDialog opener — wired by MainMenuView.buttonDepress(BTN_CHANGE_PLAYER)
    // Maps to FUN_004028ca (rwg_functions.c:2598).
    showChangePlayer() {
        if (!this.mCore) return;
        new ChangePlayerDialog(this.mCore).openHtml();
    }

    // Credits — FUN_004088d0(1000) (main-menu CREDITS, FUN_0040ea92
    // rwg:18128-18129) → SelectLevelView mode 1000 → FUN_0041d395 roll
    // (text FUN_0041d828:35977). FUN_004088d0 does not change music, so the
    // main-menu track keeps playing.
    showCredits() {
        this.mCurrentView = new CreditsView(this, 'credits');
    }

    // Win screen — FUN_004088d0(51) after level 50 (FUN_0040dd6a rwg:17104);
    // text FUN_0041d723:35923. No music change (the game track continues)
    // until the sequence returns to the main menu (FUN_0041d3e0 rwg:35754
    // → FUN_00408799, which switches to main music).
    showWin() {
        this.mCurrentView = new CreditsView(this, 'win');
    }

    // unlockNextLevel — kept for FieldController's call order only. The
    // original has no separate unlock: completing level L appends its time to
    // the current player's times vector (FUN_0041111b rwg:21406, called from
    // FUN_00421948 rwg:41372 only when a current player exists), and
    // maxUnlocked = min(50, count + 1) (FUN_0041614b:28638). Core.recordLevelTime
    // does both, so this is intentionally a no-op.
    unlockNextLevel(level) {}

    // Override input handling to route to current view
    _setupInput() {
        this.mCanvas.addEventListener('mousemove', (e) => {
            const rect = this.mCanvas.getBoundingClientRect();
            const scaleX = this.mWidth / rect.width;
            const scaleY = this.mHeight / rect.height;
            this.mMouse.x = (e.clientX - rect.left) * scaleX;
            this.mMouse.y = (e.clientY - rect.top) * scaleY;
            if (this.mCurrentView) {
                this.mCurrentView.mouseMove(this.mMouse.x, this.mMouse.y);
            }
        });
        this.mCanvas.addEventListener('mousedown', (e) => {
            this.mMouse.down = true;
            if (this.mCurrentView) {
                this.mCurrentView.mouseDown(this.mMouse.x, this.mMouse.y, e.button);
            }
        });
        this.mCanvas.addEventListener('mouseup', (e) => {
            this.mMouse.down = false;
            if (this.mCurrentView) {
                this.mCurrentView.mouseUp(this.mMouse.x, this.mMouse.y, e.button);
            }
        });
        this.mCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Keyboard input — routes to current view's keyDown if defined.
        // Mirrors original Sexy framework's WidgetManager::KeyDown dispatch.
        const handleKey = (e) => {
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if (this.mCurrentView && typeof this.mCurrentView.keyDown === 'function') {
                if (this.mCurrentView.keyDown(e.key)) {
                    e.preventDefault();
                }
            }
        };
        window.addEventListener('keydown', handleKey);
    }
}
