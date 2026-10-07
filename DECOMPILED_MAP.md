# Decompiled → JavaScript port reference map

Single source of truth: each behavior in the JS port maps to a specific function/line in `decompiled/rwg_functions.c`. If a row says `UNKNOWN`, the behavior has not yet been verified against decompiled source — do not rely on it.

**Process rule:** when implementing/changing JS behavior, find the row here (or add one). Cite `rwg_functions.c:LINE` in code comments. Never invent values.

---

## Conventions

- Hex offsets (e.g., `0x48`) are struct field offsets unless context makes them addresses.
- `FUN_xxxxxxxx` = decompiled function at address. Look up by name in `rwg_functions.c`.
- `DAT_xxxxxxxx` = global data (often image/sound resource pointer).
- Status: ✓ ported & verified · ◐ ported, not fully verified · ✗ invented (needs revisit) · — not yet ported
- `✓ (audit 2026-10-06)` = row corrected or confirmed by the two audit rounds of 2026-10-06; `✓ (audit round 3)` = corrected/added by audit round 3 (js commit a5436be); `✓ (audit round 4)` = audit round 4 (js commit bb6f6c1: float32 precision, tick/input order, dialog logic); `✓ (audit round 5)` = js commit 034eabb (key polling/pause, loop catch-up, audio, sell sort, starter order); `✓ (audit round 6)` = js commit 4e1da30 (level-end repeat, risk rect, music curve, time format). Where a row was wrong, the old claim is struck out with ~~…~~ or replaced.
- **Ground truth for "what is ported where" is the JS comments themselves**: `grep -n "FUN_\|rwg" src/*.js`. Every ported value carries `FUN_xxxxxxxx` + `rwg_functions.c` line (or `asm 0x…` address).
- **Recovering what Ghidra dropped** (register args in EAX/ESI/AL, float/double constants, `.data` tables): disassemble the real PE `original-app/chicken_chase.RWG` (`chicken_chase.exe` is only a launcher wrapper):
  `llvm-objdump -d --start-address=0x422d10 --stop-address=0x423ea0 original-app/chicken_chase.RWG` for code, and read `.rdata`/`.data` bytes at the `_DAT_` address for constants (`llvm-objdump -s -j .rdata`, or `strings -a` for literals). JS cites these as `asm 0x…`.

---

## 0. Key vtable offsets (Sexy framework)

Discovered via `FUN_0040bbea` and surrounding draw code.

| Vtable offset | Method | Notes | Source |
|---|---|---|---|
| `+100` (0x64) | `Resize(int x, int y, int w, int h)` | Position+size for widgets | rwg_functions.c:14005 |
| `+0x40` | `SetVisible(bool)` | 0=hidden, 1=visible | rwg_functions.c:14009 |
| ~~`+0x28`~~ | ~~`Translate(...)`~~ | rwg:13660 is a direct call of FUN_00466895 (DrawImage stretched into a rect), not a vtable call | ✓ (audit round 3) |
| `+0x1c` | text/string render | Draw text via font | rwg_functions.c:13683, 13703 |
| `+0x2c` | image lookup by name | resource fetch | rwg_functions.c:31203+ |
| `+0xc4` | sound play (singleton) | argument is sound DAT | rwg_functions.c:12495 |

`FUN_004665cf(int x, undefined2 y, undefined4 image)` = **Blt** (immediate-mode image draw at x,y).
`FUN_00466895` = **DrawImage stretched into a rect** (dest x+trans, y+trans, w, h; src = whole image; Ghidra dropped the register args — read the asm, e.g. 0x40af8d-0x40afa5). ~~Translate (vtable +0x28)~~ ✓ (audit round 3). Also used for gem shadows (Gem.js).

---

## 1. GameView constructor & class layout

`FUN_004091f9` at line **11677** (NOT FUN_004092aa). Calls parent `FUN_00438a84` at 11703.

| Offset | Field | Initial value | Source |
|---|---|---|---|
| `+0x00` | vtable | `Sexy::GameView::vftable` | 11707 |
| `+0x84` | listener vtable | `Sexy::ButtonListener::vftable` | 11706 |
| `+0x88-0x9C` | misc state | 0/3/0 | 11709-11713 |
| `+0xA0` | hand list | via FUN_0040bf56 | 11715 |
| `+0xAC` | MENU button widget | `FUN_0042149b("MENU")` | 11724-11726 |
| `+0xB0` | SELL button widget | `FUN_0042149b("SELL")` | 11727-11730 |
| `+0xB4` | BUY button widget | `FUN_0042149b("BUY")` | 11731-11733 |
| `+0xB8` | parent ptr | param_1 | 11720 |
| `+0xBD` | re-entrancy guard | 0 | 11722 |
| `+0xC0` | (state) | -1 (0xFFFFFFFF) | 11718 |

Other fields read from in Draw (`+0x10`, `+0x14`, `+0x1C`, `+0x24`, `+0x28`, `+0x30`, `+0x34`, `+0x38`, `+0x3C`, `+0x44`, `+0x48`) are populated by parent base class — vector/list members for chickens, eggs, hands, tasks. Not HUD widgets.

---

## 2. Top panel UI (HUD)

**KEY FINDING:** Only **3 actual widgets** exist (MENU, SELL, BUY). Everything else (shop slots, egg row, money/time/level/task counters, risk icon) is **rendered procedurally** in `GameView::Draw` (`FUN_0040a3d6` line 13085) via immediate-mode Blt calls.

### Real widgets

| Widget | Offset | Resize(x,y,w,h) | Initially visible? | Visibility refresh in Draw | Source |
|---|---|---|---|---|---|
| MENU | `this+0xAC` | `(0x193, 0x27, 0x65, 0x26)` = (403, 39, 101, 38) | yes | (none — always visible) | 14005 |
| SELL | `this+0xB0` | `(0x1FA, 0x27, 0x55, 0x26)` = (506, 39, 85, 38) | hidden (SetVisible(0)) | per frame from `(puVar5+0x30)+0x18` | 14007-14009, 13294-13295 |
| BUY  | `this+0xB4` | `(0x1FA, 0x01, 0x55, 0x26)` = (506, 1, 85, 38) | hidden (SetVisible(0)) | per frame from `(puVar5+0x30)+0x19` | 14010-14012, 13297-13299 |

SELL/BUY visibility flags live at **store** (app+0x30) `+0x18` / `+0x19` (ctor 1), written by the per-level switch `FUN_00422d10` / `FUN_00423cb3` / `FUN_00423e5a` — ~~set by FUN_00423c04~~ (that sets type bits + buy slots). JS `LevelData sellButton / specialShopButton`, `GameView.js` widget visibility. ✓ (audit 2026-10-06)

Shop slots: always 5 entries (FUN_0041e7f2 ctor loop :37640-37660); slot click FUN_00409ba0:12469 → FUN_0041e8f5 (closed slot 0 rejected, click consumed). Slots do not depend on the BUY flag (screenshot 13). Egg row: 11 boxes per row (FUN_00409ab2:12381). Click order on HUD (FUN_004093d9:11870-11883): shop slots → egg row → risk icon (FUN_00409c38:12514). ✓ (audit 2026-10-06)

### Procedurally-drawn HUD elements (NOT widgets)

All positions from asm 0x40af73-0x40b965 (FUN_0040a3d6 HUD part; DrawString x = left, y = baseline). JS `FieldController` HUD draw. Button widgets: MouseDown FUN_0043db80 → ButtonPress only; **ButtonDepress fires on mouse-up** (FUN_0043dbb3 rwg:73862, when mIsOver); pressed draw = down image, else over/normal image **offset (1,1)** when mIsDown && mIsOver; over image when mIsOver || mIsDown (rwg:73668-73690). JS `SexyApp.js` ButtonWidget, `GameView.js`. ✓ (audit round 3)

**MENU/SELL/BUY = DialogButtons** built by `FUN_0042149b` (GameView ctor FUN_004091f9 rwg:11723-11732): IMAGE_DIALOG_BUTTON / _OVER (DAT_004fffa0), font FONT_DLG_BUTTONS (DAT_004fff2c, rwg:30954-30956), labels white (rwg:41106-41112), draw FUN_0043ea73. **Drawn after GameView::Draw** (children → on top of hint bar and GAME PAUSED). SELL uses IMAGE_DIALOG_BUTTON_HIGHLIGHT/_OVER (DAT_004fffa4/a8) while `FUN_00404ea0` (rwg:6001) finds a chick passing vt[4] with food == FUN_004058af() (rwg:13294-13309). JS `FieldController.drawHudButtons` (CreditsView `DialogButton`). ✓ (audit round 4)

| Element | Image | DAT | Position | Source line |
|---|---|---|---|---|
| Top panel background | `IMAGE_IN_GAME_UP` | `DAT_004fffb8` | x = view.width - image.width | 13659 |
| Bottom strip | `IMAGE_IN_GAME_DOWN` (10x40, alpha) | `DAT_004fffbc` | drawn **stretched** to (0, H − 40, W, 40) = dark strip along the bottom of the field. ~~NOT drawn — Translate anchor~~ | 13660, asm 0x40af8d-0x40afa5 (FUN_00466895 = stretched DrawImage); `FieldController` HUD ✓ (audit round 3) |
| Money slot bg | `IMAGE_NUMBER_SLOT` | `DAT_004fffc0` | x = view.width - slot.width, y = (top, 1st draw) | 13663 |
| Time slot bg | `IMAGE_NUMBER_SLOT` | `DAT_004fffc0` | x = view.width - slot.width, y = (top, 2nd draw) | 13664 |
| Shop slots (loop) | `IMAGE_SHOP_SLOT_OPEN` (open) / `IMAGE_SHOP_SLOT_CLOSED` (closed) | `DAT_004fff88` / `DAT_004fff8c` | x = OPEN.w × i, y = 0; value 0 → CLOSED. Open: preview DAT_00500604[i] at (x+0xd, 6); price "%i" FONT_8 at (x+0x28−w/2, 0x46); value > 0 → "%i" FONT_10 at (x+0x3e−w/2, 0x17); white | asm 0x40b001-0x40b1a8 ✓ (audit round 3) |
| Shop slot count | `FUN_0040bfa0()` | (dynamic) | per level | — |
| Egg incubation row | `IMAGE_EGG_REF` (idle) / `IMAGE_EGG_REF_FOR_BROOD` (brooding) | `DAT_004fff74` / `DAT_004fff78` | x = `EGG_REF.width × index`, y = `0x50` (80); wraps at index >10 (x -= 11×width, y = image.height + 0x50) | FUN_00409ab2:12389-12399, drawn at 13836-13840 |
| Egg type overlays | `IMAGE_MISSION_EGGS_LAYER`/`BROODY`/`ROOSTER`/`MAGIC`/`HOLY` | `DAT_004fffdc` .. `DAT_004fffec` | drawn over egg, type 0..4 | 13842-13849 |
| Brood progress overlay | `IMAGE_EGG_REF_BROOD_PROGRESS` | `DAT_004fff7c` | conditional on `progress > _DAT_004e90b0` | 13854-13862 |
| Task progress slot row | `IMAGE_NUMBER_SLOT_TASK` | `DAT_004fffc4` | tasks with target > 0, k = drawn count: slot at (W−w, h·k+0x50); icon at (0x25d, slotY+h/2−icon.h/2); time task (0xc/0xd): FONT_16 (255,50,50), white-blink when rem ≤ 1000 and (rem/50) odd, centred on 0x2c1 at slotY+0x1b; else FONT_10 white (flash: FONT_12 (100,100,200)), current right-aligned to 0x2c1 + " / %i" from 0x2c1, y = slotY+0x19 | asm 0x40b210-0x40b4a4 ✓ (audit round 3) |
| Level label | "Level %i" (0x4dcdac) | FONT_16 `DAT_004fff14`, white | (0x19a, 0x19) | asm 0x40b1ae-0x40b20b ✓ (audit round 3) |
| Time / Money | FONT_16 `DAT_004fff14`, white | — | "Time" (0x265, 0x1b), value (0x2d5, 0x1b) as `[0]m:[0]s` of state+8/100 (FUN_0040bebb asm 0x40bebb-0x40bf55: t = ticks/100 idiv, < 0 → 0; "%i:"/"0%i:" minutes > 9 / ≤ 9, "%i"/"0%i" seconds) ✓ (audit round 6); "Money" (0x265, 0x46), money right-aligned to 0x314 at 0x46 | asm 0x40b677-0x40b80b ✓ (audit round 3) |
| HUD fonts | FONT_8/10/12/16 = DAT_004fff08/0c/10/14 (ArialBlack 8/10/12/16) | — | — | rwg:30926-30938 ✓ (audit round 3) |
| Money effects | "%i" amount, FONT_16, colour (255,255,255, ftol(timer·256)) at FUN_00409567(pos) | list (app+0x3c)+0xc, pushed by FUN_00424b5d → FUN_0040693f {amount, pos, 1.0} when pos.x ≥ 0 | — | asm 0x40b87b-0x40b965, 0x424b5d-0x424bb4 ✓ (audit round 3) |
| Egg boxes gate | only when FUN_00404a71(1) (broody bit of field type bitset +0x24c); egg icon at (x+(EGG_REF.w−icon.w)/2, y+10); progress cropped to ftol(p·w+0.5) at (x+5, y+5) | — | — | asm 0x40b4a9-0x40b672 ✓ (audit round 3) |
| Hint pointer up/down | `IMAGE_HINT_POINTER_UP/DOWN` | `DAT_004fff84` / `DAT_004fff80` | conditional | 13952-13960 |
| Risk icon position | (computed) | — | x = `0x2da` (730), y = `(count-1) × NUMBER_SLOT_TASK.height + 0x75` (117); w/h = whole IMAGE_ICON_RISK; recomputed whenever used (HUD draw rwg:13900 and the click FUN_00409c38) — not cached | FUN_00409af0:12415-12457, asm 0x409b88 ✓ (audit round 3) ✓ (audit round 6) |
| Risk icon image | `IMAGE_ICON_RISK` | `DAT_00500014` | shown when `*(*(iStack_12c+0x48)+9) != 0` | 13899-13905 |

---

## 3. Mouse buttons & cursor flags

| Action | Decompiled | Detail | Status |
|---|---|---|---|
| Left button | FUN_0040bd72:14135 | `param_3 == 1 \|\| 2` → calls `FUN_0040be11(1)` → sets `DAT_004fff00` | ✓ |
| Right button | same | `param_3 == 3 \|\| -1 \|\| -2` → calls `FUN_0040be50(1)` → sets `DAT_004fff01` | ✓ |
| Right held = seed drop | FUN_0040cc71:16166-16180 (hand mode 0 only, repeat every 0x14 ticks while DAT_004fff01 held, :15904-15917) → FUN_0041bfe2:34292 | Only for mouse y ≥ 0x15f (351). Seeds per click DAT_0050034c[seed lvl] = 5/9/12, price `ftol(n*0.4+0.5)` = $2/$4/$5 (asm 0x41c01d), via FUN_00403e23 (no sound if unaffordable). JS `FieldController._feedArea/dropSeedsAt`. ~~FUN_004015f8:716-718 "money −1 per drop"~~ — that line is the raven controller tick decrementing raven +0x48. | ✓ (audit 2026-10-06) |
| Left-click polling | FUN_004093d9:11869-11883 (HUD: shop slots FUN_00409ba0 → egg row FUN_00409c92 → risk icon FUN_00409c38, paused or not; then pending button +0xc0 via FUN_0040bce7) + FUN_0040cc71 (field, unpaused, latch Hand+8 :15893-15902) | Both poll the DAT_004fff00 edge; no DOM click handlers. JS `GameView.js` input poll | ✓ (audit round 4) |
| Left click on field | FUN_0040cc71:15843-16190 | Mode-dependent order: gun → ravens then wolves; cure → gem under cursor first, then cure chick; seeds → gems, eggs, then drop seeds (y ≥ 351). JS `FieldController` hand click | ✓ (audit 2026-10-06) |
| **Note** | | `DAT_004fff00`/`DAT_004fff01` are also referenced for SELL/BUY visibility flags — these are level-state flags at `(level+0x30)+0x18` and `+0x19`, not the global mouse-button flags. The mouse-button DATs and the level-state flags are different addresses despite both being read from `DAT_004fff00/01` references in some agent reports — verify before using. | ◐ |

---

## 4. Money / costs

| Item | Value | Decompiled | Status |
|---|---|---|---|
| Seed drop | 5/9/12 seeds for $2/$4/$5 (seed upgrade level 0/1/2), y ≥ 351 only | FUN_0041bfe2:34292 (+ asm 0x41c01d), DAT_0050034c rwg:6677-6685 | ✓ (audit 2026-10-06) — ~~$1, FUN_004015f8:716~~ (raven controller tick) |
| Cure sick chicken | $50 (0x32); money < 50 → SOUND_ERROR | FUN_0040490a:5432-5463 | ✓ |
| Raven killed | +$50 | FUN_0040cc71:16117-16121 → FUN_00424b5d | ✓ (audit 2026-10-06) |
| Wolf killed | +$500 | FUN_0041050c asm 0x410567 → FUN_00406b22 → FUN_00424b5d | ✓ (audit 2026-10-06) |
| Money object | Core+0xc: `+0` freeze flag, `+4` money, `+8` cap (ctor −1 = none) | FUN_00406069:7524-7533 | ✓ (audit 2026-10-06) |
| Add money (cap consumer) | money += v unless `+0` set; clamp to `+8` when cap > 0; queues effect FUN_0040693f | FUN_00424b5d:45035-45049 | ✓ (audit 2026-10-06) |
| Spend money | only if money ≥ amount | FUN_00403e23:4524 | ✓ |
| Temporary money while starter chickens are bought | 1,000,000 (then overwritten by the start money) | FUN_0042166f:41259 | ✓ (audit 2026-10-06) — ~~"default money cap"~~ |
| Start money | 200 / 300 (L ≥ 10) / 400 (L ≥ 30), +100 if L < 7 (FUN_00405886) | FUN_00422c01:42840-42862 | ✓ (audit 2026-10-06) |
| Bonus-level start money | 10,000 (starting money, **not a cap**) | FUN_00423cb3:43858 | ✓ (audit 2026-10-06) |
| L34/L37 start money | 5,000 + money freeze flag (+0) = 1, eggs give no money (egg ctl +0x28) | FUN_00423e5a:43969-43990 | ✓ (audit 2026-10-06) |
| Per-level money cap (`+8`) | L30 500, L36 1000, L47 800, L48 800, L49 1000; else −1 | FUN_00422d10 cases | ✓ (audit 2026-10-06) |
| Special-shop item price | store +0 = 0xfa (250); ×2 after each purchase, floor 250 | FUN_0041e7f2:37614, FUN_0041eb94:37974-37996 | ✓ (audit 2026-10-06) |
| Chicken buy price | base DAT_0050032c × global inflation `_DAT_004fc3b8` (never doubles) | FUN_004058e7 asm 0x40590a; FUN_00405540:6655 | ✓ (audit 2026-10-06) |
| Price inflation | ×1.003 every 100 store updates when store +4 set (L32/37/39/43/49/50) | FUN_0041ea9a:37884 (asm 0x41ea9a-0x41eadf) | ✓ (audit 2026-10-06) |

---

## 5. Coins / Gems decay

| Item | Initial timer | High value | Mid value | Low value | Source |
|---|---|---|---|---|---|
| CoinGold | 1.0f (`0x3f800000`) | $30 | $20 | $10 | FUN_0040c20a:14748 |
| CoinSilver | 1.0f | $20 | $10 | $5 | FUN_0040c236:14770 |
| Diamond (fixed) | (none) | $300 | — | — | FUN_0040c2bf:14842 |

Float thresholds, read from `.rdata` of `original-app/chicken_chase.RWG` (audit 2026-10-06, `Gem.js`): `_DAT_004e9120` = 0.3, `_DAT_004dc47c` = 0.6, coin decay `_DAT_004e9128` = 0.0025/tick, diamond increment `_DAT_004e90f8` = 0.015/tick, brood-progress threshold `_DAT_004e90b0` = 0.0. ✓ (audit 2026-10-06)

---

## 6. Level configs (50 cases, 1..0x32) — rewritten ✓ (audit 2026-10-06)

JS: `src/LevelData.js` (`getLevelConfig`, `getInitialChicks`, raw `SETUP` table with per-case line + asm address). Source: `FUN_00422d10` (rwg_functions.c:42903, cases 42994-43535; asm 0x422d64-0x4238c3) plus helpers below. Full audit: scratchpad `report_leveldata.md`.

