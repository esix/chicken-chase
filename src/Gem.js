// Port of Sexy::Gem and subclasses
// Original vtables:
//   Sexy::Gem at 004dcf2c
//   Sexy::CoinGold at 004dcf4c
//   Sexy::CoinSilver at 004dcf6c
//   Sexy::DiamondBlue at 004dcf8c
//   Sexy::DiamondRed at 004dcfac
//
// Key functions:
//   FUN_0040c311 - Gem constructor (10 lines)
//   FUN_0040c4d9 - Gem::update (136 lines)
//   FUN_00448b4b - Coin value decay

import { IMAGES, SOUNDS } from './Res.js';

// Cached tinted egg-cel offscreen canvases — generated once per (img, frame,
// eggType) and reused. Keyed by `${img.mPath}_${frame}_${type}`. Each entry
// is an OffscreenCanvas/HTMLCanvasElement holding the egg cel pre-tinted via
// 'source-atop' composite (clipped to the cel's own alpha, so no background
// spillover when blitted onto the main canvas).
const _eggTintCache = new Map();
// Egg-type tint colors keyed off the original mission_eggs_*.png art:
//   0=WHITE (layer)   — no tint
//   1=BLUE (magic)    — bright cyan/sky-blue, matches mission_eggs_magic.png
//   2=RED (holy)      — bright red, matches mission_eggs_holy.png
//   3=BLACK (rooster) — pure black, matches mission_eggs_rooster.png
//   4=BROODY          — deep saturated blue, matches mission_eggs_broody.png
//                       (NOT golden — golden was JS-port speculation, the
//                       original broody egg is the deep-blue colour seen in
//                       the broody mission-icon art).
const EGG_TINT_COLORS = [null, '#33b5ff', '#ff2030', '#000000', '#2828dd'];

export function getTintedEggCel(img, frame, eggType) {
    if (!eggType || eggType < 0 || eggType >= EGG_TINT_COLORS.length) return null;
    const tint = EGG_TINT_COLORS[eggType];
    if (!tint) return null;
    if (!img || !img.img) return null;
    const key = `${img.mPath || 'egg'}_${frame}_${eggType}`;
    let cached = _eggTintCache.get(key);
    if (cached) return cached;
    const celW = img.getCelWidth();
    const celH = img.getCelHeight();
    if (!celW || !celH) return null;
    const cols = img.mNumCols || 1;
    const sx = (frame % cols) * celW;
    const sy = Math.floor(frame / cols) * celH;
    const off = document.createElement('canvas');
    off.width = celW;
    off.height = celH;
    const offCtx = off.getContext('2d');
    // Draw the cel
    offCtx.drawImage(img.img, sx, sy, celW, celH, 0, 0, celW, celH);
    // Apply tint via 'multiply' so the result is BRIGHT and SATURATED —
    // matches the original mission_eggs_*.png art which is fully saturated
    // (not the muted/pastel look that source-atop at 0.55 alpha produced).
    // Multiply preserves shading: white pixels become the full tint colour,
    // shaded (darker) pixels become a darker tint, transparent stays
    // transparent. globalAlpha=1.0 so the colour is fully applied.
    offCtx.globalCompositeOperation = 'multiply';
    offCtx.globalAlpha = 1.0;
    offCtx.fillStyle = tint;
    offCtx.fillRect(0, 0, celW, celH);
    // multiply on top of transparent pixels can leave colour fringe in the
    // alpha=0 area on some browsers; clip back to the original silhouette.
    offCtx.globalCompositeOperation = 'destination-in';
    offCtx.globalAlpha = 1.0;
    offCtx.drawImage(img.img, sx, sy, celW, celH, 0, 0, celW, celH);
    _eggTintCache.set(key, off);
    return off;
}

