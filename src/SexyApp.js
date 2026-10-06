// Port of Sexy::SexyAppBase - PopCap/SexyApp Framework base
// Original: FUN_004a7bea (constructor), vtable at 004e55ac
// 800x600, "Chicken Chase", version "1.0", registry "PosITive\\Chicken Chase"

export class Graphics {
    // Port of Sexy::Graphics - vtable at 004e6514
    constructor(ctx) {
        this.ctx = ctx;
        this.mTransX = 0;
        this.mTransY = 0;
        this.mColor = [255, 255, 255, 255];
        this.mStateStack = [];
    }

    pushState() {
        this.mStateStack.push({
            transX: this.mTransX,
            transY: this.mTransY,
            color: [...this.mColor],
        });
    }

    popState() {
        if (this.mStateStack.length > 0) {
            const state = this.mStateStack.pop();
            this.mTransX = state.transX;
            this.mTransY = state.transY;
            this.mColor = state.color;
        }
    }

    translate(x, y) {
        this.mTransX += x;
        this.mTransY += y;
    }

    setColor(r, g, b, a = 255) {
        this.mColor = [r, g, b, a];
        this.ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
        this.ctx.strokeStyle = this.ctx.fillStyle;
    }

    // FUN_00450771 - FillRect
    fillRect(x, y, w, h) {
        this.ctx.fillRect(this.mTransX + x, this.mTransY + y, w, h);
    }

    // Check if an image source is ready to draw (HTMLImageElement or Canvas)
    _isReady(imgSrc) {
        if (!imgSrc) return false;
        if (imgSrc instanceof HTMLCanvasElement) return true;
        return imgSrc.complete && imgSrc.naturalWidth > 0;
    }

    // DrawImage
    drawImage(image, x, y) {
        if (image && image.img && this._isReady(image.img)) {
            this.ctx.drawImage(image.img, this.mTransX + x, this.mTransY + y);
        }
    }

    // 9-slice draw of the dialog box (dialog.png). The title plate is baked
    // into the top ~68px of the 250x210 art; a plain stretch would balloon it
    // as the box grows. 9-slice keeps the top band (plate), bottom band and
    // side borders at native height/width and stretches only the middle, so
    // the plate stays a natural fixed size at the top regardless of box height.
    // Insets (native px): left/right=22, top=68 (just below the plate), bottom=28.
    // Returns the plate's vertical center (absolute Y) so callers can center the
    // title in it, and the plate bottom Y so controls start below it.
    drawDialogBox(image, x, y, w, h) {
        const tx = this.mTransX + x, ty = this.mTransY + y;
        if (!image || !image.img || !this._isReady(image.img)) {
            // Fallback: solid box so layout still works without the art.
            this.ctx.fillStyle = 'rgba(220,170,70,0.97)';
            this.ctx.fillRect(tx, ty, w, h);
            this.ctx.strokeStyle = '#7a4a14';
            this.ctx.lineWidth = 3;
            this.ctx.strokeRect(tx, ty, w, h);
            return { plateCenterY: y + 41, plateBottomY: y + 64 };
        }
        const img = image.img;
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        const L = 22, R = 22, T = 68, B = 28; // native-pixel insets
        const c = this.ctx;
        const sMidW = iw - L - R, sMidH = ih - T - B;
        const dMidW = w - L - R, dMidH = h - T - B;
        const dr = tx + w - R, db = ty + h - B; // dest right/bottom band origin
        const sr = iw - R, sb = ih - B;          // src right/bottom band origin
        // corners
        c.drawImage(img, 0, 0, L, T, tx, ty, L, T);
        c.drawImage(img, sr, 0, R, T, dr, ty, R, T);
        c.drawImage(img, 0, sb, L, B, tx, db, L, B);
        c.drawImage(img, sr, sb, R, B, dr, db, R, B);
        // edges
        c.drawImage(img, L, 0, sMidW, T, tx + L, ty, dMidW, T);       // top (plate)
        c.drawImage(img, L, sb, sMidW, B, tx + L, db, dMidW, B);      // bottom
        c.drawImage(img, 0, T, L, sMidH, tx, ty + T, L, dMidH);       // left
        c.drawImage(img, sr, T, R, sMidH, dr, ty + T, R, dMidH);      // right
        // center
        c.drawImage(img, L, T, sMidW, sMidH, tx + L, ty + T, dMidW, dMidH);
        // Plate native span ~y22..y60 -> drawn unscaled in the top band.
        return { plateCenterY: y + 41, plateBottomY: y + 64 };
    }

