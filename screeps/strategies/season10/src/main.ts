import { resetTickCache } from './utils/tickCache';
import { trackScores } from './managers/scoreTracker';
import { manageSpawns } from './managers/spawnManager';
import { checkRCTransition } from './managers/rcTransitionManager';
import { manageConstruction } from './managers/constructionManager';
import { manageTowers } from './managers/towerManager';
import { runObserver } from './managers/observerManager';
import { runHarvester } from './roles/harvester';
import { runHauler } from './roles/hauler';
import { runCollector } from './roles/collector';
import { runScout } from './roles/scout';
import { runBuilder } from './roles/builder';
import { runHunter } from './roles/hunter';
import { runUpgrader } from './roles/upgrader';
import { runDefender } from './roles/defender';

export function loop(): void {
    // 1. Reset per-tick find() cache (CPU budget: avoids duplicate room.find calls)
    resetTickCache();

    // 2. Clean up dead creeps from memory
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) delete Memory.creeps[name];
    }

    // 3. Initialize Memory
    if (!Memory.scoreMap)        Memory.scoreMap        = {};
    if (!Memory.scoreCache)      Memory.scoreCache       = {};
    if (!Memory.knownRooms)      Memory.knownRooms       = [];
    if (!Memory.roomIntel)       Memory.roomIntel        = {};
    if (!Memory.observerTargets) Memory.observerTargets  = [];
    if (Memory.observerIndex === undefined) Memory.observerIndex = 0;

    // 4. Track scores in all visible rooms (throttled to every 10 ticks inside trackScores)
    for (const roomName in Game.rooms) {
        trackScores(Game.rooms[roomName]);
    }

    // 5. Per-owned-room managers
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller?.my) continue;

        checkRCTransition(room);
        manageConstruction(room);
        manageTowers(room);
        manageSpawns(room);

        // RC8: run observer rotation once per tick
        if ((room.memory as RoomMemory).observerEnabled) {
            const observers = room.find(FIND_MY_STRUCTURES).filter(
                (s: AnyStructure) => s.structureType === STRUCTURE_OBSERVER
            ) as StructureObserver[];
            if (observers.length > 0) runObserver(observers[0]);
        }
    }

    // 6. Run creep roles
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        switch (creep.memory.role) {
            case 'harvester': runHarvester(creep); break;
            case 'hauler':    runHauler(creep);    break;
            case 'collector': runCollector(creep); break;
            case 'scout':     runScout(creep);     break;
            case 'builder':   runBuilder(creep);   break;
            case 'hunter':    runHunter(creep);    break;
            case 'upgrader':  runUpgrader(creep);  break;
            case 'defender':  runDefender(creep);  break;
        }
    }

    // 7. Stats dump every 50 ticks
    if (Game.time % 50 === 0) {
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room.controller?.my) continue;

            const allCreeps = Object.values(Game.creeps).filter(c => c.room.name === roomName);
            const counts: Record<string, number> = {};
            for (const c of allCreeps) {
                counts[c.memory.role] = (counts[c.memory.role] ?? 0) + 1;
            }

            const topScoreRooms = Object.entries(Memory.scoreMap ?? {})
                .sort((a, b) => b[1].score - a[1].score)
                .slice(0, 3)
                .map(([r, d]) => `${r}(${d.score})`);

            console.log(`=== season10:stats:${roomName}:${Game.time} ===`);
            console.log(JSON.stringify({
                tick: Game.time,
                rcl: room.controller?.level,
                energy: { avail: room.energyAvailable, cap: room.energyCapacityAvailable },
                creeps: counts,
                totalCreeps: allCreeps.length,
                scoreRooms: Object.keys(Memory.scoreMap ?? {}).length,
                topScores: topScoreRooms,
                cachedScores: Object.keys(Memory.scoreCache ?? {}).length,
            }));
        }
    }
}
