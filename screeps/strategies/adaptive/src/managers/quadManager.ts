// Quad squad manager.
// Forms 4-creep attack groups (2 warriors + 2 rangers) for coordinated assault.
//
// Advantages over individual platoons:
//  - Focused fire drains one tower at a time (empty tower = neutralized)
//  - Mutual ranged-heal keeps the quad alive much longer
//  - Combined body parts survive damage that would kill any individual
//
// Quad states follow room.memory.combatState (RALLY/MARCH/ENGAGE).
// Each quad has a leader (isQuadLeader=true) who picks targets.
// Non-leaders move to stay within 2 tiles of the leader.

const QUAD_SIZE      = 4; // 2 warriors + 2 rangers
const FORM_UP_RANGE  = 2; // non-leaders stay within this many tiles of leader

export function manageQuads(room: Room): void {
    if ((room.memory.combatState ?? 'RALLY') === 'RALLY') {
        formQuads(room);
    }
    // MARCH/ENGAGE: individual roles handle movement, quadManager handles targeting
    if ((room.memory.combatState ?? 'RALLY') !== 'RALLY') {
        coordinateQuadTargets(room);
    }
}

// ─── Formation ────────────────────────────────────────────────────────────────

// Groups unassigned fighters into quads when enough units are available.
function formQuads(room: Room): void {
    const fighters = room.find(FIND_MY_CREEPS, {
        filter: c =>
            (c.memory.role === 'warrior' || c.memory.role === 'ranger') &&
            c.memory.homeRoom === room.name &&
            !c.memory.quadId,
    });

    const warriors = fighters.filter(c => c.memory.role === 'warrior');
    const rangers  = fighters.filter(c => c.memory.role === 'ranger');

    // Form quads as long as we have 2 warriors + 2 rangers available
    let quadIndex = nextQuadIndex(room.name);
    while (warriors.length >= 2 && rangers.length >= 2) {
        const quadId  = `quad_${room.name}_${quadIndex++}`;
        const members = [
            warriors.splice(0, 2),
            rangers.splice(0, 2),
        ].flat();

        members[0].memory.quadId        = quadId;
        members[0].memory.isQuadLeader  = true;
        for (const m of members.slice(1)) {
            m.memory.quadId       = quadId;
            m.memory.isQuadLeader = false;
        }
    }
}

function nextQuadIndex(roomName: string): number {
    let max = 0;
    for (const name in Game.creeps) {
        const qid = Game.creeps[name].memory.quadId;
        if (qid && qid.startsWith(`quad_${roomName}_`)) {
            const n = parseInt(qid.split('_').pop() ?? '0', 10);
            if (n >= max) max = n + 1;
        }
    }
    return max;
}

// ─── Coordinated targeting ───────────────────────────────────────────────────

// All members of a quad focus the same target — the tower with lowest energy first
// (drain it completely → neutralize it), then enemy creeps, then spawns.
function coordinateQuadTargets(room: Room): void {
    const quadIds = new Set<string>();
    for (const name in Game.creeps) {
        const qid = Game.creeps[name].memory.quadId;
        if (qid) quadIds.add(qid);
    }

    for (const quadId of quadIds) {
        const members = Object.values(Game.creeps).filter(c => c.memory.quadId === quadId);
        const leader  = members.find(c => c.memory.isQuadLeader);
        if (!leader || leader.room.name !== room.name) continue;

        const target = pickQuadTarget(leader.room);
        if (!target) continue;

        // Share the target ID with all quad members so they all focus it
        for (const m of members) {
            m.memory.targetId = target.id as string;
        }
    }
}

// Tower with lowest energy (drain focus) → hostile creep (most ATTACK parts) → spawn → structure
function pickQuadTarget(room: Room): Creep | AnyOwnedStructure | null {
    const towers = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_TOWER,
    }) as StructureTower[];

    if (towers.length > 0) {
        // Target the least-charged tower — empty towers are fully neutralized
        return towers.reduce((a, b) =>
            a.store[RESOURCE_ENERGY] < b.store[RESOURCE_ENERGY] ? a : b
        );
    }

    const creeps = room.find(FIND_HOSTILE_CREEPS);
    if (creeps.length > 0) {
        return creeps.reduce((a, b) => threatScore(b) > threatScore(a) ? b : a);
    }

    const spawns = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: s => s.structureType === STRUCTURE_SPAWN,
    });
    if (spawns.length > 0) return spawns[0] as AnyOwnedStructure;

    return room.find(FIND_HOSTILE_STRUCTURES)[0] as AnyOwnedStructure ?? null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Called by warrior/ranger roles: move non-leaders to stay near their leader.
export function followQuadLeader(creep: Creep): boolean {
    if (!creep.memory.quadId || creep.memory.isQuadLeader) return false;

    const leader = Object.values(Game.creeps).find(c =>
        c.memory.quadId === creep.memory.quadId && c.memory.isQuadLeader
    );
    if (!leader || leader.room.name !== creep.room.name) return false;

    const range = creep.pos.getRangeTo(leader);
    if (range > FORM_UP_RANGE) {
        creep.moveTo(leader, { reusePath: 2 });
        return true; // consumed movement action
    }
    return false;
}

function threatScore(c: Creep): number {
    return c.body.reduce((n, p) => {
        if (p.type === ATTACK)        return n + 3;
        if (p.type === RANGED_ATTACK) return n + 2;
        if (p.type === HEAL)          return n + 1;
        return n;
    }, 0);
}
