// Screeps runtime globals — injected by the game engine, mocked here for tests.

// Body part constants
(global as any).WORK          = 'work';
(global as any).MOVE          = 'move';
(global as any).CARRY         = 'carry';
(global as any).ATTACK        = 'attack';
(global as any).RANGED_ATTACK = 'ranged_attack';
(global as any).HEAL          = 'heal';
(global as any).TOUGH         = 'tough';
(global as any).CLAIM         = 'claim';

// Body part costs (energy per part)
(global as any).BODYPART_COST = {
    work: 100,
    move: 50,
    carry: 50,
    attack: 80,
    ranged_attack: 150,
    heal: 250,
    tough: 10,
    claim: 600,
};

// Find constants
(global as any).FIND_MY_CREEPS          = 104;
(global as any).FIND_STRUCTURES         = 107;
(global as any).FIND_MY_STRUCTURES      = 108;
(global as any).FIND_SOURCES            = 105;
(global as any).FIND_SOURCES_ACTIVE     = 112;
(global as any).FIND_DROPPED_RESOURCES  = 106;
(global as any).FIND_CONSTRUCTION_SITES = 109;
(global as any).FIND_HOSTILE_CREEPS     = 103;
(global as any).FIND_MY_SPAWNS          = 101;
(global as any).FIND_SCORES             = 10031; // Season 10

// Look constants
(global as any).LOOK_SCORE = 'score';

// Season 10 constants
(global as any).SCORE_SPAWN_CHANCE          = 0.01;
(global as any).SCORE_SPAWN_INTERVAL_TICKS  = 250;

// Structure / resource constants
(global as any).STRUCTURE_CONTAINER  = 'container';
(global as any).STRUCTURE_EXTENSION  = 'extension';
(global as any).STRUCTURE_TOWER      = 'tower';
(global as any).STRUCTURE_ROAD       = 'road';
(global as any).STRUCTURE_RAMPART    = 'rampart';
(global as any).STRUCTURE_LINK       = 'link';
(global as any).STRUCTURE_TERMINAL   = 'terminal';
(global as any).STRUCTURE_STORAGE    = 'storage';
(global as any).STRUCTURE_SPAWN      = 'spawn';
(global as any).STRUCTURE_OBSERVER   = 'observer';
(global as any).RESOURCE_ENERGY      = 'energy';

// Find constants (additional)
(global as any).FIND_CONSTRUCTION_SITES  = 109;

// Return codes
(global as any).OK                       = 0;
(global as any).ERR_NOT_IN_RANGE         = -9;
(global as any).ERR_FULL                 = -8;
(global as any).ERR_NOT_ENOUGH_RESOURCES = -6;
(global as any).ERR_NO_PATH              = -2;
(global as any).ERR_INVALID_ARGS         = -10;
(global as any).ERR_INVALID_TARGET       = -7;

// Game singleton — tests mutate this per-suite
(global as any).Game = {
    time: 1000,
    rooms: {} as Record<string, any>,
    creeps: {} as Record<string, any>,
    getObjectById: (_id: string) => null,
    map: {
        getRoomLinearDistance: (_a: string, _b: string) => 1,
        describeExits: (_roomName: string) => ({
            1: 'W1N2',
            3: 'W2N1',
            5: 'W1N0',
            7: 'W0N1',
        }),
    },
};

// Memory singleton
(global as any).Memory = {
    scoreMap: {} as Record<string, any>,
    scoreCache: {} as Record<string, any>,
    knownRooms: [] as string[],
    observerIndex: 0,
    observerTargets: [] as string[],
};
