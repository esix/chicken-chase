// Port of the per-level setup of the original game.
//
// Sources (rwg_functions.c unless noted; addresses verified against the
// binary app/chicken_chase.RWG with llvm-objdump where Ghidra lost register
// arguments — ESI slot indices of FUN_0040bfb3, the AL 4th flag of
// FUN_00423c04 and the EAX time argument of FUN_00423cb3):
//   FUN_0042166f:41154  level object ctor. Spawns the starting chickens
//                       (41259-41300) then calls FUN_00422c01 and FUN_00422d10.
//   FUN_00422c01:42818  per-level defaults (buy slots, start money, raven ctrl).
//   FUN_00422d10:42903  the 50-case switch (case lines 42994..43535).
//   FUN_00423c04:43776  chick-type enable flags (broody, rooster, magic, holy).
//   FUN_00423cb3:43817  bonus ("protect your chickens") level helper.
//   FUN_00423d75:43887  unlock special-shop items 0..N.
//   FUN_00423deb:43926  spawn free layers until the farm has N chickens.
//   FUN_00423e5a:43969  "$5,000 budget" helper (L34, L37).
//   FUN_0042399c:43549  level description strings.
//
// Objects referenced by the switch (FUN_00401165() = game state, re-created
// for every level start by FUN_00406069:7496 via FUN_00408dae:11129, so any
// field a case does not write keeps its constructor / FUN_00422c01 default —
// there is NO inheritance between levels):
//   +0x0c money obj  (ctor 7528-7535, +8 = 0xffffffff at 7533): +0 byte flag, +4 money, +8 cap (-1)
//   +0x10 raven ctrl (FUN_00401202:284): +0x0c wolves/wave, +0x10 wolf HP
//                    (asm 0x4015c7 → FUN_00410299 arg3 → FUN_00424be6 +0x38),
//                    +0x14 ravens/wave, +0x18 raven HP (asm 0x40128f → raven
//                    +0x44), +0x1c ravens at once (FUN_004014eb:597), +0x34
//                    float, +0x38 delay (cs), +0x3c fixed-chance flag, +0x40
//                    raven speed (asm 0x401288 → raven +0x4c)
//   +0x14 field      (FUN_00404022:4765): +0x24c 5-bit chick-type bitset (all
//                    set by ctor loop 0x4040b4-0x4040dd), +0x264, +0x26c,
//                    +0x270 broody-egg cap (-1)
//   +0x30 store      (FUN_0041e7f2): +4 price-rise flag (0), +8 buy-slot
//                    vector (8 bytes/type, dword = remaining buys, -1 =
//                    unlimited, 0 = none), +0x18 SELL button (1), +0x19 BUY
//                    button (1)
//   +0x48 RiskController (FUN_0041b569): +8 enabled (1)
//   level object (param_1): +0x14 bonus flag, +0x48 ACE TIME in seconds
//                    (read at FUN_0040dde4 0x40df31-0x40df37: ×100 → cs),
//                    +0x50 bonus chick count
//
// Chick type ids (FUN_00403ec2:4623): 0 layer, 1 broody, 2 rooster,
// 3 magic, 4 holy.
//
// Times: the original stores task 0xc / 0xd in centiseconds (42000 = 7 min,
// L7 description "7 minutes"). This port's FieldController counts ms
// (mTimeElapsed += 10 per 100fps tick), so targets are converted ×10.

// Task ids = index into the level task vector (FUN_0041b4bd:33314, 0x14 bytes
// per entry; icons assigned in FUN_0042166f:41226-41249).
export const TaskType = {
    COLLECT_COINS: 0,          // IMAGE_MISSION_COIN (DAT_004fffc8)
    COLLECT_BLUE_DIAMONDS: 1,  // DAT_004fffcc
    COLLECT_RED_DIAMONDS: 2,   // DAT_004fffd0
    EARN_MONEY: 3,             // DAT_004fffd4
    COLLECT_WHITE_EGGS: 4,     // DAT_004fffd8
    COLLECT_BLUE_EGGS: 5,      // DAT_004fffe8 (magic egg image)
    COLLECT_RED_EGGS: 6,       // DAT_004fffec (holy egg image)
    COLLECT_BLACK_EGGS: 7,     // DAT_004fffe4 (rooster egg image)
    RAISE_CHICKENS: 8,         // DAT_004ffff0
    HATCH_MAGIC: 9,            // DAT_004ffff4
    HATCH_HOLY: 10,            // DAT_004ffff8
    RAISE_ROOSTERS: 11,        // DAT_004ffffc
    TIME_LIMIT: 12,            // DAT_00500000 (time icon), centiseconds
    // Task 0xd: only written by FUN_00423cb3:43842 (bonus levels), same time
    // icon DAT_00500000 (41249). The previous name EARN_MONEY_TIMED was not
    // supported by the decompiled source (and was unused).
    BONUS_TIME: 13,
};

export const TOTAL_LEVELS = 50; // switch cases 1..0x32 (FUN_00422d10:42993)

// Chick type order used by buy slots / type bitset (FUN_00403ec2:4623).
const TYPE_KEYS = ['layer', 'broody', 'rooster', 'magic', 'holy'];

// Special-shop item ids unlocked by FUN_00423d75 (loop i = 0..N inclusive,
// 43895-43907; asm 0x423d75-0x423de8) or pushed directly (L6/L7 FUN_0040ca85).
// Identity of every id is fixed by the item image table DAT_005005d4 filled
// at rwg_functions.c:31518-31538 in id order: "SEEDS_COUNT1", "MOUSE",
// "SEEDS_CALORIES1", "GUN_AREA", "ELEPHANT", "SEEDS_COUNT2",
// "SEEDS_CALORIES2", "GUN_POWER" (IMAGE_OFFENSIVE_<name>), and by the effect
// of buying it:
//   FUN_0041c3c6 (34581): seed list — 2 → seed ctl +0x1c = 1, 6 → +0x1c = 2,
//                         0 → +0x20 = 1, 5 → +0x20 = 2 (+0x20 = index into
//                         DAT_0050034c seeds-per-click {5,9,12}).
//   FUN_0041ebd3 (38003): weapon list — 3 → (app+0x40)+0x10 = 1 (gun area),
//                         7 → (app+0x40)+0x11 = 1 (gun power).
//   FUN_00410223 (19917): pet list — 1 → FUN_00410299 type 0 (mouse),
//                         4 → type 1 (elephant) (asm 0x410273-0x41028b).
// The list each id lives in (asm of FUN_00423d75): 0/2/5/6 → (app+0x1c)+0xc,
// 3/7 → (app+0x40)+4, 1/4 → (app+0x44)+0xc.
export const SHOP_ITEMS = ['SEEDS_COUNT1', 'MOUSE', 'SEEDS_CALORIES1', 'GUN_AREA',
    'ELEPHANT', 'SEEDS_COUNT2', 'SEEDS_CALORIES2', 'GUN_POWER'];
