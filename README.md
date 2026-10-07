# Chicken Chase

A browser port of the Windows game *Chicken Chase* (PopCap Sexy framework, 800×600), translated function by function from the decompiled original into JavaScript. Gameplay runs on a canvas; dialogs are HTML/CSS.

## Requirements

- Node.js 18 or newer (Vite 5)

## Install

```sh
npm install
```

## Run (development)

```sh
npm start
```

Starts the Vite dev server at http://127.0.0.1:8765 and opens the browser. Edits to `styles/dialogs.css` hot-reload; edits to `index.html` or `src/*.js` reload the page. `npm run dev` does the same.

The dialog preview page shows any HTML dialog on its own, for example http://127.0.0.1:8765/dialog-preview.html?dialog=shop-buy.

## Build

```sh
npm run build
```

Writes a self-contained production build to `dist/`. It includes the game's images, sounds and music, so `dist/` can be served as-is by any static web server.

To try the build locally:

```sh
npm run preview
```

This serves `dist/` at http://127.0.0.1:8765.

## Project layout

| Path | Contents |
|---|---|
| `src/` | The port (game logic, views, dialogs) |
| `index.html`, `styles/` | Page, HTML dialogs and their CSS and art |
| `assets/` | Original images, sounds and music used at runtime (served from the web root) |
| `tools/` | Helper scripts, e.g. `prepare_dialog_art.py` |
| `DECOMPILED_MAP.md` | Reference: game behaviour → decompiled function → JS file |
| `CLAUDE.md` / `AGENTS.md` | Porting rules |

Not in git (see `.gitignore`): `original-app/` (the original game), `decompiled/` and `ghidra_project/` (decompilation), `screenshots/` (reference screenshots of the original).

The game assets in `assets/` are the original game's copyrighted files; don't publish this repository publicly with them.
