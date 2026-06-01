export type GamePhase = 'ECONOMY' | 'ASSESS' | 'RUSH' | 'DEFEND';
export type CombatState = 'RALLY' | 'MARCH' | 'ENGAGE';

declare global {
    const console: { log(...args: any[]): void; error(...args: any[]): void };

    interface RoomIntel {
        scannedAt: number;
        enemyCreeps: number;
        enemySpawns: number;
        enemyTowers: number;
        strength: number;
    }

    interface CreepMemory {
        role: 'harvester' | 'builder' | 'scout' | 'warrior';
        working: boolean;
        targetRoomName?: string;
        scoutComplete?: boolean;
    }

    interface Memory {
        phase?: GamePhase;
        roomIntel: Record<string, RoomIntel>;
        enemyRoomName?: string;
        enemyStrength?: number;
        scoutTick?: number;
        phaseTick?: number;
        combatState?: CombatState;
        rallyTick?: number;
        roadsPlanned?: boolean;
        lastRCL?: number;
    }
}

export {};
