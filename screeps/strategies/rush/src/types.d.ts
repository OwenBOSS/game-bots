export type RushPhase = 'ECONOMY' | 'MUSTERING' | 'ATTACK';

declare global {
    const console: { log(...args: any[]): void; error(...args: any[]): void };
    interface CreepMemory {
        role: 'harvester' | 'attacker';
        working: boolean;
        targetRoomName?: string;
    }

    interface Memory {
        rushPhase?: RushPhase;
        enemySpawnId?: Id<StructureSpawn>;
        attackWaveTick?: number;
    }
}

export {};
