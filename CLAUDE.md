# Chicken Chase port — project rules

This is a strict port of the original "Chicken Chase" game (Windows, PopCap Sexy framework, 800x600) from decompiled C to JavaScript.

## Hard rules

1. **No imagination.** Every position, size, color, cost, timer, count, or behavior in JS code must come from the decompiled source. If you can't find it, say "UNKNOWN — not found in decompiled" and ask. Never guess.

2. **Cite the source.** When introducing or changing a value, comment with the function/line:
   ```js
   // FUN_0040bbea line 14005: Resize(0x193, 0x27, 0x65, 0x26)
   ctx.drawImage(menuBtnImg.img, 403, 39, 101, 38);
   ```

3. **Update DECOMPILED_MAP.md** when implementing a new behavior. It's the structured reference: behavior → decompiled function → JS file.

4. **Verify against screenshots.** `screenshots/*.png` are 29 real-game screenshots. Compare visual output before declaring done.

5. **Research agents must fail loud.** Prompt them: "Output UNKNOWN if not found, do not infer."

## Source of truth — do NOT modify

- `decompiled/rwg_functions.c` (224K lines) — main decompiled C
- `decompiled/rwg_vtables.txt` — vtables
- `decompiled/rwg_structs.txt` — struct layouts
- `decompiled/all_functions.c` — full decompilation
- `decompiled/function_index.txt` — function name index
- `screenshots/*.png` — 29 ground-truth screenshots
- `original-app/images/*.png` — original game images
- `original-app/sounds/*.wav` — original game sounds

## Working files

- `src/*.js` — the port
- `DECOMPILED_MAP.md` — structured reference (behavior → decompiled function → JS file)

## Common decompiled prefixes

- `FUN_xxxxxxxx` — decompiled function at address 0x... (look up in rwg_functions.c)
- `DAT_xxxxxxxx` — global data at address (often image/sound resource pointers)
- `_DAT_xxxxxxxx` — read-only constant
- `*(this + 0xN)` — instance field at offset N

## Frame of reference

Screen is **800x600**. Float timers are typically 0.0–1.0, decremented per frame at 100fps. Money is integer dollars at object offset 0x48 (FieldController) or 0x4 (game state).
