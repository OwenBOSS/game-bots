// Season 10 extends standard Screeps World with Score objects.
// All declarations here go into declare global so they're visible project-wide.

declare global {
    const console: { log(...args: any[]): void; error(...args: any[]): void };

    // Season-specific find/look constants (not in @types/screeps)
    const FIND_SCORES: 10031;
    const LOOK_SCORE: 'score';
    const SCORE_SPAWN_CHANCE: 0.01;
    const SCORE_SPAWN_INTERVAL_TICKS: 250;

    // Body part costs
    const BODYPART_COST: Record<string, number>;

    interface Score {
        readonly id: Id<Score>;
        readonly pos: RoomPosition;
        readonly room: Room;
        readonly score: number;
        readonly ticksToDecay: number;
        readonly effects: RoomObjectEffect[];
    }

    // Legacy alias used by older files
    interface ScoreObject extends Score {}

    // Per-score entry in Memory.scoreCache
    interface ScoreCacheEntry {
        pos: { x: number; y: number; roomName: string };
        value: number;
        expiresAt: number;
    }

    type ScoreCache = Record<string, ScoreCacheEntry>;

    interface CollectorMemory {
        role: 'collector';
        working: boolean;
        targetScoreId: string | null;
        homeRoom: string;
    }

    interface CreepMemory {
        role: 'harvester' | 'collector' | 'hauler' | 'scout' | 'hunter' | 'builder';
        working: boolean;
        targetId?: string;
        targetRoom?: string;
        targetScoreId?: string | null;
        homeRoom?: string;
        sourceId?: string;
    }

    // Per-room memory fields for Season 10
    interface RoomMemory {
        rcLevel?: number;
        spawnScoutNext?: boolean;
        collectorQuota?: number;
        dynamicCollectorQuota?: boolean;
        observerEnabled?: boolean;
        containerSitesPlaced?: boolean;
        towerSitePlaced?: boolean;
        storageSitePlaced?: boolean;
        roadSitesPlaced?: boolean;
    }

    interface Memory {
        creeps: Record<string, CreepMemory>;
        rooms: Record<string, RoomMemory>;
        scoreMap: Record<string, { score: number; tick: number }>;
        scoreCache: ScoreCache;
        knownRooms: string[];
        observerIndex: number;
        observerTargets: string[];
    }

    // Augment Room.find to accept FIND_SCORES
    interface Room {
        find(type: 10031): Score[];
        lookForAt(type: 'score', x: number, y: number): Score[];
        lookForAt(type: 'score', pos: RoomPosition): Score[];
    }
}

export {};
