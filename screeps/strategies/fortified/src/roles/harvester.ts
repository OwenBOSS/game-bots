// Stationary harvester: body has no MOVE parts — it is towed to the source by a
// paired hauler. Once atSource=true it mines in-place and deposits to adjacent
// extensions/spawn without ever moving.
export function runHarvester(creep: Creep): void {
    if (!creep.memory.atSource) return;

    const sourceId = creep.memory.sourceId;
    if (!sourceId) return;
    const source = Game.getObjectById(sourceId as Id<Source>);
    if (!source) return;

    if (creep.pos.getRangeTo(source) > 1) return;

    creep.harvest(source);

    if (creep.store.getFreeCapacity() === 0) {
        const target = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
            filter: (s: AnyStructure) =>
                (s.structureType === STRUCTURE_EXTENSION || s.structureType === STRUCTURE_SPAWN) &&
                (s as StructureExtension).store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        })[0] as StructureExtension | StructureSpawn | undefined;
        if (target) creep.transfer(target, RESOURCE_ENERGY);
    }
}
