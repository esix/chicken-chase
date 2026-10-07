// Vite dev server for the Chicken Chase port.
//
// `npm run dev` starts a server with HMR:
//   - styles/dialogs.css edits hot-reload INSTANTLY — the open dialog stays
//     visible while the new styles apply, no page reload, no state lost.
//   - index.html / src/*.js edits trigger a full page reload.
//
// Vite serves the project root as the web root. The game's runtime copies of
// the original files are in assets/ (publicDir): served at /images/...,
// /sounds/..., /music/... and copied into dist/ by `vite build`.

export default {
    root: '.',
    publicDir: 'assets',        // original game images/sounds/music used at runtime
    server: {
        port: 8765,             // match the old python http.server port
        host: '127.0.0.1',
        strictPort: true,       // fail loud if 8765 is busy instead of jumping
        open: true,             // pop the browser open on `npm run dev`
    },
    preview: {
        port: 8765,
        host: '127.0.0.1',
        strictPort: true,
    },
};
