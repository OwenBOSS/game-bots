// Season 10 extends standard Screeps World with Score objects.
// All declarations here go into declare global so they're visible project-wide.

declare global {
    const console: { log(...args: any[]): void; error(...args: any[]): void };

    // Season-specific find/look constants (not in @types/screeps)
    const FIND_SCORES: 10031;
    const LOOK_SCORE: 'score';

    interface ScoreObject {
        id: Id<ScoreObject>;
        score: number;
        pos: RoomPosition;
        room: Room;
        ticksToDecay: number;
        effects?: unknown[];
    }

    interface CreepMemory {
        role: 'harvester' | 'collector' | 'hauler';
        working: boolean;
        targetId?: string;
        targetRoom?: string;
    }

    interface Memory {
        scoreMap: Record<string, { score: number; tick: number }>;
        knownRooms: string[];
    }
}

export {};
