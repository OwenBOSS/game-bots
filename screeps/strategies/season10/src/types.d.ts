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
        role: 'harvester' | 'collector' | 'hauler' | 'scout' | 'hunter' | 'builder' | 'upgrader' | 'defender';
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

    interface RoomIntel {
        tick: number;
        hasHostiles: boolean;
        scoreCount: number;
    }

    interface StatSnapshot {
        tick: number;
        rcl: number;
        energy: { avail: number; cap: number; pct: number };
        creeps: Record<string, number>;
        structs: { roads: number; containers: number; extensions: number; towers: number };
        scores: {
            activeRooms: number;
            cacheSize: number;
            topRooms: Array<{ room: string; score: number }>;
        };
        collectors: { count: number; quota: number };
    }

    interface RoomLayout {
        tick: number;
        room: string;
        rcl: number;
        sources: Array<{ id: string; x: number; y: number }>;
        controller: { id: string; x: number; y: number } | null;
        spawns: Array<{ id: string; name: string; x: number; y: number }>;
        extensions: Array<{ x: number; y: number }>;
        containers: Array<{ x: number; y: number; energy: number; capacity: number }>;
        storage: { x: number; y: number; energy: number; capacity: number } | null;
        towers: Array<{ x: number; y: number; energy: number }>;
        roads: Array<{ x: number; y: number }>;
        sites: Array<{ type: string; x: number; y: number; progress: number; total: number }>;
        ascii: string;
    }

    interface Memory {
        creeps: Record<string, CreepMemory>;
        rooms: Record<string, RoomMemory>;
        scoreMap: Record<string, { score: number; tick: number }>;
        scoreCache: ScoreCache;
        knownRooms: string[];
        roomIntel: Record<string, RoomIntel>;
        observerIndex: number;
        observerTargets: string[];
        statsLog?: StatSnapshot[];
        roomLayout?: Record<string, RoomLayout>;
    }

    // Augment Room.find to accept FIND_SCORES
    interface Room {
        find(type: 10031): Score[];
        lookForAt(type: 'score', x: number, y: number): Score[];
        lookForAt(type: 'score', pos: RoomPosition): Score[];
    }
}

export {};
