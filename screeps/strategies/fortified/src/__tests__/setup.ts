// Screeps runtime globals injected by the game engine — mocked here for tests.

(global as any).WORK          = 'work';
(global as any).MOVE          = 'move';
(global as any).CARRY         = 'carry';
(global as any).ATTACK        = 'attack';
(global as any).RANGED_ATTACK = 'ranged_attack';
(global as any).HEAL          = 'heal';
(global as any).TOUGH         = 'tough';
(global as any).CLAIM         = 'claim';

(global as any).FIND_MY_CREEPS          = 104;
(global as any).FIND_STRUCTURES         = 107;
(global as any).FIND_MY_STRUCTURES      = 108;
(global as any).FIND_SOURCES            = 105;
(global as any).FIND_SOURCES_ACTIVE     = 112;
(global as any).FIND_DROPPED_RESOURCES  = 106;
(global as any).FIND_CONSTRUCTION_SITES = 109;
(global as any).FIND_MY_SPAWNS          = 101;

(global as any).STRUCTURE_CONTAINER  = 'container';
(global as any).STRUCTURE_EXTENSION  = 'extension';
(global as any).STRUCTURE_TOWER      = 'tower';
(global as any).STRUCTURE_ROAD       = 'road';
(global as any).STRUCTURE_RAMPART    = 'rampart';
(global as any).STRUCTURE_LINK       = 'link';
(global as any).STRUCTURE_STORAGE    = 'storage';
(global as any).STRUCTURE_SPAWN      = 'spawn';
(global as any).RESOURCE_ENERGY      = 'energy';
(global as any).TERRAIN_MASK_WALL    = 1;

(global as any).OK                       = 0;
(global as any).ERR_NOT_IN_RANGE         = -9;
(global as any).ERR_FULL                 = -8;
(global as any).ERR_NOT_ENOUGH_RESOURCES = -6;
(global as any).ERR_INVALID_TARGET       = -7;

(global as any).BODYPART_COST = {
    work: 100,
    move: 50,
    carry: 50,
    heal: 250,
    attack: 80,
    ranged_attack: 150,
    tough: 10,
    claim: 600,
};

(global as any).Game = {
    time: 1000,
    rooms: {} as Record<string, any>,
    creeps: {} as Record<string, any>,
    getObjectById: (_id: string) => null,
};

(global as any).Memory = {
    creeps: {} as Record<string, any>,
};
