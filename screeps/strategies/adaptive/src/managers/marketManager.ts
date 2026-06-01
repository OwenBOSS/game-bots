// Manages terminal trades.
// Primary use: buy ghodium when safe mode charges are depleted.
// Ghodium (1000G) is consumed by a creep using generateSafeMode(controller) to
// add one safe mode charge. The upgrader handles the generation step.

const GHODIUM_TARGET   = 1000; // enough for one safe mode recharge
const CHECK_INTERVAL   = 200;  // only scan market every 200 ticks (rate limit + CPU)
const MIN_CREDITS      = 500;  // don't buy if broke

export function manageMarket(room: Room): void {
    if (!room.terminal) return;
    if (room.terminal.cooldown > 0) return;
    if (Game.time % CHECK_INTERVAL !== 0) return;

    const ctrl = room.controller;
    if (!ctrl) return;

    // Check ghodium need: safe mode charges depleted and we don't have enough ghodium yet
    const ghodiumHeld = room.terminal.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0;
    if (ctrl.safeModeAvailable > 0 || ghodiumHeld >= GHODIUM_TARGET) return;

    if (Game.market.credits < MIN_CREDITS) {
        console.log('[adaptive] Market: low credits, skipping ghodium purchase');
        return;
    }

    const orders = Game.market.getAllOrders({
        type: ORDER_SELL,
        resourceType: RESOURCE_GHODIUM,
    });

    if (orders.length === 0) return;

    // Pick cheapest order with enough stock
    const viable = orders
        .filter(o => (o.amount ?? 0) >= 100)
        .sort((a, b) => (a.price ?? 0) - (b.price ?? 0));

    if (viable.length === 0) return;

    const best  = viable[0];
    const need  = GHODIUM_TARGET - ghodiumHeld;
    const afford = Math.floor(Game.market.credits / (best.price ?? 1));
    const amount = Math.min(need, best.amount ?? 0, afford, 1000);

    if (amount <= 0) return;

    const result = Game.market.deal(best.id, amount, room.name);
    if (result === OK) {
        console.log(`[adaptive] Market: ordered ${amount}G @ ${best.price?.toFixed(2)} each (total ${(amount * (best.price ?? 0)).toFixed(0)} credits)`);
    }
}