// Gem types matching the decompiled Gem struct +0x08 (FUN_0040c4d9:15155-15246).
// Order: 0=Gold, 1=Silver, 2=DiamondBlue, 3=DiamondRed. Previously had Silver/Gold
// inverted which made mType not match the spawn-dispatch type id.
export const GemType = {
    COIN_GOLD: 0,
    COIN_SILVER: 1,
    DIAMOND_BLUE: 2,
    DIAMOND_RED: 3,
    EGG: 4,
};

export class Gem {
    // Port of Sexy::Gem - vtable at 004dcf2c
    // Constructor: FUN_0040c311
    constructor(type, x, y) {
        this.mType = type;              // offset +0x00
        this.mX = x;                    // offset +0x04
        this.mY = y;                    // offset +0x08
        this.mVelocityY = -3;           // offset +0x10 - bounce up then fall
        this.mValue = 10;               // offset +0x14
        this.mBaseValue = 10;           // offset +0x18
        this.mLifeTimer = 0;            // offset +0x1c
        this.mMaxLife = 600;             // offset +0x20 - 6 seconds at 100fps
        this.mIsAlive = true;           // offset +0x24
        this.mCollected = false;        // offset +0x25
        this.mAnimTimer = 0;            // offset +0x2c
        this.mBouncing = true;          // offset +0x30
        this.mGroundY = y;              // offset +0x34
    }

    // FUN_0040c4d9 - Gem::update (136 lines)
    update() {
        if (!this.mIsAlive) return;

        this.mLifeTimer++;
        this.mAnimTimer++;

        // Bouncing physics
        if (this.mBouncing) {
            this.mVelocityY += 0.15; // gravity
            this.mY += this.mVelocityY;
            if (this.mY >= this.mGroundY) {
                this.mY = this.mGroundY;
                this.mVelocityY = -this.mVelocityY * 0.4;
                if (Math.abs(this.mVelocityY) < 0.5) {
                    this.mBouncing = false;
                    this.mVelocityY = 0;
                }
            }
        }

        // Value decay for coins - FUN_00448b4b
        // "Collect coins as soon as possible. The longer the coin is available, the less valuable it becomes."
        if (this.mType === GemType.COIN_SILVER || this.mType === GemType.COIN_GOLD) {
            this.mValue = Math.max(1, Math.floor(this.mBaseValue * (1 - this.mLifeTimer / this.mMaxLife)));
        }

        // Expire
        if (this.mLifeTimer >= this.mMaxLife) {
            this.mIsAlive = false;
        }
    }

    // Collect
    collect() {
        if (!this.mIsAlive || this.mCollected) return 0;
        this.mCollected = true;
        this.mIsAlive = false;
        this._playCollectSound();
        return this.mValue;
    }

    _playCollectSound() {
        // Override in subclass
    }

    getImage() {
        return null;
    }

    draw(g) {
        const img = this.getImage();
        if (img && img.img && this.mIsAlive) {
            // Blinking near end of life (only when MaxLife > 0)
            if (this.mMaxLife > 0 && this.mLifeTimer > this.mMaxLife * 0.75) {
                if (Math.floor(this.mAnimTimer / 5) % 2 === 0) return;
            }
            const celW = img.getCelWidth();
            const celH = img.getCelHeight();
            const numFrames = img.mNumCols * img.mNumRows;
            const frame = numFrames > 1 ? Math.floor(this.mAnimTimer / 8) % numFrames : 0;
            // Brief "pop-in" scale animation in first 15 ticks
            let scale = 1;
            if (this.mAnimTimer < 15) {
                scale = 0.5 + (this.mAnimTimer / 15) * 0.5;
            }
            const w = celW * scale, h = celH * scale;
            const ctx = g.ctx;
            const sx = (img.mNumCols && img.mNumCols > 1) ? (frame % img.mNumCols) * celW : 0;
            const sy = Math.floor(frame / (img.mNumCols || 1)) * celH;
            ctx.drawImage(img.img, sx, sy, celW, celH, this.mX - w / 2, this.mY - h / 2, w, h);
        }
    }