    // DrawImage with cell (spritesheet)
    drawImageCell(image, x, y, cellIdx) {
        if (!image || !image.img || !this._isReady(image.img)) return;
        const cols = image.mNumCols || 1;
        const cw = image.img.width / cols;
        const ch = image.img.height / (image.mNumRows || 1);
        const col = cellIdx % cols;
        const row = Math.floor(cellIdx / cols);
        this.ctx.drawImage(image.img, col * cw, row * ch, cw, ch,
            this.mTransX + x, this.mTransY + y, cw, ch);
    }
}

export class Image {
    // Port of Sexy::Image/DDImage/MemoryImage
    constructor(path, numRows, numCols) {
        this.mPath = path;
        this.mNumRows = numRows || 1;
        this.mNumCols = numCols || 1;
        this.img = null;
        this.mWidth = 0;
        this.mHeight = 0;
        this.loaded = false;
    }

    load() {
        return new Promise((resolve, reject) => {
            this.img = new window.Image();
            this.img.onload = () => {
                this.mWidth = this.img.width;
                this.mHeight = this.img.height;
                // No cel auto-detection: rows/cols stay as given (1x1 for
                // resources.xml entries). Res.js applies the explicit
                // FUN_00417990 / FUN_0041a5b6 fix-ups after loading.
                this.loaded = true;
                resolve(this);
            };
            this.img.onerror = () => {
                console.warn('Failed to load image:', this.mPath);
                this.loaded = true;
                resolve(this);
            };
            this.img.src = this.mPath;
        });
    }

    // PopCap alpha mask compositing:
    // The main image has RGB on a white background.
    // The "_" variant file has the alpha mask (white=opaque, black=transparent).
    // This method composites them into a single RGBA canvas.
    applyAlphaMask(maskImg) {
        if (!this.img || !maskImg) return;
        const w = this.img.width;
        const h = this.img.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');

        // Draw the color image
        ctx.drawImage(this.img, 0, 0);
        const imageData = ctx.getImageData(0, 0, w, h);
        const pixels = imageData.data;

        // Draw the mask to read its pixels
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = w;
        maskCanvas.height = h;
        const maskCtx = maskCanvas.getContext('2d');
        maskCtx.drawImage(maskImg, 0, 0);
        const maskData = maskCtx.getImageData(0, 0, w, h).data;

        // Apply: use the red channel of the mask as alpha
        for (let i = 0; i < pixels.length; i += 4) {
            pixels[i + 3] = maskData[i]; // red channel of mask = alpha
        }

        ctx.putImageData(imageData, 0, 0);

        // Replace img with the composited canvas
        this.img = canvas;
        this.mWidth = w;
        this.mHeight = h;
    }

    getCelWidth() {
        return this.mWidth / (this.mNumCols || 1);
    }

    getCelHeight() {
        return this.mHeight / (this.mNumRows || 1);
    }
}

