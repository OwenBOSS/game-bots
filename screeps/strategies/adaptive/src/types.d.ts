export type GamePhase     = 'ECONOMY' | 'ASSESS' | 'RUSH' | 'DEFEND';
export type CombatState   = 'RALLY' | 'MARCH' | 'ENGAGE';
export type ExpansionState = 'IDLE' | 'CLAIMING' | 'BOOTSTRAPPING' | 'ACTIVE';
export type TacticType    = 'DIRECT' | 'FLANK' | 'FEINT' | 'MAIN';

export interface PlatoonOrder {
    tactic: TacticType;
    waypointRoom?: string;  // FLANK/MAIN: travel through this room first
    engageTick?: number;    // MAIN: don't enter enemy room until this tick
    feintEndTick?: number;  // FEINT: retreat after this tick
}
export type CreepRole =
    | 'harvester' | 'hauler' | 'upgrader' | 'builder' | 'repairer'
    | 'scout' | 'claimer'
    | 'warrior' | 'ranger' | 'healer';

declare global {
    const console: { log(...args: any[]): void; error(...args: any[]): void };

    interface RoomIntel {
        scannedAt: number;
        enemyCreeps: number;
        enemySpawns: number;
        enemyTowers: number;
        strength: number;
        hasController: boolean;
        controllerOwned: boolean;
        sourceCount: number;
    }

    interface RoomThreat {
        detectedAt:   number;  // tick when first detected
        lastSeenAt:   number;  // most recent confirmation tick
        hostileCount: number;
        strength:     number;  // sum of threat scores across all dangerous hostiles
        severity:     'WARNING' | 'ACTIVE';
        fromRoom?:    string;  // adjacent room where scouts first saw the threat approaching
    }

    interface CreepMemory {
        role: CreepRole;
        working: boolean;
        targetRoomName?: string;
        scoutComplete?: boolean;
        sourceId?: Id<Source>;   // harvesters: assigned source
        platoonId?: string;      // warriors/rangers: rally group id
        homeRoom?: string;       // room this creep was spawned in; used for retreat and dispatch recall
        defendingRoom?: string;  // set by defenseManager when this unit is dispatched to a remote room
    }

    // Per-room economy tracking (stored on room.memory so multi-room setups don't clobber each other)
    interface RoomMemory {
        energyHistory?: {
            tick: number; avail: number;
            containerFillPct?: number;   // avg fill % across all containers (0–100)
            sourceDepletedPct?: number;  // % of sources currently at 0 energy (0–100)
        }[];
        energyStatus?: {
            netRate: number; trend: number; pct: number;
            level: 'SURPLUS' | 'STABLE' | 'DEFICIT' | 'CRITICAL';
            bottleneck: 'HARVESTER_SHORTAGE' | 'HAULER_SHORTAGE' | 'SOURCE_MAXED' | 'BALANCED';
        };
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
        // Tactics
        platoonOrders?: Record<string, import('../types').PlatoonOrder>;
        coordinatedAttackTick?: number;
        // Per-room threat registry — key is the name of OUR room being threatened
        roomThreats?: Record<string, RoomThreat>;
        // Expansion
        expansionState?: ExpansionState;
        expansionTarget?: string;
        expansionRoomName?: string;
        // Analytics log — rolling history, dumpable via JSON.stringify(Memory.statsLog)
        statsLog?: StatSnapshot[];
    }

    interface StatSnapshot {
        tick:    number;
        phase:   string;
        rcl:     number;
        energy:  { avail: number; cap: number };
        creeps:  Record<string, number>;
        ctrl:    { pct: number; progress: number; total: number } | null;
        structs: { roads: number; containers: number; extensions: number; towers: number; ramparts: number };
        combat:  { state: string; warriors: number; rangers: number; target: string | null };
    }
}

export {};
