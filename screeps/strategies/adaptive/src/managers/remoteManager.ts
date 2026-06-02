// Remote mining manager.
// Identifies adjacent rooms suitable for reservation + harvesting, computes how many
// remote miners and haulers are needed (distance-based), and publishes spawn targets
// to room.memory.remoteRooms for spawnManager to act on.
//
// Remote rooms are processed in priority order: closest (linear distance = 1) first,
// then rooms with more sources.

const MAX_REMOTE_ROOMS  = 3;  // cap: CPU scales with remote rooms
const RESERVE_THRESHOLD = 500; // re-send reserver when ticksLeft drops below this
const MIN_MINER_RCL     = 2;   // RCL 2 has containers + haulers — remote mining helps economy

export function manageRemote(room: Room): void {
    if ((room.controller?.level ?? 0) < MIN_MINER_RCL) return;

    if (!room.memory.remoteRooms) room.memory.remoteRooms = {};

    // Find candidate rooms: adjacent, neutral, not already owned
    const candidates = findCandidateRooms(room);

    // Trim to top MAX_REMOTE_ROOMS by source count desc
    const chosen = candidates.slice(0, MAX_REMOTE_ROOMS);

    // Remove stale entries (rooms we no longer want to harvest)
    const chosenNames = new Set(chosen.map(r => r.name));
    for (const name of Object.keys(room.memory.remoteRooms)) {
        if (!chosenNames.has(name)) delete room.memory.remoteRooms[name];
    }

    // Update spawn targets for each chosen room
    for (const remote of chosen) {
        const distanceTiles = estimateRoundTripTiles(room.name, remote.name);
        const haulerCarry   = bestHaulerCarry(room.energyCapacityAvailable);
        // Each source produces ~10e/tick; miners * round-trip determines hauler count
        const haulersNeeded = Math.ceil(10 * distanceTiles * remote.sources / haulerCarry);

        room.memory.remoteRooms[remote.name] = {
            sources:        remote.sources,
            miners:         remote.sources,   // 1 big miner per source
            haulers:        Math.max(1, haulersNeeded),
            reservedUntil:  remote.reservedUntil,
        };
    }
}

// ─── Room selection ───────────────────────────────────────────────────────────

interface CandidateRoom {
    name:          string;
    sources:       number;
    reservedUntil: number;
}

function findCandidateRooms(home: Room): CandidateRoom[] {
    const exits = Game.map.describeExits(home.name);
    if (!exits) return [];

    const ownedNames = new Set(
        Object.values(Game.rooms)
            .filter(r => r.controller?.my)
            .map(r => r.name)
    );

    const candidates: CandidateRoom[] = [];

    for (const roomName of Object.values(exits).filter((n): n is string => !!n)) {
        if (ownedNames.has(roomName)) continue;
        if (Game.map.getRoomStatus(roomName).status !== 'normal') continue;

        const intel = Memory.roomIntel?.[roomName];
        // Skip if last scan showed an enemy owner (don't try to harvest occupied rooms)
        if (intel?.controllerOwned) continue;
        // Skip if hostile combat creeps spotted recently (< 200t ago)
        if (intel && intel.enemyCreeps > 0 && Game.time - intel.scannedAt < 200) continue;

        const ctrl = Game.rooms[roomName]?.controller;
        const reservedUntil = ctrl?.reservation?.ticksToEnd ?? 0;
        const sources = intel?.sourceCount ?? (Game.rooms[roomName]?.find(FIND_SOURCES).length ?? 1);

        candidates.push({ name: roomName, sources, reservedUntil });
    }

    // Prefer rooms with more sources, then alphabetical for stability
    return candidates.sort((a, b) => b.sources - a.sources || a.name.localeCompare(b.name));
}

// ─── Distance-based hauler math ───────────────────────────────────────────────

// Approximate round-trip tile count for a cross-room trip.
// Adjacent room (linear distance = 1) ≈ 110 tiles round trip on roads.
function estimateRoundTripTiles(home: string, remote: string): number {
    const dist = Game.map.getRoomLinearDistance(home, remote);
    return (dist * 50 + 5) * 2; // 50 tiles/room + 5 for exits, doubled for return
}

// How much energy the best-available hauler body can carry given the room's cap.
// Mirrors the haulerBody() logic in bodyBuilder.ts: [CC,M] units at 150e each.
function bestHaulerCarry(energyCap: number): number {
    const units = Math.min(Math.floor(energyCap / 150), 10);
    return units * 100; // each CC unit = 100e capacity
}