// Item names: std::string array at 0x500480 (+id*0x1c), read by FUN_0041aeaf
// (asm 0x41af79-0x41af7f); descriptions: std::string array DAT_005003a0
// (+id*0x1c), drawn per row by FUN_00420758:40142. Its initializer is
// not reachable in the decompiled code or the disassembly (no code references
// the literals), so the names below are the .rdata literals at
// 0x4dd930-0x4dd99c matched to ids by their description literals at
// 0x4dd9ac-0x4ddaf0 (e.g. "Increases damage area of the weapon." = GUN_AREA).
// Item 5 has no literal of its own: UNKNOWN — not found in decompiled
// (assumed to reuse the merged "Seed upgrade" literal).
// list: which original list the id belongs to (see above).
export const SHOP_ITEM_LIST = [
    { id: 0, list: 'seed',   name: 'Seed upgrade',            desc: 'Throw more seeds with each click.' },
    { id: 1, list: 'pet',    name: 'Mouse',                   desc: 'Collects coins and diamonds in the field.' },
    { id: 2, list: 'seed',   name: 'Longer-lasting seeds',    desc: 'Seeds have more sustenance so you don\u2019t have to feed the chickens as often.' },
    { id: 3, list: 'weapon', name: 'Weapon upgrade',          desc: 'Increases damage area of the weapon.' },
    { id: 4, list: 'pet',    name: 'Elephant',                desc: 'Protects chickens from ravens and wolves.' },
    { id: 5, list: 'seed',   name: 'Seed upgrade',            desc: 'Throw the maximum amount of seeds with each click.' },
    { id: 6, list: 'seed',   name: 'Longest-lasting seeds',   desc: 'Seeds have the most sustenance available.' },
    { id: 7, list: 'weapon', name: 'Weapon strength upgrade', desc: 'Doubles weapon power.' },
];