// Shared Web Audio context. Sounds are decoded ONCE into in-memory buffers
// at load time; every play() spins up a lightweight BufferSourceNode off the
// same buffer — zero network after load. The previous implementation cloned
// an <audio> element on each play (`audio.cloneNode()`), and a cloned media
// element re-fetches its src when played — so with HTTP caching disabled the
// game re-downloaded e.g. collect_coin.ogg on every coin pickup. Web Audio
// buffers eliminate that entirely and also allow clean overlapping playback.
let _audioCtx = null;
function getAudioCtx() {
    if (_audioCtx === null) {
        const AC = (typeof window !== 'undefined') &&
            (window.AudioContext || window.webkitAudioContext);
        _audioCtx = AC ? new AC() : undefined; // undefined = unavailable
    }
    return _audioCtx || null;
}
// Browsers suspend the AudioContext until a user gesture (autoplay policy).
// Resume on the first pointer/key event so menu music + SFX become audible.
if (typeof window !== 'undefined') {
    const _resume = () => {
        const c = getAudioCtx();
        if (c && c.state === 'suspended') c.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', _resume);
    window.addEventListener('keydown', _resume);
    window.addEventListener('touchstart', _resume);
}

export class SoundInstance {
    // Port of Sexy::SoundInstance/DSoundInstance
    constructor(path) {
        this.mPath = path;
        this.mBuffer = null;       // decoded AudioBuffer (primary playback path)
        this.audio = null;         // HTMLAudio fallback (decode-unsupported browsers)
        this.loaded = false;
    }

    async load() {
        const ctx = getAudioCtx();
        // Primary path: fetch once, decode into a reusable AudioBuffer.
        if (ctx) {
            try {
                const resp = await fetch(this.mPath);
                const arr = await resp.arrayBuffer();
                this.mBuffer = await ctx.decodeAudioData(arr);
                this.loaded = true;
                return this;
            } catch (e) {
                // decodeAudioData can fail on browsers without OGG support
                // (e.g. older Safari). Fall through to the HTMLAudio fallback.
                console.warn('Web Audio decode failed, falling back:', this.mPath, e);
            }
        }
        // Fallback: a single preloaded HTMLAudio element. We REPLAY it
        // (currentTime=0) instead of cloneNode() so the buffered media is
        // reused with no re-fetch. Loses overlap, but never re-downloads.
        return new Promise((resolve) => {
            this.audio = new Audio(this.mPath);
            const done = () => { this.loaded = true; resolve(this); };
            this.audio.addEventListener('canplaythrough', done, { once: true });
            this.audio.addEventListener('error', () => {
                console.warn('Failed to load sound:', this.mPath);
                done();
            }, { once: true });
            this.audio.load();
        });
    }

    // Play an SFX (Sexy PlaySample → DSoundInstance::Play). Each playing
    // instance is registered with SoundManager so a later master-volume
    // change (SetSfxVolume / Mute) re-applies to it, like DSoundManager::
    // SetVolume FUN_0047600f which re-hups every playing slot (FUN_004775c5).
    // Returns a handle — callers currently ignore it.
    play(loop = false) {
        const ctx = getAudioCtx();
        if (ctx && this.mBuffer) {
            const src = ctx.createBufferSource();
            src.buffer = this.mBuffer;
            src.loop = loop;
            const gain = ctx.createGain();
            gain.gain.value = SoundManager._sfxGain();
            src.connect(gain);
            gain.connect(ctx.destination);
            const handle = { source: src, gain };
            SoundManager.mPlayingSfx.add(handle);
            src.onended = () => SoundManager.mPlayingSfx.delete(handle);
            try { src.start(0); } catch { /* ignore */ }
            return handle;
        }
        // HTMLAudio fallback — replay the existing element (no re-fetch).
        if (this.audio) {
            this.audio.loop = loop;
            this.audio.volume = SoundManager._sfxGain();
            try { this.audio.currentTime = 0; } catch { /* not seekable yet */ }
            this.audio.play().catch(() => {});
            return this.audio;
        }
        return null;
    }
}

export class SoundManager {
    // Port of Sexy::SoundManager/DSoundManager - vtable at 004e67cc, plus the
    // SexyAppBase volume/mute methods that drive it.
    // DSoundManager ctor rwg:121954 — master volume double = 1.0
    // (0x3ff0000000000000). The previous 0.7 was not from the source.
    static mMasterVolume = 1.0;
    // SexyAppBase ctor FUN_00440396 rwg:77188 — mSfxVolume = _DAT_004e9340 = 0.85
    static mSfxVolume = 0.85;
    // SexyAppBase ctor FUN_00440396 rwg:77186 — mMusicVolume = _DAT_004e9348 = 0.6
    static mMusicVolume = 0.6;
    // SexyAppBase mMuteCount (app+0x3f0): Mute FUN_0044a963 increments,
    // Unmute FUN_0044a9a8 decrements (not below 0). While > 0, SetMusicVolume
    // FUN_0044a9ff and SetSfxVolume FUN_0044aa3c push 0 to the devices.
    static mMuteCount = 0;
    static mPlayingSfx = new Set();  // live Web Audio SFX handles {source, gain}
    static mCurrentMusic = null;     // BufferSourceNode (Web Audio) or HTMLAudio (fallback)
    static mCurrentMusicGain = null; // GainNode for Web Audio music volume
    static mCurrentMusicSrc = null;  // mPath of the playing track (same-track guard)
    static mCurrentMusicSound = null;
    static mMusicStartCtxTime = 0;   // ctx.currentTime when the current track (re)started
    static mMusicStartOffset = 0;    // track position (s) at that moment
    static mMusicPos = new Map();    // mPath → paused position (s)

    // DSoundManager volume → DirectSound attenuation, FUN_00475fd0 (asm
    // 0x475fd0-0x47600c): dB100 = ftol((log10(v * 9.0 + 1.0) - 1.0) * 2333.0)
    // (_DAT_004e90a0 = 9.0, _DAT_004e9060 = 1.0, _DAT_004e9098 = 2333.0);
    // dB100 < -2000 → -10000 (DSBVOLUME_MIN = silence). Converted to a linear
    // amplitude for Web Audio: 10^(dB100 / 2000).
    static volumeToGain(v) {
        const db100 = Math.trunc((Math.log10(v * 9.0 + 1.0) - 1.0) * 2333.0);
        if (db100 < -2000) return 0;
        return Math.pow(10, db100 / 2000);
    }

    // Instance volume (1.0) * base volume (1.0) * DSoundManager master
    // (FUN_004775c5). The master is set by SexyAppBase::SetSfxVolume
    // FUN_0044aa3c to mSfxVolume, or 0 while muted.
    static _sfxGain() {
        const master = SoundManager.mMuteCount > 0 ? 0 : SoundManager.mSfxVolume;
        return SoundManager.volumeToGain(SoundManager.mMasterVolume * master);
    }

    // AudiereMusicInterface::SetVolume FUN_00477d50 stores the float and hands
    // it to audiere's OutputStream::setVolume. UNKNOWN — audiere.dll's
    // volume→DirectSound mapping is not in the decompiled RWG; linear is used.
    static _musicGain() {
        return SoundManager.mMuteCount > 0 ? 0 : SoundManager.mMusicVolume;
    }

    // MusicInterface PlayMusic(id, offset 0, noLoop false) as called by
    // FUN_00408799 / FUN_00408dae after `if (!IsPlaying(id)) StopAllMusic()`.
    // AudierePlayMusic FUN_004779ae: if the stream is not playing →
    // setVolume, setRepeat(!noLoop), play(). It never calls reset(), and
    // StopAllMusic FUN_00477b27 only calls stop() — so a track that was
    // stopped earlier resumes from where it stopped (audiere stop() pauses).
    static playMusic(sound) {
        if (!sound) return;
        // IsPlaying(id) FUN_00477a43 → nothing to do.
        if (SoundManager.mCurrentMusicSrc === sound.mPath && SoundManager.mCurrentMusic) {
            return;
        }
        SoundManager.stopMusic();
        const pos = SoundManager.mMusicPos.get(sound.mPath) || 0;
        const ctx = getAudioCtx();
        // Web Audio path: loop a buffer source through a dedicated gain node.
        if (ctx && sound.mBuffer) {
            const src = ctx.createBufferSource();
            src.buffer = sound.mBuffer;
            src.loop = true;
            const gain = ctx.createGain();
            gain.gain.value = SoundManager._musicGain();
            src.connect(gain);
            gain.connect(ctx.destination);
            const offset = sound.mBuffer.duration > 0 ? pos % sound.mBuffer.duration : 0;
            try { src.start(0, offset); } catch { /* ignore */ }
            SoundManager.mCurrentMusic = src;
            SoundManager.mCurrentMusicGain = gain;
            SoundManager.mCurrentMusicSrc = sound.mPath;
            SoundManager.mCurrentMusicSound = sound;
            SoundManager.mMusicStartCtxTime = ctx.currentTime;
            SoundManager.mMusicStartOffset = offset;
            return;
        }
        // HTMLAudio fallback — pause()/play() keeps the element's position.
        if (sound.audio) {
            sound.audio.loop = true;
            sound.audio.volume = SoundManager._musicGain();
            sound.audio.play().catch(() => {});
            SoundManager.mCurrentMusic = sound.audio;
            SoundManager.mCurrentMusicGain = null;
            SoundManager.mCurrentMusicSrc = sound.mPath;
            SoundManager.mCurrentMusicSound = sound;
        }
    }

    // StopAllMusic FUN_00477b27: stop() each stream (position kept).
    static stopMusic() {
        const m = SoundManager.mCurrentMusic;
        if (m) {
            const snd = SoundManager.mCurrentMusicSound;
            // Buffer source (Web Audio) → remember position, stop(); HTMLAudio → pause().
            if (typeof m.stop === 'function') {
                const ctx = getAudioCtx();
                if (ctx && snd && snd.mBuffer && snd.mBuffer.duration > 0) {
                    const p = SoundManager.mMusicStartOffset + (ctx.currentTime - SoundManager.mMusicStartCtxTime);
                    SoundManager.mMusicPos.set(snd.mPath, p % snd.mBuffer.duration);
                }
                try { m.stop(); } catch { /* ignore */ }
            } else if (typeof m.pause === 'function') { m.pause(); }
            SoundManager.mCurrentMusic = null;
            SoundManager.mCurrentMusicGain = null;
        }
        SoundManager.mCurrentMusicSrc = null;
        SoundManager.mCurrentMusicSound = null;
    }

    static _applyMusicVolume() {
        const v = SoundManager._musicGain();
        if (SoundManager.mCurrentMusicGain) {
            SoundManager.mCurrentMusicGain.gain.value = v;
        } else if (SoundManager.mCurrentMusic && 'volume' in SoundManager.mCurrentMusic) {
            SoundManager.mCurrentMusic.volume = v;
        }
    }

    static _applySfxVolume() {
        const g = SoundManager._sfxGain();
        for (const h of SoundManager.mPlayingSfx) h.gain.gain.value = g;
    }

    // SexyAppBase::SetMusicVolume FUN_0044a9ff
    static setMusicVolume(v) {
        v = Math.max(0, Math.min(1, v));
        SoundManager.mMusicVolume = v;
        SoundManager._applyMusicVolume();
    }

    // SexyAppBase::SetSfxVolume FUN_0044aa3c → DSoundManager::SetVolume
    // FUN_0047600f (re-hups every playing instance).
    static setSfxVolume(v) {
        v = Math.max(0, Math.min(1, v));
        SoundManager.mSfxVolume = v;
        SoundManager._applySfxVolume();
    }

    // SexyAppBase::Mute FUN_0044a963 / Unmute FUN_0044a9a8, then re-apply
    // both volumes (vt+0xdc / vt+0xe0).
    static mute() {
        SoundManager.mMuteCount++;
        SoundManager._applyMusicVolume();
        SoundManager._applySfxVolume();
    }

    static unmute() {
        if (SoundManager.mMuteCount > 0) SoundManager.mMuteCount--;
        SoundManager._applyMusicVolume();
        SoundManager._applySfxVolume();
    }
}

export class Widget {
    // Port of Sexy::Widget - vtable at 004e3e7c
    constructor() {
        this.mX = 0;
        this.mY = 0;
        this.mWidth = 0;
        this.mHeight = 0;
        this.mVisible = true;
        this.mIsOver = false;
        this.mIsDown = false;
        this.mParent = null;
        this.mWidgets = [];
        this.mId = 0;
    }

    // Resize - FUN_0043e6c1
    resize(x, y, w, h) {
        this.mX = x;
        this.mY = y;
        this.mWidth = w;
        this.mHeight = h;
    }

    addWidget(widget) {
        widget.mParent = this;
        this.mWidgets.push(widget);
    }

    removeWidget(widget) {
        const idx = this.mWidgets.indexOf(widget);
        if (idx >= 0) this.mWidgets.splice(idx, 1);
        widget.mParent = null;
    }

    // FUN_0043e9be - ButtonDepress
    buttonDepress(id) {}

    // Virtual methods
    draw(g) {
        for (const w of this.mWidgets) {
            if (w.mVisible) {
                g.translate(w.mX, w.mY);
                w.draw(g);
                g.translate(-w.mX, -w.mY);
            }
        }
    }

    update() {
        for (const w of this.mWidgets) {
            w.update();
        }
    }

    // Sexy WidgetManager routing: the press goes to the top-most widget under
    // the cursor, which becomes the "last down widget"; the matching release
    // is delivered to THAT widget (even if the cursor left it) and, while a
    // button is held, only that widget can be "over" (MouseDrag).
    mouseDown(x, y, btn) {
        this.mLastDownWidget = null;
        for (let i = this.mWidgets.length - 1; i >= 0; i--) {
            const w = this.mWidgets[i];
            if (w.mVisible) {
                const lx = x - w.mX;
                const ly = y - w.mY;
                if (lx >= 0 && lx < w.mWidth && ly >= 0 && ly < w.mHeight) {
                    this.mLastDownWidget = w;
                    w.mouseDown(lx, ly, btn);
                    return true;
                }
            }
        }
        return false;
    }

    mouseUp(x, y, btn) {
        const w = this.mLastDownWidget;
        this.mLastDownWidget = null;
        if (w && w.mParent === this) {
            const lx = x - w.mX;
            const ly = y - w.mY;
            w.mIsOver = w.mVisible && lx >= 0 && lx < w.mWidth && ly >= 0 && ly < w.mHeight;
            w.mouseUp(lx, ly, btn);
            return true;
        }
        return false;
    }

    mouseMove(x, y) {
        const held = this.mLastDownWidget;
        for (let i = this.mWidgets.length - 1; i >= 0; i--) {
            const w = this.mWidgets[i];
            if (w.mVisible) {
                const lx = x - w.mX;
                const ly = y - w.mY;
                const inside = lx >= 0 && lx < w.mWidth && ly >= 0 && ly < w.mHeight;
                const isOver = inside && (!held || held === w);
                w.mIsOver = isOver;
                if (isOver) {
                    w.mouseMove(lx, ly);
                }
            }
        }
    }

    contains(x, y) {
        return x >= 0 && x < this.mWidth && y >= 0 && y < this.mHeight;
    }
}

export class ButtonWidget extends Widget {
    // Port of Sexy::ButtonWidget - vtable at 004e4404
    constructor(id, listener) {
        super();
        this.mId = id;
        this.mListener = listener;
        this.mButtonImage = null;
        this.mOverImage = null;
        this.mDownImage = null;
    }

    // ButtonWidget::Draw image branch (rwg_functions.c:73668-73690):
    //   pressed (mIsDown && mIsOver): down image (+0xb4) at (0,0) if present,
    //   else over image (+0xb0), else normal (+0xac), offset by (1,1).
    //   Otherwise over image when mIsOver || mIsDown, else normal.
    draw(g) {
        if (this.mIsDown && this.mIsOver) {
            if (this.mDownImage) { g.drawImage(this.mDownImage, 0, 0); return; }
            const img = this.mOverImage || this.mButtonImage;
            if (img) g.drawImage(img, 1, 1);
            return;
        }
        let img = this.mButtonImage;
        if ((this.mIsOver || this.mIsDown) && this.mOverImage) img = this.mOverImage;
        if (img) g.drawImage(img, 0, 0);
    }

    // ButtonWidget::MouseDown FUN_0043db80 (rwg:73845): Widget::MouseDown,
    // then listener->ButtonPress(mId, clickCount) (listener vtable[0]).
    mouseDown(x, y, btn) {
        this.mIsDown = true;
        if (this.mListener && typeof this.mListener.buttonPress === 'function') {
            this.mListener.buttonPress(this.mId);
        }
    }

    // ButtonWidget::MouseUp FUN_0043dbb3 (rwg:73862): if mIsOver (+0x55) and
    // the WidgetManager has focus → listener->ButtonDepress(mId) (vtable[2]).
    // Any mouse button; only reached by the widget that got the press
    // (Widget.mouseUp routing above).
    mouseUp(x, y, btn) {
        if (this.mIsDown && this.mIsOver && this.contains(x, y)) {
            if (this.mListener) {
                this.mListener.buttonDepress(this.mId);
            }
        }
        this.mIsDown = false;
    }
}

export class SexyAppBase {
    // Port of Sexy::SexyAppBase - vtable at 004e55ac
    // Constructor: FUN_0040826e
    constructor(canvasId) {
        this.mWidth = 800;                   // DAT_004fe764
        this.mHeight = 600;                  // DAT_004fe768
        // SexyAppBase ctor FUN_00440396 rwg:77153: _DAT_004feaf4 (app+0x41c,
        // frame time) = 10 ms → 100 updates per second.
        this.mFrameRate = 100;
        this.mCanvas = document.getElementById(canvasId);
        this.mCtx = this.mCanvas.getContext('2d');
        this.mGraphics = new Graphics(this.mCtx);
        this.mWidgetManager = new WidgetManager(this);
        this.mMouse = { x: 0, y: 0, down: false };
        this.mRunning = false;
        this.mLastTime = 0;
        this.mAccumDelta = 0;
        this._setupInput();
    }

    _setupInput() {
        this.mCanvas.addEventListener('mousemove', (e) => {
            const rect = this.mCanvas.getBoundingClientRect();
            const scaleX = this.mWidth / rect.width;
            const scaleY = this.mHeight / rect.height;
            this.mMouse.x = (e.clientX - rect.left) * scaleX;
            this.mMouse.y = (e.clientY - rect.top) * scaleY;
            this.mWidgetManager.mouseMove(this.mMouse.x, this.mMouse.y);
        });
        this.mCanvas.addEventListener('mousedown', (e) => {
            this.mMouse.down = true;
            this.mWidgetManager.mouseDown(this.mMouse.x, this.mMouse.y, e.button);
        });
        this.mCanvas.addEventListener('mouseup', (e) => {
            this.mMouse.down = false;
            this.mWidgetManager.mouseUp(this.mMouse.x, this.mMouse.y, e.button);
        });
        this.mCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Keyboard input — forwards to current view if it has keyDown().
        // Original Sexy framework dispatches via WidgetManager::KeyDown.
        window.addEventListener('keydown', (e) => {
            const tag = (e.target && e.target.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;
            if (this.mCurrentView && typeof this.mCurrentView.keyDown === 'function') {
                if (this.mCurrentView.keyDown(e.key)) e.preventDefault();
            }
        });
    }

    // init() and _gameLoop() are provided by the GameApp subclass — see
    // GameApp.js for the concrete implementations (resource loading, fixed
    // timestep with view-based update/draw).
}

export class WidgetManager extends Widget {
    // Port of Sexy::WidgetManager - vtable at 004e3f5c
    // Just a Widget that sizes itself to the app's canvas.
    constructor(app) {
        super();
        this.mWidth = app.mWidth;
        this.mHeight = app.mHeight;
    }
}
