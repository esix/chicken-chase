// Port of the level setup switch statement
// Original: FUN_0042399c (level descriptions, 220 lines)
// and the level setup function at ~line 42993 in rwg_functions.c
//
// Task types from FUN_0041b4bd parameter:
//   0  = collect coins (silver+gold)
//   1  = collect blue diamonds (gems)
//   2  = collect red diamonds
//   3  = earn money ($)
//   4  = collect white eggs
//   5  = collect blue eggs (magic)
//   6  = collect red eggs (holy)
//   7  = collect black eggs (rooster)
//   8  = raise N chickens total
//   9  = hatch N magic chickens
//   10 = hatch N holy chickens
//   11 = raise N roosters
//   12 = time limit (milliseconds)
//   13 = earn money within time

export const TaskType = {
    COLLECT_COINS: 0,
    COLLECT_BLUE_DIAMONDS: 1,
    COLLECT_RED_DIAMONDS: 2,
    EARN_MONEY: 3,
    COLLECT_WHITE_EGGS: 4,
    COLLECT_BLUE_EGGS: 5,
    COLLECT_RED_EGGS: 6,
    COLLECT_BLACK_EGGS: 7,
    RAISE_CHICKENS: 8,
    HATCH_MAGIC: 9,
    HATCH_HOLY: 10,
    RAISE_ROOSTERS: 11,
    TIME_LIMIT: 12,
    EARN_MONEY_TIMED: 13,
};

// Level data extracted from the decompiled switch statement at ~42993
// Each level has: tasks (array of {type, target}), description, available chick types,
// shop config, etc.
// FUN_00423c04 params: (this, hasLayer, hasBroody, hasMagicHoly)
//   param1=layer, param2=broody/sell, param3=magic/holy
// FUN_0040bfb3 returns shop slot configs

export const TOTAL_LEVELS = 50; // 0x32