// ---------------------------------------------------------------------------
// Raw per-level data, transcribed from FUN_00422d10 (asm 0x422d64-0x4238c3).
//   tasks  : [[taskId, target], ...] as written via FUN_0041b4bd(id) = target
//   types  : FUN_00423c04(broody, rooster, magic, AL=holy); null = not called
//            (all 5 bits stay set from the field ctor, slots stay -1)
//   slots  : explicit FUN_0040bfb3() writes {typeIndex: count} AFTER the
//            FUN_00423c04 call (asm ESI value gives the index)
//   ace    : level+0x48 (ace time, seconds); bonus levels never write it (0)
//   cap    : money obj +8 (earnings cap); undefined = ctor default -1
//   zr     : raven ctrl +0x14/+0x1c/+0x18 written 0 (no raven waves)
//   zw     : raven ctrl +0x0c/+0x10 written 0 (no wolf waves)
//   sell/shop : store +0x18 / +0x19 written (undefined = ctor default 1)
//   risk   : RiskController +8 written (undefined = ctor default 1)
//   unlock : FUN_00423d75(N) argument; items:[...] for direct FUN_0040ca85
//   e5a    : FUN_00423e5a called; rise: store+4 = 1; fix: raven +0x3c = 1
//   bonus  : FUN_00423cb3(level, chicks, mult) with EAX = time/100
//   Float constants (raven +0x34 / +0x40, bonus mult) are float32 fields
//   (flds/fstps, e.g. asm 0x423512-0x423520, 0x423cee-0x423cf3), so they are
//   stored here as Math.fround values.
// ---------------------------------------------------------------------------
const SETUP = {
    // case 1 — 42994-43010 (asm 0x422d64): also field+0x264 = 0 (42997) —
    // the sickness-enable flag tested by FUN_004040ec (rwg:4838) and set back
    // to 1 by the level-1 tutorial (rwg:42152); consumed by Field.js.
    1: { line: 42994, tasks: [[0, 15]], types: [0, 0, 0, 0], slots: { 0: 0 },
         zr: true, zw: true, sell: 0, shop: 0, risk: 0, f264: 0, ace: 0x2c },
    // case 2 — 43011-43024 (asm 0x422dc0)
    2: { line: 43011, tasks: [[4, 10]], types: [0, 0, 0, 0],
         zr: true, zw: true, sell: 0, shop: 0, risk: 0, ace: 0x4b },
    // case 3 — 43025-43042 (asm 0x422e03): slot0=2, slot1=3 ("maximum of 5")
    3: { line: 43025, tasks: [[8, 12]], types: [1, 0, 0, 0], slots: { 0: 2, 1: 3 },
         zr: true, zw: true, sell: 0, shop: 0, risk: 0, ace: 0x46 },
    // case 4 — 43043-43050 → LAB_00422e7f (asm 0x422e66)
    4: { line: 43043, tasks: [[3, 1500]], types: [1, 0, 0, 0],
         zw: true, sell: 0, shop: 0, risk: 0, ace: 0x96 },
    // case 5 — 43051-43065 (asm 0x422ea1): store+0x18 = 1 (SELL)
    5: { line: 43051, tasks: [[3, 5000]], types: [1, 1, 0, 0],
         zw: true, sell: 1, shop: 0, risk: 0, ace: 0x96 },
    // case 6 — 43066-43083 (asm 0x422ebd): slots 0=5,1=5,2=2; item 0 pushed
    // directly via FUN_0040ca85 (43079)
    6: { line: 43066, tasks: [[8, 20]], types: [1, 1, 0, 0], slots: { 0: 5, 1: 5, 2: 2 },
         zw: true, risk: 0, items: [0], ace: 100 },
    // case 7 — 43084-43096 (asm 0x422f3b): item 0 via FUN_0040ca85 (43092)
    7: { line: 43084, tasks: [[3, 7000], [12, 42000]], types: [1, 1, 0, 0],
         zw: true, items: [0], ace: 0x136 },
    // case 8 — 43097-43100 → FUN_00423cb3 (asm 0x422f98: EAX=0x1e, 3 chicks,
    // _DAT_004e941c = 0.8f)
    8: { line: 43097, bonus: { time: 0x1e, chicks: 3, mult: Math.fround(0.8) } },
    // case 9 — 43101-43111 → LAB_00422fe6 (asm 0x422fb2): slot3 = 0
    9: { line: 43101, tasks: [[5, 10]], types: [1, 0, 1, 0], slots: { 3: 0 },
         zr: true, zw: true, unlock: 1, ace: 0xf0 },
    // case 10 — 43112-43125 (asm 0x423000): slot3 = 0
    10: { line: 43112, tasks: [[9, 5]], types: [1, 0, 1, 0], slots: { 3: 0 },
          zr: true, zw: true, unlock: 1, ace: 200 },
    // case 0xb — 43126-43137 (asm 0x42304e)
    11: { line: 43126, tasks: [[1, 15]], types: [1, 0, 1, 0],
          zr: true, zw: true, unlock: 1, ace: 0xb9 },
    // case 0xc — 43138-43149 (asm 0x42308a)
    12: { line: 43138, tasks: [[3, 40000]], types: [1, 0, 1, 0],
          zr: true, zw: true, unlock: 2, ace: 300 },
    // case 0xd — 43150-43152 (asm 0x4230c7: EAX=0x1e, 4 chicks,
    // _DAT_004e9418 = 0.9f)
    13: { line: 43150, bonus: { time: 0x1e, chicks: 4, mult: Math.fround(0.9) } },
    // case 0xe — 43153-43169 (asm 0x4230d8): slots 0=5,1=5,2=5,3=2
    14: { line: 43153, tasks: [[9, 9]], types: [1, 1, 1, 0], slots: { 0: 5, 1: 5, 2: 5, 3: 2 },
          zw: true, unlock: 2, ace: 300 },
    // case 0xf — 43170-43178 (asm 0x423146)
    15: { line: 43170, tasks: [[3, 100000]], types: [1, 1, 1, 0],
          zw: true, unlock: 3, ace: 400 },
    // case 0x10 — 43179-43183 (asm 0x42317b: EAX=0x2d, 4 chicks, 1.0f)
    16: { line: 43179, bonus: { time: 0x2d, chicks: 4, mult: 1.0 } },
    // case 0x11 — 43184-43194 (asm 0x42318b)
    17: { line: 43184, tasks: [[1, 30], [12, 54000]], types: [1, 1, 1, 0],
          zw: true, unlock: 4, ace: 0xdc },
    // case 0x12 — 43195-43204 → LAB_00423202 (asm 0x4231cc)
    18: { line: 43195, tasks: [[3, 5000], [12, 18000]], types: [1, 1, 1, 0],
          zw: true, unlock: 4, ace: 0xa0 },
    // case 0x13 — 43205-43218 (asm 0x42320e)
    19: { line: 43205, tasks: [[8, 80], [12, 30000]], types: [1, 0, 1, 0],
          zr: true, zw: true, unlock: 5, ace: 0xbe },
    // case 0x14 — 43180 shares case 0x10 (asm jump table entry 20 = 0x42317b)
    20: { line: 43180, bonus: { time: 0x2d, chicks: 4, mult: 1.0 } },
    // case 0x15 — 43219-43234 → LAB_00422fe6 (asm 0x423258): slot4 = 0
    21: { line: 43219, tasks: [[6, 8], [12, 42000]], types: null, slots: { 4: 0 },
          zw: true, unlock: 5, ace: 0xf0 },
    // case 0x16 — 43235-43244 (asm 0x423288): slot4 = 0
    22: { line: 43235, tasks: [[10, 5]], types: null, slots: { 4: 0 },
          zw: true, unlock: 5, ace: 0xd2 },
    // case 0x17 — 43245-43252 (asm 0x4232c0)
    23: { line: 43245, tasks: [[2, 10]], types: null,
          zw: true, unlock: 5, ace: 0x230 },
    // case 0x18 — 43253-43260 → LAB_004232ff (asm 0x4232e8)
    24: { line: 43253, tasks: [[3, 200000]], types: null,
          zw: true, unlock: 6, ace: 0x1e0 },
    // case 0x19 — 43261-43263 → LAB_00423316 (asm 0x423310: EAX=0x14,
    // 4 chicks, _DAT_004e9414 = 1.1f)
    25: { line: 43261, bonus: { time: 0x14, chicks: 4, mult: Math.fround(1.1) } },
    // case 0x1a — 43264-43282 → LAB_00423383 (asm 0x423324): slots
    // 0=5,1=5,2=5,4=5; ravens zeroed but wolves (+0x0c) keep default
    26: { line: 43264, tasks: [[10, 15], [9, 15]], types: null, slots: { 0: 5, 1: 5, 2: 5, 4: 5 },
          zr: true, unlock: 6, ace: 0x1e0 },
    // case 0x1b — 43283-43293 → LAB_004232ff (asm 0x423397)
    27: { line: 43283, tasks: [[2, 20], [12, 54000]], types: null,
          unlock: 7, ace: 0x1e0 },
    // case 0x1c — 43294-43305 (asm 0x4233b8): slot2 = 0, FUN_00404aa8(2,0)
    // clears the rooster type bit, raven +0x3c = 1
    28: { line: 43294, tasks: [[8, 50], [12, 24000]], types: null, slots: { 2: 0 },
          clearBits: [2], fix: true, unlock: 7, ace: 0xa5 },
    // case 0x1d — 43306-43312 (asm 0x423405: push 1,1,0 + mov al,1)
    29: { line: 43306, tasks: [[3, 30000]], types: [0, 1, 1, 1],
          unlock: 7, ace: 0x17c },
    // case 0x1e — 43313-43319 (asm 0x423432): money cap 500
    30: { line: 43313, tasks: [[1, 30]], types: null, cap: 500,
          unlock: 7, ace: 0x168 },
    // case 0x1f — 43320-43328 → LAB_00422e95 (asm 0x42345c):
    // _DAT_004fc3b4 = _DAT_004e90e4 (3.0f), field+0x26c = 1
    31: { line: 43320, tasks: [[8, 50], [12, 54000]], types: null,
          hatchSlow: 3.0, fastSick: true, unlock: 7, ace: 0x96 },
    // case 0x20 — 43329-43338 (asm 0x423498): slot1 = 0, field+0x270 = 4,
    // store+4 = 1
    32: { line: 43329, tasks: [[8, 100]], types: null, slots: { 1: 0 },
          broodyCap: 4, rise: true, unlock: 7, ace: 0xdc },
    // case 0x21 — 43339-43343 → LAB_00423316 (asm 0x4234dd: EAX=0x14,
    // 4 chicks, _DAT_004e92a8 = 1.2f)
    33: { line: 43339, bonus: { time: 0x14, chicks: 4, mult: Math.fround(1.2) } },
    // case 0x22 — 43344-43350 (asm 0x4234e8): FUN_00423e5a
    34: { line: 43344, tasks: [[10, 10]], types: null, e5a: true,
          unlock: 7, ace: 0x163 },
    // case 0x23 — 43351-43365 (asm 0x42350b): raven +0x34 = _DAT_004dc820
    // (0.4f), +0x38 = 0, +0x14 = +0x1c = 2, +0x18 = 1; FUN_00423deb(10);
    // slot2 = 0 (ESI still 2 from 0x423527)
    35: { line: 43351, tasks: [[3, 10000]], types: null, slots: { 2: 0 },
          raven: { perWave: 2, atOnce: 2, f18: 1, f34: Math.fround(0.4), f38: 0 }, fillTo: 10,
          unlock: 7, ace: 0x96 },
    // case 0x24 — 43366-43384 (asm 0x42355d): raven +0x34 = 1.0f,
    // +0x38 = 24000; slots 0..3 = 2, 4 = 0; cap 1000
    36: { line: 43366, tasks: [[8, 25]], types: null, slots: { 0: 2, 1: 2, 2: 2, 3: 2, 4: 0 },
          raven: { f34: 1.0, f38: 24000 }, cap: 1000, unlock: 7, ace: 0x8c },
    // case 0x25 — 43385-43393 (asm 0x4235cb): FUN_00423e5a, store+4 = 1,
    // then FUN_00423c04(1,1,0, AL=0)
    37: { line: 43385, tasks: [[11, 15]], types: [1, 1, 0, 0], e5a: true, rise: true,
          unlock: 7, ace: 0x10e },
    // case 0x26 — 43394-43396 (asm 0x423601: EAX=0x14, 5 chicks,
    // _DAT_004e9418 = 0.9f)
    38: { line: 43394, bonus: { time: 0x14, chicks: 5, mult: Math.fround(0.9) } },
    // case 0x27 — 43397-43405 (asm 0x423612): store+4 = 1
    39: { line: 43397, tasks: [[10, 10], [1, 30]], types: null, rise: true,
          unlock: 7, ace: 0x118 },
    // case 0x28 — 43406-43421 (asm 0x423641): slot0 = 0, slots 1..4 = 5
    40: { line: 43406, tasks: [[2, 30]], types: null, slots: { 0: 0, 1: 5, 2: 5, 3: 5, 4: 5 },
          unlock: 7, ace: 0x208 },
    // case 0x29 — 43422-43441 (asm 0x423699: push 1,0,1 + mov al,1);
    // slot3 = 0, slot4 = 0
    41: { line: 43422, tasks: [[2, 1], [1, 1], [12, 20000]], types: [1, 0, 1, 1], slots: { 3: 0, 4: 0 },
          zr: true, zw: true, unlock: 7, ace: 0xb4 },
    // case 0x2a — 43442-43448 → LAB_00423721 (asm 0x42370a): raven +0x34 =
    // 1.0f, +0x38 = 30000
    42: { line: 43442, tasks: [[10, 10]], types: null, raven: { f34: 1.0, f38: 30000 },
          unlock: 7, ace: 0xb4 },
    // case 0x2b — 43449-43458 → LAB_00423202 (asm 0x423734): store+4 = 1
    43: { line: 43449, tasks: [[3, 10000], [12, 18000]], types: null, rise: true,
          unlock: 7, ace: 0xa0 },
    // case 0x2c — 43459-43466 (asm 0x42375e: push 1,0,1 + mov al,1);
    // raven +0x3c = 1
    44: { line: 43459, tasks: [[6, 30]], types: [1, 0, 1, 1], fix: true,
          unlock: 7, ace: 0x11c },
    // case 0x2d — 43467-43472 (asm 0x42378f: EAX=0x1e, 5 chicks, 1.0f)
    45: { line: 43467, bonus: { time: 0x1e, chicks: 5, mult: 1.0 } },
    // case 0x2e — 43473-43483 → LAB_004237d8 → LAB_00422fec (asm 0x42379c:
    // push 1,1,1 + mov al,1); raven +0x3c = 1; slot2 = 5
    46: { line: 43473, tasks: [[7, 20], [12, 32000]], types: [1, 1, 1, 1], slots: { 2: 5 },
          fix: true, unlock: 7, ace: 0xf0 },
    // case 0x2f — 43484-43494 → LAB_00423721 (asm 0x4237df): cap 800
    47: { line: 43484, tasks: [[8, 50], [12, 36000]], types: null, cap: 800,
          unlock: 7, ace: 0xb4 },
    // case 0x30 — 43495-43510 → LAB_00423383 (asm 0x423808): slot0 = 10
    // ("no more than 10 layer chickens"), cap 800
    48: { line: 43495, tasks: [[4, 100], [9, 20], [12, 60000]], types: null, slots: { 0: 10 },
          cap: 800, unlock: 7, ace: 0x1e0 },
    // case 0x31 — 43511-43522 → LAB_004237d8 (asm 0x423850): slot1 = 1
    // ("only have one broody chicken"), cap 1000, store+4 = 1, raven +0x3c = 1
    49: { line: 43511, tasks: [[8, 50]], types: null, slots: { 1: 1 }, cap: 1000,
          rise: true, fix: true, unlock: 7, ace: 0xf0 },
    // case 0x32 — 43523-43534 (asm 0x423884): store+4 = 1
    50: { line: 43523, tasks: [[3, 1000000], [1, 80], [2, 50], [12, 0x18e70]], types: null,
          rise: true, unlock: 7, ace: 0x348 },
};

