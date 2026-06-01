declare global {
    // Screeps provides console globally but it's not in the ES2017 lib
    const console: { log(...args: any[]): void; error(...args: any[]): void };

    interface CreepMemory {
        role: 'harvester' | 'upgrader' | 'builder';
        working: boolean;
        targetId?: Id<Source | StructureSpawn | StructureExtension | StructureController | ConstructionSite>;
    }

    interface Memory {
        uuid: number;
    }
}

export {};
