// Port of WinMain / DllMain entry point
// Original: chicken_chase.exe launches chicken_chase.RWG
// RWG entry at 004a368b -> creates GameApp -> calls Init()
//
// The original flow:
//   1. chicken_chase.exe (wrapper) decrypts and loads chicken_chase.RWG
//   2. RWG's DllMain/entry sets up the SexyApp framework
//   3. GameApp constructor (FUN_0040826e rwg:10436; lazily created by the
//      singleton accessor FUN_004011c6 rwg:246) configures 800x600, "Chicken Chase"
//   4. GameApp::Init (FUN_004084d8 rwg:10593) loads the "Init" group and adds
//      the TitleScreen
//   5. LoadingThreadProc (FUN_0040860b rwg:10657) loads the "Game" group from
//      resources.xml, then music main/game0/game1
//   6. LoadingThreadCompleted (FUN_0040874e rwg:10730) removes the
//      TitleScreen and shows MainMenuView (FUN_00408799)
//   7. Player starts game -> GameView with FieldController

import { GameApp } from './GameApp.js';

window.addEventListener('DOMContentLoaded', () => {
    const app = new GameApp('gameCanvas');
    app.init();
    window.gameApp = app;
});
