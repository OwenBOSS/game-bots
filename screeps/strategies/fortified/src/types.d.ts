// Ambient declarations — no imports/exports so these are globally available.

type FortifiedRole = 'bootstrap' | 'harvester' | 'hauler' | 'upgrader';
type BootstrapPhase = 'seek' | 'build' | 'mine';
type HaulerPhase = 'tow' | 'collect' | 'deliver';

interface CreepMemory {
    role: FortifiedRole;
    homeRoom?: string;
    // harvester
    sourceId?: Id<Source>;
    atSource?: boolean;
    // hauler
    towTarget?: string;       // harvester creep name
    haulerPhase?: HaulerPhase;
    targetId?: string;        // cached delivery target id
    // bootstrap
    bootstrapPhase?: BootstrapPhase;
    // shared
    working?: boolean;
}

interface RoomMemory {
    fortifiedPhase?: 'bootstrap' | 'transition' | 'steady';
}