export function getLevelDescription(level) {
    // FUN_0042399c (rwg_functions.c:43549) — verbatim strings; default case
    // "No description" (43762).
    const descriptions = {
    // FUN_0042399c case 1: rwg_functions.c:43557
    1: "Welcome to your farm! Your chickens need you to take care of them. Chickens like to dig, and sometimes find coins. Collect 15 silver or golden coins.",
    // FUN_0042399c case 2: rwg_functions.c:43561
    2: "Collect 10 white eggs to complete the level.",
    // FUN_0042399c case 3: rwg_functions.c:43565
    3: "Your goal is to raise 12 chickens. You can hatch them or buy them, but in this level you can only buy a maximum of 5 chickens.",
    // FUN_0042399c case 4: rwg_functions.c:43570
    4: "Earn $1,500 to complete the level. Watch for ravens. They will try to steal your chickens!",
    // FUN_0042399c case 5: rwg_functions.c:43574
    5: "Earn $5,000 to complete this level. The specialty store is now open. Its specialty? Selling chickens! Sell your chickens to earn extra money.",
    // FUN_0042399c case 6: rwg_functions.c:43579
    6: "Hatch or buy a total of 20 chickens. The store now has additional items for you to purchase, including an upgrade to your food.",
    // FUN_0042399c case 7: rwg_functions.c:43584
    7: "Earn $7,000 in 7 minutes or less. Feel clucky...err lucky? Click on the question mark button. You might benefit from something great...or you might get a \"fowl\" surprise.",
    // FUN_0042399c case 8: rwg_functions.c:43596
    8: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
    // FUN_0042399c case 9: rwg_functions.c:43601
    9: "The goal is to collect 10 light blue eggs. Don't worry about the ravens. They will not bother you for the next few levels. The shop is now selling a mouse which will help you collect coins and other goodies.",
    // FUN_0042399c case 0xa: rwg_functions.c:43605
    10: "Hatch 5 magic chickens to complete this level.",
    // FUN_0042399c case 0xb: rwg_functions.c:43608
    11: "Collect 15 blue gems.",
    // FUN_0042399c case 0xc: rwg_functions.c:43611
    12: "Earn $40,000. Your seeds can now be upgraded in the shop.",
    // FUN_0042399c case 0xd: rwg_functions.c:43596
    13: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
    // FUN_0042399c case 0xe: rwg_functions.c:43615
    14: "Hatch 9 magic chickens. The ravens are back and more ravenous then ever! Keep an eye on the ghastly grim and ancient raven wandering from the nightly shore!",
    // FUN_0042399c case 0xf: rwg_functions.c:43620
    15: "All you've got to do is earn $100,000. Your shop is now selling a weapon upgrade to help keep the pesky ravens away.",
    // FUN_0042399c case 0x10: rwg_functions.c:43596
    16: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
    // FUN_0042399c case 0x11: rwg_functions.c:43625
    17: "Collect 30 blue gems in 9 minutes or less. From now on, you can purchase an elephant from the shop. The elephant lowers the number of attacks from the ravens.",
    // FUN_0042399c case 0x12: rwg_functions.c:43630
    18: "The goal is to earn $5,000 in 3 minutes or less. Oh yeah, you can only use magic chickens. Don't worry, just wing it...",
    // FUN_0042399c case 0x13: rwg_functions.c:43635
    19: "Hatch or buy 80 chickens in 5 minutes or less. The ravens have found another farm to bother for a while so you won't need to worry about them. Your feed can be upgraded again.",
    // FUN_0042399c case 0x14: rwg_functions.c:43596
    20: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
    // FUN_0042399c case 0x15: rwg_functions.c:43639
    21: "You have discovered holy chickens! Collect 8 red eggs as fast as you can.",
    // FUN_0042399c case 0x16: rwg_functions.c:43643
    22: "Hatch 5 holy chickens. You can't buy them yet, so the only way to be successful this round is to hatch them.",
    // FUN_0042399c case 0x17: rwg_functions.c:43647
    23: "The goal is to collect 10 red gems.",
    // FUN_0042399c case 0x18: rwg_functions.c:43650
    24: "Earn $200,000. Another food upgrade is available in the shop now.",
    // FUN_0042399c case 0x19: rwg_functions.c:43596
    25: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
    // FUN_0042399c case 0x1a: rwg_functions.c:43654
    26: "Grow or buy 15 magic and 15 holy chickens. There's a new menace to your chickens: wolves! They're hungry like, well...the wolves.",
    // FUN_0042399c case 0x1b: rwg_functions.c:43659
    27: "Collect 30 red gems in 9 minutes or less. The ravens have returned and joined forces with the wolves to create a double threat to your chickens. Your new weapon upgrade will help keep both scavengers away from your chickens.",
    // FUN_0042399c case 0x1c: rwg_functions.c:43664
    28: "Grow 50 chickens in 4 minutes or less. There are no roosters available in this level so be especially careful when the ravens attack...",
    // FUN_0042399c case 0x1d: rwg_functions.c:43669
    29: "Earn $30,000 this level to reach the goal. You'll have to do it without the help of the broody chickens.",
    // FUN_0042399c case 0x1e: rwg_functions.c:43674
    30: "Collect 30 blue gems. A lesser-known tax on digital chicken farms forces you to cap your earnings at $500. Spend your money fast or you will lose it!",
    // FUN_0042399c case 0x1f: rwg_functions.c:43679
    31: "A strange bird illness (chicken pox?) has broken out, and your chickens are not feeling well. As a result, they get sick very quickly. It's well known among digital chicken farmers that it takes sick birds longer to hatch their eggs. Grow your farm to reach a total of 50 chickens.",
    // FUN_0042399c case 0x20: rwg_functions.c:43684
    32: "Grow your farm until you have 100 chickens. The market price for chickens is on the rise. Buy plenty of chickens at the beginning of the level, or you'll pay through the beak later.",
    // FUN_0042399c case 0x21: rwg_functions.c:43596
    33: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
    // FUN_0042399c case 0x22: rwg_functions.c:43689
    34: "Raise or buy 10 magic chickens. A recent splurge on new overalls left you with a mere $5,000 for this task.",
    // FUN_0042399c case 0x23: rwg_functions.c:43694
    35: "The goal is to earn $10,000. Roosters are not available for purchase, so be careful when the ravens attack!",
    // FUN_0042399c case 0x24: rwg_functions.c:43699
    36: "Grow 25 chickens to complete this level. You have only 4 minutes before the ravens attack. Good news: local lawmakers lowered the tax on digital chicken farms. Bad news: the new cap is $1,000. Spend it or lose it!",
    // FUN_0042399c case 0x25: rwg_functions.c:43704
    37: "The goal is to raise 15 roosters. Your chickens won't find any coins for you; you can't sell anything; and you have only $5,000. Inflation has once again made the price of chickens increase.",
    // FUN_0042399c case 0x26: rwg_functions.c:43596
    38: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
    // FUN_0042399c case 0x27: rwg_functions.c:43709
    39: "Collect 30 blue gems and 10 holy chickens to complete this level. Remember: as the time winds down the price for chickens goes up. Supply and demand!",
    // FUN_0042399c case 0x28: rwg_functions.c:43714
    40: "Collect 30 red gems to complete this level. The chickens appear to have come down with something and are hatching their eggs very slowly.",
    // FUN_0042399c case 0x29: rwg_functions.c:43719
    41: "Collect 1 blue and 1 red gem in 3 minutes 20 seconds or less. Magic and holy chickens are conveniently unavailable in this level.",
    // FUN_0042399c case 0x2a: rwg_functions.c:43724
    42: "Hatch or buy 10 holy chickens. The ravens start attacking in 5 minutes, so get moving!",
    // FUN_0042399c case 0x2b: rwg_functions.c:43728
    43: "Earn $10,000 in 3 minutes or less. Wouldn't you know it? Your chickens are sick and growing very slowly. The price for chickens rises as time goes on.",
    // FUN_0042399c case 0x2c: rwg_functions.c:43733
    44: "The goal is to collect 30 red eggs. Your chickens are still sick, so it will take them a while to grow to full size. Roosters are not available this round, so be very aware when the ravens attack.",
    // FUN_0042399c case 0x2d: rwg_functions.c:43596
    45: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
    // FUN_0042399c case 0x2e: rwg_functions.c:43738
    46: "Collect 20 black eggs in 5 minutes or less. Your roosters are still pursuing their dream of being free-range chickens. Be careful when the ravens attack!",
    // FUN_0042399c case 0x2f: rwg_functions.c:43743
    47: "Get 50 chickens in 6 minutes or less. A lesser-known tax on digital chicken farms forces you to cap your earnings at $800.",
    // FUN_0042399c case 0x30: rwg_functions.c:43748
    48: "Collect 100 white eggs and 20 magic chickens in 10 minutes or less. We reserve the right to sell you no more than 10 layer chickens. A lesser-known tax on digital chicken farms forces you to cap your earnings at $800.",
    // FUN_0042399c case 0x31: rwg_functions.c:43753
    49: "The goal is to grow 50 chickens, but we're not going to make it easy. Any money you earn over $1,000 is lost. The price of the chickens goes up as the time goes on. And you only have one broody chicken. If the ravens take it, you can't replace it.",
    // FUN_0042399c case 0x32: rwg_functions.c:43758
    50: "Earn $1,000,000, collect 80 blue gems and 50 red gems in 17 minutes or less. Chickens get more expensive, and the ravens attack you more frequently. It'll be tough, but this is your chance to rule the roost!",
    };
    return descriptions[level] || "No description";
}

