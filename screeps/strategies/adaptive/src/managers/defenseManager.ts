// Multi-room defense coordinator.
//
// Runs once per owned room per tick. Maintains Memory.roomThreats:
//   WARNING  — scout intel shows enemy combat creeps in an adjacent room
//   ACTIVE   — dangerous hostiles are physically inside this room right now
//
// When a room goes ACTIVE, any combat units that are currently rallying in a
// safe room (combatState === 'RALLY', not yet on an offensive mission) are
// dispatched there via creep.memory.defendingRoom. They return home when the
// threat clears.
//
// This layer is orthogonal to the global RALLY/MARCH/ENGAGE offense machine.
// Offense campaigns continue uninterrupted; only idle (RALLY) units are
// redirected for defense.

const THREAT_CLEAR_TICKS = 50;   // ticks without hostile sighting before clearing
const WARNING_MAX_AGE    = 100;  // scout intel must be this fresh to trigger WARNING

export function manageDefense(room: Room): void {
    if (!Memory.roomThreats) Memory.roomThreats = {};
    detectActiveThreats(room);
    checkEarlyWarnings(room);
    dispatchAndRecall();
}

// ─── Threat detection ─────────────────────────────────────────────────────────

function detectActiveThreats(room: Room): void {
    const hostiles = room.find(FIND_HOSTILE_CREEPS, {
        filter: c => c.body.some(p =>
            p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK
        ),
    });

    if (hostiles.length > 0) {
        const str  = hostiles.reduce((s, c) => s + threatScore(c), 0);
        const prev = Memory.roomThreats![room.name];
        Memory.roomThreats![room.name] = {
            detectedAt:   prev?.detectedAt ?? Game.time,
            lastSeenAt:   Game.time,
            hostileCount: hostiles.length,
            strength:     str,
            severity:     'ACTIVE',
            fromRoom:     prev?.fromRoom,
        };
        if (!prev || prev.severity !== 'ACTIVE') {
            console.log(`[defense] ⚠️ ACTIVE in ${room.name}: ${hostiles.length} hostiles str=${str}`);
        }
        return;
    }

    // No hostiles — age out ACTIVE threats
    const prev = Memory.roomThreats![room.name];
    if (prev?.severity === 'ACTIVE' && Game.time - prev.lastSeenAt > THREAT_CLEAR_TICKS) {
        delete Memory.roomThreats![room.name];
        console.log(`[defense] ✓ Threat cleared in ${room.name}`);
    }
}

// ─── Early warning ────────────────────────────────────────────────────────────
// Uses recent scout intel to warn before enemies enter our room.

function checkEarlyWarnings(room: Room): void {
    // Don't downgrade an ACTIVE threat to a WARNING
    if (Memory.roomThreats![room.name]?.severity === 'ACTIVE') return;

    const exits = Game.map.describeExits(room.name);
    if (!exits) return;

    const intel = Memory.roomIntel ?? {};
    let bestNeighbor: string | undefined;
    let bestStrength = 0;

    for (const neighbor of Object.values(exits)) {
        if (!neighbor) continue;
        const data = intel[neighbor];
        if (!data) continue;
        if (Game.time - data.scannedAt > WARNING_MAX_AGE) continue; // stale intel
        if (data.enemyCreeps === 0) continue;
        if (data.strength > bestStrength) {
            bestStrength = data.strength;
            bestNeighbor = neighbor;
        }
    }

    if (bestNeighbor) {
        const prev = Memory.roomThreats![room.name];
        Memory.roomThreats![room.name] = {
            detectedAt:   prev?.detectedAt ?? Game.time,
            lastSeenAt:   Game.time,
            hostileCount: intel[bestNeighbor]?.enemyCreeps ?? 0,
            strength:     bestStrength,
            severity:     'WARNING',
            fromRoom:     bestNeighbor,
        };
        if (!prev) {
            console.log(`[defense] ⚡ WARNING for ${room.name}: enemy movement in ${bestNeighbor} str=${bestStrength}`);
        }
        return;
    }

    // No warning found — age out stale WARNINGs
    const prev = Memory.roomThreats![room.name];
    if (prev?.severity === 'WARNING' && Game.time - prev.lastSeenAt > THREAT_CLEAR_TICKS) {
        delete Memory.roomThreats![room.name];
    }
}

// ─── Dispatch & recall ────────────────────────────────────────────────────────
// Iterates all creeps globally. Called multiple times per tick (once per owned room)
// but is idempotent — already-dispatched units are skipped.

function dispatchAndRecall(): void {
    const threats = Memory.roomThreats ?? {};

    // Recall defenders whose threat has resolved
    for (const creep of Object.values(Game.creeps)) {
        const assigned = creep.memory.defendingRoom;
        if (!assigned) continue;
        if (threats[assigned]?.severity === 'ACTIVE') continue;
        // Threat gone — send home
        console.log(`[defense] Recalling ${creep.name} from ${assigned} → ${creep.memory.homeRoom ?? 'unknown'}`);
        creep.memory.defendingRoom  = undefined;
        creep.memory.targetRoomName = creep.memory.homeRoom;
    }

    // Dispatch idle units to active threats
    const activeThreats = Object.entries(threats).filter(([, t]) => t.severity === 'ACTIVE');
    if (activeThreats.length === 0) return;

    for (const [threatenedRoom] of activeThreats) {
        for (const creep of Object.values(Game.creeps)) {
            if (
                creep.memory.role !== 'warrior' &&
                creep.memory.role !== 'ranger'  &&
                creep.memory.role !== 'healer'
            ) continue;
            if (creep.memory.defendingRoom) continue;  // already on a mission
            if (!creep.memory.homeRoom) continue;      // no homeRoom — legacy creep, skip

            // Only dispatch from rooms that are not themselves under active threat
            if (threats[creep.memory.homeRoom]?.severity === 'ACTIVE') continue;

            // Only dispatch units currently in their home room (they're in RALLY state)
            if (creep.room.name !== creep.memory.homeRoom) continue;

            // Don't pull from an active offense campaign
            if (Memory.combatState !== 'RALLY') continue;

            creep.memory.defendingRoom  = threatenedRoom;
            creep.memory.targetRoomName = threatenedRoom;
            console.log(`[defense] Dispatching ${creep.name} (${creep.memory.role}) ${creep.memory.homeRoom} → ${threatenedRoom}`);
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function threatScore(creep: Creep): number {
    return creep.body.reduce((n, p) => {
        if (p.type === ATTACK)        return n + 3;
        if (p.type === RANGED_ATTACK) return n + 2;
        if (p.type === WORK)          return n + 1;
        return n;
    }, 0);
}