**No inheritance between levels.** `FUN_00408dae` (select-level START / LevelFailed RESTART) → `FUN_00406069` rebuilds the whole game state (money obj, raven ctrl, store, RiskController, HintController, field) every level; fields a case does not write keep ctor / `FUN_00422c01` defaults. (Old "inherits prior / fall-through" notes were wrong.)

Level start order: `FUN_00406069`:7496 (fresh world) → `FUN_0042166f`:41149 (level object, tasks, starter chickens) → `FUN_00422c01`:42818 (defaults) → `FUN_00422d10`:42903 (per-level switch). JS: `FieldController.startLevel`.

`FUN_0041b4bd(uint task_index)` — rwg_functions.c:33314 — returns ptr to `(task_index × 0x14) + table_base`. Each task entry is 0x14 bytes; offset +0 = target count, +4 current, +8 = icon ptr, +0xc flash counter (FUN_0042164e:41124).

### Task index → meaning

| Index | Meaning | Icon |
|---|---|---|
| 0 | Coins | IMAGE_MISSION_COIN |
| 1 | Blue diamonds | IMAGE_MISSION_DIAMONDS_BLUE |
| 2 | Red diamonds | IMAGE_MISSION_DIAMONDS_RED |
| 3 | Money earned | IMAGE_MISSION_MONEY |
| 4 | White (regular) eggs | IMAGE_MISSION_EGGS |
| 5 | Magic (blue) eggs | IMAGE_MISSION_EGGS_MAGIC |
| 6 | Holy (red) eggs | IMAGE_MISSION_EGGS_HOLY |
| 7 | Rooster (black) eggs | IMAGE_MISSION_EGGS_ROOSTER |
| 8 | Total chickens | IMAGE_MISSION_CHICKENS |
| 9 | Magic chickens | IMAGE_MISSION_CHICKENS_MAGIC |
| 10 (0xa) | Holy chickens | IMAGE_MISSION_CHICKENS_HOLY |
| 11 (0xb) | Rooster chickens | IMAGE_MISSION_CHICKENS_ROOSTER |
| 12 (0xc) | Time limit (centiseconds in the original; JS ms) | IMAGE_MISSION_TIME |
| 13 (0xd) | Bonus-level time (`EAX × 100` cs, only FUN_00423cb3:43842) | IMAGE_MISSION_TIME |

Task current values: `FUN_00421bc4`:41547. Level end: `FUN_00421b21`:41489 (completed → `FUN_00421948`:41320, failed → `FUN_00421a66`:41411; "lost" test `FUN_00421afa`:41460). Perfect bonus = chicken count == level +0x50 (`FUN_00423d5b`:43870).

### Defaults — `FUN_00422c01` (rwg:42818)

| Field | Default |
|---|---|
| buy slots 0-4 (store +8) | −1 (unlimited) |
| money | 200; 300 if L ≥ 10; 400 if L ≥ 30; +100 if L < 7 (`FUN_00405886`) (42840-42862) |
| raven +0x14 ravens/wave | 8 (L ≤ 10), 12 (L 11-30), 25 (L ≥ 31) |
| raven +0x1c max active | 4 |
| raven +0x18 raven HP | 1, or 2 if L > 40 |
| raven +0x0c wolves/wave | 1, or 2 if L ≥ 31 |
| raven +0x10 wolf HP | 7, or 6 if L ≥ 31 |

### Helpers

- `FUN_00423c04(this, broody, rooster, magic)` with **AL = holy** (rwg:43776, asm 0x423c04): for type i = 1..4 sets field type-bitset bit (`FUN_00404aa8(i, flag)`, field+0x24c) and store buy slot i (`FUN_0041e8e0`, −1 or 0). Layer (type 0) is never touched. ~~"buy/sell/holy buttons"~~.
- `FUN_0040bfb3()` writes (slot index in ESI) = per-type buy-count slots: −1 unlimited, 0 none, N at most N buys (decremented by `FUN_0041e8f5`:37694-37718).
- `FUN_00423cb3(level, chicks, multF)` with **EAX = time/100** (rwg:43817): task 0xd = EAX×100 cs; raven +0x34 = 6.0, +0x40 = multF, +0x38 = 0, +0x14 = +0x1c = chicks, +0x18 = 1; FUN_00423c04(0,0,0,0); store +0x18 = +0x19 = 0; FUN_00423deb(chicks); slot0 = 0; level +0x14 = 1 (bonus); level +0x50 = chick count; **money = 10000**. ~~"task 0xd = level×100, money cap 10000"~~.
- `FUN_00423d75(N)` (rwg:43887): unlocks special-shop items 0..N inclusive; ids 0/2/5/6 → seed list (app+0x1c)+0xc, 3/7 → weapon list (app+0x40)+4, 1/4 → pet list (app+0x44)+0xc. L6/L7 push item 0 directly (FUN_0040ca85). See §28.
- `FUN_00423deb(N)` (rwg:43926): slot0 = −1, buy layers until N chickens.
- `FUN_00423e5a` (rwg:43969): money obj +0 = 1, money = 5000, store +0x18 = 0, +0x19 = 1, (app+0x28)+0x1c = 1 (JS `noPeckCoins`, semantic UNKNOWN), (app+0x24)+0x28 = 1 (eggs give no money).
- Starter chickens `FUN_0042166f`:41259-41300 (asm 0x421816-0x421917): 3 layers; L < 7 +1 layer +1 broody; L ≥ 10 except 29 +1 broody; L ≥ 30 +1 layer. JS `getInitialChicks`.
  Buy order (fixes world list order) via FUN_0041e8f5: 3× layer (asm 0x42182a-0x421863) → L < 7 layer, broody (0x42187c-0x4218b6) → L ≥ 10 && ≠ 0x1d broody (0x4218bb-0x4218e8) → L ≥ 0x1e layer (0x4218ed-0x421917). FUN_00422d10 has no default case (asm 0x422d57). ✓ (audit round 5)

### Bonus levels (`FUN_00423cb3`)

| Lv | EAX | time | chicks | mult (+0x40) |
|---|---|---|---|---|
| 8 | 0x1e | 30 s | 3 | 0.8 |
| 13 | 0x1e | 30 s | 4 | 0.9 |
| 16 | 0x2d | 45 s | 4 | 1.0 |
| 20 | 0x2d | 45 s | 4 | 1.0 |
| 25 | 0x14 | 20 s | 4 | 1.1 |
| 33 | 0x14 | 20 s | 4 | 1.2 |
| 38 | 0x14 | 20 s | 5 | 0.9 |
| 45 | 0x1e | 30 s | 5 | 1.0 |

### Per-level table (verified, as emitted by `getLevelConfig`)

Time targets are in ms (the original centiseconds × 10, because FieldController counts ms). Type bits and slots are in L/B/R/M/H order. "raven +0x34/+0x38/+0x3c" are the raw raven-controller floats/delay/fixed-chance flag.

| Lv | case line | tasks (id→target; time in ms) | start $ | cap | ace s | type bits L/B/R/M/H | buy slots L/B/R/M/H | SELL | BUY btn | risk | ravens/wave | wolves/wave | raven +0x34/+0x38/+0x3c | price rise | shop items | start chicks | other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 42994 | 0(coins)→15 | 300 | -1(none) | 44 | 10000 | 0/0/0/0/0 | 0 | 0 | 0 | 0 | 0 | 1/-1/0 | 0 | - | 4L+1B | field+0x264=0 |
| 2 | 43011 | 4(whiteEgg)→10 | 300 | -1(none) | 75 | 10000 | -1/0/0/0/0 | 0 | 0 | 0 | 0 | 0 | 1/-1/0 | 0 | - | 4L+1B |  |
| 3 | 43025 | 8(chickens)→12 | 300 | -1(none) | 70 | 11000 | 2/3/0/0/0 | 0 | 0 | 0 | 0 | 0 | 1/-1/0 | 0 | - | 4L+1B |  |
| 4 | 43043 | 3($)→1500 | 300 | -1(none) | 150 | 11000 | -1/-1/0/0/0 | 0 | 0 | 0 | 8 | 0 | 1/-1/0 | 0 | - | 4L+1B |  |
| 5 | 43051 | 3($)→5000 | 300 | -1(none) | 150 | 11100 | -1/-1/-1/0/0 | 1 | 0 | 0 | 8 | 0 | 1/-1/0 | 0 | - | 4L+1B |  |
| 6 | 43066 | 8(chickens)→20 | 300 | -1(none) | 100 | 11100 | 5/5/2/0/0 | 1 | 1 | 0 | 8 | 0 | 1/-1/0 | 0 | 0 | 4L+1B |  |
| 7 | 43084 | 3($)→7000, 12(time)→420000 | 200 | -1(none) | 310 | 11100 | -1/-1/-1/0/0 | 1 | 1 | 1 | 8 | 0 | 1/-1/0 | 0 | 0 | 3L+0B |  |
| 8 | 43097 | 13(bonusTime)→30000 | 10000 | -1(none) | 0 | 10000 | 0/0/0/0/0 | 0 | 0 | 1 | 3 | 1 | 6/0/0 | 0 | - | 3L+0B (fill to 3) | BONUS chicks=3, +0x40=0.8 |
| 9 | 43101 | 5(blueEgg)→10 | 200 | -1(none) | 240 | 11010 | -1/-1/0/0/0 | 1 | 1 | 1 | 0 | 0 | 1/-1/0 | 0 | 0,1 | 3L+0B |  |
| 10 | 43112 | 9(magic)→5 | 300 | -1(none) | 200 | 11010 | -1/-1/0/0/0 | 1 | 1 | 1 | 0 | 0 | 1/-1/0 | 0 | 0,1 | 3L+1B |  |
| 11 | 43126 | 1(blueGem)→15 | 300 | -1(none) | 185 | 11010 | -1/-1/0/-1/0 | 1 | 1 | 1 | 0 | 0 | 1/-1/0 | 0 | 0,1 | 3L+1B |  |
| 12 | 43138 | 3($)→40000 | 300 | -1(none) | 300 | 11010 | -1/-1/0/-1/0 | 1 | 1 | 1 | 0 | 0 | 1/-1/0 | 0 | 0,1,2 | 3L+1B |  |
| 13 | 43150 | 13(bonusTime)→30000 | 10000 | -1(none) | 0 | 10000 | 0/0/0/0/0 | 0 | 0 | 1 | 4 | 1 | 6/0/0 | 0 | - | 3L+1B (fill to 4) | BONUS chicks=4, +0x40=0.9 |
| 14 | 43153 | 9(magic)→9 | 300 | -1(none) | 300 | 11110 | 5/5/5/2/0 | 1 | 1 | 1 | 12 | 0 | 1/-1/0 | 0 | 0,1,2 | 3L+1B |  |
| 15 | 43170 | 3($)→100000 | 300 | -1(none) | 400 | 11110 | -1/-1/-1/-1/0 | 1 | 1 | 1 | 12 | 0 | 1/-1/0 | 0 | 0,1,2,3 | 3L+1B |  |
| 16 | 43179 | 13(bonusTime)→45000 | 10000 | -1(none) | 0 | 10000 | 0/0/0/0/0 | 0 | 0 | 1 | 4 | 1 | 6/0/0 | 0 | - | 3L+1B (fill to 4) | BONUS chicks=4, +0x40=1 |
| 17 | 43184 | 1(blueGem)→30, 12(time)→540000 | 300 | -1(none) | 220 | 11110 | -1/-1/-1/-1/0 | 1 | 1 | 1 | 12 | 0 | 1/-1/0 | 0 | 0,1,2,3,4 | 3L+1B |  |
| 18 | 43195 | 3($)→5000, 12(time)→180000 | 300 | -1(none) | 160 | 11110 | -1/-1/-1/-1/0 | 1 | 1 | 1 | 12 | 0 | 1/-1/0 | 0 | 0,1,2,3,4 | 3L+1B |  |
| 19 | 43205 | 8(chickens)→80, 12(time)→300000 | 300 | -1(none) | 190 | 11010 | -1/-1/0/-1/0 | 1 | 1 | 1 | 0 | 0 | 1/-1/0 | 0 | 0,1,2,3,4,5 | 3L+1B |  |
| 20 | 43180 | 13(bonusTime)→45000 | 10000 | -1(none) | 0 | 10000 | 0/0/0/0/0 | 0 | 0 | 1 | 4 | 1 | 6/0/0 | 0 | - | 3L+1B (fill to 4) | BONUS chicks=4, +0x40=1 |
| 21 | 43219 | 6(redEgg)→8, 12(time)→420000 | 300 | -1(none) | 240 | 11111 | -1/-1/-1/-1/0 | 1 | 1 | 1 | 12 | 0 | 1/-1/0 | 0 | 0,1,2,3,4,5 | 3L+1B |  |
| 22 | 43235 | 10(holy)→5 | 300 | -1(none) | 210 | 11111 | -1/-1/-1/-1/0 | 1 | 1 | 1 | 12 | 0 | 1/-1/0 | 0 | 0,1,2,3,4,5 | 3L+1B |  |
| 23 | 43245 | 2(redGem)→10 | 300 | -1(none) | 560 | 11111 | -1/-1/-1/-1/-1 | 1 | 1 | 1 | 12 | 0 | 1/-1/0 | 0 | 0,1,2,3,4,5 | 3L+1B |  |
| 24 | 43253 | 3($)→200000 | 300 | -1(none) | 480 | 11111 | -1/-1/-1/-1/-1 | 1 | 1 | 1 | 12 | 0 | 1/-1/0 | 0 | 0,1,2,3,4,5,6 | 3L+1B |  |
| 25 | 43261 | 13(bonusTime)→20000 | 10000 | -1(none) | 0 | 10000 | 0/0/0/0/0 | 0 | 0 | 1 | 4 | 1 | 6/0/0 | 0 | - | 3L+1B (fill to 4) | BONUS chicks=4, +0x40=1.1 |
| 26 | 43264 | 9(magic)→15, 10(holy)→15 | 300 | -1(none) | 480 | 11111 | 5/5/5/-1/5 | 1 | 1 | 1 | 0 | 1 | 1/-1/0 | 0 | 0,1,2,3,4,5,6 | 3L+1B |  |
| 27 | 43283 | 2(redGem)→20, 12(time)→540000 | 300 | -1(none) | 480 | 11111 | -1/-1/-1/-1/-1 | 1 | 1 | 1 | 12 | 1 | 1/-1/0 | 0 | 0,1,2,3,4,5,6,7 | 3L+1B |  |
| 28 | 43294 | 8(chickens)→50, 12(time)→240000 | 300 | -1(none) | 165 | 11011 | -1/-1/0/-1/-1 | 1 | 1 | 1 | 12 | 1 | 1/-1/1 | 0 | 0,1,2,3,4,5,6,7 | 3L+1B |  |
| 29 | 43306 | 3($)→30000 | 300 | -1(none) | 380 | 10111 | -1/0/-1/-1/-1 | 1 | 1 | 1 | 12 | 1 | 1/-1/0 | 0 | 0,1,2,3,4,5,6,7 | 3L+0B |  |
| 30 | 43313 | 1(blueGem)→30 | 400 | 500 | 360 | 11111 | -1/-1/-1/-1/-1 | 1 | 1 | 1 | 12 | 1 | 1/-1/0 | 0 | 0,1,2,3,4,5,6,7 | 4L+1B |  |
| 31 | 43320 | 8(chickens)→50, 12(time)→540000 | 400 | -1(none) | 150 | 11111 | -1/-1/-1/-1/-1 | 1 | 1 | 1 | 25 | 2 | 1/-1/0 | 0 | 0,1,2,3,4,5,6,7 | 4L+1B | hatchSlowdown=3; field+0x26c=1 |
| 32 | 43329 | 8(chickens)→100 | 400 | -1(none) | 220 | 11111 | -1/0/-1/-1/-1 | 1 | 1 | 1 | 25 | 2 | 1/-1/0 | 1 | 0,1,2,3,4,5,6,7 | 4L+1B | broodyEggCap=4 |
| 33 | 43339 | 13(bonusTime)→20000 | 10000 | -1(none) | 0 | 10000 | 0/0/0/0/0 | 0 | 0 | 1 | 4 | 2 | 6/0/0 | 0 | - | 4L+1B (fill to 4) | BONUS chicks=4, +0x40=1.2 |
| 34 | 43344 | 10(holy)→10 | 5000 | -1(none) | 355 | 11111 | -1/-1/-1/-1/-1 | 0 | 1 | 1 | 25 | 2 | 1/-1/0 | 0 | 0,1,2,3,4,5,6,7 | 4L+1B | FUN_00423e5a |
| 35 | 43351 | 3($)→10000 | 400 | -1(none) | 150 | 11111 | -1/-1/0/-1/-1 | 1 | 1 | 1 | 2 | 2 | 0.4/0/0 | 0 | 0,1,2,3,4,5,6,7 | 4L+1B (fill to 10) |  |
| 36 | 43366 | 8(chickens)→25 | 400 | 1000 | 140 | 11111 | 2/2/2/2/0 | 1 | 1 | 1 | 25 | 2 | 1/24000/0 | 0 | 0,1,2,3,4,5,6,7 | 4L+1B |  |
| 37 | 43385 | 11(rooster)→15 | 5000 | -1(none) | 270 | 11100 | -1/-1/-1/0/0 | 0 | 1 | 1 | 25 | 2 | 1/-1/0 | 1 | 0,1,2,3,4,5,6,7 | 4L+1B | FUN_00423e5a |
| 38 | 43394 | 13(bonusTime)→20000 | 10000 | -1(none) | 0 | 10000 | 0/0/0/0/0 | 0 | 0 | 1 | 5 | 2 | 6/0/0 | 0 | - | 4L+1B (fill to 5) | BONUS chicks=5, +0x40=0.9 |
| 39 | 43397 | 1(blueGem)→30, 10(holy)→10 | 400 | -1(none) | 280 | 11111 | -1/-1/-1/-1/-1 | 1 | 1 | 1 | 25 | 2 | 1/-1/0 | 1 | 0,1,2,3,4,5,6,7 | 4L+1B |  |
| 40 | 43406 | 2(redGem)→30 | 400 | -1(none) | 520 | 11111 | 0/5/5/5/5 | 1 | 1 | 1 | 25 | 2 | 1/-1/0 | 0 | 0,1,2,3,4,5,6,7 | 4L+1B |  |
| 41 | 43422 | 1(blueGem)→1, 2(redGem)→1, 12(time)→200000 | 400 | -1(none) | 180 | 11011 | -1/-1/0/0/0 | 1 | 1 | 1 | 0 | 0 | 1/-1/0 | 0 | 0,1,2,3,4,5,6,7 | 4L+1B |  |
| 42 | 43442 | 10(holy)→10 | 400 | -1(none) | 180 | 11111 | -1/-1/-1/-1/-1 | 1 | 1 | 1 | 25 | 2 | 1/30000/0 | 0 | 0,1,2,3,4,5,6,7 | 4L+1B |  |
| 43 | 43449 | 3($)→10000, 12(time)→180000 | 400 | -1(none) | 160 | 11111 | -1/-1/-1/-1/-1 | 1 | 1 | 1 | 25 | 2 | 1/-1/0 | 1 | 0,1,2,3,4,5,6,7 | 4L+1B |  |
| 44 | 43459 | 6(redEgg)→30 | 400 | -1(none) | 284 | 11011 | -1/-1/0/-1/-1 | 1 | 1 | 1 | 25 | 2 | 1/-1/1 | 0 | 0,1,2,3,4,5,6,7 | 4L+1B |  |
| 45 | 43467 | 13(bonusTime)→30000 | 10000 | -1(none) | 0 | 10000 | 0/0/0/0/0 | 0 | 0 | 1 | 5 | 2 | 6/0/0 | 0 | - | 4L+1B (fill to 5) | BONUS chicks=5, +0x40=1 |
| 46 | 43473 | 7(blackEgg)→20, 12(time)→320000 | 400 | -1(none) | 240 | 11111 | -1/-1/5/-1/-1 | 1 | 1 | 1 | 25 | 2 | 1/-1/1 | 0 | 0,1,2,3,4,5,6,7 | 4L+1B |  |
| 47 | 43484 | 8(chickens)→50, 12(time)→360000 | 400 | 800 | 180 | 11111 | -1/-1/-1/-1/-1 | 1 | 1 | 1 | 25 | 2 | 1/-1/0 | 0 | 0,1,2,3,4,5,6,7 | 4L+1B |  |
| 48 | 43495 | 4(whiteEgg)→100, 9(magic)→20, 12(time)→600000 | 400 | 800 | 480 | 11111 | 10/-1/-1/-1/-1 | 1 | 1 | 1 | 25 | 2 | 1/-1/0 | 0 | 0,1,2,3,4,5,6,7 | 4L+1B |  |
| 49 | 43511 | 8(chickens)→50 | 400 | 1000 | 240 | 11111 | -1/1/-1/-1/-1 | 1 | 1 | 1 | 25 | 2 | 1/-1/1 | 1 | 0,1,2,3,4,5,6,7 | 4L+1B |  |
| 50 | 43523 | 1(blueGem)→80, 2(redGem)→50, 3($)→1000000, 12(time)→1020000 | 400 | -1(none) | 840 | 11111 | -1/-1/-1/-1/-1 | 1 | 1 | 1 | 25 | 2 | 1/-1/0 | 1 | 0,1,2,3,4,5,6,7 | 4L+1B |  |

