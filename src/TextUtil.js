// Shared canvas-text helpers for dialogs.
//
// NOT a port of a specific decompiled function. The original rendered dialog
// text with the Sexy framework's BITMAP fonts (app/fonts/ArialBlack*.png +
// .txt descriptors with fixed per-glyph widths) laid out by the Sexy Dialog
// widget. This port draws dialog text with the browser's canvas fillText
// instead, whose metrics vary by platform — so fixed coordinates that fit in
// one browser overflow in another. These helpers constrain text rendering to
// the dialog boxes' (already source-cited) bounds: shrink-to-fit titles and
// word-wrap body text so nothing spills outside the box, regardless of the
// font the browser actually resolves. They do not introduce any new gameplay
// position/size values.

// Parse the px size out of a CSS font string, e.g. 'bold 22px Arial Black, ...'
function _fontPx(font) {
    const m = /(\d+(?:\.\d+)?)px/.exec(font);
    return m ? parseFloat(m[1]) : 14;
}
function _withPx(font, px) {
    return font.replace(/(\d+(?:\.\d+)?)px/, px + 'px');
}

// Set ctx.font to `baseFont`, shrinking the px size only as far as needed so
// `text` fits within `maxWidth`. Returns the chosen font string (already set).
// Won't shrink below `minPx` (clips instead — callers size boxes to avoid it).
export function fitFont(ctx, text, baseFont, maxWidth, minPx = 9) {
    let px = _fontPx(baseFont);
    ctx.font = baseFont;
    while (px > minPx && ctx.measureText(text).width > maxWidth) {
        px -= 1;
        ctx.font = _withPx(baseFont, px);
    }
    return ctx.font;
}

// Draw `text` at (x, y) using the current textAlign, shrinking the font to fit
// within `maxWidth`. Convenience wrapper around fitFont + fillText.
export function drawFitText(ctx, text, x, y, maxWidth, baseFont, minPx = 9) {
    fitFont(ctx, text, baseFont, maxWidth, minPx);
    ctx.fillText(text, x, y);
}

// Split `text` into lines that each fit within `maxWidth` at the current
// ctx.font. Greedy word-wrap; a single word longer than maxWidth is left as
// its own (over-wide) line rather than broken mid-word.
export function wrapText(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (line && ctx.measureText(test).width > maxWidth) {
            lines.push(line);
            line = word;
        } else {
            line = test;
        }
    }
    if (line) lines.push(line);
    return lines;
}

// Draw word-wrapped, centered text starting at (cx, y), advancing by lineH per
// line. Returns the y just past the last line (so callers can place content
// below). Uses the current ctx.font / fillStyle / textAlign.
export function drawWrappedCentered(ctx, text, cx, y, maxWidth, lineH) {
    const lines = wrapText(ctx, text, maxWidth);
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], cx, y + i * lineH);
    }
    return y + lines.length * lineH;
}