    contains(x, y) {
        return Math.abs(x - this.mX) < 20 && Math.abs(y - this.mY) < 20;
    }
}

export class CoinSilver extends Gem {
    // vtable at 004dcf6c
    // FUN_0040c236: timer>0.66 -> $20, timer>0.33 -> $10, else -> $5
    constructor(x, y) {
        super(GemType.COIN_SILVER, x, y);
        this.mTimer = 1.0; // starts at 1.0, decays to 0
        // User reported: "wait ~1s, coin rotates 39→20→10→disappears" → ~3s total.
        // 1.0 / (0.0033/tick) = ~303 ticks = 3s @ 100fps.
        this.mDecayRate = 0.0033;
        this.mValue = 20;
        this.mBaseValue = 20;
        // mMaxLife must match the actual mTimer-driven lifetime (~303 ticks)
        // because the base Gem.draw blink-near-expiry check uses
        // `mLifeTimer > mMaxLife * 0.75`. With mMaxLife=1000 the coin would
        // need 750 ticks of life to blink, but it expires at ~303 ticks of
        // mTimer decay — so coins NEVER blinked before vanishing, silently
        // failing the "collect coins quickly" visual cue. With mMaxLife=303
        // the blink kicks in at mTimer ≈ 0.25, right as the coin enters its
        // final $5 tier.
        this.mMaxLife = 303;
    }

    update() {
        if (!this.mIsAlive) return;
        this.mAnimTimer++;
        this.mLifeTimer++;
        // Bouncing physics — original Gem update does this for all gem types.
        if (this.mBouncing) {
            this.mVelocityY += 0.15;
            this.mY += this.mVelocityY;
            if (this.mY >= this.mGroundY) {
                this.mY = this.mGroundY;
                this.mVelocityY = -this.mVelocityY * 0.4;
                if (Math.abs(this.mVelocityY) < 0.5) {
                    this.mBouncing = false;
                    this.mVelocityY = 0;
                }
            }
        }
        this.mTimer -= this.mDecayRate;
        // Three-tier value decay from decompiled FUN_0040c236
        if (this.mTimer > 0.66) this.mValue = 20;
        else if (this.mTimer > 0.33) this.mValue = 10;
        else if (this.mTimer > 0) this.mValue = 5;
        else { this.mIsAlive = false; }
    }

    getImage() { return IMAGES.IMAGE_COIN_SILVER; }

    _playCollectSound() {
        if (SOUNDS.SOUND_COLLECT_COIN) SOUNDS.SOUND_COLLECT_COIN.play();
    }
}

export class CoinGold extends Gem {
    // vtable at 004dcf4c
    // FUN_0040c20a: timer>0.66 -> $30, timer>0.33 -> $20, else -> $10
    constructor(x, y) {
        super(GemType.COIN_GOLD, x, y);
        this.mTimer = 1.0;
        this.mDecayRate = 0.0033;
        this.mValue = 30;
        this.mBaseValue = 30;
        // See CoinSilver — mMaxLife must match mTimer's decay-to-0 lifetime
        // (1.0 / 0.0033 ≈ 303 ticks) so the base Gem.draw blink trigger
        // (mLifeTimer > mMaxLife * 0.75) fires before the coin expires.
        this.mMaxLife = 303;
    }

    update() {
        if (!this.mIsAlive) return;
        this.mAnimTimer++;
        this.mLifeTimer++;
        // Bouncing physics — original Gem update does this for all gem types.
        if (this.mBouncing) {
            this.mVelocityY += 0.15;
            this.mY += this.mVelocityY;
            if (this.mY >= this.mGroundY) {
                this.mY = this.mGroundY;
                this.mVelocityY = -this.mVelocityY * 0.4;
                if (Math.abs(this.mVelocityY) < 0.5) {
                    this.mBouncing = false;
                    this.mVelocityY = 0;
                }
            }
        }
        this.mTimer -= this.mDecayRate;
        // Three-tier value decay from decompiled FUN_0040c20a
        if (this.mTimer > 0.66) this.mValue = 30;
        else if (this.mTimer > 0.33) this.mValue = 20;
        else if (this.mTimer > 0) this.mValue = 10;
        else { this.mIsAlive = false; }
    }

