// Tower logic — runs every tick for each tower in an owned room.
// Priority (per RC strategy Part 5):
//   1. Attack any hostile creep
//   2. Heal any allied creep below 80% hits
//   3. Repair any rampart below 10,000 hits
//   4. Repair any road below 50% hits (only if tower energy > 700)

const HEAL_THRESHOLD    = 0.8;
const RAMPART_MIN_HITS  = 10_000;
const ROAD_ENERGY_MIN   = 700;

export function manageTowers(room: Room): void {
    const towers = room.find(FIND_MY_STRUCTURES).filter(
        (s: AnyStructure) => s.structureType === STRUCTURE_TOWER
    ) as StructureTower[];

    if (towers.length === 0) return;

    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    const allies   = room.find(FIND_MY_CREEPS);
    const structs  = room.find(FIND_STRUCTURES) as AnyStructure[];

    for (const tower of towers) {
        // Priority 1: attack hostiles
        if (hostiles.length > 0) {
            tower.attack(hostiles[0] as Creep);
            continue;
        }

        // Priority 2: heal damaged allies
        const wounded = (allies as Creep[]).find(
            c => c.hits / c.hitsMax < HEAL_THRESHOLD
        );
        if (wounded) {
            tower.heal(wounded);
            continue;
        }

        // Priority 3: repair low-hit ramparts
        const lowRampart = structs.find(
            s => s.structureType === STRUCTURE_RAMPART && s.hits < RAMPART_MIN_HITS
        );
        if (lowRampart) {
            tower.repair(lowRampart);
            continue;
        }

        // Priority 4: repair degraded roads (only when energy plentiful)
        if (tower.store[RESOURCE_ENERGY] > ROAD_ENERGY_MIN) {
            const degradedRoad = structs.find(
                s => s.structureType === STRUCTURE_ROAD && s.hits / s.hitsMax < 0.5
            );
            if (degradedRoad) {
                tower.repair(degradedRoad);
            }
        }
    }
}