// FUN_00405886:6760-6766 — `**(app+4) < 7`. app+4 holds the current level number
// (compared with DAT_004fc2f8 = level+1 at 37662 / 41391).
function isEarlyLevel(level) {
    return level < 7;
}

// Raven controller defaults: ctor FUN_00401202:284-300 (+0x34 = 1.0f,
// +0x38 = -1, +0x40 = 1.0f, +0x3c = 0) then FUN_00422c01:42863-42889
// (asm 0x422ca6-0x422d08): ravens/wave 8 (L<=10), 12 (L11-30), 25 (L>=31);
// +0x1c = 4; +0x18 = 1 (2 when L>40); wolves/wave +0x0c = 1 (2 when L>=31);
// +0x10 = 7 (6 when L>=31).
// Semantics: +0x14 = ravens spawned per wave (FUN_004014eb:590, ×2/3 with
// the elephant pet), +0x0c = wolves per wave (FUN_00401543 plays SOUND_WOLF
// DAT_004feda0 and spawns +0x0c pets of the wolf factory FUN_00410299),
// +0x3c != 0 → raven chance fixed at _DAT_004e93c0 = 0.02f instead of the
// rooster-count based value (FUN_0040134a:466-467). +0x10 = wolf HP (asm
// 0x4015c7, FUN_00424be6 0x424c3f), +0x18 = raven HP (asm 0x40128f),
// +0x1c = ravens alive at once (FUN_004014eb, FUN_00401427), +0x40 = raven
// speed factor (asm 0x401288). +0x34: used only when +0x38 == 0 (attack
// chance +0x34*0.1*2, FUN_0040134a:458-461).
function ravenDefaults(level) {
    let perWave = 8;
    let wolvesPerWave = 1;
    let f10 = 7;
    if (level > 30) {
        perWave = 25;
        wolvesPerWave = 2;
        f10 = 6;
    } else if (level > 10) {
        perWave = 12;
    }
    return {
        perWave,                     // +0x14
        atOnce: 4,                   // +0x1c
        f18: level > 40 ? 2 : 1,     // +0x18
        wolvesPerWave,               // +0x0c
        f10,                         // +0x10
        f34: 1.0,                    // +0x34 (float)
        f38: -1,                     // +0x38 (centiseconds; -1 ctor default)
        f40: 1.0,                    // +0x40 (float)
        fixedChance: false,          // +0x3c
    };
}

