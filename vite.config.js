// Vite dev server for the Chicken Chase port.
//
// `npm run dev` starts a server with HMR:
//   - styles/dialogs.css edits hot-reload INSTANTLY — the open dialog stays
//     visible while the new styles apply, no page reload, no state lost.
//   - index.html / src/*.js edits trigger a full page reload.
//
// Vite serves the project root (this js/ directory) as the web root, so the
// `app/` symlink (→ ../app) keeps working for /app/images/letter.jpg etc.

export default {
    root: '.',
    publicDir: false,           // we don't use a separate public/ dir
    server: {
        port: 8765,             // match the old python http.server port
        host: '127.0.0.1',
        strictPort: true,       // fail loud if 8765 is busy instead of jumping
        open: true,             // pop the browser open on `npm run dev`
        fs: { allow: ['..'] },  // let Vite serve the app/ symlink (../app/)
    },
    preview: {
        port: 8765,
        host: '127.0.0.1',
        strictPort: true,
    },
};
