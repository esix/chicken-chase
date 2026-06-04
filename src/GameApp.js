// Port of Sexy::GameApp - vtable at 004dcbfc
// Constructor: FUN_0040826e
// Destructor: FUN_00408394
//
// Key functions:
//   FUN_0040826e - GameApp constructor (54 lines) - sets up "Chicken Chase", 800x600
//   FUN_00408394 - GameApp destructor (73 lines)
//   FUN_004088d0 - GameApp::startLevel
//   FUN_00408799 - GameApp::showMainMenu
//   FUN_00408c24 - GameApp::showOptions
//   FUN_00408dae - GameApp::restartLevel
//   FUN_00408a1b - GameApp::nextLevel

import { SexyAppBase, SoundManager } from './SexyApp.js';
import { Res, SOUNDS } from './Res.js';
import { GameView } from './GameView.js';
import { MainMenuView, SelectLevelView } from './MainMenuView.js';
import { Core } from './Core.js';
import { OptionsDialog } from './OptionsDialog.js';
import { ChangePlayerDialog } from './PlayerDialogs.js';
import { CreditsView } from './CreditsView.js';
import { HtmlDialogs } from './HtmlDialogs.js';

// Game states matching the decompiled flow
const GameState = {
    LOADING: 0,
    TITLE: 1,
    INTRODUCTION: 2,
    MAIN_MENU: 3,
    SELECT_LEVEL: 4,
    PLAYING: 5,
    OPTIONS: 6,
};

export class GameApp extends SexyAppBase {
    // Port of Sexy::GameApp - vtable at 004dcbfc
    // Constructor: FUN_0040826e

    constructor(canvasId) {
        super(canvasId);
        this.mState = GameState.LOADING;
        this.mGameView = null;
        this.mMainMenuView = null;
        this.mCurrentView = null;
        this.mLoadProgress = 0;

        // Player profile data — Sexy::Core (DECOMPILED_MAP.md section 14)
        this.mCore = new Core();
        this.mCore.load();

        // Registry values - DAT_004fecbc-DAT_004feccc
    }

    // Forward player name reads to Core for the main-menu draw
    get mPlayerName() {
        return (this.mCore && this.mCore.mPlayerName) || '';
    }

    // FUN_004a7bea - Init sequence
    async init() {
        // Load all resources
        await Res.loadAll((progress) => {
            this.mLoadProgress = progress;
        });

        // Apply persisted volumes from current player profile to SoundManager.
        // OptionsDialog reads/writes the same fields (mMusicVolume / mSoundVolume).
        if (this.mCore) {
            SoundManager.setMusicVolume(this.mCore.mMusicVolume ?? 0.5);
            SoundManager.setSfxVolume(this.mCore.mSoundVolume ?? 0.7);
        }

        // Create views
        this.mMainMenuView = new MainMenuView(this);
        this.mGameView = new GameView(this);

        // Show main menu
        this.showMainMenu();

        // Start game loop
        this.mRunning = true;
        this.mLastTime = performance.now();
        this._gameLoop();
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

        // Fixed timestep update
        this.mAccumDelta += delta;
        const tickMs = 1000 / this.mFrameRate;
        let updates = 0;
        while (this.mAccumDelta >= tickMs && updates < 5) {
            if (this.mCurrentView) {
                this.mCurrentView.update();
            }
            this.mAccumDelta -= tickMs;
            updates++;
        }

        // Draw
        this.mCtx.clearRect(0, 0, this.mWidth, this.mHeight);
        if (this.mCurrentView) {
            this.mCurrentView.draw(this.mGraphics);
        }

        requestAnimationFrame(() => this._gameLoop());
    }

    _drawLoadingScreen() {
        this.mCtx.fillStyle = '#000';
        this.mCtx.fillRect(0, 0, 800, 600);
        this.mCtx.fillStyle = '#fff';
        this.mCtx.font = '24px Arial, sans-serif';
        this.mCtx.textAlign = 'center';
        this.mCtx.fillText('Loading...', 400, 280);

        // Progress bar
        this.mCtx.strokeStyle = '#fff';
        this.mCtx.strokeRect(250, 300, 300, 20);
        this.mCtx.fillStyle = '#4a4';
        this.mCtx.fillRect(252, 302, 296 * this.mLoadProgress, 16);
        this.mCtx.fillStyle = '#fff';
        this.mCtx.fillText(`${Math.floor(this.mLoadProgress * 100)}%`, 400, 340);
        this.mCtx.textAlign = 'left';
    }

    // FUN_00408799 - showMainMenu
    showMainMenu() {
        this.mState = GameState.MAIN_MENU;
        this.mCurrentView = this.mMainMenuView;
        this.mCanvas.style.cursor = 'default';
        // Switch to main-menu music
        if (SOUNDS.MUSIC_MAIN) SoundManager.playMusic(SOUNDS.MUSIC_MAIN);
    }

    // FUN_004088d0 - startGame (starts a level)
    startGame(level) {
        this.mState = GameState.PLAYING;
        this.mCurrentView = this.mGameView;
        this.mCanvas.style.cursor = 'none';
        this.mGameView.startLevel(level);
        this.mGameView.showLevelIntro(level);
        // Switch to game music — alternate by level for variety
        const track = (level % 2 === 0) ? SOUNDS.MUSIC_GAME1 : SOUNDS.MUSIC_GAME0;
        if (track) SoundManager.playMusic(track);
    }