export function getLevelConfig(level) {
    const s = SETUP[level];
    if (!s) {
        // FUN_00422d10 has no default case: nothing is configured.
        return {
            tasks: [], hasBuy: false, hasSell: false, hasMagicHoly: false,
            buyableTypes: {}, maxBuyPerType: {}, hasRavens: false, hasWolves: false,
            moneyCap: Infinity, timeLimit: 0, upgradeLevel: 0, startMoney: 0,
            isBonus: false, ravenDelay: 0, sicknessFactor: 0,
            chickenPriceMultiplier: 1.0, noPeckCoins: false, aceTime: 0,
        };
    }

    // ---- money -------------------------------------------------------------
    // FUN_00422c01:42850-42855 (asm 0x422c75-0x422ca3): money obj +4 =
    // 200, 300 if level >= 10, 400 if level >= 30, +100 when FUN_00405886.
    let startMoney = 200;
    if (level >= 10) startMoney = 300;
    if (level >= 30) startMoney = 400;
    if (isEarlyLevel(level)) startMoney += 100;
    // Money obj +8: -1 from ctor (7533). Cases 0x1e/0x24/0x2f/0x30/0x31 write
    // 500/1000/800/800/1000. Consumer: FUN_00424b5d:45049-45052 clamps money
    // to +8 when 0 < +8 < money, so -1 = no cap (Infinity here).
    const moneyCap = (s.cap !== undefined) ? s.cap : Infinity;

    // ---- chick types & buy slots ------------------------------------------
    // Field bitset +0x24c: all 5 bits set by ctor loop (asm 0x4040b4-0x4040dd).
    // Store slots: FUN_00422c01:42836-42849 writes -1 to slots 0..4.
    const typeEnabled = [true, true, true, true, true];
    const slots = [-1, -1, -1, -1, -1];
    const types = s.bonus ? [0, 0, 0, 0] : s.types;
    if (types) {
        // FUN_00423c04:43788-43803: FUN_00404aa8(i, flag) sets bit i;
        // FUN_0041e8e0(-(flag != 0)) sets slot i to -1 or 0, for i = 1..4.
        for (let i = 0; i < 4; i++) {
            typeEnabled[i + 1] = !!types[i];
            slots[i + 1] = types[i] ? -1 : 0;
        }
    }
    if (s.clearBits) {
        // FUN_00404aa8(2,'\0') at 43301 (case 0x1c only)
        for (const b of s.clearBits) typeEnabled[b] = false;
    }
    if (s.slots) {
        for (const k of Object.keys(s.slots)) slots[+k] = s.slots[k];
    }
    if (s.bonus) {
        // FUN_00423cb3:43853 — slot 0 = 0 after FUN_00423deb (43850).
        slots[0] = 0;
    }

    // ---- HUD buttons / risk -----------------------------------------------
    // store +0x18 (SELL widget this+0xB0) / +0x19 (BUY widget this+0xB4),
    // read every frame at FUN_0040a3d6:13294-13299; ctor default 1 (FUN_0041e7f2).
    let sellButton = (s.sell !== undefined) ? s.sell === 1 : true;
    let specialShopButton = (s.shop !== undefined) ? s.shop === 1 : true;
    if (s.e5a) {
        // FUN_00423e5a:43985-43986: +0x18 = 0, +0x19 = 1
        sellButton = false;
        specialShopButton = true;
    }
    if (s.bonus) {
        // FUN_00423cb3:43848-43849: +0x18 = 0, +0x19 = 0
        sellButton = false;
        specialShopButton = false;
    }
    // RiskController +8: ctor 1 (FUN_0041b569); cases 1-6 write 0.
    const riskEnabled = (s.risk !== undefined) ? s.risk === 1 : true;

    // ---- ravens / wolves --------------------------------------------------
    const raven = ravenDefaults(level);
    if (s.zr) { raven.perWave = 0; raven.atOnce = 0; raven.f18 = 0; }
    if (s.zw) { raven.wolvesPerWave = 0; raven.f10 = 0; }
    if (s.raven) Object.assign(raven, s.raven);
    if (s.fix) raven.fixedChance = true;
    if (s.bonus) {
        // FUN_00423cb3:43841-43846: +0x34 = _DAT_004dc7f8 (6.0f), +0x40 =
        // mult, +0x38 = 0, +0x14 = +0x1c = chicks, +0x18 = 1
        raven.perWave = s.bonus.chicks;
        raven.atOnce = s.bonus.chicks;
        raven.f18 = 1;
        raven.f34 = 6.0;
        raven.f38 = 0;
        raven.f40 = s.bonus.mult;
    }

    // ---- tasks --------------------------------------------------------------
    // Task vector is indexed by task id (FUN_0041b4bd), so order = id order.
    let tasks;
    let timeLimit = 0;
    if (s.bonus) {
        // FUN_00423cb3:43840 — task 0xd = EAX × 100 (centiseconds); EAX is
        // the register value from the asm (decompile lost it). Kept as
        // TIME_LIMIT for the existing FieldController consumer.
        timeLimit = s.bonus.time * 100 * 10; // cs → ms
        tasks = [{ type: TaskType.TIME_LIMIT, target: timeLimit, origTaskId: TaskType.BONUS_TIME }];
    } else {
        tasks = s.tasks
            .slice()
            .sort((a, b) => a[0] - b[0])
            .map(([id, target]) => {
                if (id === TaskType.TIME_LIMIT) {
                    timeLimit = target * 10; // centiseconds → ms
                    return { type: id, target: timeLimit };
                }
                return { type: id, target };
            });
    }

    // ---- shop item unlocks ----------------------------------------------------
    let shopUnlockItems = [];
    if (s.items) shopUnlockItems = s.items.slice();
    if (s.unlock !== undefined) {
        for (let i = 0; i <= s.unlock; i++) shopUnlockItems.push(i);
    }

    // ---- assemble ---------------------------------------------------------------
    const buyableTypes = {};
    const maxBuyPerType = {};
    for (let i = 0; i < 5; i++) {
        buyableTypes[TYPE_KEYS[i]] = slots[i] !== 0;
        if (slots[i] > 0) maxBuyPerType[TYPE_KEYS[i]] = slots[i];
    }

    if (s.bonus) startMoney = 10000;   // FUN_00423cb3:43858
    if (s.e5a) startMoney = 5000;      // FUN_00423e5a:43982

    return {
        level,
        sourceLine: s.line,
        tasks,
        timeLimit,

        // --- legacy fields consumed by FieldController / GameView / Chick /
        // ShopDialogs / RiskController (derived from the original data) ---
        // Any buy slot not 0 (slot strip, FUN_0041e8f5:37694).
        hasBuy: slots.some((v) => v !== 0),
        // SELL button = store +0x18.
        hasSell: sellButton,
        // Magic (bit 3) or holy (bit 4) enabled in the field type bitset —
        // which gates the layer egg reroll (FUN_0040dba2, 0x40dc21).
        hasMagicHoly: typeEnabled[3] || typeEnabled[4],
        buyableTypes,
        maxBuyPerType,
        hasRavens: raven.perWave > 0,
        hasWolves: raven.wolvesPerWave > 0,
        moneyCap,
        // Raven ctrl +0x38 (cs → ms); only cases 0x24/0x2a write > 0.
        ravenDelay: raven.f38 > 0 ? raven.f38 * 10 : 0,
        startMoney,
        isBonus: !!s.bonus,            // level +0x14 = 1 (FUN_00423cb3:43854)
        // No level case writes the field background index; the former
        // per-level values (L15=3, L50=7) were not in the decompiled source.
        upgradeLevel: 0,
        // Case 0x1f sets field+0x26c, which halves the value returned at
        // rwg_functions.c:5806-5808 (`iVar2 / 2`). 2 = that halving expressed
        // as this port's rate factor; no other case touches sickness.
        sicknessFactor: s.fastSick ? 2 : 0,
        // No static price multiplier exists in the original; see
        // priceRisesOverTime.
        chickenPriceMultiplier: 1.0,
        // FUN_00423e5a:43988 sets gem controller (app+0x28)+0x1c = 1; the
        // gem factory FUN_0040c4d9 (rwg:15152) then creates no coins
        // (consumers Chick.js / Field.js).
        noPeckCoins: !!s.e5a,

        // --- raw original values (not yet consumed by other files) ---
        aceTime: s.ace || 0,                 // level+0x48, seconds
        chickTypeEnabled: typeEnabled,       // field +0x24c bits [layer..holy]
        buySlots: slots,                     // store slot counts (-1 unlimited)
        sellButton,                          // store +0x18
        specialShopButton,                   // store +0x19 (BUY widget)
        riskEnabled,                         // RiskController +8
        shopUnlockItems,                     // SHOP_ITEMS ids
        raven,                               // raven ctrl raw fields
        // store +4: every 100 store updates the global price factor
        // DAT_004fc3b8 (double, 1.0 at FUN_00405540:6655) *= 1.003
        // (_DAT_004e9278) and slot prices are recomputed (asm 0x41ea9a-0x41eadf).
        priceRisesOverTime: !!s.rise,
        // field +0x270 (-1 ctor): broody egg allowed only while broody count
        // + FUN_0040785f() < cap (asm 0x40440c-0x404438, 0x40dc2a-0x40dc36).
        broodyEggCap: s.broodyCap !== undefined ? s.broodyCap : -1,
        // _DAT_004fc3b4 (1.0f at FUN_00405540:6656), read by brood progress
        // FUN_00406ac9 (asm 0x406adf).
        hatchSlowdown: s.hatchSlow || 1.0,
        fastSickness: !!s.fastSick,          // field +0x26c
        // money obj +0 = 1 (FUN_00424b5d asm 0x424b63: no money is ever
        // added) and egg ctl (app+0x24)+0x28 = 1 (FUN_004072fa asm 0x407395:
        // clicked eggs pay nothing) — FUN_00423e5a:43981, 43990.
        budgetFlags: !!s.e5a,
        // field +0x264 (ctor 1, rwg:4791); case 1 writes 0 (42997): sickness
        // enable flag (FUN_004040ec rwg:4838).
        field264: s.f264 !== undefined ? s.f264 : 1,
        bonusChicks: s.bonus ? s.bonus.chicks : 0, // level +0x50 compare (FUN_00423d5b)
    };
}

// Starting chickens — FUN_0042166f:41259-41300 (asm 0x421816-0x421917).
// Money is set to 1,000,000 first, so these are free; FUN_00422c01 sets the
// real money afterwards. FUN_0041e8f5 (ECX = store, EAX = type) buys one.
//   3 layers always (slot0 = 3)
//   +1 layer +1 broody when FUN_00405886 (level < 7)
//   +1 broody when level >= 10 and level != 29 (0x1d)
//   +1 layer  when level >= 30
// Then the level case may top up with free layers until the farm holds N
// chickens: FUN_00423deb(N) (case 0x23 N=10; bonus levels N = chicks).
export function getInitialChicks(level) {
    let layer = 3;
    let broody = 0;
    if (isEarlyLevel(level)) { layer += 1; broody += 1; }
    if (level >= 10 && level !== 29) broody += 1;
    if (level >= 30) layer += 1;
    const s = SETUP[level];
    let fillLayersToTotal = 0;
    if (s && s.fillTo) fillLayersToTotal = s.fillTo;
    if (s && s.bonus) fillLayersToTotal = s.bonus.chicks;
    return { layer, broody, fillLayersToTotal };
}
