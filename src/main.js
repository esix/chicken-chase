// Port of WinMain / DllMain entry point
// Original: chicken_chase.exe launches chicken_chase.RWG
// RWG entry at 004a368b -> creates GameApp -> calls Init()
//
// The original flow:
//   1. chicken_chase.exe (wrapper) decrypts and loads chicken_chase.RWG
//   2. RWG's DllMain/entry sets up the SexyApp framework
//   3. GameApp constructor (FUN_0040826e) configures 800x600, "Chicken Chase"
//   4. SexyAppBase::Init() starts the game loop
//   5. Resources loaded from resources.xml
//   6. TitleScreen shown, then MainMenuView
//   7. Player starts game -> GameView with FieldController

import { GameApp } from './GameApp.js';

window.addEventListener('DOMContentLoaded', () => {
    const app = new GameApp('gameCanvas');
    app.init();
    window.gameApp = app;
});