export function getLevelDescription(level) {
    // Port of FUN_0042399c - switch on level number
    const descriptions = {
        1: "Welcome to your farm! Your chickens need you to take care of them. Chickens like to dig, and sometimes find coins. Collect 15 silver or golden coins.",
        2: "Collect 10 white eggs to complete the level.",
        3: "Your goal is to raise 12 chickens. You can hatch them or buy them, but in this level you can only buy a maximum of 5 chickens.",
        4: "Earn $1,500 to complete the level. Watch for ravens. They will try to steal your chickens!",
        5: "Earn $5,000 to complete this level. The specialty store is now open. Its specialty? Selling chickens! Sell your chickens to earn extra money.",
        6: "Hatch or buy a total of 20 chickens. The store now has additional items for you to purchase, including an upgrade to your food.",
        7: "Earn $7,000 in 7 minutes or less. Feel clucky...err lucky? Click on the question mark button. You might benefit from something great...or you might get a \"fowl\" surprise.",
        8: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
        9: "The goal is to collect 10 light blue eggs. Don't worry about the ravens. They will not bother you for the next few levels. The shop is now selling a mouse which will help you collect coins and other goodies.",
        10: "Hatch 5 magic chickens to complete this level.",
        11: "Collect 15 blue gems.",
        12: "Earn $40,000. Your seeds can now be upgraded in the shop.",
        13: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
        14: "Hatch 9 magic chickens. The ravens are back and more ravenous then ever! Keep an eye on the ghastly grim and ancient raven wandering from the nightly shore!",
        15: "All you've got to do is earn $100,000. Your shop is now selling a weapon upgrade to help keep the pesky ravens away.",
        16: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
        17: "Collect 30 blue gems in 9 minutes or less. From now on, you can purchase an elephant from the shop. The elephant lowers the number of attacks from the ravens.",
        18: "The goal is to earn $5,000 in 3 minutes or less. Oh yeah, you can only use magic chickens. Don't worry, just wing it...",
        19: "Hatch or buy 80 chickens in 5 minutes or less. The ravens have found another farm to bother for a while so you won't need to worry about them. Your feed can be upgraded again.",
        20: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
        21: "You have discovered holy chickens! Collect 8 red eggs as fast as you can.",
        22: "Hatch 5 holy chickens. You can't buy them yet, so the only way to be successful this round is to hatch them.",
        23: "The goal is to collect 10 red gems.",
        24: "Earn $200,000. Another food upgrade is available in the shop now.",
        25: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
        26: "Grow or buy 15 magic and 15 holy chickens. There's a new menace to your chickens: wolves! They're hungry like, well...the wolves.",
        27: "Collect 20 red gems in 9 minutes or less. The ravens have returned and joined forces with the wolves to create a double threat to your chickens. Your new weapon upgrade will help keep both scavengers away from your chickens.",
        28: "Grow 50 chickens in 4 minutes or less. There are no roosters available in this level so be especially careful when the ravens attack...",
        29: "Earn $30,000 this level to reach the goal. You'll have to do it without the help of the broody chickens.",
        30: "Collect 30 blue gems. A lesser-known tax on digital chicken farms forces you to cap your earnings at $500. Spend your money fast or you will lose it!",
        31: "A strange bird illness (chicken pox?) has broken out, and your chickens are not feeling well. As a result, they get sick very quickly. It's well known among digital chicken farmers that it takes sick birds longer to hatch their eggs. Grow your farm to reach a total of 50 chickens.",
        32: "Grow your farm until you have 100 chickens. The market price for chickens is on the rise. Buy plenty of chickens at the beginning of the level, or you'll pay through the beak later.",
        33: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
        34: "Raise or hatch 10 holy chickens. A recent splurge on new overalls left you with a mere $5,000 for this task.",
        35: "The goal is to earn $10,000. Roosters are not available for purchase, so be careful when the ravens attack!",
        36: "Grow 25 chickens to complete this level. You have only 4 minutes before the ravens attack. Good news: local lawmakers lowered the tax on digital chicken farms. Bad news: the new cap is $1,000. Spend it or lose it!",
        37: "The goal is to raise 15 roosters. Your chickens won't find any coins for you; you can't sell anything; and you have only $5,000. Inflation has once again made the price of chickens increase.",
        38: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
        39: "Collect 30 blue gems and 10 holy chickens to complete this level. Remember: as the time winds down the price for chickens goes up. Supply and demand!",
        40: "Collect 30 red gems to complete this level. The chickens appear to have come down with something and are hatching their eggs very slowly.",
        41: "Collect 1 blue and 1 red gem in 3 minutes 20 seconds or less. Magic and holy chickens are conveniently unavailable in this level.",
        42: "Hatch or buy 10 holy chickens. The ravens start attacking in 5 minutes, so get moving!",
        43: "Earn $10,000 in 3 minutes or less. Wouldn't you know it? Your chickens are sick and growing very slowly. The price for chickens rises as time goes on.",
        44: "The goal is to collect 30 red eggs. Your chickens are still sick, so it will take them a while to grow to full size. Roosters are not available this round, so be very aware when the ravens attack.",
        45: "Bonus level! Your only task is to protect each of your chickens within the allotted amount of time.",
        46: "Collect 20 black eggs in 5 minutes or less. Your roosters are still pursuing their dream of being free-range chickens. Be careful when the ravens attack!",
        47: "Get 50 chickens in 6 minutes or less. A lesser-known tax on digital chicken farms forces you to cap your earnings at $800.",
        48: "Collect 100 white eggs and 20 magic chickens in 10 minutes or less. We reserve the right to sell you no more than 10 layer chickens. A lesser-known tax on digital chicken farms forces you to cap your earnings at $800.",
        49: "The goal is to grow 50 chickens, but we're not going to make it easy. Any money you earn over $1,000 is lost. The price of the chickens goes up as the time goes on. And you only have one broody chicken. If the ravens take it, you can't replace it.",
        50: "Earn $1,000,000, collect 80 blue gems and 50 red gems in 17 minutes or less. Chickens get more expensive, and the ravens attack you more frequently. It'll be tough, but this is your chance to rule the roost!",
    };
    return descriptions[level] || "No description";
}

