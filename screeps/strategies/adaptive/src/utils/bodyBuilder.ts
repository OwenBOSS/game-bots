// Dynamic body builder — scales creep bodies to the available energy budget.
// Part ordering follows Screeps convention: TOUGH first (absorbs damage), MOVE last (stays mobile longest).

import { CreepRole } from '../types';

export function buildBody(role: CreepRole, budget: number): BodyPartConstant[] | null {
    switch (role) {
        case 'harvester':  return harvesterBody(budget);
        case 'hauler':     return haulerBody(budget);
        case 'upgrader':   return upgraderBody(budget);
        case 'builder':
        case 'repairer':   return workerBody(budget);
        case 'scavenger':  return scavengerBody(budget);
        case 'courier':    return courierBody(budget);
        case 'reserver':   return reserverBody(budget);
        case 'warrior':    return warriorBody(budget);
        case 'ranger':     return rangerBody(budget);
        case 'scout':      return scoutBody(budget);
        case 'claimer':    return claimerBody(budget);
        case 'healer':     return healerBody(budget);
        default:           return null;
    }
}

// ─── Economic roles ───────────────────────────────────────────────────────────

// Stationary harvester: maximize WORK (source saturation = 6 WORK = 12e/tick).
// Minimal CARRY + MOVE — it barely moves once assigned to a source.
function harvesterBody(budget: number): BodyPartConstant[] | null {
    if (budget < 200) return null;
    const w = Math.min(Math.floor((budget - 100) / 100), 6); // reserve 100 for CARRY+MOVE
    return [...r(WORK, w), CARRY, MOVE];
}

// Road-optimized hauler: 2 CARRY per 1 MOVE (roads halve movement cost).
// Each [CC,M] unit = 150e = 100e cargo capacity.
function haulerBody(budget: number): BodyPartConstant[] | null {
    if (budget < 150) return null;
    const units = Math.min(Math.floor(budget / 150), 10);
    return [...r(CARRY, units * 2), ...r(MOVE, units)];
}

// Dedicated upgrader: WORK-heavy with enough CARRY/MOVE to sustain near controller.
// Repeat unit [W,W,C,M] = 350e. Falls back to [W,C,M] if budget is tight.
function upgraderBody(budget: number): BodyPartConstant[] | null {
    if (budget < 200) return null;
    if (budget < 350) return [WORK, CARRY, MOVE];
    const units = Math.min(Math.floor(budget / 350), 10);
    return [...r(WORK, units * 2), ...r(CARRY, units), ...r(MOVE, units)];
}

// General worker (builder / repairer): balanced WORK, CARRY, MOVE.
// Repeat unit [W,C,M] = 200e.
function workerBody(budget: number): BodyPartConstant[] | null {
    if (budget < 200) return null;
    const units = Math.min(Math.floor(budget / 200), 8);
    return [...r(WORK, units), ...r(CARRY, units), ...r(MOVE, units)];
}

// Reserver: CLAIM + MOVE for fast travel to adjacent rooms.
// 1 CLAIM part: net 0/tick (reserves +1, decay -1 = holds flat).
// 2 CLAIM parts: net +1/tick (reserves +2, decay -1 = builds buffer). Use when affordable.
function reserverBody(budget: number): BodyPartConstant[] | null {
    if (budget < 650) return null;
    if (budget >= 1300) {
        // 2-CLAIM body: actively builds the reservation buffer instead of just holding it flat.
        const extraMoves = Math.min(Math.floor((budget - 1300) / 50), 4);
        return [CLAIM, CLAIM, ...r(MOVE, 2 + extraMoves)];
    }
    const extraMoves = Math.min(Math.floor((budget - 650) / 50), 4);
    return [CLAIM, ...r(MOVE, 1 + extraMoves)];
}

// Scavenger: fast looter — equal CARRY and MOVE for full-road speed plus TOUGH buffer.
// Repeat unit [T,C,M] = 180e. Cap at 8 units. Does not need WORK.
function scavengerBody(budget: number): BodyPartConstant[] | null {
    if (budget < 180) return null;
    const units = Math.min(Math.floor(budget / 180), 8);
    return [...r(TOUGH, units), ...r(CARRY, units), ...r(MOVE, units)];
}

// Courier: high-carry hauler for inter-room trips on plains (1:1 CARRY:MOVE).
// Repeat unit [C,M] = 100e. No TOUGH — trips through owned rooms only.
function courierBody(budget: number): BodyPartConstant[] | null {
    if (budget < 100) return null;
    const units = Math.min(Math.floor(budget / 100), 16);
    return [...r(CARRY, units), ...r(MOVE, units)];
}

// ─── Combat roles ─────────────────────────────────────────────────────────────

// Melee warrior: TOUGH buffer, ATTACK, HEAL (self-repair), MOVE.
// Repeat unit [T,A,H,M,M] = 440e.
function warriorBody(budget: number): BodyPartConstant[] | null {
    if (budget < 130) return null;
    if (budget < 260) return [ATTACK, MOVE];
    if (budget < 440) return [ATTACK, ATTACK, MOVE, MOVE];
    const units = Math.min(Math.floor(budget / 440), 8);
    return [...r(TOUGH, units), ...r(ATTACK, units), ...r(HEAL, units), ...r(MOVE, units * 2)];
}

// Ranged attacker: TOUGH buffer, RANGED_ATTACK, HEAL, MOVE.
// Repeat unit [T,RA,H,M,M] = 510e. Stays at range 3 and kites melee enemies.
function rangerBody(budget: number): BodyPartConstant[] | null {
    if (budget < 200) return null;
    if (budget < 400) return [RANGED_ATTACK, MOVE, MOVE]; // 250e basic
    if (budget < 510) return [RANGED_ATTACK, HEAL, MOVE, MOVE]; // 500e with self-heal
    const units = Math.min(Math.floor(budget / 510), 6);
    return [...r(TOUGH, units), ...r(RANGED_ATTACK, units), ...r(HEAL, units), ...r(MOVE, units * 2)];
}

// ─── Utility roles ────────────────────────────────────────────────────────────

function scoutBody(budget: number): BodyPartConstant[] | null {
    if (budget < 50) return null;
    // Pure-MOVE creeps have zero body weight → zero fatigue → full speed on all terrain.
    // Extra MOVE parts add cost with no benefit.
    return [MOVE];
}

// CLAIM is 600e. Extra MOVE for faster travel to the target room.
function claimerBody(budget: number): BodyPartConstant[] | null {
    if (budget < 650) return null;
    const extraMoves = Math.min(Math.floor((budget - 600) / 50), 4);
    return [CLAIM, ...r(MOVE, 1 + extraMoves)];
}

// Healer: pure support — TOUGH buffer, HEAL, MOVE. No attack parts.
// Repeat unit [T,H,M,M] = 360e. Stays behind warriors, heals the most wounded.
function healerBody(budget: number): BodyPartConstant[] | null {
    if (budget < 300) return null;
    if (budget < 360) return [HEAL, MOVE]; // 300e minimum
    const units = Math.min(Math.floor(budget / 360), 8);
    return [...r(TOUGH, units), ...r(HEAL, units), ...r(MOVE, units * 2)];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function r(part: BodyPartConstant, n: number): BodyPartConstant[] {
    return Array(n).fill(part);
}
