// Inter-room energy balancing.
// Identifies rooms with surplus energy and rooms in deficit, then spawns couriers
// to physically carry energy until RCL 6+ terminals are available.
//
// Each tick this runs per room and writes room.memory.energySurplus.
// Spawning couriers is handled by spawnManager reading that value.

const SURPLUS_THRESHOLD  = 100_000; // storage energy above this = surplus
const DEFICIT_THRESHOLD  = 10_000;  // storage energy below this = deficit
const TERMINAL_RCL       = 6;       // at this RCL, use terminal transfers instead

export function manageTransfers(room: Room): void {
    if (!room.controller) return;

    const rcl     = room.controller.level;
    const storage = room.storage;

    // Compute and publish this room's surplus for spawnManager to read
    if (storage) {
        const energy = storage.store[RESOURCE_ENERGY];
        room.memory.energySurplus = energy > SURPLUS_THRESHOLD ? energy - SURPLUS_THRESHOLD : 0;
    } else {
        room.memory.energySurplus = 0;
    }

    // At RCL 6+, terminals handle inter-room transfers — use them if both rooms have terminals
    if (rcl >= TERMINAL_RCL) {
        manageTerminalTransfers(room);
    }
}

function manageTerminalTransfers(room: Room): void {
    const terminal = room.terminal;
    if (!terminal || terminal.cooldown > 0) return;
    if (terminal.store[RESOURCE_ENERGY] < 1000) return;

    // Find another owned room with low energy that has a terminal
    const deficitRoom = Object.values(Game.rooms).find(r =>
        r.name !== room.name &&
        r.controller?.my &&
        r.controller.level >= TERMINAL_RCL &&
        r.terminal &&
        r.storage &&
        r.storage.store[RESOURCE_ENERGY] < DEFICIT_THRESHOLD
    );

    if (!deficitRoom || !deficitRoom.terminal) return;

    // Send 5000 energy — leave some for the terminal itself
    const sendAmount = Math.min(5000, terminal.store[RESOURCE_ENERGY] - 500);
    if (sendAmount <= 0) return;

    const result = terminal.send(RESOURCE_ENERGY, sendAmount, deficitRoom.name);
    if (result === OK) {
        console.log(`[${room.name}] Terminal → ${deficitRoom.name}: ${sendAmount}e`);
    }
}
