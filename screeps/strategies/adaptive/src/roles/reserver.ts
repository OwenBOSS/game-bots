// Reserver: keeps a neutral adjacent room's controller reserved so no one else can claim it.

import { moveTo } from '../utils/trafficManager';
// Reservation costs 1 CLAIM part and lasts up to 5000 ticks (refreshed each call).
// Reserved rooms cannot be claimed by other players — they remain neutral so we can
// harvest their sources without spending a GCL slot.
//
// creep.memory.targetRoomName — room whose controller to reserve

export function runReserver(creep: Creep): void {
    const target = creep.memory.targetRoomName;
    if (!target) return;

    if (creep.room.name !== target) {
        moveToRoom(creep, target);
        return;
    }

    const ctrl = creep.room.controller;
    if (!ctrl) return;

    // Already claimed by us — shouldn't happen but handle gracefully
    if (ctrl.my) return;

    // Reserving: each call with CLAIM+MOVE adds 600t to reservation (cap 5000t)
    const result = creep.reserveController(ctrl);
    if (result === ERR_NOT_IN_RANGE) {
        moveTo(creep,ctrl, { reusePath: 10 });
    }
}

function moveToRoom(creep: Creep, roomName: string): void {
    const exitDir = creep.room.findExitTo(roomName);
    if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByRange(exitDir);
        if (exit) moveTo(creep,exit, { reusePath: 5 });
    }
}
