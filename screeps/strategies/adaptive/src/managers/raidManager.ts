// Economy-first raiding system.
//
// All raiding serves the goal of improving our relative economy:
//   - Capture energy from enemy harvesters and haulers
//   - Deny the enemy their income by destroying economy creeps
//   - Abort immediately when the operation becomes unprofitable
//
// Halting criterion: if total energy spent on raids exceeds energy captured
// over the last 500 ticks, halt all raids until the balance recovers.

const RAID_STRENGTH_MAX  = 15;
const RAID_INTEL_MAX_AGE = 500;
const RAID_ECON_WINDOW   = 500;

type RaidPosture = 'NONE' | 'OPPORTUNISTIC' | 'ORGANIZED' | 'FULL';

interface RaidComposition { attackers: number; rangers: number; haulers: number; }

interface RetreatOpts {
    scavengers:    Array<{ store: { getFreeCapacity: () => number } }>;
    hostiles:      Array<{ body: Array<{ type: string }> }>;
    militaryUnits: Array<{ hits: number; hitsMax: number }>;
}

interface RaidEntry   { tick: number; captured: number; spent: number; }
interface RaidEconomy { entries: RaidEntry[]; }

// ─── Operational posture ──────────────────────────────────────────────────────

export function getOperationalPosture(rcl: number): RaidPosture {
    if (rcl <= 2) return 'NONE';
    if (rcl <= 4) return 'OPPORTUNISTIC';
    if (rcl <= 6) return 'ORGANIZED';
    return 'FULL';
}

// ─── Viability ────────────────────────────────────────────────────────────────

export function isRaidViable(targetRoomName: string): boolean {
    const intel = Memory.roomIntel?.[targetRoomName];
    if (!intel) return false;
    if (Game.time - intel.scannedAt > RAID_INTEL_MAX_AGE) return false;
    if (intel.enemyTowers  > 0)                return false;
    if (intel.strength     > RAID_STRENGTH_MAX) return false;
    return true;
}

// ─── Target selection ─────────────────────────────────────────────────────────

export function selectRaidTarget(room: Room): string | null {
    const intel       = Memory.roomIntel ?? {};
    const remoteRooms = (room.memory as any).remoteRooms as Record<string, unknown> ?? {};

    let best:         string | null = null;
    let bestStrength: number        = Infinity;

    for (const [roomName, data] of Object.entries(intel)) {
        if (Game.rooms[roomName]?.controller?.my) continue;
        if (remoteRooms[roomName])                 continue;
        if (data.strength === 0)                   continue;
        if (!isRaidViable(roomName))               continue;
        if (data.strength < bestStrength) {
            bestStrength = data.strength;
            best         = roomName;
        }
    }

    return best;
}

// ─── Composition ─────────────────────────────────────────────────────────────

export function getRaidComposition(rcl: number): RaidComposition {
    switch (getOperationalPosture(rcl)) {
        case 'NONE':          return { attackers: 0, rangers: 0, haulers: 0 };
        case 'OPPORTUNISTIC': return { attackers: 1, rangers: 0, haulers: 2 };
        case 'ORGANIZED':     return { attackers: 2, rangers: 1, haulers: 3 };
        case 'FULL':          return { attackers: 2, rangers: 2, haulers: 3 };
    }
}

// ─── Strike target ────────────────────────────────────────────────────────────
// Priority: harvesters (WORK) > laden haulers > empty haulers
// Returns null if a tower is present (abort — too dangerous) or room is empty.

export function pickStrikeTarget(room: Room): Creep | null {
    const towers = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: (s: AnyStructure) => s.structureType === STRUCTURE_TOWER,
    });
    if (towers.length > 0) return null;

    const hostiles = room.find(FIND_HOSTILE_CREEPS) as Creep[];
    if (hostiles.length === 0) return null;

    const harvesters = hostiles.filter(c => c.body.some(p => p.type === WORK));
    if (harvesters.length > 0) return harvesters[0];

    const laden = hostiles.filter(c =>
        c.body.some(p => p.type === CARRY) && (c as any).store.energy > 0
    );
    if (laden.length > 0) return laden[0];

    return hostiles.find(c => c.body.some(p => p.type === CARRY)) ?? null;
}

// ─── Retreat logic ────────────────────────────────────────────────────────────

export function shouldRetreat(opts: RetreatOpts): boolean {
    const { scavengers, hostiles, militaryUnits } = opts;

    if (scavengers.length > 0 && scavengers.every(s => s.store.getFreeCapacity() === 0)) {
        return true;
    }
    if (militaryUnits.some(u => u.hits < u.hitsMax)) return true;
    if (hostiles.some(c => c.body.some(p => p.type === ATTACK || p.type === RANGED_ATTACK))) {
        return true;
    }

    return false;
}

// ─── Economy tracking ─────────────────────────────────────────────────────────

export function trackRaidNetEnergy(
    roomName:       string,
    capturedEnergy: number,
    spentEnergy:    number,
): void {
    const mem = Memory as any;
    if (!mem.raidEconomy)           mem.raidEconomy = {};
    if (!mem.raidEconomy[roomName]) mem.raidEconomy[roomName] = { entries: [] };

    (mem.raidEconomy[roomName] as RaidEconomy).entries.push({
        tick:     Game.time,
        captured: capturedEnergy,
        spent:    spentEnergy,
    });
}

export function shouldHaltRaids(roomName: string): boolean {
    const economy = ((Memory as any).raidEconomy?.[roomName]) as RaidEconomy | undefined;
    if (!economy?.entries?.length) return false;

    const cutoff        = Game.time - RAID_ECON_WINDOW;
    const windowEntries = economy.entries.filter((e: RaidEntry) => e.tick >= cutoff);
    if (windowEntries.length === 0) return false;

    const captured = windowEntries.reduce((s: number, e: RaidEntry) => s + e.captured, 0);
    const spent    = windowEntries.reduce((s: number, e: RaidEntry) => s + e.spent,    0);
    return captured < spent;
}