    // SelectLevelDialog opener (FUN_0041c48a). Now an HTML dialog overlaid on
    // the main-menu background (mCurrentView stays the menu so the bg draws).
    showSelectLevel() {
        if (!this.mSelectLevelView) {
            this.mSelectLevelView = new SelectLevelView(this);
        }
        this.mSelectLevelView.mMaxLevel = (this.mCore && this.mCore.mMaxLevelReached) || 1;
        this.mSelectLevelView.mSelectedLevel = Math.min(this.mSelectLevelView.mMaxLevel, 50);
        this.mState = GameState.SELECT_LEVEL;
        this.mCurrentView = this.mMainMenuView;
        this.mSelectLevelView.openHtml();
    }

    // FUN_00408c24 - showOptions. Opens the OptionsDialog (HTML) from the menu.
    showOptions() {
        this.openOptions({ inGame: false });
    }

    // Shared opener for the HTML Options dialog (menu + in-game). opts:
    //   { inGame, onClose, onMainMenu, onRestart }. Sliders write SoundManager +
    //   the player profile; MAIN MENU / RESTART route through a quit confirm.
    openOptions(opts = {}) {
        const inGame = !!opts.inGame;
        const core = this.mCore;
        HtmlDialogs.open('options', {
            binds: {
                music: core ? (core.mMusicVolume ?? 0.5) : 0.5,
                sfx: core ? (core.mSoundVolume ?? 0.7) : 0.7,
                fullscreen: !!(typeof document !== 'undefined' && document.fullscreenElement),
                hwaccel: true,
            },
            visible: { ingame: inGame },
            onBind: {
                music: (v) => { if (core) core.mMusicVolume = v; SoundManager.setMusicVolume(v); },
                sfx: (v) => { if (core) core.mSoundVolume = v; SoundManager.setSfxVolume(v); },
                fullscreen: (v) => {
                    try {
                        if (v) document.documentElement.requestFullscreen?.();
                        else if (document.fullscreenElement) document.exitFullscreen?.();
                    } catch (e) { /* ignore */ }
                },
            },
            actions: {
                close: () => {
                    HtmlDialogs.close('options');
                    if (core && core.save) core.save();
                    if (opts.onClose) opts.onClose();
                },
                mainmenu: () => this._optionsQuitConfirm('mainmenu', opts),
                restart: () => this._optionsQuitConfirm('restart', opts),
            },
        });
    }

    _optionsQuitConfirm(which, opts) {
        HtmlDialogs.open('quit-confirm', {
            actions: {
                yes: () => {
                    HtmlDialogs.close('quit-confirm');
                    HtmlDialogs.close('options');
                    if (which === 'mainmenu' && opts.onMainMenu) opts.onMainMenu();
                    else if (which === 'restart' && opts.onRestart) opts.onRestart();
                },
                no: () => HtmlDialogs.close('quit-confirm'),
            },
        });
    }

    // ChangePlayerDialog opener — wired by MainMenuView.buttonDepress(BTN_CHANGE_PLAYER)
    // Maps to FUN_004028ca (rwg_functions.c:2598).
    showChangePlayer() {
        if (!this.mCore) return;
        new ChangePlayerDialog(this.mCore, () => {
            // Re-sync SoundManager volumes from the (possibly new) profile.
            // Core.selectPlayer updates mMusicVolume/mSoundVolume on this.mCore
            // but doesn't push the new values into SoundManager — so without
            // this, the new player's profile volumes wouldn't take effect
            // until they open OptionsDialog.
            if (this.mCore) {
                SoundManager.setMusicVolume(this.mCore.mMusicVolume ?? 0.5);
                SoundManager.setSfxVolume(this.mCore.mSoundVolume ?? 0.7);
            }
            // Pet ownership isn't saved to profile (within-session only).
            // Reset on profile switch so the new player doesn't inherit
            // the previous player's bought Mouse/Elephant.
            if (this.mGameView && this.mGameView.mFieldController) {
                this.mGameView.mFieldController.mHasMouse = false;
                this.mGameView.mFieldController.mHasElephant = false;
            }
        }).openHtml();
    }

    // Credits — opens the alien-letter credits roll (FUN_0041d828:35977).
    showCredits() {
        this.mCurrentView = new CreditsView(this, 'credits');
        // Switch back to menu music — game music keeps blasting otherwise.
        if (SOUNDS.MUSIC_MAIN) SoundManager.playMusic(SOUNDS.MUSIC_MAIN);
    }

    // Win screen — fires after final level. Text from FUN_0041d723:35923.
    showWin() {
        this.mCurrentView = new CreditsView(this, 'win');
        if (SOUNDS.MUSIC_MAIN) SoundManager.playMusic(SOUNDS.MUSIC_MAIN);
    }

    // unlockNextLevel — bumps player profile's max-level-reached and persists.
    // Original FUN_xxxxxxxx for unlockNextLevel not pinpointed in our trace.
    unlockNextLevel(level) {
        if (this.mCore) {
            if (level > (this.mCore.mMaxLevelReached || 1)) {
                this.mCore.mMaxLevelReached = level;
            }
            if (this.mCore.save) this.mCore.save();
        }
    }

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