### Level-state field offsets (corrected)

| Field | Meaning |
|---|---|
| `param_1+0x10` | level index (switch) |
| `param_1+0x48` | **Ace time (seconds)** — `FUN_0040dde4` asm 0x40df31 ×100 → "Ace time". ~~starting money~~ |
| `iVar4+0` / `+4` / `+8` | money obj: freeze flag (FUN_00423e5a) / **money** / cap (ctor −1) |
| `iVar2` | raven/wolf controller app+0x10 (ctor `FUN_00401202`:284, 0x44 bytes) — see §8 |
| `iVar2+0x0c` / `+0x10` | wolves per wave / wolf HP |
| `iVar2+0x14` / `+0x18` / `+0x1c` | ravens per wave / raven HP / max active ravens |
| `iVar2+0x34` / `+0x38` | bonus raven-rate float / raven delay ticks (L36 24000, L42 30000; 0 → rate = +0x34×0.1×2) |
| `iVar2+0x3c` | fixed raven chance 0.02, ignores roosters (L28/44/46/49) — ~~wolves flag~~ |
| `iVar2+0x40` | raven speed multiplier |
| `iVar10` | store app+0x30 (ctor `FUN_0041e7f2`) |
| `iVar10+4` | **price rises over time** (×1.003) — ~~ravens flag~~ |
| `iVar10+8` | buy-slot vector (5 entries) |
| `iVar10+0x18` / `+0x19` | SELL / BUY HUD buttons (ctor 1) |
| `iVar3` / `iVar3+8` | RiskController app+0x48 / risk enabled (0 on L1-6) — ~~upgrade level~~ |
| `iVar1+0x24c` | field chick-type bitset (`FUN_00404a71` test) |
| `iVar1+0x264` | sickness enabled (ctor 1; L1 writes 0; L2 tutorial sets 1 at 42152) |
| `iVar1+0x26c` | fast sickness (sick period halved; L31) |
| `iVar1+0x270` | broody-egg cap (L32 = 4) |

---

## 7. Eggs / brooding

| Concept | Value | Source | Status |
|---|---|---|---|
| Egg box position | x = `EGG_REF.w × i`, y = 0x50, wraps at i>10 | FUN_00409ab2:12389-12400 | ✓ |
| Box image (idle) | `IMAGE_EGG_REF` (DAT_004fff74) | 31188-31189 | ✓ |
| Box image (brooding) | `IMAGE_EGG_REF_FOR_BROOD` (DAT_004fff78) | 31193-31194 | ✓ |
| Brood progress overlay | `IMAGE_EGG_REF_BROOD_PROGRESS` (DAT_004fff7c) | 31197-31199 | ✓ |
| Click box → toggle brood | `FUN_00406e6a`:8569 (cancel: egg +0x18 = −1, +0x20 = 0, removed :8584-8586) | called by FUN_00409c92:12552; JS `FieldController` egg-box click | ✓ (audit 2026-10-06) |
| Keyboard brooding | A/Z all eggs on/off `FUN_00406eed`:8623; Q/W/E/R/T eggs of type 0..4 `FUN_00406f87`:8671 | FUN_004093d9:11884-11946 — see §10 | ✓ (audit 2026-10-06) |
| Brood progress query | `FUN_00406ac9` returns **remaining** fraction 1→0 | called at 13853 | ✓ |
| Brood active query | `FUN_00406e0d` returns bool | called at 13835 | ✓ |
| Egg type → image | type 0..4 → `DAT_004fffdc..ec` = MISSION_EGGS_LAYER/BROODY/ROOSTER/MAGIC/HOLY | 13842-13849 | ✓ |
| Egg lifetime / brood countdown | egg +0x14 = 4000 | FUN_00407038:8775; JS `Gem.js` Egg | ✓ (audit 2026-10-06) |
| Hatch animation | egg +0x1c set 0.001 when the broody gets up (FUN_0040258b), +0.01/tick (FUN_00406c85:8427); at 1.0 the egg hatches → FUN_00404865(type,pos):5400 | JS `Gem.js`, `Field.js` | ✓ (audit 2026-10-06) |
| Brood assignment | world gives brood-requested eggs to free broodies | FUN_0040412c:4850 (free test :4924-4935); JS `Field._assignBroodEggs` | ✓ (audit 2026-10-06) |
| Broody-egg cap | field +0x270 (L32 = 4) | FUN_00404ad0(1)+FUN_0040785f asm 0x40440c | ✓ (audit 2026-10-06) |
| Egg claims (magic chick) | FUN_004071b2:8826: candidates claim +0x00 < 1 or +0x04 == id; nearest (Chebyshev) < 1e6 with +0x20 clear; type 3/4 eggs only if nothing else; claim = {+0x00 = id ? 0x32 : 0, +0x04 = id}; never counted down. Re-claim FUN_004072bc:8888 | `Field.js`, `Chick.js` | ✓ (audit round 3) |
| Lay spots | egg ctl +0x18: 18 spots built by FUN_00406b47 (:8358-8395), spot i = 1..18: x = i·7.1111 − 3.5556, y = 68 (float32); reserve FUN_004075da:9142 (own spot refresh timer 10, else random free spot mt%count); tick FUN_00407550:9097 (drop busy egg, timer−−, 0 frees owner); egg spawned at the spot FUN_00407038 | `Chick.js` laySpotsOf / reserveLaySpot / updateLaySpots | ✓ (audit round 3) |

---

## 8. Ravens (Aliens internally) & raven/wolf attack controller — rewritten ✓ (audit 2026-10-06)

Raven entity = plain 0x54-byte struct (not virtual). JS: `Field.js` (Raven, raven list), `FieldController.js` (controller).

| Concept | Value / behavior | Source | JS |
|---|---|---|---|
| Resource names | `IMAGE_ALIEN_DOWN/CATCH/UP` | 31232-31261 | Res.js |
| Controller | app+0x10, ctor `FUN_00401202`:284 (0x44 bytes); fields §6 | FUN_00401202, FUN_00422c01:42863-42889 | `FieldController._setupRavenController` |
| Tick order ✓ (audit round 4) | FUN_004015f8:700-735: `+0x38` delay countdown → raven entity updates (Field.updateRavens: flash, FUN_00416db8, FUN_00416ed4, remove dead) → wave/spawn rolls. Movement FUN_004170ab / length FUN_004173ca in float32 (`Math.fround`) | FUN_004015f8:700-735, asm 0x4173ca-0x417428 | `_updateRavenController`, `Field.updateRavens` |
| Controller tick | `FUN_004015f8`:682 — `+0x38` delay--, scarecrow timer +0x30 countdown (:763-767), wave + random rolls; per raven: flash +0x48-- (:716-718), anim FUN_00416db8, move FUN_00416ed4, removed when it returns false | FUN_004015f8:682-767 | `_updateRavenController`, `Field.update` | 
| Attack start | `FUN_00401491`:527 — no ravens/wave → wolves; else wolves if +0x0c > 0 and rand ≥ 0.5; else raven wave | FUN_00401491 | `startRavenAttack` |
| Wave timer | 9000 ticks between attacks; refill up to +0x1c active | FUN_00401427:480 | `_ravenWaveTick` |
| Raven wave | remaining = +0x14 (×2/3 if elephant, FUN_004104b3(1)) | FUN_004014eb:582-593 | `_startRavenWave` |
| Random single raven | every 10 ticks, needs chicken-list count (field+8) > 3; chance by rooster shortfall (§19), float32 constants | FUN_0040134a:428-470 (asm 0x401377-0x40141a) ✓ (audit round 4) | `_ravenRandomTick` |
| Spawn | target `FUN_0040178e`:798 (active chicks, not roosters, not already targeted FUN_00401720:759); HP = +0x18, speed = +0x40 | FUN_0040123f:313, asm 0x401288-0x40128f | `Field.spawnRaven` |
| Raven ctor / spawn-exit points | FUN_00416c26:29790 / FUN_00416cc2:29854 | | Field.js |
| Base speed by level | 0.45 if level < 10 … | FUN_0040591e:6846 | Field.js |
| Damage | hp −= dmg; hp < 1 → drop held chick (FUN_0040497d:5479) | FUN_00416d35:29898 | `Raven.hit` |
| Shot | only while HP > 0; SOUND_SHOOT; HP < 1 → +$50 | FUN_0040cc71:16114-16123 (asm 0x40d0f0, 0x40d113) | FieldController hand click |
| Aim test | crosshair rect (20 px with area gun, else 8) overlapping raven rect FUN_00409a2d | FUN_0040cc71:15926-15981, FUN_0040d241:16200 | `Raven.contains` |
| Catch | chick removed from field (FUN_0040481d → FUN_0040466e) | FUN_00416ed4 asm 0x416fe0 | `Chick.ravenAttack` |
| Flee flag | elephant near target (FUN_00410409 pet list) | FUN_00417219:30305 | Field.js |
| Draw | image FUN_0040a120, rect FUN_00409a2d, colorize FUN_0040a072 (255,150,150 flash); drawn after the depth-sorted list | FUN_0040a3d6:13606-13627 | `Field.draw` |
| ~~Hit handler FUN_00420e2e~~ | FUN_00420e2e is the **holy spell** (chick → red diamond), see §11 | 40520-40566 | Chick.js |

Wolves: §16. Scarecrow (+0x30) is set by RiskCaseRavensScared to max(cur, 12000) and zeroed by RiskCaseRavensAttack.

---

## 9. Risk system

Superseded by §15 (verified). Result texts are verbatim binary strings (see §15). ✓ (audit 2026-10-06)

---

## 10. Cursor / hand modes

### Setter — `FUN_0040cc01` (rwg_functions.c:15815-15838)

Calling convention: `__fastcall`, ECX = Hand `this`, EAX = mode value.
- Writes mode to `*(this+4) = EAX` (line 15822)
- Mode 0 (default): no special branch
- Mode 1: `if (in_EAX == 1)` (line 15824)
- Mode 2: `if (in_EAX == 2)` (line 15828) — extra `FUN_00401165` call before fetching singleton
- All paths end with `FUN_004422b3(piVar1)` which writes `singleton[0xde] = EAX` and dispatches `vtable[12]` (offset 0x30) — the cursor-redraw handler

**Body of FUN_0040cc01 only branches on EAX values 0/1/2** = hand modes 0 seeds, 1 cure, 2 gun (JS `Hand.js` `HandMode`). ~~Modes 3 and 4 via keyboard~~ — the keyboard calls below are egg-brooding, not cursor modes. ✓ (audit 2026-10-06)

Hand reset: `FUN_004090b9` → `FUN_0040cc01(Core+0x20, 0)` (asm 0x4090c4: mode **0**), called when pausing (space FUN_0040907e:11494-11495, focus loss FUN_00408e2f:11209, SURPRISE open FUN_0041b94a:33697). ✓ (audit 2026-10-06)

### Sexy::Hand vtable (rwg_vtables.txt:1962) — corrected ✓ (audit 2026-10-06)

| Slot | Function | Purpose |
|---|---|---|
| [0] | FUN_0040cbe4:15796 | destructor (the only Hand slot) |

~~[2] FUN_0040d4bb / [3] FUN_0040d27d~~ belong to the next vtable, **HintController** (vtable 004dcfd4): [0] FUN_0040d4bb:16402 dialog-closed → unpause, [1] FUN_0040d27d → [0]. Cursor-image dispatch lives on the app singleton (`FUN_004422b3`: app+0x378, app vtable +0x30). JS `Hand.js`, `HintController.js`.

### Hand::Update `FUN_0040cc71` (rwg:15843-16195)

Tick counter +0x0c every call (:15890). Hover tests only when mouse y > 0x82 (130) (:15944/15953); seed drop only when y ≥ 0x15f (351) (:16164-16168). Click order by mode: see §3. Auto-cursor call sites (15924/15980/16017/16153/16183) — mode values come from asm; hover/click hit test FUN_00407ad4:9520 (x in [rx,rx+w), y in [ry,ry+h)). Cursor image drawn by the framework software cursor (DDInterface, asm 0x450079-0x4500bf). JS `Hand.js`, `FieldController.js`. ✓ (audit 2026-10-06)

Round 4: ~~`Hand.isOverField` (mouseY 80..580)~~ removed — no such check in the original; only y > 0x82 (hover/aim) and y ≥ 0x15f (seeds). Cursor slot: FUN_0040cc01 → FUN_004422b3 writes app[0xde] (app+0x378 = slot 0 of the cursor-image table) read by **EnforceCursor `FUN_00448cbe`**; over a button (mDoFinger, FUN_0043e9f1 +0x78 = 1) the cursor is CURSOR_HAND. JS `GameView.js`, `Hand.js`. ✓ (audit round 4)

### Keyboard — egg-brooding keys (FUN_004093d9:11884-11946) — corrected ✓ (audit 2026-10-06)

Key-state byte array base = WidgetManager+0xd0 (`state = *(FUN_004011c6()+0x2e4)`), so offset − 0xd0 = virtual-key code. Polled every Update (FUN_00438a14:68189), only when no button is pending (+0xc0 == −1) and the game is not paused.

Round 5/6 ✓ (audit round 5): WidgetManager::mKeyDown[] is set by KeyDown FUN_00438a14 (rwg:68182, via FUN_00445818 → FUN_00446cef:82160-82168) **even while a dialog has the focus**, cleared by KeyUp FUN_00438a45 (:68205-68215). Space is polled by FUN_0040907e (:11485-11497) from **both** branches of the game tick (paused or not): edge on +0xc (prev, zeroed by StartLevel FUN_00406069:7524); toggle +0xd = 0, +4 = !+4, on pause FUN_004090b9 → hand mode 0, +0xd = 1 — so space un/pauses under an open dialog. ESC / A / Z / Q-T polled by FUN_004093d9 (:11849-11950, asm 0x4093d9-0x409532), one action per call: left-flag latch +0xbc (shop slots FUN_00409ba0 → egg row FUN_00409c92 → risk icon FUN_00409c38); +0xc0 pending button → FUN_0040bce7; else if unpaused: ESC (clears mKeyDown[ESC], MENU), A, Z, Q..T. JS `GameView.js` `_inputPoll`.

| Flag offset | VK | Key | Action |
|---|---|---|---|
| `+0xf0` | 0x20 | Space | pause toggle FUN_0040907e:11479-11498 (edge-triggered; works with a dialog open) ✓ (audit round 5) |
| — | ESC | Esc | FUN_0040bce7 MENU (Options) :11897-11900; Shift+Esc → app vtable+0xa0 = FUN_00408f0e (ShellExecute + Shutdown; no-op in browser) :11890-11895 |
| `+0x111` | 0x41 | A | `FUN_00406eed(eggs, 1)` — all eggs brood on |
| `+0x12a` | 0x5a | Z | `FUN_00406eed(eggs, 0)` — all eggs brood off |
| `+0x121` | 0x51 | Q | `FUN_00406f87(eggs, 0)` — toggle brood for egg type 0 |
| `+0x127` | 0x57 | W | `FUN_00406f87(eggs, 1)` — type 1 |
| `+0x115` | 0x45 | E | `FUN_00406f87(eggs, 2)` — type 2 |
| `+0x122` | 0x52 | R | `FUN_00406f87(eggs, 3)` — type 3 |
| `+0x124` | 0x54 | T | `FUN_00406f87(eggs, 4)` — type 4 |

JS: `GameView.js` key handler (`_setAllEggsBrooding`, `_broodEggsOfType`).

### Cursor images loaded at init

| Resource | DAT | Load line |
|---|---|---|
| `IMAGE_HAND_SEEDS` | `DAT_004fff4c` | 31202-31204 |
| `IMAGE_HAND_CURE` | `DAT_004fff50` | 31207-31209 |
| `IMAGE_HAND_GUN` | `DAT_004fff54` | 31212-31214 |
| `IMAGE_HAND_GUN_POWER` | `DAT_004fff58` | 31217-31219 |
| `IMAGE_HAND_GUN_AREA` | `DAT_004fff5c` | 31222-31224 |
| `IMAGE_HAND_GUN_POWER_AREA` | `DAT_004fff60` | 31227-31229 |

**`IMAGE_HAND_CATCH` does not exist as a literal.** Possibly `IMAGE_ALIEN_CATCH` (`DAT_004fff68`) is repurposed.

### Win32 cursor dispatcher — FUN_00448cbe (rwg_functions.c:83775-83883)

Separate from the in-game Hand. Switches on `*(int*)(this+0x478)`:

| Index | Cursor | Win32 ID |
|---|---|---|
| 0 | IDC_ARROW | 0x7f00 |
| 1 | custom slot at `+0x480` | (HCURSOR) |
| 2 | custom slot at `+0x484` | (HCURSOR) |
| 3 | IDC_IBEAM | 0x7f01 |
| 4 | IDC_HAND | 0x7f88 |
| 5 | IDC_NO | 0x7f86 |
| 6 | IDC_SIZENESW | 0x7f83 |
| 7 | IDC_SIZEWE | 0x7f85 |
| 8 | IDC_SIZENWSE | 0x7f82 |
| 9 | IDC_SIZENS | 0x7f84 |
| 10 | IDC_CROSS | 0x7f02 |
| 11, 12 | NULL (hidden) | — |

This is the framework cursor system. Game-specific cursor swap (seeds/cure/gun) is on top via `vtable[12]` of the app singleton.

---

## 11. Chick state machine & AI

JS: `src/Chick.js` (header documents vtable slots and struct). Chicks live in **field units** (§27); `mX/mY` are screen accessors.

### Struct layout (ctor `FUN_004032ca`:3426, asm 0x4032ca) — corrected ✓ (audit 2026-10-06)

| Offset | Field | Notes | Source |
|---|---|---|---|
| `+0x00` | vtable | per subclass | 3439 |
| `+0x04` | **type** 0..4 | returned by FUN_00465f98 | 3440 |
| `+0x08` | **state** | 0 held by raven, 1 sick, 2 hungry (seek food), 3 go lay, 4 normal, 6 dead, 0x14 broody brooding | FUN_004037e8 / FUN_0040386a |
| `+0x0C` | **action** | 1..13, see below | FUN_004032b8:3402 |
| `+0x10` / `+0x14` | action length / elapsed | elapsed += speedMult (×1.3 in a hurry) per tick | FUN_00403602:3652 |
| `+0x18` | anim / walk speed multiplier | re-rolled FUN_00403207(1.2, 0.5) | 3441, Chick.js:682 |
| `+0x1C` | **age / satiety** | −1 per tick, + calories when eating; ≤ 0 → death | 3478, 3629-3638 |
| `+0x20..+0x28` | field pos x, y, z | ~~x, y, stun~~ | FUN_00408149 clamp |
| `+0x2C` / `+0x30` | facing unit vector (mirror when +0x2c > 0) | | FUN_00409d5c |
| `+0x34` | **food** | capped at FUN_004058af = unit×33 (L < 10) | FUN_0041ff9a |
| `+0x38` | **sick counter** | 2000; reset by cure FUN_00403403:3510; ≤ 0 → death | 3450, 3633 |
| `+0x3C` | unique id | `DAT_004fc72c++` | 3460 |
| `+0x40` | **lay cooldown** | layFlag ? (L ≤ 6 ? 1500 : 2000) : −1 | 3458; Chick.js:252, 593 |
| `+0x44` | **hungry flag** (byte) — ~~sickness flag~~ | FUN_00403a9a: hungry when age < (L ≤ 6 ? 4500 : 5000), cleared below 3000 | 4103-4123 |
| `+0x48` | **dig cooldown** — ~~egg-laying cooldown~~ | 0 → dig a coin/diamond (vt[15], FUN_0040c4d9); reset L ≤ 6 ? 800 : 1000 | 4028; Chick.js:606 |
| `+0x4C` | speed re-roll timer | 1000 | 3612-3624 |
| `+0x50` | fall speed (vz += 0.03) | | FUN_004035c8:3626 |
| `+0x54/+0x58`, `+0x5C/+0x60` | walk target / wander target | wander target FUN_004046aa:5257 | 3490 |
| `+0x64` | hungry-icon anim | | 3471 |
| `+0x68/+0x6c` | target seed / egg (MagicChick) | | |