    getImage() { return IMAGES.IMAGE_COIN_GOLD; }

    _playCollectSound() {
        if (SOUNDS.SOUND_COLLECT_COIN) SOUNDS.SOUND_COLLECT_COIN.play();
    }
}

export class DiamondBlue extends Gem {
    // vtable at 004dcf8c
    // FUN_0040c2bf:14842 — getValue returns 300 fixed (no decay tiers).
    // FUN_0040c278:14810 — lifetime is 2001 ticks (tick_counter < 0x7d1).
    constructor(x, y) {
        super(GemType.DIAMOND_BLUE, x, y);
        this.mValue = 300;
        this.mBaseValue = 300;
        this.mMaxLife = 2001;
    }

    getImage() { return IMAGES.IMAGE_DIAMOND_BLUE; }

    _playCollectSound() {
        if (SOUNDS.SOUND_COLLECT_BLUE_DIAMOND) SOUNDS.SOUND_COLLECT_BLUE_DIAMOND.play();
    }
}

export class DiamondRed extends Gem {
    // vtable at 004dcfac
    // FUN_0040c2c5:14860 — getValue returns *(this+0x1c) if > 0, else 2000.
    // FUN_0040c278:14810 — lifetime is 2001 ticks.
    constructor(x, y) {
        super(GemType.DIAMOND_RED, x, y);
        this.mValue = 2000;
        this.mBaseValue = 2000;
        this.mMaxLife = 2001;
    }

    getImage() { return IMAGES.IMAGE_DIAMOND_RED; }

    _playCollectSound() {
        if (SOUNDS.SOUND_COLLECT_RED_DIAMOND) SOUNDS.SOUND_COLLECT_RED_DIAMOND.play();
    }
}

export class Egg extends Gem {
    // Eggs are similar to Gems but can also be hatched
    // Click on egg -> choose to collect or hatch
    update() {
        // Lifetime decay pauses while a broody is committed to the egg —
        // either walking toward it OR actively sitting on it. Walking can
        // take ~16s across the full field at the broody's 0.5 px/tick speed,
        // and an egg laid 30s earlier would expire mid-walk (4000-tick = 40s
        // lifetime). Player would commit a broody → broody walks across →
        // egg expires before arrival → broody gives up → player lost the
        // egg with no recourse. Pause as soon as broody is assigned so the
        // commitment is the only timing that matters.
        //
        // Guard against "marked but immortal" eggs: require a live, claimed
        // broody that's actually targeting THIS egg (mWalkingToEgg OR
        // mBroodActive). Stale-claim cleanup in FieldController.update
        // clears _claimedBy when the broody drops the egg, so a dead/lost
        // broody won't pause forever.
        const broody = this._claimedBy;
        const broodyEngaged = this.mBrooding && broody
            && broody.mIsAlive && !broody.mIsCarried
            && broody.mBroodingEgg === this
            && (broody.mBroodActive || broody.mWalkingToEgg);
        if (broodyEngaged) {
            this.mAnimTimer++;
            return;
        }
        super.update();
    }
    constructor(eggType, x, y) {
        super(GemType.EGG, x, y);
        this.mEggType = eggType;
        // Sell value depends on type per DAT_0050035c table — overridden below.
        // Layer (white) base sell ~ 50 (mid), Magic 300, Holy 500, Rooster 200, Broody 100.
        // Egg-collect values — the original DAT_0050035c is the CHICK sell-price
        // table (FUN_00403bd6 indexes it by chick type), not egg-collect values.
        // Eggs themselves likely use a distinct table that's UNKNOWN in decompiled.
        // Use proportional values that reflect the relative chick-type rarity.
        this.mEggSellValue = [50, 100, 200, 300, 500][eggType] || 50;
        this.mValue = this.mEggSellValue;
        this.mBaseValue = this.mEggSellValue;
        // Lifetime confirmed: FUN_00407038 line 8775 — egg[5] = 4000 (~40s at 100fps).
        this.mMaxLife = 4000;
        // mBrooding: true once player has committed the egg for brooding via
        // the HUD egg-box click. Stays true until hatch, cancellation toggle
        // (second egg-box click), or natural lifetime expiry. Note: this is
        // the player INTENT flag, not "broody actively sitting" — that's
        // checked separately in Egg.update via _claimedBy.mBroodActive.
        this.mBrooding = false;
        this.mBroodProgress = 0;       // 0..1 (progress, NOT remaining)
        // mBroodDuration & mBroodTimer were used by the now-removed
        // auto-hatch fallback. Brood timing lives entirely on BroodyChick
        // (mBroodProgress / mBroodDuration there).
    }

