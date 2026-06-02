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
    | 'scout' | 'claimer' | 'reserver' | 'scavenger' | 'courier'
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
        sourceId?: Id<Source>;      // harvesters: assigned source
        platoonId?: string;         // warriors/rangers: rally group id
        homeRoom?: string;          // room this creep was spawned in; used for retreat and dispatch recall
        defendingRoom?: string;     // set by defenseManager when this unit is dispatched to a remote room
        scavengeRoom?: string;      // scavengers: optional remote room to loot after own room is clear
        courierTarget?: string;     // couriers: destination room to deliver energy to
        remoteRoom?: string;        // remote harvesters/haulers: which reserved room to work in
        reserveRoom?: string;       // reservers: which room's controller to keep reserved
        quadId?: string;            // quad combat units: which quad formation they belong to
        isQuadLeader?: boolean;     // quad: the unit that picks movement targets for the group
        targetId?: string;          // CPU cache: avoids findClosestByPath every tick
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
        // Per-room offense — each owned room runs its own phase + combat FSM independently
        phase?: import('../types').GamePhase;
        phaseTick?: number;            // tick of last phase change (used for cooldowns + timeouts)
        scoutTick?: number;            // tick scout completed intel on target room
        combatState?: import('../types').CombatState;
        rallyTick?: number;            // tick MARCH began (used for reassess interval)
        enemyRoomName?: string;         // current offensive target for this room
        enemyStrength?: number;         // strength score of that target
        platoonOrders?: Record<string, import('../types').PlatoonOrder>;
        coordinatedAttackTick?: number;
        // Decay-first rampart repair cache (getFortifyTarget in combatManager)
        fortifyTarget?: string;         // cached ID of highest-priority rampart to repair
        fortifyTargetTick?: number;     // tick when fortifyTarget was last computed
        // Inter-room energy balance
        energySurplus?: number;         // computed by transferManager: excess e/tick this room can donate
        // Remote mining — per-remote-room spawn targets written by remoteManager
        remoteRooms?: Record<string, {
            sources: number;            // how many sources the remote room has
            miners: number;             // target miner count for this remote room
            haulers: number;            // target remote hauler count for this remote room
            reservedUntil: number;      // tick when reservation expires (used to decide reserver respawn)
        }>;
        sourceDistances?: Record<string, number>; // sourceId → path distance to storage (cached)
        // PID controller state — drives upgrader count based on total room energy vs setpoint
        pidState?: {
            integral:  number;  // accumulated error × dt
            lastError: number;  // normalized error from previous tick
            lastTick:  number;  // game tick of previous PID call
            output:    number;  // last computed upgrader demand (0–4)
        };
    }

    interface RoomLayout {
        tick:        number;
        room:        string;
        rcl:         number;
        sources:     Array<{ id: string; x: number; y: number }>;
        controller:  { id: string; x: number; y: number } | null;
        spawns:      Array<{ id: string; name: string; x: number; y: number }>;
        extensions:  Array<{ x: number; y: number }>;
        containers:  Array<{ x: number; y: number; energy: number; capacity: number }>;
        storage:     { x: number; y: number; energy: number; capacity: number } | null;
        towers:      Array<{ x: number; y: number; energy: number }>;
        ramparts:    Array<{ x: number; y: number }>;
        roads:       Array<{ x: number; y: number }>;
        links:       Array<{ x: number; y: number }>;
        sites:       Array<{ type: string; x: number; y: number; progress: number; total: number }>;
        // 50×50 ASCII grid, rows joined with '\n'.
        // Legend: O=spawn S=source C=controller T=tower K=storage L=link e=extension
        //         c=container r=road *=site #=wall ~=swamp .=plain
        ascii:       string;
    }

    interface Memory {
        // Shared global intel — written by scout.ts, read by all rooms
        roomIntel: Record<string, RoomIntel>;
        // Construction planning — global since construction sites are room-scoped
        roadsPlanned?: boolean;
        lastRCL?: number;
        // Per-room threat registry — key is the name of OUR room being threatened
        roomThreats?: Record<string, RoomThreat>;
        // Expansion (one expansion campaign at a time, global FSM)
        expansionState?: ExpansionState;
        expansionTarget?: string;
        expansionRoomName?: string;
        // Analytics log — rolling history, dumpable via JSON.stringify(Memory.statsLog)
        statsLog?: StatSnapshot[];
        // Room layout snapshots — updated every 1000t, keyed by room name
        roomLayout?: Record<string, RoomLayout>;
        // Set to true from console to force an immediate layout capture this tick
        captureLayout?: boolean;
        captureLayoutAt?: number;
    }

    interface StatSnapshot {
        tick:    number;
        regime:  string;
        phase:   string;
        rcl:     number;
        energy:  { avail: number; cap: number; totalAvail: number; totalCap: number; netRate: number | null; bottleneck?: string | null };
        creeps:  Record<string, number>;
        ctrl:    { pct: number; progress: number; total: number } | null;
        structs: { roads: number; containers: number; extensions: number; towers: number; ramparts: number };
        combat:  { state: string; warriors: number; rangers: number; target: string | null };
    }
}

export {};