Food unit `FUN_00405899` = 500 (L ≤ 6) / 700. Food tier `FUN_00403a3e`: 2 if food ≥ unit×11, 1 if ≥ unit×5, else 0 (≥ 1 = "fed"). Ratio `FUN_00403a65` 0..2 (asm 0x403a65-0x403a99: ≥ unit×11 → 2.0, else float32 (2·food)/(unit×11)) ✓ (audit round 5); food unit / level read live from game state FUN_00405886/FUN_00405899/FUN_004058af (asm 0x405886-0x40588e) on every call ✓ (audit round 5); sell price `FUN_00403bd6` = ftol(SELL[type] × food/(unit×33)).

**Float32 rounding** ✓ (audit round 4): walk step/normalize (asm 0x403934-0x403966, FUN_00403cdf), action elapsed (asm 0x403650), fall vz += 0.03f (asm 0x4035c8-0x403601), hungry-icon anim (asm 0x4034b2-0x4034e1), progress FUN_0040918d, draw scale (r < 1.99 double) and spawn positions use `Math.fround`; constants read as exact float/double values from .rdata. JS `Chick.js`.

**Chick size scales with food: scale = r ≥ 1.99 ? 1.0 : r×0.25 + 0.5** (r = FUN_00403a65) — a new chick is drawn at half size. `FUN_00409d5c` asm 0x409e15-0x409e43. ✓ (audit 2026-10-06)

### Vtable slots (all chicks)

[1] Update FUN_0040344c:3560 (Broody FUN_00403de4, Holy FUN_0040d912) · [2] showHungryIcon FUN_00403ac8 · [3] canBeSickTarget (Layer FUN_00403e3c:4550, others false) · [5] isActive FUN_0040327c · [6] inHurry FUN_00403ae9 · [7] decideState FUN_004037e8:3813 · [8] startAction FUN_0040386a:3867 · [9] onArrive · [10] onActionEnd · [11] eatEnd FUN_0041ff9a · [12] walkToFood FUN_00420069 · [13] seekFood FUN_0042013e · [14] eggType · [15] coinType FUN_004201a0:39698 (Magic → 2). ✓ (audit 2026-10-06)

### Chick types (factory `FUN_00403ec2` line 4623)

| Type id | Subclass | Alloc size | Vtable | Lays eggs | Source |
|---|---|---|---|---|---|
| 0 | LayerChick | 0x70 (112) | 0x004dc96c | yes — egg type by weighted rand (FUN_0040dba2) | 4646-4659 |
| 1 | BroodyChick | 0x80 (128) | 0x004dc924 | no — broods only | 4661-4677 |
| 2 | RoosterChick | 0x70 (112) | 0x004dc9b4 | no | 4679-4691 |
| 3 | MagicChick | 0x70 (112) | 0x004dd62c | no (FUN_004032ca(pos,0)); eats eggs; digs blue diamonds | 4693-4707 |
| 4 | HolyChick | 0x74 (116) | 0x004dd11c | no (casts spells, 6000 cooldown at +0x70) | 4709-4726 |

Layer/Broody/Rooster/Holy are built by SimpleChick ctor `FUN_0041ff68(type, layFlag)`:39518 (layFlag = 1 only for Layer).

### Subclass-specific fields

| Class | Offset | Field | Source |
|---|---|---|---|
| BroodyChick | `+0x70` | smart-ptr to target egg | 2090, 4671 |
| BroodyChick | `+0x78` | ++ every update | FUN_00403de4 |
| BroodyChick | `+0x7C` | tick at which it sat down | 4674 |
| MagicChick | `+0x68` / `+0x6C` | target egg | 39533 |
| HolyChick | `+0x70` | **holy-spell cooldown (6000)** | 4722; FUN_0040d8b1 |

### Action values (`+0x0C`), nominal lengths PTR_004d01f0 (read from binary)

| Action | Value | Length | Image (FUN_0040a166:12962) |
|---|---|---|---|
| idle | 1 | 150 | IDLE0[type] (default) |
| dig | 2 | 120 | IDLE1[type] |
| sick-start | 3 | 50 | SICK_START[type] (DAT_00500644) |
| sick-idle | 4 | 100 | SICK_IDLE[type] (DAT_005005c4) |
| cured | 5 | 50 | SICK_START[type] |
| broody sit / on nest / get up | 6 / 7 / 8 | 70 / 400 / 70 | BROOD_START / BROOD_IDLE / BROOD_START |
| lay egg | 9 | 100 | LAYER[type] (DAT_005005b4) |
| peck / eat | 10 | 30 | PECK[type] (DAT_00500674) |
| walk | 11 | 60 | WALK[type] (DAT_005005e4) |
| holy spell | 12 | 100 | IMAGE_CHICK_HOLY_SPELL |
| death | 13 | 200 | DEATH[type] (DAT_00500574) |

"Sick" = action 3 or 4 (`FUN_00402342`:2063).

### Hunger / sickness / death — corrected ✓ (audit 2026-10-06)

Two separate mechanisms (JS: `Chick.js`, `Field.js`):

1. **Hunger** (per chick): age +0x1c counts down; hungry flag +0x44 (FUN_00403a9a) → state 2 seek food (vt[13]); age ≤ 0 → death + SOUND_CHICK_DEATH (FUN_0040344c:3635-3638).
2. **Sick event** (world): see §29. A sick chick (state 1, actions 3/4) dies when its sick counter +0x38 runs out unless cured ($50, FUN_0040490a → FUN_00403403 resets +0x38 = 2000, action 5).

Death: `FUN_0040342b`:3530 (state 6, action 13, 200; **no sound** — death sample only in FUN_0040344c:3637). Raven catch (FUN_0040481d), wolf eat end (FUN_00424da9 → FUN_0040481d) and Risk steal (FUN_0041b30a) all go through **FUN_0040466e**:5320-5335 = FUN_0040342b + immediate list erase FUN_00405184 (no death animation, no sound); JS `Chick.removeFromField` ✓ (audit round 3). Holy spell: `FUN_00420e2e` kills the target magic chick **without** death sound and drops a red diamond (value 2×sell price, ≥ 2000) + SOUND_CHICK_TO_RED_DIAMOND (:40566). ~~"raven catches chick: FUN_00420e2e"~~.

### Egg laying

- **LayerChick** vt[3] `FUN_00403e3c`:4550: not sick, z = 0, fed, active, on field (y ≤ 61, FUN_00403bbf). decideState → state 3 when lay cooldown +0x40 = 0 and a lay spot is reserved (FUN_004075da, see §7 Lay spots) ✓ (audit round 3).
- On lay (action 9 end): +0x40 = L ≤ 6 ? 1500 : 2000; FUN_00407038 spawns the egg, SOUND_EGG_LAYERED1/2 by rand()%2 (:8748-8760).
- **Egg type** `FUN_0040dba2`:16958: up to 31 tries, r = mt/2147483647.0 minus {0.35, 0.24, 0.14, 0.15, 1.0}; accept if the level enables the type (FUN_00404a71); Broody also needs world+0x274; else 0. ✓ (audit 2026-10-06)

### Eating — corrected ✓ (audit 2026-10-06)

~~"Eating = FUN_004015f8"~~ (that is the raven controller tick). Eating is the SimpleChick seed path: vt[13] `FUN_0042013e` (nearest claimable seed FUN_0041c11f:34388, claim) → vt[12] `FUN_00420069` (walk, re-claim FUN_0041c220:34446, action 10 on arrival) → vt[11] `FUN_0041ff9a` (food += calories, capped FUN_004058af; seed life = 0). The eaten seed is erased at once: FUN_0041bfbe (asm 0x41bfbe-0x41bfdf) life = 0 then FUN_004210f4 erases it from the seed list (world+0x1c) ✓ (audit round 5). MagicChick eats eggs instead: FUN_0040e51f / FUN_0040e44d / FUN_0040e392 (egg removed FUN_004077ae, SOUND_EAT_EGG DAT_004feda8).

---

## 12. Egg / Gem extended

### Gem struct layout (offset by 4-byte word, decimal)

| Offset (bytes) | [word] | Field | Source |
|---|---|---|---|
| 0x00 | [0] | vtable | spawn |
| 0x04 | [1] | collected flag (byte) | FUN_0040c1bc:14693 |
| 0x08 | [2] | type (0=Gold, 1=Silver, 2=DiamondBlue, 3=DiamondRed) | FUN_0040c4d9:15155-15246 |
| 0x0C | [3] | x | FUN_0040c4d9 |
| 0x10 | [4] | y | FUN_0040c4d9 |
| 0x14 | [5] | timer (float) | FUN_0040c1c1:14719, init in spawn |
| 0x18 | [6] | tick counter (Diamonds only) / unused for Coins | FUN_0040c278:14823 |
| 0x1C | [7] | DiamondRed value override (else 2000 default) | FUN_0040c4d9:15246, FUN_0040c2c5:14860 |

### Coin decay (FUN_0040c1c1:14710)

```
timer -= _DAT_004e9128
if (timer < 0) timer = 0
return timer > 0  // alive
```

- Coin starts at timer=1.0f (`0x3f800000`); decays to 0.
- Decay rate `_DAT_004e9128` = **0.0025**/tick (≈400 ticks). ✓ (audit 2026-10-06)

### Coin getValue (3-tier)

**CoinGold (FUN_0040c20a:14748):**
```
if (timer < _DAT_004e9120) return 10
if (timer < _DAT_004dc47c) return 20 (0x14)
return 30 (0x1e)
```

**CoinSilver (FUN_0040c236:14770):**
```
if (timer < _DAT_004e9120) return 5
if (timer < _DAT_004dc47c) return 10
return 20 (0x14)
```

Tier thresholds `_DAT_004e9120` = **0.3**, `_DAT_004dc47c` = **0.6** (read from `.rdata`; `Gem.js`). ✓ (audit 2026-10-06)

### Diamond timer (FUN_0040c278:14810)

**Different update logic — counts UP, not down:**
```
timer += _DAT_004e90f8
if (timer > 1.0) timer = 0  // wraps
tick_counter++
return tick_counter < 2001 (0x7d1)  // alive while < 2001
```

- **Lifetime: 2001 ticks**.
- Increment rate `_DAT_004e90f8` = **0.015**. ✓ (audit 2026-10-06)
- DiamondBlue value: 300 fixed (FUN_0040c2bf:14842).
- DiamondRed value: `*(this+0x1c)` if > 0, else 2000 (FUN_0040c2c5:14860).

### Vtable layouts

| Class | Vtable | Update | GetValue | Sound |
|---|---|---|---|---|
| Sexy::Gem (base) | 004dcf2c | — | — | — |
| Sexy::CoinGold | 004dcf4c | FUN_0040c1c1 | FUN_0040c20a | FUN_0040c262 → DAT_004fed74 |
| Sexy::CoinSilver | 004dcf6c | FUN_0040c1c1 | FUN_0040c236 | FUN_0040c262 → DAT_004fed74 |
| Sexy::DiamondBlue | 004dcf8c | FUN_0040c278 | FUN_0040c2bf | FUN_0040c2d2 → DAT_004fed98 |
| Sexy::DiamondRed | 004dcfac | FUN_0040c278 | FUN_0040c2c5 | FUN_0040c2e8 |

### Egg lay (FUN_00407038:8721)

Allocated 0x24 (36) bytes, fields:

| Offset | Field | Initial value |
|---|---|---|
| `+0x00` | (zeroed) | 0 |
| `+0x04` | (zeroed) | 0 |
| `+0x08` | x | param x |
| `+0x0C` | y | param y |
| `+0x10` | egg type (0..4) | from chick vtable[0xE] return |
| `+0x14` | lifetime ticks | **4000** |
| `+0x18` | claimed-by-chick handle | -1 (0xFFFFFFFF) |
| `+0x1C` | (zeroed) | 0 |
| `+0x20` | pickup flag (byte) | 0 |

Eggs are spawned at the end of action 9 (rwg_functions.c:3760-3768):
- Sets chick lay-cooldown **+0x40** to 2000 (1500 if level ≤ 6) — ~~`chick+0x10`~~ ✓ (audit 2026-10-06)
- Calls chick vtable[0xE] to decide egg type
- Calls FUN_00407038 with that type

### Layer egg-type weighted random (FUN_0040dba2:16958)

Weights `_DAT_004e9388/80/78/70` = **0.35, 0.24, 0.14, 0.15**, last 1.0; r = mt / `_DAT_004e9368` (**2147483647.0**); first index where the running r ≤ 0. JS `LayerChick.getEggType`. ✓ (audit 2026-10-06)

Re-rolls up to 31 times if tournament check (`FUN_00404a71`) fails OR if type-1 selected but field flag `*(char*)(field+0x274) == 0`.

### Egg type → chick class (FUN_00403ec2:4623)

| Egg type | Chick class | Alloc size | Vtable | Source |
|---|---|---|---|---|
| 0 | LayerChick | 0x70 (112) | Sexy::LayerChick::vftable | 4646-4659 |
| 1 | BroodyChick | 0x80 (128) | Sexy::BroodyChick::vftable | 4661-4677 |
| 2 | RoosterChick | 0x70 (112) | Sexy::RoosterChick::vftable | 4679-4691 |
| 3 | MagicChick | 0x70 (112) | Sexy::MagicChick::vftable | 4693-4707 |
| 4 | HolyChick | 0x74 (116) | Sexy::HolyChick::vftable | 4709-4726 |

Egg type → DAT image (HUD overlay):