export function getLevelConfig(level) {
    // Port of the switch statement at line ~42993-43535
    // Returns the configuration for each level
    const config = {
        tasks: [],
        hasLayer: true,
        hasBroody: true,
        hasBuy: false,
        hasSell: false,
        hasMagicHoly: false,
        // Per-type buy disable flags (some levels forbid specific types)
        buyableTypes: { layer: true, broody: true, rooster: true, magic: false, holy: false },
        shopSlots: [],
        hasRavens: false,
        hasWolves: false,
        moneyCap: 1000000,
        timeLimit: 0,
        upgradeLevel: 0,
        startMoney: 44,
        isBonus: false,
        ravenDelay: 0,
        sicknessFactor: 0,
        chickenPriceMultiplier: 1.0,
    };

    switch (level) {
        // Case 1: collect 15 coins. No buy/sell. startMoney=0x2c=44
        case 1:
            config.tasks = [{ type: TaskType.COLLECT_COINS, target: 15 }];
            config.hasRavens = false;
            config.hasBuy = false;
            config.hasSell = false;
            config.hasMagicHoly = false;
            config.startMoney = 44;
            break;

        // Case 2: collect 10 white eggs. Per FUN_00423c04 line 43021 —
        // (this_02, '\0', '\0', '\0') = no buy, no sell, no holy. Level 2
        // is meant as a pure egg-collection tutorial relying on the chicks
        // you spawn into. startMoney=0x4b=75
        case 2:
            config.tasks = [{ type: TaskType.COLLECT_WHITE_EGGS, target: 10 }];
            config.hasRavens = false;
            config.hasBuy = false;
            config.hasSell = false;
            config.startMoney = 75;
            break;

        // Case 3: raise 12 chickens. Buy enabled. startMoney=0x46=70
        case 3:
            config.tasks = [{ type: TaskType.RAISE_CHICKENS, target: 12 }];
            config.hasBuy = true;
            config.hasSell = false;
            config.startMoney = 70;
            break;

        // Case 4: earn $1500. Ravens appear. startMoney=0x96=150
        case 4:
            config.tasks = [{ type: TaskType.EARN_MONEY, target: 1500 }];
            config.hasRavens = true;
            config.hasBuy = true;
            config.hasSell = false;
            config.startMoney = 150;
            break;

        // Case 5: earn $5000. Sell enabled. startMoney=0x96=150
        case 5:
            config.tasks = [{ type: TaskType.EARN_MONEY, target: 5000 }];
            config.hasRavens = true;
            config.hasBuy = true;
            config.hasSell = true;
            config.startMoney = 150;
            break;

        // Case 6: 20 chickens. startMoney=$100 (DECOMPILED_MAP.md).
        // Ravens stay ON through L4-L7 per L9's "They will not bother you for
        // the next few levels" — the hiatus starts at L9, so L6 must still
        // have them spawning.
        case 6:
            config.tasks = [{ type: TaskType.RAISE_CHICKENS, target: 20 }];
            config.hasBuy = true;
            config.hasSell = true;
            config.hasRavens = true;
            config.startMoney = 100;
            break;

        // Case 7: $7000 in 7 minutes. startMoney=$310 (0x136). Ravens still ON
        // (per the L4-L8 arc; L9 turns them off). Risk system introduced here.
        case 7:
            config.tasks = [
                { type: TaskType.EARN_MONEY, target: 7000 },
                { type: TaskType.TIME_LIMIT, target: 420000 },
            ];
            config.hasBuy = true;
            config.hasSell = true;
            config.hasRavens = true;
            config.timeLimit = 420000;
            config.startMoney = 310;
            break;

        // Case 8: competitive — task 0xd→800. moneyCap=10000. All flags off.
        case 8:
            config.isBonus = true;
            config.hasRavens = false;
            config.hasBuy = false;
            config.hasSell = false;
            config.hasMagicHoly = false;
            config.tasks = [{ type: TaskType.TIME_LIMIT, target: 80000 }];
            config.timeLimit = 80000;
            config.moneyCap = 10000;
            break;

        // Case 9: 10 magic eggs. startMoney=$200 (0xc8)
        case 9:
            config.tasks = [{ type: TaskType.COLLECT_BLUE_EGGS, target: 10 }];
            config.hasBuy = true;
            config.hasMagicHoly = true;
            config.hasRavens = false;
            config.startMoney = 200;
            break;

        // Case 10: hatch 5 magic chickens. startMoney=$200
        case 10:
            config.tasks = [{ type: TaskType.HATCH_MAGIC, target: 5 }];
            config.hasBuy = true;
            config.hasMagicHoly = true;
            config.hasRavens = false;
            config.startMoney = 200;
            break;

        // Case 11: 15 blue diamonds. startMoney=$185 (0xb9)
        case 11:
            config.tasks = [{ type: TaskType.COLLECT_BLUE_DIAMONDS, target: 15 }];
            config.hasBuy = true;
            config.hasMagicHoly = true;
            config.startMoney = 185;
            break;

        // Case 12: earn $40000. startMoney=$300
        case 12:
            config.tasks = [{ type: TaskType.EARN_MONEY, target: 40000 }];
            config.hasBuy = true;
            config.hasMagicHoly = true;
            config.startMoney = 300;
            break;

        // Case 13: competitive — task 0xd→1300. moneyCap=10000.
        case 13:
            config.isBonus = true;
            config.hasRavens = false;
            config.hasBuy = false;
            config.hasSell = false;
            config.hasMagicHoly = false;
            config.tasks = [{ type: TaskType.TIME_LIMIT, target: 130000 }];
            config.timeLimit = 130000;
            config.moneyCap = 10000;
            break;

        // Case 14: hatch 9 magic chickens, all shop options. startMoney=$300.
        // Description: "The ravens are back and more ravenous than ever!" — so
        // hasRavens=true after the L9-L13 hiatus.
        case 14:
            config.tasks = [{ type: TaskType.HATCH_MAGIC, target: 9 }];
            config.hasBuy = true;
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.hasRavens = true;
            config.startMoney = 300;
            break;

        // Case 15: earn $100000. startMoney=$400. Ravens continue from L14.
        case 15:
            config.tasks = [{ type: TaskType.EARN_MONEY, target: 100000 }];
            config.hasBuy = true;
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.hasRavens = true;
            config.startMoney = 400;
            config.upgradeLevel = 3;
            break;

        // Case 16: competitive — task 0xd→1600. moneyCap=10000.
        case 16:
            config.isBonus = true;
            config.tasks = [{ type: TaskType.TIME_LIMIT, target: 160000 }];
            config.timeLimit = 160000;
            config.moneyCap = 10000;
            break;

        // Case 20: competitive — task 0xd→2000. moneyCap=10000.
        case 20:
            config.isBonus = true;
            config.tasks = [{ type: TaskType.TIME_LIMIT, target: 200000 }];
            config.timeLimit = 200000;
            config.moneyCap = 10000;
            break;

        // Case 17: 30 blue diamonds, 54000cs (9min). startMoney=$220 (0xdc).
        // Description: "you can purchase an elephant from the shop. The elephant
        // lowers the number of attacks from the ravens." — the elephant-as-
        // raven-deterrent intro only makes sense if ravens are actually active.
        case 17:
            config.tasks = [
                { type: TaskType.COLLECT_BLUE_DIAMONDS, target: 30 },
                { type: TaskType.TIME_LIMIT, target: 540000 },
            ];
            config.timeLimit = 540000;
            config.hasBuy = true;
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.hasRavens = true;
            config.startMoney = 220;
            break;

        // Case 18: $5000 in 18000cs (3min). startMoney=$160 (0xa0). Ravens
        // continue from L17 (L19 explicitly turns them off again).
        // Description: "Oh yeah, you can only use magic chickens." — the
        // shop only sells magic chicks here, forcing the player to lean
        // entirely on the blue-diamond peck income stream for the $5000.
        case 18:
            config.tasks = [
                { type: TaskType.EARN_MONEY, target: 5000 },
                { type: TaskType.TIME_LIMIT, target: 180000 },
            ];
            config.timeLimit = 180000;
            config.hasBuy = true;
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.hasRavens = true;
            config.startMoney = 160;
            config.buyableTypes = { layer: false, broody: false, rooster: false, magic: true, holy: false };
            break;

        // Case 19: 80 chickens in 30000cs (5min). startMoney=$190 (0xbe)
        case 19:
            config.tasks = [
                { type: TaskType.RAISE_CHICKENS, target: 80 },
                { type: TaskType.TIME_LIMIT, target: 300000 },
            ];
            config.timeLimit = 300000;
            config.hasBuy = true;
            config.hasMagicHoly = true;
            config.startMoney = 190;
            break;

        // Case 21: 8 holy eggs in 7 min. startMoney=$240 (0xf0).
        // Per decompiled rwg_functions.c:43219-43223 (case 0x15) — task type 6
        // (COLLECT_RED_EGGS) target 8 AND task type 0xc (TIME_LIMIT) target
        // 42000cs = 420s = 7min. We were missing the time limit, which made
        // L21 trivially winnable with no urgency despite the description
        // "as fast as you can".
        case 21:
            config.tasks = [
                { type: TaskType.COLLECT_RED_EGGS, target: 8 },
                { type: TaskType.TIME_LIMIT, target: 420000 },
            ];
            config.timeLimit = 420000;
            config.hasBuy = true;
            config.hasMagicHoly = true;
            config.startMoney = 240;
            // Description: "You can't buy them yet" applies to L22 — L21 just unlocks holy.
            break;

        // Case 22: hatch 5 holy chickens. startMoney=$210 (0xd2).
        // Description: "You can't buy them yet, so the only way to be successful this round is to hatch them"
        case 22:
            config.tasks = [{ type: TaskType.HATCH_HOLY, target: 5 }];
            config.hasBuy = true;
            config.hasMagicHoly = true;
            config.startMoney = 210;
            // Holy not yet buyable per description
            config.buyableTypes = { layer: true, broody: true, rooster: true, magic: true, holy: false };
            break;

        // Case 23: 10 red diamonds. startMoney=$560 (0x230)
        case 23:
            config.tasks = [{ type: TaskType.COLLECT_RED_DIAMONDS, target: 10 }];
            config.hasBuy = true;
            config.hasMagicHoly = true;
            config.startMoney = 560;
            break;

        // Case 24: earn $200000. startMoney=$480 (0x1e0).
        // No explicit FUN_00423c04 — inherits L19's ('\x01','\0','\x01'):
        // buy=yes, sell=NO, holy=yes. Without sell, the player has to grind
        // $200k via red-diamond spells (holy chicks) + blue-diamond pecks
        // (magic chicks) + egg collection. The "Another food upgrade is
        // available in the shop now" hint is about UpgradeSelectDialog,
        // not the special shop.
        case 24:
            config.tasks = [{ type: TaskType.EARN_MONEY, target: 200000 }];
            config.hasBuy = true;
            config.hasMagicHoly = true;
            config.startMoney = 480;
            break;

        // Case 25: competitive — task 0xd→2500. moneyCap=10000.
        case 25:
            config.isBonus = true;
            config.tasks = [{ type: TaskType.TIME_LIMIT, target: 250000 }];
            config.timeLimit = 250000;
            config.moneyCap = 10000;
            break;

        // Case 26: 15 holy + 15 magic chickens. No explicit FUN_00423c04 call
        // — inherits from level 19's ('\x01','\0','\x01') = buy=yes, sell=no,
        // holy=yes. Description: "There's a new menace to your chickens:
        // wolves!" — wolves introduced here, ravens still on hiatus from L19.
        case 26:
            config.tasks = [
                { type: TaskType.HATCH_HOLY, target: 15 },
                { type: TaskType.HATCH_MAGIC, target: 15 },
            ];
            config.hasBuy = true;
            config.hasMagicHoly = true;
            config.hasWolves = true;
            config.startMoney = 480;
            break;

        // Case 27: 20 red diamonds in 54000cs (9min). startMoney=$480.
        // Inherits ('\x01','\0','\x01') from L19 — buy=yes, sell=no, holy=yes.
        case 27:
            config.tasks = [
                { type: TaskType.COLLECT_RED_DIAMONDS, target: 20 },
                { type: TaskType.TIME_LIMIT, target: 540000 },
            ];
            config.timeLimit = 540000;
            config.startMoney = 480;
            config.hasBuy = true;
            config.hasMagicHoly = true;
            // Per level 27 description: "ravens have returned and joined forces
            // with the wolves to create a double threat to your chickens".
            config.hasRavens = true;
            config.hasWolves = true;
            break;

        // Case 28: 50 chickens in 24000cs (4min), wolves on. startMoney=$165 (0xa5).
        // Description: "no roosters available in this level".
        // No FUN_00423c04 — inherits L19's ('\x01','\0','\x01'). FUN_00404aa8(2,'\0')
        // at line 43301 explicitly re-disables sell (already was). hasMagicHoly
        // inherits as true (per L19). Without hasBuy=true, the buyableTypes
        // restriction is moot since the shop UI never appears in the first place.
        case 28:
            config.tasks = [
                { type: TaskType.RAISE_CHICKENS, target: 50 },
                { type: TaskType.TIME_LIMIT, target: 240000 },
            ];
            config.timeLimit = 240000;
            config.hasBuy = true;
            config.hasMagicHoly = true;
            config.hasWolves = true;
            config.hasRavens = true;
            config.startMoney = 165;
            config.buyableTypes = { layer: true, broody: true, rooster: false, magic: true, holy: true };
            break;

        // Case 29: earn $30000. Per FUN_00423c04(this_23, '\0', '\x01', '\x01')
        // at line 43308 — buy=no, sell=yes, holy=yes. The "without the help of
        // the broody chickens" description applies — and with buy disabled,
        // the player must rely on existing chicks + selling for the earn-task.
        // startMoney=$380 (0x17c).
        case 29:
            config.tasks = [{ type: TaskType.EARN_MONEY, target: 30000 }];
            config.hasBuy = false;
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.startMoney = 380;
            break;

        // Case 30: 30 blue diamonds, moneyCap=$500. startMoney=$360 (0x168).
        // No explicit FUN_00423c04 — inherits from L29's ('\0','\x01','\x01')
        // = buy=no, sell=yes, holy=yes. hasMagicHoly is critical: blue
        // diamonds come only from magic chicks, and magic chicks come only
        // from BLUE eggs (which layer chicks can't lay without hasMagicHoly).
        case 30:
            config.tasks = [{ type: TaskType.COLLECT_BLUE_DIAMONDS, target: 30 }];
            config.moneyCap = 500;
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.startMoney = 360;
            break;

        // Case 31: 50 chickens in 54000cs (9min). startMoney=$150 (0x96)
        // Case 31: 50 chickens in 9 min, chicken-pox sickness. Inherits L29's
        // ('\0','\x01','\x01') = buy=no, sell=yes, holy=yes. Without sell,
        // managing the chicken cap as you lose chicks to illness gets brutal.
        case 31:
            config.tasks = [
                { type: TaskType.RAISE_CHICKENS, target: 50 },
                { type: TaskType.TIME_LIMIT, target: 540000 },
            ];
            config.timeLimit = 540000;
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.sicknessFactor = 2;
            config.startMoney = 150;
            break;

        // Case 32: 100 chickens, ravens. startMoney=$220 (0xdc).
        // Inherits L29's ('\0','\x01','\x01') — sell=yes, holy=yes.
        case 32:
            config.tasks = [{ type: TaskType.RAISE_CHICKENS, target: 100 }];
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.hasRavens = true;
            config.chickenPriceMultiplier = 4;
            config.startMoney = 220;
            break;

        // Case 33: competitive — task 0xd→3300. moneyCap=10000.
        case 33:
            config.isBonus = true;
            config.tasks = [{ type: TaskType.TIME_LIMIT, target: 330000 }];
            config.timeLimit = 330000;
            config.moneyCap = 10000;
            break;

        // Case 34: 10 holy chickens. startMoney=$355 (0x163).
        // Calls FUN_00423e5a at line 43346, which sets *(puVar1+4) = 5000
        // — that's the moneyCap budget. Description: "A recent splurge on
        // new overalls left you with a mere $5,000 for this task" confirms
        // the $5,000 cap.
        // No explicit FUN_00423c04 — inherits L29's ('\0','\x01','\x01'):
        // buy=no, sell=yes, holy=yes. hasMagicHoly is mandatory — without it
        // no RED eggs can be laid → HATCH_HOLY task is unwinnable.
        case 34:
            config.tasks = [{ type: TaskType.HATCH_HOLY, target: 10 }];
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.moneyCap = 5000;
            // FUN_00423e5a (rwg_functions.c:43969) sets *(game+0x28+0x1c) = 1
            // — the noPeckCoins flag — in addition to moneyCap=5000. L37 has
            // the same call and we set noPeckCoins for it; L34 was missing
            // this flag despite the identical FUN_00423e5a invocation at
            // line 43347. Adds another budget constraint matching the
            // "mere $5,000 for this task" description.
            config.noPeckCoins = true;
            config.startMoney = 355;
            break;

        // Case 35: earn $10000. startMoney=$150 (0x96).
        // Description: "Roosters are not available for purchase". No explicit
        // FUN_00423c04 — inherits sell=yes, holy=yes from L29 (the explicit
        // buy=true here overrides the inherited buy=no; the no-roosters
        // description implies buy must be available for the restriction to mean
        // anything).
        case 35:
            config.tasks = [{ type: TaskType.EARN_MONEY, target: 10000 }];
            config.hasBuy = true;
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.hasRavens = true;
            config.startMoney = 150;
            config.buyableTypes = { layer: true, broody: true, rooster: false, magic: true, holy: true };
            break;

        // Case 36: 25 chickens, moneyCap=$1000, ravenDelay 240s. startMoney=$140 (0x8c).
        // Per decompiled (case 0x24) `*(iVar2 + 0x38) = 24000` at line 43370
        // — 24000 cs = 240s = 4 min raven delay. Inherits sell=yes, holy=yes
        // from L29. The FUN_0040bfb3 shop slot writes at lines 43373-43381
        // populate 5 slots with values 2,2,2,2,0 (LAYER + 4× ROOSTER) — so
        // the shop restricts purchases to those two types. With ravens
        // arriving in 4 min, rooster-stacking is the player's main defense.
        case 36:
            config.tasks = [{ type: TaskType.RAISE_CHICKENS, target: 25 }];
            config.moneyCap = 1000;
            config.hasBuy = true;
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.hasRavens = true;
            config.ravenDelay = 240000;
            config.startMoney = 140;
            config.buyableTypes = { layer: true, broody: false, rooster: true, magic: false, holy: false };
            break;

        // Case 37: 15 roosters, ravens. startMoney=$270 (0x10e).
        // Calls FUN_00423e5a at line 43387 — sets moneyCap to $5000 (the
        // same "bonus task" budget mechanism as L34) and a "no peck coins"
        // flag at FUN_00423e5a:43988 (`*(*(this+0x28)+0x1c) = 1`).
        // Description: "Your chickens won't find any coins for you; you can't
        // sell anything; and you have only $5,000". Per decompiled
        // rwg_functions.c:43704 (case 0x25) — "you can't sell anything" so
        // hasSell must be false (was wrongly set to true).
        case 37:
            config.tasks = [{ type: TaskType.RAISE_ROOSTERS, target: 15 }];
            config.hasBuy = true;
            config.hasSell = false;
            config.hasRavens = true;
            config.chickenPriceMultiplier = 2;
            config.moneyCap = 5000;
            config.noPeckCoins = true;
            config.startMoney = 270;
            break;

        // Case 38: competitive — task 0xd→3800. moneyCap=10000.
        case 38:
            config.isBonus = true;
            config.tasks = [{ type: TaskType.TIME_LIMIT, target: 380000 }];
            config.timeLimit = 380000;
            config.moneyCap = 10000;
            break;

        // Case 39: 10 holy + 30 blue diamonds, ravens. startMoney=$280 (0x118).
        // Tasks REQUIRE hasMagicHoly: HATCH_HOLY needs RED eggs, blue diamonds
        // come from MAGIC chicks which need BLUE eggs — both blocked without
        // hasMagicHoly. Buy/sell inherited from L37 ('\x01','\x01','\0').
        case 39:
            config.tasks = [
                { type: TaskType.HATCH_HOLY, target: 10 },
                { type: TaskType.COLLECT_BLUE_DIAMONDS, target: 30 },
            ];
            config.hasBuy = true;
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.hasRavens = true;
            config.chickenPriceMultiplier = 1.5;
            config.startMoney = 280;
            break;

        // Case 40: 30 red diamonds. startMoney=$520 (0x208).
        // COLLECT_RED_DIAMONDS only fires when a HolyChick casts spell — needs
        // hasMagicHoly so holy chicks can hatch. Buy/sell inherited from L37.
        case 40:
            config.tasks = [{ type: TaskType.COLLECT_RED_DIAMONDS, target: 30 }];
            config.hasBuy = true;
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.sicknessFactor = 1;
            config.startMoney = 520;
            break;

        // Case 41: 2→1, 1→1, 0xc→20000 (3:20). startMoney=$180 (0xb4).
        // Description: "Magic and holy chickens are conveniently unavailable".
        // Per FUN_00423c04(this_36, '\x01', '\0', '\x01') at line 43434:
        // buy=yes, sell=no, holy=yes. Task: 1 red + 1 blue diamond in 20s.
        // The "no magic or holy chickens available this round" description
        // restricts SHOP slots (via buyableTypes), NOT world-state — magic
        // and holy EGGS still need to be possible since the only way to win
        // is for layer chicks to lay a blue + red egg the broody can hatch.
        case 41:
            config.tasks = [
                { type: TaskType.COLLECT_RED_DIAMONDS, target: 1 },
                { type: TaskType.COLLECT_BLUE_DIAMONDS, target: 1 },
                { type: TaskType.TIME_LIMIT, target: 200000 },
            ];
            config.timeLimit = 200000;
            config.hasBuy = true;
            config.hasMagicHoly = true;
            config.startMoney = 180;
            config.buyableTypes = { layer: true, broody: true, rooster: true, magic: false, holy: false };
            break;

        // Case 42: 10 holy chickens. startMoney=$180 (0xb4).
        // No FUN_00423c04 — inherits L41's ('\x01','\0','\x01') = buy=yes,
        // sell=no, holy=yes. hasMagicHoly is mandatory: HATCH_HOLY requires
        // RED eggs, which need hasMagicHoly enabled in the egg-reroll loop.
        case 42:
            config.tasks = [{ type: TaskType.HATCH_HOLY, target: 10 }];
            config.ravenDelay = 300000;
            config.hasBuy = true;
            config.hasMagicHoly = true;
            config.hasRavens = true;
            config.startMoney = 180;
            break;

        // Case 43: $10000 in 18000cs (3min), ravens. startMoney=$160 (0xa0).
        // Inherits L41's ('\x01','\0','\x01') = buy=yes, sell=no, holy=yes.
        case 43:
            config.tasks = [
                { type: TaskType.EARN_MONEY, target: 10000 },
                { type: TaskType.TIME_LIMIT, target: 180000 },
            ];
            config.timeLimit = 180000;
            config.hasBuy = true;
            config.hasMagicHoly = true;
            config.hasRavens = true;
            config.sicknessFactor = 1;
            config.chickenPriceMultiplier = 1.5;
            config.startMoney = 160;
            break;

        // Case 44: 30 holy eggs, wolves on. startMoney=$284 (0x11c).
        // Description: "Roosters are not available this round".
        case 44:
            config.tasks = [{ type: TaskType.COLLECT_RED_EGGS, target: 30 }];
            config.hasBuy = true;
            config.hasMagicHoly = true;
            config.hasWolves = true;
            config.hasRavens = true;
            config.sicknessFactor = 1;
            config.startMoney = 284;
            config.buyableTypes = { layer: true, broody: true, rooster: false, magic: true, holy: true };
            break;

        // Case 45: competitive — task 0xd→4500. moneyCap=10000.
        case 45:
            config.isBonus = true;
            config.tasks = [{ type: TaskType.TIME_LIMIT, target: 450000 }];
            config.timeLimit = 450000;
            config.moneyCap = 10000;
            break;

        // Case 46: 20 rooster eggs in 32000cs, wolves. startMoney=$240 (0xf0).
        // Description: "Your roosters are still pursuing their dream of being free-range chickens"
        // → roosters not buyable.
        case 46:
            config.tasks = [
                { type: TaskType.COLLECT_BLACK_EGGS, target: 20 },
                { type: TaskType.TIME_LIMIT, target: 320000 },
            ];
            config.timeLimit = 320000;
            config.hasBuy = true;
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.hasWolves = true;
            config.hasRavens = true;
            config.startMoney = 240;
            config.buyableTypes = { layer: true, broody: true, rooster: false, magic: true, holy: true };
            break;

        // Case 47: 50 chickens in 36000cs (6min), moneyCap=$800. startMoney=$180
        case 47:
            config.tasks = [
                { type: TaskType.RAISE_CHICKENS, target: 50 },
                { type: TaskType.TIME_LIMIT, target: 360000 },
            ];
            config.timeLimit = 360000;
            config.moneyCap = 800;
            config.hasBuy = true;
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.startMoney = 180;
            break;

        // Case 48: 100 white eggs + 20 magic chickens in 60000cs (10min),
        // moneyCap=$800. Description: "We reserve the right to sell you no
        // more than 10 layer chickens" — per-type purchase cap enforced via
        // maxBuyPerType. startMoney=$480.
        case 48:
            config.tasks = [
                { type: TaskType.COLLECT_WHITE_EGGS, target: 100 },
                { type: TaskType.HATCH_MAGIC, target: 20 },
                { type: TaskType.TIME_LIMIT, target: 600000 },
            ];
            config.timeLimit = 600000;
            config.moneyCap = 800;
            config.hasBuy = true;
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.maxBuyPerType = { layer: 10 };
            config.startMoney = 480;
            break;

        // Case 49: 50 chickens, ravens, wolves, moneyCap=$1000. startMoney=$240
        case 49:
            config.tasks = [{ type: TaskType.RAISE_CHICKENS, target: 50 }];
            config.moneyCap = 1000;
            config.chickenPriceMultiplier = 2;
            config.hasRavens = true;
            config.hasWolves = true;
            config.hasBuy = true;
            config.hasSell = true;
            config.hasMagicHoly = true;
            // Description: "And you only have one broody chicken" — single-broody constraint
            config.buyableTypes = { layer: true, broody: false, rooster: true, magic: true, holy: true };
            config.startMoney = 240;
            break;

        // Case 50 (0x32): final level! $1M + 80 blue + 50 red in 102000cs (17min). startMoney=$840 (0x348)
        case 50:
            config.hasBuy = true;
            config.hasSell = true;
            config.hasMagicHoly = true;
            config.tasks = [
                { type: TaskType.EARN_MONEY, target: 1000000 },
                { type: TaskType.COLLECT_BLUE_DIAMONDS, target: 80 },
                { type: TaskType.COLLECT_RED_DIAMONDS, target: 50 },
                { type: TaskType.TIME_LIMIT, target: 1020000 },
            ];
            config.timeLimit = 1020000;
            config.hasRavens = true;
            config.startMoney = 840;
            config.chickenPriceMultiplier = 3;
            config.upgradeLevel = 7;
            break;

        default:
            config.tasks = [{ type: TaskType.COLLECT_COINS, target: 10 }];
    }

    return config;
}
