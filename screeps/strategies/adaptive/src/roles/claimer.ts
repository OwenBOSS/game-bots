// Claims a neutral controller in the target room.
// Once claimed, suicide — expansionManager handles the rest.

export function runClaimer(creep: Creep): void {
    const targetRoom = creep.memory.targetRoomName;
    if (!targetRoom) return;

    if (creep.room.name !== targetRoom) {
        const exitDir = creep.room.findExitTo(targetRoom);
        if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
            const exit = creep.pos.findClosestByRange(exitDir);
            if (exit) creep.moveTo(exit, { reusePath: 3 });
        }
        return;
    }

    const controller = creep.room.controller;
    if (!controller) return;

    if (controller.my) {
        console.log(`[adaptive] Room ${targetRoom} claimed at tick ${Game.time}!`);
        Memory.expansionState = 'BOOTSTRAPPING';
        Memory.expansionRoomName = targetRoom;
        creep.suicide();
        return;
    }

    // If reserved by enemy, attack the reservation first
    if (controller.reservation && controller.reservation.username !== creep.owner.username) {
        if (creep.attackController(controller) === ERR_NOT_IN_RANGE) {
            creep.moveTo(controller, { reusePath: 3 });
        }
        return;
    }

    if (creep.claimController(controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { reusePath: 3 });
    }
}