| Type | DAT | Loaded as |
|---|---|---|
| 0 | DAT_004fffdc | IMAGE_MISSION_EGGS_LAYER (per agent #1) |
| 1 | DAT_004fffe0 | IMAGE_MISSION_EGGS_BROODY |
| 2 | DAT_004fffe4 | IMAGE_MISSION_EGGS_ROOSTER |
| 3 | DAT_004fffe8 | IMAGE_MISSION_EGGS_MAGIC |
| 4 | DAT_004fffec | IMAGE_MISSION_EGGS_HOLY |

### Brooding

- **Toggle clear (FUN_00406e6a:8574)**: sets `chick+0x18 = -1`, `chick+0x20 = 0`.
- **Active query (FUN_00406e0d:8549)**: returns true if a brood-list node at `chick+0x10` matches given id.
- **Progress query (FUN_00406ac9:8263)**: returns 0 if `chick+0x18 == -1`, else `1 - elapsed/total`.
  - **IMPORTANT:** This returns the **REMAINING fraction (1.0 → 0.0)**, NOT progress (0.0 → 1.0)!
- **Bar draw threshold**: `_DAT_004e90b0` = 0.0 (drawn when remaining > 0). ✓ (audit 2026-10-06)
- **Brood duration**: egg +0x14 = 4000 ticks (FUN_00407038:8775), countdown +0x18 in FUN_00406c85; then hatch animation +0x1c 0.01/tick. ✓ (audit 2026-10-06)

### Data-section constants (resolved 2026-10-06 from `original-app/chicken_chase.RWG`)

| Symbol | Used at | Meaning | Value |
|---|---|---|---|
| `_DAT_004e9120` | 14751, 14773 | Coin tier1 threshold | 0.3 |
| `_DAT_004dc47c` | 14754, 14776 | Coin tier2 threshold | 0.6 |
| `_DAT_004e9128` | 14720 | Coin per-tick decay | 0.0025 |
| `_DAT_004e90f8` | 14818 | Diamond timer increment | 0.015 |
| `_DAT_004e90b0` | 13855 | Brood-progress draw threshold | 0.0 |
| `_DAT_004e9388/80/78/70` | 16971-16986 | Egg-type weights | 0.35/0.24/0.14/0.15 |
| `_DAT_004e9368` | 16973 | Normalizer | 2147483647.0 |
| `_DAT_004e9140` / `_DAT_004e9144` | FUN_00408149 | Field size | 128.0 / 72.0 |
| `_DAT_004e93c8` | FUN_0040134a | raven bonus-rate factor (double) | 0.1 (FieldController.js; LevelData report calls the float decode garbage → treat as double) |

Method: see Conventions (`llvm-objdump` on `original-app/chicken_chase.RWG`).

---

## 13. Dialogs

### Base classes & shared resources

- **Base**: `Sexy::StdDialog` at `FUN_00421251` (rwg_functions.c:40838). Sets fonts and standard images:
  - Fonts: `FONT_DLG_HEADER` (DAT_004fff24), `FONT_DLG_LINES` (DAT_004fff28), `FONT_DLG_BUTTONS` (DAT_004fff2c) — loaded 30949-30956
  - Images: `IMAGE_DIALOG_BOX` (DAT_004fff98), `IMAGE_DIALOG_BUTTON` (DAT_004fff9c), `IMAGE_DIALOG_BUTTON_OVER` (DAT_004fffa0), `IMAGE_DIALOG_BUTTON_HIGHLIGHT` (DAT_004fffa4), `IMAGE_DIALOG_BUTTON_HIGHLIGHT_OVER` (DAT_004fffa8) — loaded 31352-31372
- **Helper**: `Sexy::DialogButton` at `FUN_0042149b` (rwg_functions.c:40983) — creates button with standard images and white color from a label string.

### HTML/CSS shared dialog chrome

`styles/dialogs.css` uses the original StdDialog / DialogButton art listed
above for the shared frame, title plate, and button normal/hover/pressed states.
`tools/prepare_dialog_art.py` composites the separate grayscale alpha masks
and extracts reusable frame/plate images into `styles/assets/`; source art
in `original-app/images/` is unchanged. Slice bounds are measured from the image pixels,
with visual verification against `screenshots/04.png` and `06.png`.
At the user's request, all HTML dialog titles, button captions, descriptions,
labels and player names now use ordinary DOM text and shared CSS fonts in
`dialogs.css` (Arial Black with Arial/sans-serif fallback). `HtmlDialogs.js`
updates `textContent`; the browser wraps text. The former `DialogText.js`
glyph renderer, generated font sheets/metrics and font preparation code have
been removed; original font resources in `original-app/` remain unchanged. Browser font
metrics are an intentional approximation, rather than an exact FONT_12/14/16
match (`original-app/properties/resources.xml:61-63`). Body text is selectable and
`white-space: pre-line` preserves source newlines.
New Player uses its source 300x200 rect and 31px EditBox height
(rwg:18893); shared frame padding/footer spacing match screenshots 04/09. The
native HTML input retains editing, selection, and focus; its browser font is still
an approximation of FONT_16. Other per-dialog layouts are still being refined. The temporary screenshot overlay
and hover handlers in `index.html` have been removed.

### HTML Options controls and development preview

`styles/dialogs.css` shares original-art native HTML ranges and checkboxes
across dialogs. Track/thumb alpha masks and both 40x40 checkbox cells are
extracted by `tools/prepare_dialog_art.py`. Options uses 346x315 / 346x389
rects (`FUN_0040fbff`, rwg:19209-19214), 176px slider widths at offsets
(140,80)/(140,120), and checkbox offsets (40,155)/(40,195)
(rwg:19453-19462, screenshots 06/31). Extra footer buttons advance 37px as
measured in screenshot 31. Native label clicking, keyboard controls, and
`HtmlDialogs` input callbacks are retained.

`dialog-preview.html` + `src/DialogPreview.js` are development-only
previews using the markup from `index.html` and the real main menu. Open
`/dialog-preview.html?dialog=options` or add `&ingame=1` to inspect both sizes.
Preview controls use the isolated tab save described below; they do not change
system fullscreen or restart levels. Standard game entry and callbacks are unchanged.

### HTML player selection, quit confirmation and modal order

`index.html` places NEW/DELETE in a shared button row above full-width OK.
`styles/dialogs.css` uses ChangePlayer's (200,125,300,350) rect and 244x155
list at (+26,+80), from `FUN_00402e3f`, rwg:2947-2952; footer rows are at
+245/+285 (screenshot 08). Shared `.cc-selection-list` uses RGB(50,50,50),
selected RGB(128,128,128), and text RGB(220,255,255) from `FUN_004028ca`,
rwg:2669-2686. The 26px row height is measured in screenshot 08.

QUIT? uses the measured 300x300 centered rect from screenshot 32; its literal
is from `FUN_0040279c`, rwg:19564/19567. Shared CSS supplies browser word wrapping and inherited ink color for body
text and list names, retaining the original strings.

`HtmlDialogs.js` orders visible modals by opening order; reopening raises a
modal and closing restores the underlying order. This fixes New Player opening
beneath Change Player due to index.html order (screenshots 09/32).
`DialogPreview.js` provides player selection/add/delete and quit-confirm previews.
Preview player data persists across reloads in namespaced `sessionStorage` through
an injected Core storage adapter (`Core.js` / `GameApp.js`); the real game retains
its existing localStorage adapter. Only a fresh preview save is seeded with 111. The menu canvas accepts clicks
after dialogs close, so Change player can reopen the same isolated player list.
Preview dialogs now use the same `ChangePlayerDialog` implementation as the game.
`HtmlDialogs.js` focuses `[data-autofocus]` when shown and restores the opener's
focus on close; New Player marks its name input with this shared HTML hook.

### HTML HintDialog layout and preview

`prepare_dialog_art.py` converts chrome RGB channels to the RGB565 palette
observed in screenshots 04/06/15, preserving alpha and untouched original files.
The source fill (231,172,63) becomes the screenshot's (231,174,57); the plate's
(202,143,52) becomes (206,142,49). The shared CSS backing uses that same fill.

`styles/dialogs.css` uses HintDialog's (200,100,400,400) rect from
`FUN_0040d557`, rwg:16540. Frame, title, wrapped HTML text, checkbox and OK
art remain shared. Screenshot 15 places the first body ink at +83, the checkbox
cell at (+40,+280), its label immediately after the 40px cell, and OK ink at
+336. Checkbox placement also follows `FUN_0040d7d0`, rwg:16686-16690.
The checkbox and footer stay at the bottom independently of text length.
`/dialog-preview.html?dialog=hint` uses `HintController.forceHint(COLLECT_COINS)`
with the actual screenshot 15 text; `&hint=<HintType number>` selects other
original messages. OK and Don't show use the real controller and the isolated
preview Core save, without changing the normal game profile.

### CSS title plate and HTML upgrade choices

The shared `.cc-plate` in `styles/dialogs.css` now draws its bevel with CSS
gradients/shadows and four fixed 6x6px radial-gradient rivets anchored to corners.
Colors are sampled from the original plate in RGB565; positions from the native
160x50 crop and screenshots 04/15/25. This replaces stretching the bitmap plate,
whose 12px end slices cut through the right rivets. The original frame and button
art remain in use. No original assets or screenshots are modified.

SELECT UPGRADE uses 500x300 at (150,150) (`FUN_00423f8a`:44153), with 98x98
native image buttons at (201,300)/(350,300)/(499,300): spacing follows
`FUN_0042434b`:44337/44359-44361. Screenshot 25 supplies the body transcription
and preview icon identities 5/1/2 (wall, dog house, roof). The generic literal at
44151 is still unnamed. `openUpgradeChoices` in `UpgradeSelectDialog.js` shares
HTML population between GameView and `?dialog=upgrade` preview. Icon buttons
have accessible labels and keyboard activation, without visible captions.
~~Existing upgrade keys, persistence and effects stay in GameView's selection
callback~~ — corrected (audit 2026-10-06): upgrades are **decoration ids 0..16
only** (no house/seeds/gun effects in the original); selection is handled by
`UpgradesView._onDialogSelect` = FUN_004244a0 (§24). `UpgradeSelectDialog.js`
`UPGRADE_TIERS` is ✗ invented and must not drive gameplay. Preview only dismisses.

### IMPORTANT: All dialog text is hardcoded inline C-strings

There is NO external strings file. Only `properties\resources.xml` is loaded (line 84561) and it defines images/fonts/sounds — NOT text. The "DIALOG_*"/"BUTTON_*" identifiers seen in init code are resource keys for images/fonts, not text translations.

### Per-dialog table

| Dialog | Class | Constructor (line) | Box (x,y,w,h) | Title text | Body text | Status |
|---|---|---|---|---|---|---|
| LevelCompletedDialog | `Sexy::LevelCompletedDialog` | FUN_0040dc45:17009 | normal: (150,100,500,400); bonus: (175,150,450,300) | "LEVEL COMPLETED" or "BONUS LEVEL COMPLETED" | "Your time" / "Ace time" labels; if bonus: "Perfect! You have got a bonus..." else "You haven't got a bonus" | ✓ |
| LevelFailedDialog | `Sexy::LevelFailedDialog` | FUN_0040e0ea:17376 | (200, 185, 400, 230) | "LEVEL FAILED" | "Time up" or "You lost all your chickens" + "\nPress main menu or restart" | ✓ |
| IntroductionDialog | `Sexy::IntroductionDialog` | FUN_0040d936:16823 | (105, 20, 590, 560) | (image-only, no title text) | Page 1: image only; Page 2: + overlay "One day, you receive a letter from your grandparents" | ✓ |
| HintDialog | `Sexy::HintDialog` | FUN_0040d557:16491 | (200, 100, 400, 400) | "HINT" | (passed in by caller — see hint strings below) | ✓ |
| OptionsDialog | `Sexy::OptionsDialog` | FUN_0040f57b:19093 | (227, (600-h)/2, 346, h) — h=315 main / 389 in-game | "OPTIONS" | Labels: "Music", "Sound FX", "Fullscreen", "Hardware Acceleration" | ✓ |
| NewPlayerDialog | `Sexy::NewPlayerDialog` | FUN_0040f117:18703 | (250, 200, 300, 200) | "NEW PLAYER" | EditBox at this+0x57, max **15 chars** | ✓ |
| ChangePlayerDialog | `Sexy::ChangePlayerDialog` | FUN_004028ca:2598 | (200, 125, 300, 350) | "WHO ARE YOU?" | ListBox of players + scroll bar; buttons "NEW", "DELETE" | ✓ |
| SelectLevelDialog | `Sexy::SelectLevelDialog` | FUN_0041c48a:34676 | (178, 77, 444, 445) | (image-based) | Per-level intro from `FUN_0042399c` (line 43542), 50 cases | ✓ |
| ShopDialog (SELL) — ~~BUY~~ | `Sexy::ShopDialog` | FUN_0041f031:38486 | (200, 25, 400, 550) | "SHOP" | Per-slot buttons; prev/next pagination | ✓ |
| SpecialShopDialog | `Sexy::SpecialShopDialog` | FUN_00420232:39763 | (150, 25, 500, 550) | "SPECIAL SHOP" | Per-item "BUY" for special items 0-7 (§28), 3/page; prev/next | ✓ (audit 2026-10-06) |
| SURPRISE! (YES/NO, then OK) | StdDialog via FUN_0040279c / FUN_0040f491 | FUN_0041b94a:33711-33716, FUN_0041ba27:33817-33826 | (generic) | "SURPRISE!" | "Do you feel clucky?" then case text (§15) — JS `SurpriseDialog.js` | ✓ (audit 2026-10-06) |
| ~~Credits dialog~~ | not a dialog: view switch `FUN_004088d0(1000)` → SelectLevelView credits roll (§26) | — | — | — | — | ✓ (audit 2026-10-06) |
| INFORMATION (OK only) | StdDialog via DoDialog FUN_00421187 (id 70000) | FUN_0041efda:38450 / FUN_004201bd:39718 | (generic) | "INFORMATION" | shop / special-shop error message (§18); JS `index.html` 'information' | ✓ (audit round 3) |
| UpgradeSelectDialog | `Sexy::UpgradeSelectDialog` | FUN_00423f8a:44055 | (150, 150, 500, 300) | "SELECT UPGRADE" | 3 dynamic option buttons; one 98x98 image button per available upgrade (DAT_00500614[id] = IMAGE_UPGRADE_PREVIEW<id>, rwg:44128-44131; id = button − 1); body from `&DAT_004e1690` (rwg:44149-44151; prompt literal recovered from binary, with "You've") | ✓ (audit 2026-10-06) |

### Standard StdDialog button slots

Each StdDialog allocates 3 button label slots:
- Slot 0: primary action ("OK", "CONTINUE", "START LEVEL", "CLOSE")
- Slot 1: usually empty
- Slot 2: title

Action buttons (extra) attached via `this+0x24..0x5c` offsets — e.g. LevelFailedDialog adds "RESTART LEVEL" + "MAIN MENU".

### LevelCompletedDialog details

- HTML layout in `styles/dialogs.css`: normal 500x400, bonus 450x300
  (`FUN_0040dc45`:17054-17071); bonus size follows the visible bonus body.
  Time rows approximate FONT_16 with ordinary 22px/29px CSS text and a 1px
  dark stroke (`FUN_0040dde4`:17156, resource binding:30937-30938); the
  original bitmap glyph renderer is no longer used in HTML dialogs.
  Screenshot 17 supplies row ink tops 184/225/266, 41px advance, 50px side
  insets, and standard bottom CONTINUE position. Times are right aligned as
  in `FUN_0040dde4`:17246-17270. Frame, title and footer remain shared.
  Preview `?dialog=level-complete` uses screenshot 17 values; `&bonus=1`
  shows the original reward text, `&reward=0` shows the no-bonus case.
  Preview CONTINUE closes the window without advancing a level or saving.
- Buttons: slot 0 = "CONTINUE" (line 17032), slot 2 (title) = `"LEVEL COMPLETED"` or `"BONUS LEVEL COMPLETED"` based on `unaff_BL` (17036-17040)
- Body: line 17059-17064 sets text based on bonus result
- CONTINUE (id 1000) `FUN_0040dd6a`:17086-17107: SOUND_CLICK, remove dialog; upgrade flag +0xd8 == 0 → `FUN_004088d0(level+1)` (select-level; level 51 → win roll) else `FUN_00408c24(level+1)` (UpgradesView, §24). Flag computed by FUN_00421948 asm 0x421987-0x4219b4 before the time is recorded (FUN_0041111b asm 0x4219d6). JS `GameView.js`/`GameApp.js`. ✓ (audit 2026-10-06)
- Draw fn: `FUN_0040dde4` (line 17117) — "Your time"; "Ace time" = level +0x48 **seconds** ×100 (asm 0x40df31; LevelData `aceTime`); "Best time - by NAME" = best over all players `FUN_0041605e`:28586 (:17165-17200). ✓ (audit 2026-10-06)

### LevelFailedDialog details

- HTML uses the source rect (200,185,400,230), `FUN_0040e0ea`:17428, and the
  shared frame, title, body text offset and two-button footer. The source's
  explicit newline is preserved in one HTML text body (`GameView.js`/`index.html`),
  removing the extra flex gap introduced by two separate paragraphs.
  There is no LEVEL FAILED image in the supplied screenshots 04-32; common
  chrome/spacing follows screenshots 06/15/17/32 and the original StdDialog.
  Preview `?dialog=level-failed` shows Time up; `&reason=chickens` shows the
  other source reason. Both preview buttons dismiss without gameplay/save changes.
- Buttons: title "LEVEL FAILED" (17400)
- Action buttons: "RESTART LEVEL" (this+0x24, line 17413), "MAIN MENU" (this+0x25, line 17416)
- Body text built from `"Time up"` (param=1) or `"You lost all your chickens"` + `"\nPress main menu or restart"` (17418-17427)
- Click callback: `FUN_0040e217` (line 17461)

### IntroductionDialog (combined "letter intro" + "chicken types intro")

HTML pages now use the shared frame and footer: letter 590x560 at (105,20),
illustrated page 680x560 at (60,20). Width growth by 90px is from
`FUN_0040daeb`:16940-16943. Screenshot 10 places the empty title plate above
the caption (FONT_12, `FUN_0040d9ef`:16894-16896), and the native 307x372
letter at (246,132). `prepare_dialog_art.py` composites its original JPG alpha
mask into `letter.png`, removing the opaque background. Screenshot 11 places
native 616x462 `Introduction.jpg` at (92,35) inside the shared frame; the image
contains its own illustrated panels, but not the outer dialog/button.
`?dialog=intro-letter` runs the actual GameView letter->panel->dismiss callbacks;
`?dialog=intro-panel` opens the second page directly. Preview saves are unchanged.

**Same dialog, 2 pages.** Page flag at `*(this+0x15c)`. Initial value 1 (line 16855).
- **Page 1** (`+0x15c == 0`): draws `IMAGE_INTRODUCTION` (DAT_00500018) — alien/chicken-types scene — line 16886-16888
- **Page 2** (`+0x15c != 0`): draws `IMAGE_INTRODUCTION_LETTER` (DAT_0050001c) + overlay text `"One day, you receive a letter from your grandparents"` (line 16894)
- Click callback `FUN_0040daeb` (line 16910): first OK toggles page, second OK dismisses

**Gating**: triggered when current level == 1 (rwg_functions.c:35567-35569). **NOT save-flag-protected** — fires every time player visits Select Level on level 1. To make first-play-only: would need to add a save flag in JS port.

### Hint presentation — corrected ✓ (audit 2026-10-06)

Most hints are **not** modal: they go to the HintController text bar `FUN_0040d39f`:16291 (typewriter: one char every 3 ticks, global DAT_005352c0; tick `FUN_0040d281`:16241 from the unpaused game tick :7472; visible part `FUN_0040d4cc`:16423) with a bobbing pointer (IMAGE_HINT_POINTER_UP/DOWN, GameView::Draw :13930-13965; down when point.y > 200). Only the **raven warning** (asm 0x4226e6 → `FUN_0040d435`:16346) and the **level tutorials** of `FUN_00422a24`:42648 (via FUN_00422bb1:42774, levels ≤ 9, gated by player +0x1c show-hints) open the modal HintDialog (pause; close → FUN_0040d4bb unpause). "You can sell chickens here." is the SELL ShopDialog text (FUN_004227d0). Per-hint point/duration: `HINT_PRESENTATION` in `HintController.js`; dispatch: §25.

### HintDialog content strings (passed in by callers)

| Hint text | Caller line |
|---|---|
| "These are your first chickens! Click anywhere to feed them." | 41991 |
| "Collect coins for extra money." | 42005 |
| "You can buy one new chicken." | 42020 |
| "Collect 15 coins to complete the level." | 42039 |
| "Click on an egg to collect it." | 42174 |
| "Your chicken is sick! Click on your chicken to cure it!" | 42236 |
| "Collect 10 eggs to complete the level." | 42249 |
| "Click here to hatch the egg." | 42329 |
| "Your task is to hatch or buy 12 chickens." | 42340 |
| "The ravens want to steal your chickens. Force the ravens away by clicking on them whenever they appear on screen." | 42378 |
| "Buy roosters to protect your chickens from the ravens." | 42389 |
| "Click the button to sell chickens" | 42424 |
| "You can sell chickens here." | 42457 |
| "Buy more roosters to protect your chickens from the ravens." | 42515 |
| "You farm is too crowded! You should sell some of your chickens." | 42530 |
| "You need to lay some more eggs to feed the magic chickens." | 42534 |
| "Your chickens are too hungry. Drop more seeds for them." | 42538 |
| "Collect coins as soon as possible. The longer the coin is available, the less valuable it becomes. Collect coins to gain money for buying more chickens." | 42690 |
| "Buy more chickens to collect 10 eggs faster." | 42697 |
| "Collect eggs to get money for buying chickens. Hatch chickens from eggs with the help of broody hen." | 42707 |
| "Sell chickens to earn $5,000. For each adult chicken sold, you will be able to buy some younger ones." | 42717 |
| "Click on the surprise option located beneath the level task bar. Depending on your luck, it can help or hurt you!" | 42749 |
| "Buy or hatch as many layer chickens as possible. These chickens produce the most eggs. The more eggs you have the faster you will find light blue eggs." | 42759 |

### OptionsDialog widgets

- Music slider (this+0x59) — line 19142
- Sound FX slider (this+0x5a) — line 19156
- In-game only buttons:
  - "MAIN MENU" (this+0x5b) — line 19174
  - "RESTART LEVEL" (this+0x5c) — line 19178
- Fullscreen checkbox (this+0x5d) — line 19186, only drawn if `+0x178+0x50 != 0`
- HW-Acceleration checkbox (this+0x5e) — line 19199
- Quit confirmation: "QUIT?" + "Your level progress will be lost. Continue?" via generic FUN_0040279c (lines 19564, 19567)
- Logic ✓ (audit round 4) (JS `OptionsDialog.js`): Update `FUN_0040f8c8`:19298 Escape → ButtonDepress(1000); ButtonDepress `FUN_0040fd44`:19497 plays SOUND_CLICK for every button (asm 0x40fd5b), CLOSE applies fullscreen (SwitchScreenMode asm 0x40fd78-0x40fda1), unpauses if a game state exists, KillDialog; MAIN MENU/RESTART → YES/NO "QUIT?" (FUN_0040279c mode 1; YES 72000 via FUN_004211e9 → `FUN_0040fe56`:19586: MAIN MENU = FUN_00408799 + free level FUN_00406389; RESTART = FUN_00406389 + StartLevel FUN_00406069 only if a level exists). Sliders (vtable 0x4e431c): MouseDown `FUN_004395a1`, MouseDrag `FUN_00439662`, MouseUp `FUN_0043970c` → SliderVal FUN_0040fcdf (music/sfx, SOUND_CLICK). Fullscreen checkbox hidden when *(app+8) == 0 (FUN_0040fa23:19393) — app = 0x4fe6d8, app+8 = DAT_004fe6e0, set to 1 by the SexyAppBase ctor (asm 0x4409c5, rwg:77241) and the GameApp ctor FUN_0040826e (asm 0x408363) and never stored elsewhere → **always visible** ✓ (audit round 5).

### Per-level intro text source

`FUN_0042399c` at line 43542 — switch statement, cases 1..0x32 (50 levels), default = "No description". Level 1 description starts "Welcome to your farm! …" (line 43557). Used by `SelectLevelDialog::FUN_0041c62e` (line 34782).

### Pause overlay (NOT a dialog)

Pause semantics ✓ (audit round 5): every dialog opener pauses (state +4 = 1, +0xd = 0, FUN_004090b9 → hand mode 0): Options FUN_0040bce7:14103, Shop FUN_0041e97b:37769, Special shop FUN_0041e9f1:37820, Hint FUN_0040d435:16367, SURPRISE FUN_0041b94a:33692, Level completed FUN_00421948:41348, failed FUN_00421a66:41431. Every closer back to the game **always unpauses** (+4 = 0, +0xd = 0) whatever paused it: FUN_0040fd44:19545, FUN_0041f94a:39086, FUN_00420ae8:40439, FUN_0040d821:16716, FUN_0040d4bb:16408 / FUN_0041b9cf:33746. Overlay drawn only when +4 && +0xd (space pause).

In-game pause is rendered as overlay text in GameView Draw `FUN_0040a3d6`:
- "GAME PAUSED" line 13973 (font DAT_004fff1c = FONT_24)
- "press space to continue" line 13980 (font DAT_004fff18 = FONT_20)

---

## 14. Main menu / player management

### `Sexy::MainMenuView`

- Constructor: `FUN_0040e5cb` line 17785
- AddedToManager (positions widgets): `FUN_0040e83a` line 17961
- Draw: `FUN_0040e75a` line 17916
- ButtonDepress dispatch: `FUN_0040ea92` line 18061

### MainMenuView elements

| Element | Position (x, y, w, h) | Image / label | Action | Source |
|---|---|---|---|---|
| Background | full-screen | `DAT_004fff94` (`IMAGE_MAIN_MENU`) | n/a | 17938 |
| Portal logo (**bottom-left**) — ~~top-right~~ | (10, H − img.h − 10), only if DAT_00500048 loaded (resource absent from original-app/images → not drawn) | `DAT_00500048` ("images/portal_logo") | n/a | 17950-17952, asm 0x40e80a-0x40e820 ✓ (audit 2026-10-06) |
| Player-name text | UNKNOWN exact (x, y) — uses Graphics cursor state | font `DAT_004fff1c`, color `DAT_005012a0` (white). **NO "Welcome, " prefix exists in binary** — only the bare player name | n/a | 17939-17946 |
| Start button | (435, 235, w, h) [w/h = image dims] | `DAT_00500030` / `DAT_00500034` (IMAGE_MAIN_BUTTON_START / _OVER) | id 1 → `FUN_004088d0(-1)` → SelectLevelView (intro if maxUnlocked == 1, else SelectLevelDialog at FUN_0041614b) | 17823, 17992, 18089-18093 ✓ (audit 2026-10-06) |
| Options button | x ≈ centered with Start, y = 310 | `DAT_00500038` / `DAT_0050003c` (IMAGE_MAIN_BUTTON_OPTIONS / _OVER) | id 2 → alloc 0x180, ctor `FUN_0040f57b` (OptionsDialog) | 17829, 17995 |
| Exit button | x ≈ centered, y = 385 | `DAT_00500040` / `DAT_00500044` (IMAGE_MAIN_BUTTON_EXIT / _OVER) | id 3 → `App::vtable[0xa0]` (Shutdown) | 17835, 17999 |
| "Change player" link | (0, 48, 138, 30) — top-left | "Change player" text (font `DAT_004fff0c`, hover green RGB(0, 0xff, 0)) | id 4 → alloc 0x194, ctor `FUN_004028ca` (ChangePlayerDialog) | 17838-17841, 18001-18007 |
| "Credits" link | (640, 60, 138, 30) — top-right | "Credits" text (font `DAT_004fff0c`, hover green) | **view switch** `FUN_004088d0(1000)` → SelectLevelView credits roll (§26) — ~~dialog id 1000~~ | 17842-17844, 18008-18014, 18126-18129 ✓ (audit 2026-10-06) |

**CORRECTION (2026-05-05):** The strings `"Welcome, "` and `"Change player"` and `"Credits"` ARE present in `chicken_chase.RWG` (verified via `strings -a` on the binary). They were not visible as literals in `rwg_functions.c` because Ghidra emitted them as data-section references rather than inline `basic_string<>(...)` calls. The screenshots (e.g. `screenshots/04.png`) clearly show "Welcome, NAME" at top-left and "Change player" link below.

**Verification command**: `strings -a original-app/chicken_chase.RWG | grep -E "^(Welcome|Change|Credits)"` returns `Change player`, `Credits`, `Welcome, ` (with trailing space — name is concatenated after).

The other "Welcome" matches:
- "Welcome!" — alien-letter cutscene (line 36043)
- "Welcome to your farm!" — level 1 tutorial (line 43557)

So the top-left rendering is `"Welcome, " + playerName`.

`MainMenuView.js` draws Change player as browser canvas text with a white fill
and 2px black stroke, following screenshot 06 and the user's request to keep
text rather than image glyphs. A bold 14px Arial font approximates FONT_12;
its left edge is inset to x=16 beneath Welcome (screenshot 06). No underline
is drawn. The source hit rectangle (0,48,138,30) and green hover color remain
from `FUN_0040e83a`:18001-18007. Canvas state is restored after the caption.

### First-launch detection (gating to NewPlayerDialog)

**`MainMenuView::AddedToManager` (`FUN_0040e83a`)** lines 18016-18028:
```c
if (*(int *)(*(int *)(App+8) + 0x10) == 0) {  // current_player == null
    alloc 0x180 bytes
    FUN_0040f117(...)  // NewPlayerDialog ctor
    App::vtable[0x114](1, dialog)  // open as dialog id 1
}
```

**Gate is "no current player loaded"** — NOT a save-file-existence check. If `game.settings` exists but no player has been selected, dialog still shows.

### Save location

**`%APPDATA%\PosITive\Chicken Chase\game.settings`**

| Step | Function | Source |
|---|---|---|
| Resolve %APPDATA% | `SHGetFolderPathA(0, 0x801a /* CSIDL_APPDATA \| CSIDL_FLAG_CREATE */, ...)` | `FUN_00415a6c` line 28191, line 28210 |
| Append "PosITive\Chicken Chase" | string concat | `FUN_00415033` |
| Store in global | `DAT_004fc404` | line 28230 |
| Settings filename | `"game.settings"` | lines 28348, 28511 |
| Build full path | `FUN_00415bad` | line 28256 |
| Save writer chain | `FUN_00415ecd` → `FUN_0041580b` → `FUN_00415924` | lines 28472, 27950, 28064 |
| Load at startup | `FUN_00415c5f` | line 28312 |
| App constants | "PosITive\\Chicken Chase" (line 10473), "Chicken Chase" (10462), "1.0" version (10465) | `FUN_0040826e` |

### Player management widgets (already in section 13)

- **NewPlayerDialog** at (250, 200, 300, 200), title "NEW PLAYER", EditBox max **15 chars**, font DAT_004fff14
  - OK callback: `FUN_0040eb80` (line 18163) → `FUN_00415924` (create player, line 28064, 18188)
- **ChangePlayerDialog** at (200, 125, 300, 350), title "WHO ARE YOU?"
  - Buttons: "OK", "NEW" (this+0x59 line 2647), "DELETE" (this+0x5a line 2651)
  - ListWidget (this+0x5b) at ~(50, 100, 300, 300), populated from global player list at offset 0x16c by `FUN_00402b44` line 2743
  - Player-name setter: `FUN_00402c43` line 2801, writes to `this+0x174`
  - ✓ (audit round 4) ButtonDepress `FUN_00402ee5`:2963: SOUND_CLICK for every button; OK → FUN_0041580b(selected) + close; NEW → NewPlayerDialog, listener FUN_004030d3 adds (FUN_00415924) + refresh FUN_00402b44 + select new name FUN_00402c43; DELETE → YES/NO "QUESTION"/"Delete user?" via FUN_0040279c (rwg:3041-3046), YES → `FUN_00403008`: FUN_0041585b (no-op unless > 1 player) + refresh. Refresh `FUN_00402b44`:2738 selects row 0, then the current player (FUN_0040285f → FUN_00402c43). JS `PlayerDialogs.js`
  - NewPlayer cancel availability: StdDialog button mode by player count (FUN_0040f117 @0x40f15a-0x40f17e) ✓ (audit round 4)

---

## 15. Risk system (VERIFIED 2026-05-06; corrected ✓ audit 2026-10-06)

JS: `RiskController.js` (cases, cooldown, icon), `SurpriseDialog.js` (dialog flow), `index.html` `surprise-result` (per-case text templates, `%i` in a span).

- Ctor `FUN_0041b569`:33420 — one instance per case; **a new RiskController is built every level** (FUN_00406069:7661-7664, Core+0x48). `+8` running = 0 on L1-6 (FUN_00422d10 asm 0x422dad…0x422f00; JS `riskEnabled`).
- Tick `FUN_0041b901`:33629 (from unpaused game tick :7477): icon phase += 0.007 (double `_DAT_004e9108`), wraps at 1.0; cooldown counter to **7500** (0x1d4c) → ready (+9). Icon cel = ftol(phase × 15) (icon_risk.jpg 900x60; asm 0x40b83a-0x40b84e). Icon rect FUN_00409af0:12452 (asm 0x409b88: whole image) at x 730, y = (taskCount−1)×slot.h + 117.
- Click `FUN_00409c38`:12514 → SOUND_CLICK → `FUN_0041b94a`:33659: needs ready; counter = 0, pending (+0xa) = 1, ready = 0; pause (+4 = 1, +0xd = 0); hand mode 0 (`FUN_004090b9`); if player +0x1d (show prompt) → YES/NO "SURPRISE!" / "Do you feel clucky?" (FUN_0040279c, :33711-33716), else straight to `FUN_0041b9cf`.
- NO (id 73000) → `FUN_0040d4bb`:16402 unpause only. YES (id 72000) → `FUN_0041b9cf`:33734: pending branch clears +0xa, player +0x1d = 0 + save (FUN_00410f28, :33753-33763), then roll `FUN_0041ba27`:33776: pick 1..8 with `canApply`, up to 1000 tries, else Nothing; OK-only result dialog FUN_0040f491 ("SURPRISE!", case text) (:33817-33826). Result OK → FUN_0041b9cf non-pending branch: **apply the case, then unpause** (:33746-33751).

| # | Case | Vtable | canApply / apply | Effect | Text (verbatim, binary strings) |
|---|---|---|---|---|---|
| 0 | Nothing | 0x004dee7c | FUN_004108a8 / FUN_0044a036 | nothing | "Nothing happens..." (33457) |
| 1 | Offensive | 0x004dee8c | FUN_0041aeaf:32762 / FUN_0041afbd → FUN_0041ebd3 | random item from the special-shop list FUN_0041eae5 (§28), given free | "You've earned a free upgrade: " + item name (name std::string 0x500480 + id×0x1c) |
| 2 | PlusMoney | 0x004dee9c | FUN_0041afd1:32858 / FUN_0041b05f → FUN_00424b5d | + rand(money/20 .. money×3/20), min 500; not when money freeze flag set | "Congratulations! You won a bet of $ %i!" |
| 3 | PlusTime | 0x004deeac | FUN_0041b08d:32931 / FUN_0041b0b3:32952 | time task (0xc) target += 3000 cs; only if task 0xc target > 0. Bonus levels (FUN_00423cb3) write only task 0xd (rwg:43838) → never applies there (proved, ✓ (audit round 4)) | "Your watch was fast! You have 30 more seconds!" (33499) |
| 4 | RavensScared | 0x004deebc | FUN_0041b499:33276 / FUN_0041b0dd:32974 | scarecrow timer +0x30 = max(cur, 12000); **existing ravens untouched** | "Your new scarecrow has frightened away all of the ravens for a few minutes." (33516-17) |
| 5 | StealChickens | 0x004deecc | FUN_0041b0f3:32994 / FUN_0041b30a:33122 | needs > 7 chicks; k = rand(n/10 .. n/7) ≥ 1 picks (with replacement), each removed (FUN_0040466e) | "Someone has stolen %i of your chickens!" |
| 6 | MinusMoney | 0x004deedc | FUN_0041b3ae:33164 / FUN_0041b436 → FUN_00403e23 | money ≥ 500, not frozen; − rand(money/20 .. money×3/20) | "You lost %i dollars." |
| 7 | ChickFlu | 0x004deeec | FUN_0041b44b → FUN_00404e20:5964 / FUN_0041b45b:33247 | k = min(20, layers×4/5) × FUN_00404d6d (sick event, §29) | "An epidemic of the flu has begun!" (33563) |
| 8 | RavensAttack | 0x004deefc | FUN_0041b499 / FUN_0041b4ac:33294 | scarecrow +0x30 = 0, then FUN_00401491 attack now (§8) | "Acht! They are back!" (33579) |

Range helper `FUN_00403d6c`:4398 = ftol(rand()/32767 × (hi−lo) + 0.5) + lo.

---

## 16. Wolf entity (VERIFIED 2026-05-06; corrected ✓ audit 2026-10-06)

`Sexy::Wolf::vftable` at `0x004e191c`. Constructor `FUN_00424be6` (line 45130). Alloc **0x4c (76 bytes)**. JS `Pet.js` `Wolf`.

Field offsets: `+0x08..+0x10` field pos, `+0x2c` state, `+0x34` target chick, `+0x38` HP, `+0x3c` speed factor (1.0), `+0x40` stun (15 on hit), `+0x44/+0x48` knockback.

Vtable: [1] Update `FUN_00424cb9`:45218 (false when dead → removed by FUN_00410116) · [3] hit `FUN_00424f19`:45439 (HP −= dmg, stun 15, knockback along unit dir in field units) · [4] isDead FUN_00424bb9 · [5] isStunned FUN_00424bc2 · [6] move `FUN_00424fa0`:45485 · [9] speed = factor × 0.2 (stunned 0.2, FUN_00424d88) · [10] target `FUN_00424cf5`:45248 → nearest active chick `FUN_00404fb1`:6116 · [12] AI `FUN_00424da9`:45365 (eat → FUN_0040481d → FUN_0040466e kills chick).

**Spawn** — wolf attack `FUN_00401543`:620: SOUND_WOLF; n = raven ctl **+0x0c** (2 if n > 2 and an elephant exists); per wolf a target via FUN_0040178e(allowRooster = 1), then `FUN_00410299(pets, 2, +0x10)`: y = rand%72, x = **−3.0 or 131.0** (rand01 < 0.5; asm 0x4102d6-0x41030b); HP = **ctl +0x10 (7, or 6 from L31)**. Wolves come with raven attacks (FUN_00401491) on levels with +0x0c > 0 (L26-40, L42-50 + bonus levels; LevelData). ~~"triggered by +0x3c=1 (cases 28,44,46,49)"~~ — +0x3c is the fixed raven chance. No "max alive wolves" cap. Click: rect FUN_00409800 overlap (FUN_0040cc71:15971-16010); hit → `FUN_0041050c`:20161, death → +$500.

---

## 17. Pets (Mouse/Elephant) (VERIFIED 2026-05-06; corrected ✓ audit 2026-10-06)

`Sexy::Pet` base at `0x004dca0c`. Factory `FUN_00410299:19962`: 0 → Mouse (0x50, ctor `FUN_0040ebe7:18227`), 1 → Elephant (0x44, ctor `FUN_00407ebf:9951`), 2 → Wolf (0x4c). Pets bought in the special shop (items 1/4, FUN_00410223:19917) spawn at FUN_00408107 (rand%128, rand%72). JS `Pet.js`.

**Pets live in field units (128 × 72)**; screen = (6x + 10, 2.8y − 6z + 367) via `FUN_00409567` (§27). Wander point FUN_00410471:20113 (rand%128, rand%57). Base Pet::Update core FUN_00410001:19751; image by action FUN_0040a32a:13046; rect FUN_00409800; mirror when dirX > 0 (FUN_00409f04). Action lengths: Elephant {160,80,0} (DAT_004dc9fc), Mouse {50,30,0} (DAT_004dd794), Wolf {0,60,60} (PTR_004e190c). Sprite cel widths 70/100/135 (resource loader FUN_0041a5b6).

**Ctor actions ✓ (audit round 5)**: pet ctors run vt[10]/vt[11] at construction (Mouse FUN_0040ebe7 asm 0x40ec7f, Elephant FUN_00407ebf asm 0x407f50, Wolf FUN_00424be6 asm 0x424c69). Mouse distances/pickup float32 (asm 0x40ef6a-0x40efe9, FUN_0040c7db best 1e6 strict <); gem pickup effect at gem field pos +0xc, z = 0 (FUN_00406b22, asm 0x40c789).

**Tick/list ✓ (audit round 4)**: one pet list fc+0x44 (mice, elephants, wolves in insertion order) updated by `FUN_00410116`, drawn in FUN_0040a3d6 keyed by field y (+0x0c, asm 0x40ac42). Dog `FUN_004091b8` is ticked by GameView::Update FUN_00409372 after the controller update (asm 0x4093ac), not by the field. Normalize `FUN_00403cdf` (asm 0x403cdf-0x403d29) and all pet intermediates float32 (wolf knockback asm 0x424f19-0x42504a). JS `Pet.js`, `Field.js`, `GameView.js`.

### Mouse (vtable 0x004dd7a4)
- Update `FUN_0040ec95`:18290; radius 3.0 (`_DAT_004e90e4`); wander `FUN_0040ee9e`:18519 ↔ chase nearest gem `FUN_0040ede2`:18471 (FUN_0040c7db:15406).
- Picks up every gem within 2×radius via `FUN_0040ef39`:18579 → **`FUN_0040c75b`:15342 = gem pickup** (money via FUN_00424b5d, counter++, sound). ~~"disperses ravens via FUN_0040c75b"~~ — the mouse does not affect ravens.

### Elephant (vtable 0x004dca48)
- Update `FUN_00407f83`:10029 — slow meander, radius 0.2. No active scaring.
- Global effects via `FUN_004104b3(1)`: roosters needed −5 instead of −1 (`FUN_00401308`:407); raven wave ×2/3 (`FUN_004014eb`:593); wolves per attack capped at 2 (`FUN_00401543`:648); raven flee flag near elephant (`FUN_00417219`:30305).

---

## 18. ShopDialog vs SpecialShopDialog (VERIFIED 2026-05-06)

**CORRECTION**: There is no separate "SellDialog" class. Two shops:
- **ShopDialog** (FUN_0041f031:38486) — title **"SHOP"**, per-row "SELL" button, **(200, 25, 400, 550)**, 10 rows/page. SELL chickens.
- **SpecialShopDialog** (FUN_00420232:39763) — title **"SPECIAL SHOP"**, per-row "BUY" button, **(150, 25, 500, 550)**, 3 rows/page. Sells **special items 0-7 only** (seeds, weapons, mouse, elephant — §28); ~~chickens & upgrades~~. Chickens are bought from the HUD slots (FUN_0041e8f5). ✓ (audit 2026-10-06)
- Opened by GameView buttons: SELL → FUN_0041e97b:37749 → ShopDialog; BUY → FUN_0041e9f1:37802 → SpecialShopDialog; both pause (+4 = 1, +0xd = 0). Selling a chick increments world +0x260 (rwg:5348).

**Round 3 corrections** ✓ (audit round 3) — JS `ShopDialogs.js`, `index.html`:

| Behavior | Source |
|---|---|
| Header "PAGE %i OF %i" (page+1, page count or 1 when 0) | .rdata 0x4df47c; asm 0x41f53a-0x41f551 / 0x420642-0x420662 |
| Row buttons, PREV, NEXT are **shown/hidden** (Widget::SetVisible FUN_00438b09), not disabled — ~~disabled at boundaries~~ | FUN_0041f325 / FUN_00420474 |
| Errors open OK-only "INFORMATION" dialog (DoDialog FUN_00421187, id 70000) — ~~inline error line~~ | FUN_0041efda:38450 (shop), FUN_004201bd:39718 (special shop) |
| Sell: last-chicken guard → INFORMATION; SOUND_CHICK_SELL DAT_004fed90; money += FUN_00403bd6 via FUN_004047af:5324 then FUN_0040466e | asm 0x41fa02-0x41fa15, asm 0x41fb12 |
| Sell row AGE = ftol(FUN_00403c75 × 10.0 + 0.5); blue (0,0,255) when food == cap FUN_004058af else white; PRICE "%i" of FUN_00403bd6 | FUN_0041f65c asm 0x41f721-0x41f785, 0x41f73d-0x41f75c, 0x41f7a5-0x41f7b2 |
| Sell row picture = chick action image at scale 0.5 at (0x14, row·0x20+0x8c); no type-name text | FUN_0041f65c asm 0x41f6c9-0x41f702 |
| SPECIAL SHOP OK (id 1000): SOUND_CLICK, KillDialog, store +0x19 = row button 0 visible, unpause, FUN_00408a1b | FUN_00420ae8:40297, asm 0x420b10-0x420b9e (0x420b6c) |
| Not enough money → "You don't have enough money." INFORMATION | rwg:40388 |
| Sell list: chicks passing vt[4] in world order, then MSVC std::list::sort (stable merge); merge moves right before left only when ratio(left) < ratio(right) → **stable, highest FUN_00403c75 first** ✓ (audit round 5) | FUN_0041f031, FUN_0041fc07:38620, FUN_0041fdfe asm 0x41feb1-0x41fed3 |
| Special shop rows read a **copy** of FUN_0041eae5's list (+0x174, size +0x17c) taken only by refresh FUN_00420474 (rwg:39897); purchase via FUN_0041eb94, then page-- if page > 0 && copy size ≤ page (asm 0x420c7e-0x420c98), refresh, SOUND_CLICK (asm 0x420caf); no-money path returns without refresh/sound ✓ (audit round 5) | FUN_00420474, asm 0x420bc9-0x420caf |


HTML SHOP now uses its source 400x550 rect in `dialogs.css` with shared frame,
title plate, navigation and button art. `FUN_0041f889`:39017-39031 supplies
SELL (+276,+145), 100x30, 32px row stride, and arrows at +75 with 30px side
insets. `FUN_0041f65c`:38893 supplies the 32px content stride; AGE/PRICE
literals are at 38803/38808. No shop screenshot exists in 04-32. At the user's
authorization for missing dialogs, text-column positions and CSS age-bar
decoration follow the existing canvas approximation and shared visual style.
All captions remain ordinary text; ten rows fit without a scrolling white list.
The footer and error line stay fixed when pages contain fewer rows.

`ShopDialogs.js` keeps real prices/selling and disables navigation at page
boundaries; juvenile bars are yellow and adult bars green. Shared disabled
navigation is dimmed by CSS. `DialogPreview.js` exposes `?dialog=shop-sell`
using a separate in-memory field with 13 chickens to exercise both pages;
`&count=1` exercises the original last-chicken guard (39115-39117). This
fixture neither advances gameplay nor changes player saves. Browser checks
confirmed pagination, row removal after SELL and the last-chicken message.

HTML SPECIAL SHOP now uses its source 500x550 rect with the same pager,
footer, error line and chrome as SHOP. `FUN_00420a27`:40271-40285 supplies
BUY (+376,+165), 100x30, 116px stride and navigation at +75 with 30px side
insets. `FUN_00420758`:40114 supplies the content-row origin y=130. No
SPECIAL SHOP screenshot was supplied; icon/name/price columns follow the
existing canvas approximation under the user's missing-dialog authorization.
Each page contains up to three rows. Captions remain HTML text.
At the user's subsequent visual correction, BUY is centered vertically in its
116px product row using 50%/translateY(-50%), replacing the source's +60px
row offset. Horizontal position, button size and page stride are unchanged.

`ShopDialogs.js` now derives HTML preview icons from composited resource cels
(with alpha), cached per resource; the old `mPath` lookup never supplied icons.
Navigation is disabled at both boundaries and page count is recomputed after
a pet purchase. The existing buying, price escalation and availability logic
is unchanged. `DialogPreview.js` uses an isolated in-memory field with five
chicken types and pets; `?dialog=shop-buy&money=0` exercises the original money
rejection. Browser checks confirmed loaded chicken/pet icons, price updates,
pagination shrink after buying a pet and the insufficient-money message.

The development-only `dialog-preview.html` / `DialogPreview.js` now provide
a collapsible dialog picker outside the native game layout: all 13 windows,
in-game options, bonus/rejection variants and a 1..50 level input. Show again
navigates to the chosen preview query using isolated preview data. This panel
is absent from the actual game's `index.html`.
The picker also exposes all 19 HintType messages from `HintController.js`.
A browser layout audit checked all 50 real level descriptions through NEXT
and all 19 real hint bodies: no description/legend/navigation intersections
or hint/checkbox overlap occurred with the current native CSS fonts. The
bonus completion variant also fits its title and reward text inside the
450x300 box. These checks cover the supplied English strings.

### Verified price tables (rwg_functions.c:6650-6749)

| Type | BUY base (DAT_0050032c) | Egg collect value (DAT_0050033c) — ~~"Mid"~~ | SELL base (DAT_0050035c) |
|---|---|---|---|
| LAYER (0) | 100 | 50 | 500 |
| BROODY (1) | 200 | 100 | 800 |
| ROOSTER (2) | 500 | 200 | 400 |
| MAGIC (3) | 1000 | 300 | 3000 |
| HOLY (4) | 1200 | 500 | 6000 |

~~Buy price doubles after each purchase~~ — corrected ✓ (audit 2026-10-06): **chicken** price = base × global inflation (FUN_004058e7; ×1.003 rises, §4); the doubling with floor 250 (FUN_0041eb94:37992-37996) is the **special-shop item** price (store +0).
DAT_0050033c is the egg collect value per egg type (FUN_004072fa:8920; Gem.js), not a sell component.
Sell price `FUN_00403bd6` (asm 0x403bd6-0x403c72): r = float32 food/(unit×33) (FUN_00403c75); p = trunc(SELL×r); **if r < 1: p += trunc(SELL×(1−r)/10)** (FSUBRP at 0x403c59 = 1−r; 10.0 double `_DAT_004e90d8`); SELL = [500,800,400,3000,6000] DAT_0050035c; no clamp (Chick.getSellPrice). ~~+ ftol(SELL×(r−1)/10) if r > 1~~ ✓ (audit round 3)

---

## 19. RoosterChick global anti-raven (VERIFIED 2026-05-06; table corrected ✓ audit 2026-10-06)

There is NO per-instance "rooster scares ravens" function. The protection is **global headcount based** in `FUN_0040134a:446-470` (every 10 ticks, only while not attacking and ravens/wave > 0). The old table was off by one; corrected from rwg:450-467 (JS `FieldController._ravenRandomTick`):

```c
roosters = FUN_00404ad0(2);            // chicks of type 2
p = 0.0;
if (chickCount > 3) {
    needed = FUN_00401308();           // max(0, trunc((alive-1)/5) - 1), or -5 with elephant
    if (needed < roosters)            p = 0.0;
    else if (roosters == needed)      p = _DAT_004e93d4;  // 0.0033333334
    else if (roosters == needed-1)    p = _DAT_004e93d0;  // 0.033333335
    else if (roosters == needed-2)    p = _DAT_004dc84c;  // 0.05
    else if (roosters == needed-3)    p = _DAT_004e9170;  // 0.1
    else                              p = _DAT_004e90e0;  // 0.2
}
if (+0x38 == 0) p = +0x34 * _DAT_004e93c8 * 2;          // bonus levels / L35
if (+0x3c)      p = _DAT_004e93c0;                      // 0.02 fixed (L28/44/46/49)
if (rand01() < p) spawn one raven (FUN_0040123f);
```

`FUN_00422690` (mistakenly identified as "isProtected") is actually the **level-4 tutorial-hint dispatcher** that shows "The ravens want to steal your chickens..." and "Buy roosters to protect your chickens from the ravens" hints.

RoosterChick has NO unique fields, NO per-tick AI override, NO crow sound (no `SOUND_ROOSTER` exists), NO movement-speed delta (in C; presumably in external spec data). Type tag = 2 (rwg_functions.c:4679).

---

## 20. Sound triggers (24 confirmed, 16 used in rwg_functions.c)

Loaded at `rwg_functions.c:31740-31821`. Vtable `+0xc4` = one-shot SFX (PlaySample FUN_0044a8ef), `+0x168` = FUN_00408e96 (rwg:11264): play at most once per game tick — sound id looked up in Core +0x4c (FUN_0041062d), pushed + played if absent; list cleared by FUN_0044b4db at the start of Core::Update FUN_00405fcf (asm 0x405fd7, before the pause test, i.e. also while paused). Call sites: rwg:377 raven SOUND_KAR_KAR, rwg:645 wolf, rwg:3638 chick death, rwg:5848 FUN_00404d00 SOUND_SICK. JS: `FieldController.playSampleOncePerTick`, cleared in `GameView.update`.

Volume curves (JS `SexyApp.js`):
- SFX ✓ (audit round 5): DSoundManager FUN_00475fd0 (asm 0x475fd0-0x47600c) dB100 = ftol((log10(v·9.0 + 1.0) − 1.0)·2333.0); SetVolume FUN_0047600f re-hups playing slots (FUN_004775c5).
- Music ✓ (audit round 6): AudiereMusicInterface::SetVolume FUN_00477d50 → audiere.dll DSOutputStream::setVolume 0x10006e00 (float32) with conversion 0x10006490: v == 0 → −10000, else ftol(−ln(1/v)·1000.0); amplitude = 10^(dB100/2000).
- Music resume ✓ (audit round 5) ✓ (audit round 6): AudierePlayMusic FUN_004779ae; StopAllMusic FUN_00477b27 only calls stop(), which in audiere.dll (0x10007100 / 0x10006820) is IDirectSoundBuffer::Stop without rewind; play (0x10006c60) has no SetCurrentPosition → a stopped track **resumes from its position**; only reset() 0x10006ca0 rewinds.

| Resource | DAT | Key trigger sites |
|---|---|---|
| SOUND_CLICK | DAT_004fed84 | many UI confirm sites |
| SOUND_LEVEL_COMPLETED | DAT_004fedbc | FUN_00421948:41398 |
| SOUND_LEVEL_FAILED | DAT_004fed7c | FUN_00421a66:41452 |
| SOUND_CHICK_BUY | DAT_004fed80 | FUN_00409ba0:12495, asm 0x409c16-0x409c2e ✓ (audit round 3) |
| SOUND_CHICK_SELL | DAT_004fed90 | ShopDialog sell, asm 0x41fb12 (FUN_0041f94a) ✓ (audit round 3) |
| SOUND_EGG_REF | DAT_004fed78 | UNKNOWN |
| SOUND_ERROR | DAT_004fedac | FUN_0040490a:5457, FUN_0041e8f5:37736 |
| SOUND_SHOOT | DAT_004fed88 | FUN_0041050c:20189 |
| SOUND_SICK | DAT_004fed9c | FUN_00404d00:5846 |
| SOUND_CURED | DAT_004fed6c | FUN_0040490a:5463 |
| SOUND_EGG_LAYERED1/2 | DAT_00500624[0/1] | FUN_00407038:8758-8759 |
| SOUND_EGG_BROODED | DAT_004fedb4 | UNKNOWN |
| SOUND_CHICK_DEATH | DAT_004fed94 | FUN_0040344c:3638 |
| SOUND_CHICK_TO_RED_DIAMOND | DAT_004fed70 | FUN_00420e2e:40566 |
| SOUND_EAT_EGG | DAT_004feda8 | FUN_004077ae (magic chick eats egg, FUN_0040e392) ✓ (audit 2026-10-06) |
| SOUND_COLLECT_COIN | DAT_004fed74 | FUN_0040c262:14796 |
| SOUND_COLLECT_BLUE_DIAMOND | DAT_004fed98 | FUN_0040c2d2:14882 |
| SOUND_COLLECT_RED_DIAMOND | DAT_004fedb0 | FUN_0040c2e8:14900 |
| SOUND_COLLECT_EGG | DAT_004feda4 | UNKNOWN |
| SOUND_KAR_KAR | DAT_004fedb8 | UNKNOWN |
| SOUND_GAV_GAV | _DAT_004fed68 | UNKNOWN |
| SOUND_WOLF | DAT_004feda0 | FUN_00401543:645 |
| SOUND_FIELD_UPGRADE | DAT_004fed8c | FUN_00424a32:44949 |

---

## 21. Chick image dispatch (VERIFIED 2026-05-06)

Per `FUN_0040a166:12962-13030` action→image switch — corrected ✓ (audit 2026-10-06); every case indexes a per-type vector by chick type (+4). JS `Chick._getActionImage`.
- default (1) → `IDLE0_<type>`
- 2 (dig) → `IDLE1_<type>`
- 3, 5 (sick-start, cured) → `SICK_START_<type>` (DAT_00500644) — ~~LAYER_LAYER singleton~~
- 4 (sick-idle) → `SICK_IDLE_<type>` (DAT_005005c4) — ~~PREVIEW~~
- 6, 8 → `BROOD_START_<type>`; 7 → `BROOD_IDLE_<type>`
- **9 (lay) → `LAYER_<type>` lay image** (DAT_005005b4) — ~~DEATH~~
- 10 → `PECK_<type>` (DAT_00500674)
- 0xb → `WALK_<type>` (DAT_005005e4)
- 0xc → `IMAGE_CHICK_HOLY_SPELL` (singleton)
- **0xd (death) → `DEATH_<type>`** (DAT_00500574) — ~~SICK_IDLE~~
- Cel = ftol(elapsed/length × numCols), clamped; strip plays once per action (FUN_00409d5c asm 0x409e40-0x409e63).

Frame count is 1 column × N rows where N = `image.totalWidth / image.cellWidth`.

---

## 22. SelectLevelDialog (VERIFIED 2026-05-06)

HTML layout refined against screenshots 12/18/21: standard frame/title at
(178,77,444,445), START LEVEL footer, and native 74x36 PREV/NEXT art.
`dialogs.css` shares `.cc-range` between Options and the level slider. Navigation
uses y=height-107 and source x offsets 23/346 (`FUN_0041c860`:34937-34948).
`MainMenuView.js` adds an HTML slider listener, preserving 1..50 range and
clamping to unlocked levels (`FUN_0041c907`:34968-34979).

Legend rows use the actual single composited sprite cells, native coin/chicken
dimensions and existing broody egg tint. Screenshot 12 supplies coin labels
20/30, hyphens, periods and 300px text wrapping; screenshot 18 supplies egg
legends instead of chicken legends for level 2. Screenshot 21 supplies native
chicken previews for level 3. `HtmlDialogs.fillList` inserts ordinary HTML
labels; description and legend rows flow vertically, with an automatic gap
before legends and 46px reserved above the footer for navigation. This user-
authorized CSS adaptation prevents long browser text from overlapping icons.
The development
preview `?dialog=select-level&level=1` uses the real SelectLevelView with all 50
levels accessible; START LEVEL only dismisses and does not alter progression.
Large later-level enemy/pet icons are proportionally scaled to 64x56px in
`MainMenuView.js` to keep them inside the legend cell (user-reported overflow on
level 27). Native 64px egg cels and smaller previews keep their original size.
Wolf resources in `Res.js` use the native 135x110 cel boundaries: walk.jpg is
1350x110 (10 columns), eat.jpg is 1755x110 (13 columns). The prior 9-column
metadata cropped part of the next wolf into the legend and gameplay animation.

`Sexy::SelectLevelDialog` constructor `FUN_0041c48a:34676`. Box `(178, 77, 444, 445)` from `FUN_0041c860:34755`.

Layout:
- PREV button: rel (23, 338) — uses `IMAGE_BUTTON_PREV` (DAT_00500004)
- NEXT button: rel (346, 338) — uses `IMAGE_BUTTON_NEXT` (DAT_00500008)
- Slider: centered horizontally at y=338 — range `0.0..1.0` mapped to `levels 1..50` via `_DAT_004e92f8 = 49.0f`

Title (this[0x27]) = current level number (formatted via `FUN_0042c787`). Body (this[0x35]) = `FUN_0042399c(level)` per-level intro text. Footer button (this[0x2e]) = "START LEVEL".

Max unlocked level = `min(50, completedLevelCount + 1)` via `FUN_0041614b:28638`. **Introduction-vs-SelectLevel gating** in `FUN_0041d22e:35567`: shows IntroDialog only when `maxUnlocked == 1` (no levels completed yet); otherwise SelectLevelDialog directly.

~~No level thumbnails exist~~ — **level description pictures** ✓ (audit round 3): loader FUN_00417990 (@0x419aa6-0x419bee) loads "IMAGE_LEVEL_DESC_%i" (.rdata 0x4de9fc) into DAT_00500594[level] for levels {1,2,3,4,5,6,7,9,10,12,15,17,19,21,22,24,26,27}; SelectLevelDialog::Draw FUN_0041ca58:35043-35070 (@0x41cae8-0x41cb08) draws it when non-null, centred, y = dialog+0x16c+0xc3. The picture holds the icons and "- …" texts — it **replaces** the hand-made HTML legend rows described above (no source). PREV disabled when level < 2, NEXT when level > 0x31 (FUN_0041c62e:34810-34812); NEXT at last unlocked level just ignores the press (FUN_0041c98e:35015-35021). JS `MainMenuView.js`.

---

## 23. Field rendering (VERIFIED 2026-05-06)

- **Single static background**: `IMAGE_GAME_BACK` (DAT_004fff30, line 30958-30962). Drawn first by `FUN_004248b4:44841`. **NO per-level swap.**
- 17 cell-decoration images at `DAT_00500564` (loaded line 30965-30977) — runtime-named via `FUN_0042c787`. Drawn after bg by the same render fn.
- Field bounds: `_DAT_004e9140` = 128.0, `_DAT_004e9144` = 72.0 (clamp FUN_00408149:10260); wander y capped at 57.0 (`_DAT_004e9138`). See §27.
- **Depth-sorted render list** — ~~No Y-sort~~ ✓ (audit 2026-10-06). `FUN_0040a3d6`:13092 order: (1) background + decorations FUN_004248b4 (:13310), (2) dog (:13318-13330), (3) seeds (grounded immediate, airborne queued), (4) chicks queued with key = field y (held chicks immediate; hungry icon max 5/frame, asm 0x40a7a0-0x40a83f; shadows immediate), (5) eggs/gems/pets queued, (6) list sorted by key (FUN_0041763c = std::list::sort, stable), (7) holy spell effects (:13570-13602) and ravens (:13606-13627) appended with FUN_0040913d, (8) overlay pass (flag +0x10 ≠ 0) in insertion order: held chicks, spells, ravens (:13628-13657). FUN_004090ec queues {img,x,y,key,flag 0}, FUN_0040913d {img,x,y,0,flag 1} (:11553/11590). Pet/wolf key = pet +0xc (field y). JS `Field.draw` ✓ (audit round 3).
- **Update order** `FUN_00405fcf`:7445-7480 (only when state+4 == 0): elapsed++ (:7468) → ravens FUN_004015f8 → world FUN_004043fd → seeds FUN_0041bec7 → eggs FUN_00406c85 (lay spots FUN_00407550 first) → gems FUN_0040c36e → spell fx FUN_00420d2a → … → pets FUN_00410116 → inflation FUN_0041ea9a → hint FUN_0040d281 (:7472) → risk FUN_0041b901 (:7477) → hand FUN_0040cc71 → tasks FUN_00421b21. **Hand ticks once per unpaused frame** (FUN_0040cc71 inside the game tick). JS `FieldController.update`, `Field.update`, `GameView.update` ✓ (audit round 3).
- **Holy spell fx list** (Field +0x38): entry {timer 0, pos} pushed by FUN_00420e2e (asm 0x420eeb-0x420f41); FUN_00420d2a:40470 timer += 0.015f, removed when > 1.0 (asm 0x420d86-0x420d96); drawn in overlay pass. JS `Field.mSpellFx` ✓ (audit round 3).
- `FUN_004046aa:5257` random field point: 48 samples of a random 16×9 cell (8 units each), **the last sample is used** (min tracked but unused); x = cx×8 + mt%8, y = cy×8 + mt%8, y ≤ 57. ~~1,000,000 iterations / lowest occupancy~~ ✓ (audit 2026-10-06)
- **Dog**: `IMAGE_DOG`, `IMAGE_DOG_IDLE0/1` (DAT_00500654, cel width 0x6f = 111, rwg:31716-31739). Tick `FUN_004091b8`:11653 from GameView::Update: timer--; at < 1 state = (state == 0 ? rand()%3 : 0), timer = DAT_004dcd88[state] = **{2000, 200, 150}**; drawn at **(358, 226)** (0x166, 0xe2) right after the background (:13318-13330). JS `Field.js` `Dog`. ~~111-tick frame duration~~ ✓ (audit 2026-10-06)
- No sky/clouds.
- `IMAGE_UFO` (DAT_00500024, line 31627) — for raven-attack intro animation.

---

## 24. UpgradesView & upgrades (new, ✓ audit 2026-10-06)

JS: `UpgradesView.js`, `UpgradeSelectDialog.js` (HTML dialog), `Core.js` (player upgrade set), `CreditsView.js` (`drawFieldBackground`, `DECORATION_POS`).

**Upgrades = field decoration ids 0..16 only.** Upgrade id i = decoration i = `IMAGE_GAME_BACK_UPGRADE<i>` (DAT_00500564[i]) = dialog icon `IMAGE_UPGRADE_PREVIEW<i>` (DAT_00500614[i]). There are no house/seed/gun upgrade effects in the original (JS `UPGRADE_TIERS` ✗ invented; Core.js invented `upgrades` string keys dropped).

| Behavior | Source | JS |
|---|---|---|
| Upgrade offered on first completion of L3,6,9,…,30,34,37,40,43,46,49,50 | `DAT_004de0f0` int[51] (.data), FUN_00421948:41359-41366 (asm 0x421992-0x4219b2) | `UPGRADE_LEVEL_TABLE`, `levelOffersUpgrade` |
| Flag = player && level ≤ 50 && table[level] && maxUnlocked(before) ≤ level | FUN_00421948 asm 0x421987-0x4219b4 | `levelOffersUpgrade` |
| Available upgrades: ids 0..14 not owned whose prerequisite (DAT_004de1c0) is −1 or owned; if > 14 owned add 15, 16 | FUN_00416162:28665-28760 (table :28704) | `Core.getAvailableUpgrades` |
| Player upgrade **list<int>** (+0x30) in **purchase order** (push_back FUN_0040ca85, no duplicate check; find FUN_0041062d linear), ids < 0x11 — ~~set<int>~~ | FUN_00410be5:21039, :21157; copy FUN_00408234:10397 → FUN_0040821a | `Core.upgradeIds` ✓ (audit round 4) |
| Add upgrade (push_back FUN_0040ca85) + save FUN_00410f28 | FUN_00423f5c:44035 | `Core` ✓ (audit round 4) |
| Show view (hide GameView, add UpgradesView, setup) | GameApp FUN_00408c24:11047 | `GameApp.showUpgrades` |
| Ctor / fields (+0x88 CONTINUE, +0x8c next level, +0x90 decorations, +0x9c new id, +0xa0 counter, +0xa4 blink) | FUN_0042474a:44684-44727 | ctor |
| CONTINUE button Resize(600, 520, 150, 40) | FUN_004249b4:44886 | ctor |
| Setup: 0 available → show result −1; 1 → give it directly; else UpgradeSelectDialog | FUN_00424a7f:44956 (asm 0x424a7f-0x424b5a) | `setup` |
| Dialog select: SOUND_CLICK, copy decorations, show result, add upgrade | FUN_004244a0:44370-44420 | `_onDialogSelect` |
| Show result: CONTINUE visible, SOUND_FIELD_UPGRADE | FUN_00424a32:44930 (asm), DAT_004fed8c | `_showResult` |
| New decoration blinks: period 0x28 ticks until 0x168 ticks, then steady | FUN_00424838:44773-44788 | `update` |
| Draw field bg + decorations (+ new one when blink on) | FUN_0042486f:44798-44812 → FUN_004248b4:44818 (positions table 0x4fc430) | `draw` |
| CONTINUE → FUN_004088d0(next level) | FUN_00424a1c:44915-44925 | `buttonDepress` |
| Dialog box (150,150,500,300), 98x98 buttons | FUN_00423f8a:44055, FUN_0042434b:44153/44337-44361 | `UpgradeSelectDialog.js` |
| Pick 3: copy list; while copy non-empty and result < 3: n = rand()%size, push copy[n], erase → dialog list +0x16c (one button per entry; screenshot 25 = 3 of {0,1,2,5}) | FUN_004245c2:44532 (@0x4245c2-0x424660), from ctor @0x42404e | `pickUpgradeChoices` ✓ (audit round 3) |

---

## 25. Hints & LevelTutorial (new, ✓ audit 2026-10-06)

JS: `HintController.js` (`HintController` text bar + `LevelTutorial` dispatcher), ticked by `GameView.update`.

| Behavior | Source | JS |
|---|---|---|
| HintController allocated per level (game+0x2c, 0x40 bytes, empty text) | FUN_00406069 rwg:7621-7635 | ctor |
| setText(text, point, duration) | FUN_0040d39f:16291 | `setText` |
| Tick: typewriter 1 char / 3 ticks (DAT_005352c0), pointer bob, timeout | FUN_0040d281:16241 (from :7472) | `update` |
| Visible substring | FUN_0040d4cc:16423 | |
| Draw bar + pointer up/down | FUN_0040a3d6:13930-13965 (asm 0x40b973-0x40ba8f) | `draw` |
| Modal HintDialog (pause) / close → unpause | FUN_0040d435:16346 / FUN_0040d4bb:16402 | `showDialog` |
| "Don't show" checkbox → player +0x1c = !checked, save | FUN_0040d875:16741 | dialog OK |
| Level-start hint init | FUN_0042166f:41196-41221 | |
| Dispatcher: FUN_00422a24 first, then L1..5 handlers, else generic | FUN_00421b21:41522-41530 → FUN_00422036:41919 | `LevelTutorial.tick` |
| Per-level modal tutorials (cases L1,2,3,5,6,7,9; gated by player +0x1c) | FUN_00422a24:42648 → FUN_00422bb1:42774 | |
| L1 coins / buy-chicken bar hints | FUN_0042207d:41956 | `_level1` |
| L2 egg / sick hints; enables sickness (+0x264 = 1) and starts a sick event | FUN_00422228:42050 (:42152) | `_level2` |
| L3 hatch hints | FUN_004224e0:42262 | `_level3` |
| L4 raven warning (modal) + buy roosters | FUN_00422690:42349 | `_level4` |
| L5 sell hints | FUN_00422749:42398 | `_level5` |
| Generic: more roosters / crowded / magic eggs / hungry | FUN_00422802:42469 (FUN_0042290d, FUN_00422990) | `_generic` |
| Presentation table (bar point/duration vs dialog) | asm call sites | `HINT_PRESENTATION` |

Note: L5 modal "Sell chickens to earn $5,000" is unreachable in the original too (food ratio ≥ 4.5 never happens, FUN_00404f23:6054).

---

## 26. App flow, Credits roll & win screen (new, ✓ audit 2026-10-06)

JS: `GameApp.js`, `CreditsView.js`, `MainMenuView.js`.

| Behavior | Source | JS |
|---|---|---|
| App ctor "Chicken Chase" 1.0, 800x600 | FUN_0040826e:10436-10475 | GameApp ctor |
| Init / loading / done | FUN_004084d8:10593, FUN_0040860b:10657, FUN_0040874e:10730 | `init` |
| TitleScreen draw: black fill; IMAGE_PROGRESSBAR_BACK at ((w−back.w)/2, h/2−0x1e); n = ftol(progress·14.0+0.5) IMAGE_PROGRESSBAR cels, step = bar.w+3, x0 = w/2 − step·14/2, y = h/2 (int division) | FUN_00423e95:43997-44028 (@0x423e95-0x423f59) | `_drawLoadingScreen` ✓ (audit round 3) |
| Main menu + main music | FUN_00408799:10760 (:10801-10805) | `showMainMenu` |
| SelectLevelView with arg (hides UpgradesView/GameView; no music change) | FUN_004088d0:10840 | `showSelectLevel` |
| AddedToManager: 1000 → credits roll; maxUnlocked == 1 → IntroductionDialog; ≤ 50 → SelectLevelDialog; ≥ 51 → win roll | FUN_0041d22e:35539-35587 | `showSelectLevel` |
| Start level: Core::StartLevel + GameView + random game0/game1 music | FUN_00408dae:11129 (:11141-11147) | `startGame` |
| Options RESTART: reset + StartLevel only (no music re-roll) | FUN_0040fe56:19603-19609 | GameView |
| Level-exists flag (Core+4): set by StartLevel `FUN_00406069`:7514, freed/nulled only by `FUN_00406389` (@0x406563) from Options MAIN MENU (FUN_0040fe56:19601); gates RESTART | FUN_00406069, FUN_00406389 | `GameApp.mLevelExists` ✓ (audit round 4) |
| Game tick `FUN_00405fcf`:7464-7480 (unpaused): field/controllers … hint FUN_0040d281 (7472) → risk FUN_0041b901 (7477) → hand FUN_0040cc71 (7478) → **level update FUN_00421b21 last** (7479). Then input poll FUN_004093d9 (paused or not) and dog FUN_004091b8. FUN_0040907e (space) runs first, in both branches ✓ (audit round 5) | FUN_00405fcf, FUN_00409372 (asm 0x4093ac) | `GameView.update`, `FieldController.runLevelUpdate` ✓ (audit round 4) |
| Chicken list count (field+8, `FUN_00404ad0`:5619) used by tasks (FUN_00421bc4), fail reason FUN_00421a66:41443, bonus count FUN_00423cb3/FUN_00423d5b, raven roll | FUN_00404ad0 | `FieldController._chickListCount` ✓ (audit round 4) |
| Unlock next level / record time gated by `FUN_00402839` (rwg:2532) = "current player iterator != end()" (player selected) | FUN_00421948:41359-41372 | `FieldController` ✓ (audit round 4) |
| Focus lost / regained → pause (hand mode 0) / resume | FUN_00408e2f:11193, FUN_00408e62:11220 | GameApp |
| Mute on focus loss: RehupFocus with mMuteOnLostFocus (+0x3f9 = 1) → Mute(true) then LostFocus; gain → Unmute then GotFocus. mMuteCount app+0x3f0 (Mute ++, Unmute -- not below 0); while > 0 SetMusicVolume FUN_0044a9ff / SetSfxVolume FUN_0044aa3c push 0 ✓ (audit round 5) | FUN_00446c61, FUN_0044a963, FUN_0044a9a8 | `GameApp.js`, `SexyApp.js` |
| Main loop catch-up: acc = min(acc + elapsed, **200 ms**) (_DAT_004e90b8); update while acc ≥ 10 ms and ++mNonDrawCount < 10 (_DAT_004e90d8) → **≤ 9 updates per draw**; frame = 1000/100 (mSyncRefreshRate +0x574 = 100) ✓ (audit round 5) | FUN_00448fd5, FUN_00448f74 (asm 0x449263-0x44928c) | `SexyApp.js` |
| Level end can **repeat**: FUN_00421948 / FUN_00421a66 only pause (+4 = 1, +0xd = 0, hand 0) and AddDialog id 0 (FUN_00441f11 kills the open id-0 dialog first); if space unpauses under the dialog, the next full tick trips FUN_00421b21 again. No frozen flag; tick body never re-reads +4 ✓ (audit round 6) | FUN_00421948:41348, FUN_00421a66:41431, FUN_00441f11, rwg:7465-7479 | `FieldController.js`, `GameView.js` |
| Tick-order equivalence: JS runs inflation FUN_0041ea9a / money effects FUN_0040686e before the world update and the hint FUN_0040d281 after pets, unlike rwg:7470-7476 (… eggs FUN_00406c85 → gems FUN_0040c36e → hint → inflation → spell FUN_00420d2a → money fx → pets); no visible effect. Eggs are updated **before** gems (two passes over mGems) ✓ (audit round 5) | FUN_00405fcf | `Field.js`, `FieldController.js`, `GameView.js` |
| Chick ctor tail (wander pick / walk start, FUN_004032ca:3481-3497) runs **before** list insert FUN_0040528b — for hatch and purchase (JS `_runCtor`, `_ctorPending`) ✓ (audit round 5) ✓ (audit round 6) | FUN_00403ff5, FUN_004032ca | `Chick.js`, `Field.js`, `FieldController.js` |
| Hand reset after cure: after FUN_0040490a (affordable or not) FUN_0040cc01(hand, 0) ✓ (audit round 6) | asm 0x40d1af-0x40d1b4 | `FieldController.js`, `GameView.js` |
| Volumes default music 0.6 / sfx 0.85 | FUN_00440396:77186/77188 | Core / SexyApp |
| Credits roll (state 4, bg flag 1), roll step / states; roll position +0x90 and draw line cursor are float32 (`Math.fround`, @0x41cbb9-0x41cc91, @0x41d0b7) | FUN_0041d395:35692, FUN_0041cb58:35106, FUN_0041cb16:35075, FUN_0041cce4:35204 | `CreditsView` ✓ (audit round 4) |
| Win sequence (state 0: win text → UFO → alien letter → UFO → credits) | FUN_0041d22e (param ≥ 0x33); texts FUN_0041d723:35923, FUN_0041d828:35977 | `CreditsView` mode 'win' |
| Credits names/roles | FUN_0041d469:35799 (x 100), FUN_0041d5c6:35861 (x 300) | `CreditsView` |
| OK button (300, 500, 200, 32), → main menu | ctor :35291-35295 asm 0x41cdd3; FUN_0041d3e0:35735-35758 | `CreditsView` |
| Image cel fix-up: listed images rows = 1, cols = w/h (FUN_00417990:30841-31760); pets/dog cols = w/celWidth (FUN_0041a5b6:31939; mouse 0x46, elephant 0x64, wolf 0x87, dog idle 0x6f) | FUN_00417990, FUN_0041a5b6 | `Res.js` CELS_FROM_HEIGHT / CEL_WIDTH ✓ (audit round 3) |
| NewPlayer: Enter in edit box = FUN_0040f47e → ButtonDepress(1000); ButtonDepress FUN_0040f3c5:18887 plays SOUND_CLICK for any button, empty name → nothing; AllowChar FUN_0040f43e:18956 rejects space and `# $ % & ( ) * + - . : @ ^`; no trimming, no invented error texts | FUN_0040f47e, FUN_0040f3c5, FUN_0040f43e | `PlayerDialogs.js` ✓ (audit round 3) |
| Shift+ESC → app vtable+0xa0 = FUN_00408f0e (ShellExecute + Shutdown) — no-op in browser; ESC alone → MENU | asm 0x40946b-0x4094a5 | `GameView.js` ✓ (audit round 3) |
| GAME PAUSED (FONT_24) centred at y = h/2 = 300; "press space to continue" (FONT_20) at y = 400 | asm 0x40bb0b-0x40bb29 / 0x40bb5f-0x40bb80 | `GameView.js` ✓ (audit round 3) |
| HintDialog "Don't show" checkbox visibility = 2nd arg (FUN_00422bb1 passes 1, L4 raven hint passes 0) | FUN_0040d557 asm 0x40d602-0x40d613 | `HintController.showDialog` ✓ (audit round 3) |
| Players: create/select/delete/load; best time over players | FUN_00415924:28059, FUN_0041580b:27945, FUN_0041585b:27983, FUN_00415c5f:28307, FUN_0041111b:21406, FUN_0041605e:28586 | `Core.js` |

---

## 27. Field ↔ screen mapping (new, ✓ audit 2026-10-06)

All field objects (chicks, seeds, ravens, pets, wolves, eggs, gems) live in **field units**: x 0..128, y 0..72, z = height. Clamp `FUN_00408149`:10260 (`_DAT_004e9140` = 128.0, `_DAT_004e9144` = 72.0; z ≤ 0 → 0).

- Projection `FUN_00409567` (asm 0x409567-0x4095cc): **screenX = ftol(6.0·x + 0.5) + 10, screenY = ftol(2.8·y − 6.0·z + 0.5) + 367** (matrix `_DAT_004fc3ec..4fc400`, origin `_DAT_004fc3e4/e8`). The y factor `_DAT_004fc3f8` is **float 2.8f = 2.799999952316284** (read from .data) ✓ (audit round 4).
- Inverse (mouse) `FUN_00409533`:11965: x = (float)((sx − 10)/6.0f), y = (float)((sy − 367)/2.8f) (float32 results, ✓ (audit round 4)).
- JS: `Field.js` `fieldToScreen` / `screenToField`; used by Chick.js, Pet.js, Gem.js, RiskController.js.
- Random spawn point `FUN_00408107`:10260 (rand%128, rand%72); pet wander `FUN_00410471` (rand%128, rand%57).
- Distances: 2D Chebyshev `FUN_00403c97`:4316, 3D `FUN_004050cf`:6203; normalise `FUN_00403cdf`:4344.
- RNG: Mersenne twister `thunk_FUN_00429891` masked 0x7fffffff; CRT `rand()` FUN_004a082c; rand01 = rand()/32767.0 (`FUN_00401148`:203).

---

## 28. Special shop items (new, ✓ audit 2026-10-06)

JS: `LevelData.js` `SHOP_ITEMS` / `SHOP_ITEM_LIST`, `FieldController.js` special-shop section, `ShopDialogs.js`.

| id | Image (DAT_005005d4, rwg:31518-31538) | List | Effect on buy (FUN_0041ebd3:38003) |
|---|---|---|---|
| 0 | SEEDS_COUNT1 | seed (app+0x1c)+0xc | seed ctl +0x20 = 1 (9 seeds/click) — FUN_0041c3c6:34581-34607 |
| 1 | MOUSE | pet (app+0x44)+0xc | spawn Mouse — FUN_00410223:19917 |
| 2 | SEEDS_CALORIES1 | seed | seed ctl +0x1c = 1 (calorie tier) |
| 3 | GUN_AREA | weapon (app+0x40)+4 | (app+0x40)+0x10 = 1 (aim 20 px) |
| 4 | ELEPHANT | pet | spawn Elephant |
| 5 | SEEDS_COUNT2 | seed | seed ctl +0x20 = 2 (12 seeds/click) |
| 6 | SEEDS_CALORIES2 | seed | seed ctl +0x1c = 2 |
| 7 | GUN_POWER | weapon | (app+0x40)+0x11 = 1 (double damage) |

- Shop list `FUN_0041eae5`:37926: seed list → [2 if present else 6 if present] (FUN_0041c25e:34473) + whole weapon list (FUN_0040c998) + whole pet list (FUN_00410209). Same list used by RiskCaseOffensive (FUN_0041aeaf).
- Buy `FUN_0041eb94`:37974: money < price → "You don't have enough money." (rwg:40388); else apply, spend, price ×2 (floor 250). Row: image DAT_005005d4[id], description DAT_005003a0[id] (rwg:40142), names std::string at 0x500480 (initializer not found — literals matched from .rdata 0x4dd930-0x4ddaf0), price "FREE" when < 1 (:40145).
- Row layout (dialog-relative, FUN_00420758 asm 0x420758-0x420956): rowTop = row*0x74+0x82; slot IMAGE_SHOP_SLOT_BIG (DAT_004fff90) at (20, rowTop); icon 98x98 at (26, rowTop+5); description WriteWordWrapped Rect(145, rowTop+25, 220, 100), spacing -1, justification -1 (left), FONT_DLG_LINES white; price FONT_8 DrawString (52, baseline rowTop+102). PAGE label baseline 95 centred (asm 0x42068e). BUY (376, 165+row*116) 100x30 (FUN_00420a27:40271). JS `styles/dialogs.css` `.cc-box-shopbuy`.
- Unlocks per level: `FUN_00423d75(N)` (§6). Seed quality tier → food multiplier DAT_0050031c = {1.0, 1.3, 1.6} (seed +0x2c); JS 30/50/80 are only internal tags ✓ (audit round 3).

---

## 29. Sickness model (new, ✓ audit 2026-10-06)

JS: `Field.js` (world timer), `Chick.js` (infect/cure), `FieldController.js` (cure click), `RiskController.js` (flu).

| Behavior | Source | JS |
|---|---|---|
| World flags: +0x264 sickness enabled (L1 = 0), +0x268 sick timer, +0x26c fast sickness (L31) | FUN_00404022:4787-4797 | `Field` ctor |
| Sick period by chick count: ≤10 [6000,9000), >10 [4000,7000), >15 [3000,5000), >20 [1500,3000), >40 [1000,2000); halved if +0x26c | FUN_00404caf (asm 0x404caf-0x404cff) | `_sickPeriod` |
| Periodic event: timer < 0 → reset, pick rand()%n among chicks passing vt[3] (Layers only) | FUN_004043fd:5096-5132 | `Field.update` |
| Infect: if +0x264 and vt[3]: SOUND_SICK; state 1, action 3 | FUN_004040ec + FUN_00404d00:5815-5846 | `_makeSick`, `Chick.infect` |
| Sick event (tutorial L2, flu ×k) | FUN_00404d6d:5870 | `startSickEvent` |
| Cure: click sick chick in cure mode, $50, SOUND_CURED, action 5, +0x38 = 2000 | FUN_0040cc71 (cure gate rwg:16144) → FUN_0040490a:5432 → FUN_00403403:3510 | `FieldController` cure, `Chick.cure` |
| Death when sick counter +0x38 runs out | FUN_0040344c:3633-3638 | `Chick.update` |

Hunger is separate (§11). The old FieldController random-sickness stand-in is to be removed.

---

## 30. Seeds (new, ✓ audit 2026-10-06)

Seed = 0x30-byte object in seed list (fc+0x1c). Create `FUN_0041bfe2`:34292 / `FUN_0041c0a8`:34339 / `FUN_0041bdcb`:34089; update `FUN_0041be18`:34129 (vz −= 0.05, pos += vel, clamp); list update `FUN_0041bec7`:34202. Fields: claim countdown, claiming chick id, pos (z = 10.0 at drop), vel, +0x20 calorie level (image FUN_0040a0ed), +0x24 calories = FUN_00405899 (500/700), +0x28 life = (mt%300)×2 + 0x4b0, +0x2c multiplier DAT_0050031c = {1.0, 1.3, 1.6}. Draw FUN_0040a3d6:13328-13366. JS `Field.js` `SeedCluster`.

---

## 31. Open UNKNOWNs (grep "UNKNOWN" src/*.js after audit round 6, js commit 4e1da30; line numbers drift) ✓ (audit round 6)

| File:line | Item |
|---|---|
| DialogPreview.js:262 | sample upgrade item name (preview only) |
| LevelData.js:98 | special item 5 name literal |
| RiskController.js:91 | initializer of item-name strings at 0x500480 |
| (not in JS grep, carried over) | raven ctrl +0x34/+0x38 bonus path; L18/L40/L43/L44/L49 text-only rules |

(Field.js:40 only mentions an old, retracted UNKNOWN.)

Resolved in rounds 5/6 (dropped): app+8 (= DAT_004fe6e0, always 1 → Fullscreen checkbox visible); space toggling pause with a dialog open (ported, FUN_0040907e + FUN_00438a14); music volume curve (audiere.dll 0x10006490).

Resolved in round 4 (dropped): FUN_00402839 gate (= player selected), MENU/SELL/BUY label font (DialogButton FONT_DLG_BUTTONS), Hand `isOverField` (removed), PlusTime on bonus levels (proved never applies), field +0x264 (sickness enable, FUN_004040ec:4838), (app+0x28)+0x1c no coins (FUN_0040c4d9), money obj +0 / (app+0x24)+0x28 (no money / eggs pay nothing, FUN_00424b5d asm 0x424b63, FUN_004072fa asm 0x407395).