    getImage() { return IMAGES.IMAGE_EGG; }

    // Override draw: progress through cracking frames as egg ages.
    // IMAGE_EGG is configured as 1×N frames at load (rwg_functions.c:31177-31186):
    //   frame 0 = whole, last frame = fully cracked.
    draw(g) {
        const img = this.getImage();
        if (img && img.img && this.mIsAlive) {
            const celW = img.getCelWidth();
            const celH = img.getCelHeight();
            const numFrames = (img.mNumCols || 1) * (img.mNumRows || 1);
            // Progress through frames as the egg decays
            const lifeFrac = this.mMaxLife > 0 ? Math.min(1, this.mLifeTimer / this.mMaxLife) : 0;
            let frame = Math.min(numFrames - 1, Math.floor(lifeFrac * numFrames));
            if (this.mBrooding) frame = 0; // hatching reset

            const dx = this.mX - celW / 2;
            const dy = this.mY - celH / 2;
            // Color tint per egg type — matches the original which has
            // colored egg variants (visible in mission_eggs_*.png icons:
            // layer=white, magic=blue, holy=red, rooster=dark, broody=golden).
            // The field egg sprite egg.png is white; we tint by pre-baking
            // colored variants into offscreen canvases (cached on the Image
            // object). Offscreen 'source-atop' composite clips the tint to
            // the egg's own alpha — no spillover onto the canvas background.
            // 0=white (no tint), 1=blue (magic), 2=red (holy),
            // 3=dark (rooster), 4=golden (broody).
            const tinted = getTintedEggCel(img, frame, this.mEggType);
            if (tinted) {
                g.ctx.drawImage(tinted, dx, dy);
            } else {
                g.drawImageCell(img, dx, dy, frame);
            }

            // Brood progress bar above the broody chick — egg is at chick's
            // feet, chick body extends ~78px up, so bar at egg.mY - 90 sits
            // just above the chick's head. Previous offset of -10 placed it
            // *behind* the broody sprite where it was invisible.
            if (this.mBrooding && this.mBroodProgress > 0) {
                const barW = 40, barH = 5;
                const bx = this.mX - barW / 2;
                const by = this.mY - 90;
                const ctx = g.ctx;
                ctx.fillStyle = 'rgba(60,40,20,0.7)';
                ctx.fillRect(bx, by, barW, barH);
                ctx.fillStyle = '#5cff5c';
                ctx.fillRect(bx, by, barW * Math.min(1, this.mBroodProgress), barH);
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1;
                ctx.strokeRect(bx, by, barW, barH);
            }

        }
    }

    _playCollectSound() {
        if (SOUNDS.SOUND_COLLECT_EGG) SOUNDS.SOUND_COLLECT_EGG.play();
    }
}
