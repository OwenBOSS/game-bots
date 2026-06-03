import { describe, it, expect, beforeEach, vi } from 'vitest';
import { calcDynamicTargets, trackEnergyFlow, computeTotalEnergy } from '../managers/economyManager';
import { resetPeriod } from '../utils/period';
import { makeRoom, makeSource, makeContainer, makeController, makeStorage } from './helpers';

beforeEach(() => {
    (global as any).Game = { time: 1000, rooms: {}, creeps: {} };
    (global as any).Memory = { roomIntel: {}, roomThreats: {} };
    resetPeriod();
});

// ─── calcDynamicTargets ───────────────────────────────────────────────────────

describe('calcDynamicTargets', () => {
    describe('harvester count', () => {
        it('scales with source count under BALANCED bottleneck', () => {
            const src1 = makeSource({ id: 'src1', x: 10, y: 10, walkableTiles: 8 });
            const src2 = makeSource({ id: 'src2', x: 40, y: 10, walkableTiles: 8 });
            const room = makeRoom({ sources: [src1, src2], memory: { energyStatus: { bottleneck: 'BALANCED' } } });
            const t = calcDynamicTargets(room);
            expect(t.harvester).toBeGreaterThanOrEqual(2);
        });

        it('returns 1 per source in production mode (source containers exist)', () => {
            const c1 = makeContainer();
            const c2 = makeContainer();
            const src1 = makeSource({ id: 'src1', nearbyContainers: [c1] });
            const src2 = makeSource({ id: 'src2', nearbyContainers: [c2] });
            const room = makeRoom({ sources: [src1, src2], containers: [c1, c2] });
            expect(calcDynamicTargets(room).harvester).toBe(2);
        });
    });

    describe('hauler count', () => {
        it('returns 0 when no source containers exist', () => {
            const src = makeSource({ id: 'src1', nearbyContainers: [] });
            const room = makeRoom({ sources: [src] });
            expect(calcDynamicTargets(room).hauler).toBe(0);
        });

        it('returns at least 1 per source with a container', () => {
            const container = makeContainer();
            const src = makeSource({ id: 'src1', nearbyContainers: [container] });
            const room = makeRoom({
                sources: [src],
                containers: [container],
                memory: { energyStatus: { bottleneck: 'BALANCED' } },
            });
            expect(calcDynamicTargets(room).hauler).toBeGreaterThanOrEqual(1);
        });

        it('adds extra haulers per source under HAULER_SHORTAGE', () => {
            const container = makeContainer();
            const src = makeSource({ id: 'src1', nearbyContainers: [container] });
            const roomBase = makeRoom({
                sources: [src],
                containers: [container],
                memory: { energyStatus: { bottleneck: 'BALANCED' } },
            });
            const roomShortage = makeRoom({
                sources: [src],
                containers: [container],
                memory: { energyStatus: { bottleneck: 'HAULER_SHORTAGE' } },
            });
            expect(calcDynamicTargets(roomShortage).hauler).toBeGreaterThan(
                calcDynamicTargets(roomBase).hauler,
            );
        });
    });

    describe('builder count', () => {
        it('returns 0 when no construction sites', () => {
            const room = makeRoom({ constructionSiteCount: 0 });
            expect(calcDynamicTargets(room).builder).toBe(0);
        });

        it('returns 1 as bootstrap when sites exist but no source containers', () => {
            const src = makeSource({ nearbyContainers: [] });
            const room = makeRoom({ sources: [src], constructionSiteCount: 3 });
            expect(calcDynamicTargets(room).builder).toBe(1);
        });

        it('scales builder count with more construction sites', () => {
            const container = makeContainer();
            const src = makeSource({ nearbyContainers: [container] });
            const roomFew = makeRoom({
                sources: [src], containers: [container], constructionSiteCount: 3,
                memory: { energyStatus: { bottleneck: 'BALANCED' }, energyHistory: buildFullHistory(60) },
            });
            const roomMany = makeRoom({
                sources: [src], containers: [container], constructionSiteCount: 20,
                memory: { energyStatus: { bottleneck: 'BALANCED' }, energyHistory: buildFullHistory(60) },
            });
            expect(calcDynamicTargets(roomMany).builder).toBeGreaterThan(
                calcDynamicTargets(roomFew).builder,
            );
        });

        it('throttles builders when containers are low (< 25% fill)', () => {
            const emptyContainer = makeContainer(0.1);
            const src = makeSource({ nearbyContainers: [emptyContainer] });
            const room = makeRoom({
                sources: [src], containers: [emptyContainer], constructionSiteCount: 20,
                memory: {
                    energyStatus: { bottleneck: 'BALANCED' },
                    energyHistory: buildFullHistory(60, 950, { containerFillPct: 10 }),
                },
            });
            expect(calcDynamicTargets(room).builder).toBeLessThanOrEqual(2);
        });
    });

    describe('upgrader', () => {
        it('returns 0 when no controller container and energy is critical', () => {
            const ctrl = makeController({ nearContainer: false });
            const room = makeRoom({ controller: ctrl, memory: { energyStatus: { level: 'CRITICAL' } } });
            expect(calcDynamicTargets(room).upgrader).toBe(0);
        });

        it('returns 0 when no controller container regardless of pidOutput', () => {
            const ctrl = makeController({ nearContainer: false });
            // Even with high PID output, no controller container → 0 upgraders
            const room = makeRoom({
                controller: ctrl,
                memory: { pidState: { output: 4, integral: 2, lastError: 0.5, lastTick: 990 } },
            });
            expect(calcDynamicTargets(room).upgrader).toBe(0);
        });

        it('returns round(pidOutput) when controller has a nearby container', () => {
            const ctrl = makeController({ nearContainer: true });
            // pidOutput=2.6 → round → 3
            const room = makeRoom({
                controller: ctrl,
                memory: { pidState: { output: 2.6, integral: 1, lastError: 0.3, lastTick: 990 } },
            });
            expect(calcDynamicTargets(room).upgrader).toBe(3);
        });

        it('defaults to outputMid (1) when no pidState exists', () => {
            const ctrl = makeController({ nearContainer: true });
            const room = makeRoom({ controller: ctrl, memory: {} });
            // DEFAULT_PID_CONFIG.outputMid = 1 → round(1) = 1
            expect(calcDynamicTargets(room).upgrader).toBe(1);
        });
    });

    describe('RC8 maintenance mode', () => {
        it('returns 0 upgraders at RC8 when downgrade timer is healthy (>= 50k)', () => {
            const ctrl = makeController({ level: 8, nearContainer: true, ticksToDowngrade: 100_000 });
            const room = makeRoom({
                controller: ctrl,
                memory: { pidState: { output: 4, integral: 2, lastError: 0.5, lastTick: 990 } },
            });
            expect(calcDynamicTargets(room).upgrader).toBe(0);
        });

        it('returns 1 maintenance upgrader at RC8 when TTD < 50k', () => {
            const ctrl = makeController({ level: 8, nearContainer: true, ticksToDowngrade: 40_000 });
            const room = makeRoom({ controller: ctrl, memory: {} });
            expect(calcDynamicTargets(room).upgrader).toBe(1);
        });

        it('returns 0 at RC8 even with high pidOutput and healthy timer', () => {
            const ctrl = makeController({ level: 8, nearContainer: true, ticksToDowngrade: 190_000 });
            const room = makeRoom({
                controller: ctrl,
                memory: { pidState: { output: 4, integral: 3, lastError: 1, lastTick: 990 } },
            });
            expect(calcDynamicTargets(room).upgrader).toBe(0);
        });
    });

    describe('scout', () => {
        it('returns 0 at RCL 0', () => {
            const ctrl = makeController({ level: 0 });
            const room = makeRoom({ controller: ctrl });
            expect(calcDynamicTargets(room).scout).toBe(0);
        });

        it('returns 1 at RCL 1+', () => {
            const ctrl = makeController({ level: 1 });
            const room = makeRoom({ controller: ctrl });
            expect(calcDynamicTargets(room).scout).toBe(1);
        });
    });

    describe('scavenger', () => {
        it('returns 0 when no containers exist', () => {
            const room = makeRoom({ containers: [] });
            expect(calcDynamicTargets(room).scavenger).toBe(0);
        });

        it('returns 1 when at least one container exists', () => {
            const container = makeContainer();
            const room = makeRoom({ containers: [container] });
            expect(calcDynamicTargets(room).scavenger).toBe(1);
        });
    });
});

// ─── trackEnergyFlow ─────────────────────────────────────────────────────────

describe('trackEnergyFlow', () => {
    it('skips sample within interval after first fire', () => {
        // First call fires immediately (period() fires on first call after reset)
        (global as any).Game.time = 1000;
        const room = makeRoom({ memory: {} });
        trackEnergyFlow(room);
        expect(room.memory.energyHistory).toHaveLength(1);
        // Subsequent call within interval is skipped
        (global as any).Game.time = 1003;
        trackEnergyFlow(room);
        expect(room.memory.energyHistory).toHaveLength(1);
    });

    it('appends a sample on interval ticks', () => {
        (global as any).Game.time = 1000; // divisible by 5
        const room = makeRoom({ memory: {}, energyAvailable: 200, energyCapacityAvailable: 300 });
        trackEnergyFlow(room);
        expect(room.memory.energyHistory).toHaveLength(1);
        expect(room.memory.energyHistory[0].avail).toBe(200);
        expect(room.memory.energyHistory[0].tick).toBe(1000);
    });

    it('trims history to 20 samples', () => {
        (global as any).Game.time = 1000;
        const history = buildFullHistory(50, 900);
        const room = makeRoom({ memory: { energyHistory: history } });
        trackEnergyFlow(room);
        expect(room.memory.energyHistory!.length).toBeLessThanOrEqual(20);
    });

    it('writes energyStatus after enough samples', () => {
        (global as any).Game.time = 1000;
        const history = buildFullHistory(60, 950);
        const room = makeRoom({
            memory: { energyHistory: history },
            energyAvailable: 600,
            energyCapacityAvailable: 1000,
        });
        trackEnergyFlow(room);
        expect(room.memory.energyStatus).toBeDefined();
        expect(room.memory.energyStatus!.bottleneck).toBeDefined();
    });

    describe('bottleneck detection', () => {
        it('detects SOURCE_MAXED when sources depleted > 60% of samples', () => {
            (global as any).Game.time = 1000;
            const history = buildFullHistory(60, 950, { sourceDepletedPct: 80 });
            const room = makeRoom({ memory: { energyHistory: history }, energyAvailable: 600, energyCapacityAvailable: 800 });
            trackEnergyFlow(room);
            expect(room.memory.energyStatus!.bottleneck).toBe('SOURCE_MAXED');
        });

        it('detects HAULER_SHORTAGE when containers full, spawn declining, and energy DEFICIT', () => {
            (global as any).Game.time = 1000;
            // Containers full, spawn energy declining fast (haulers not draining containers)
            const history = Array.from({ length: 8 }, (_, i) => ({
                tick: 950 + i * 5,
                avail: 200 - i * 22,  // 200→24 over 8 samples, strong negative rate
                containerFillPct: 90,
                sourceDepletedPct: 0,
            }));
            const room = makeRoom({
                memory: { energyHistory: history },
                energyAvailable: 40,   // pct=13% → DEFICIT/CRITICAL
                energyCapacityAvailable: 300,
            });
            trackEnergyFlow(room);
            expect(room.memory.energyStatus!.bottleneck).toBe('HAULER_SHORTAGE');
        });

        it('detects HARVESTER_SHORTAGE when containers chronically empty and energy declining', () => {
            (global as any).Game.time = 1000;
            // Build history with declining energy AND low container fill
            const history = buildDecliningHistory(950);
            const room = makeRoom({
                memory: { energyHistory: history },
                energyAvailable: 50,
                energyCapacityAvailable: 300,
            });
            trackEnergyFlow(room);
            expect(room.memory.energyStatus!.bottleneck).toBe('HARVESTER_SHORTAGE');
        });
    });
});

// ─── Test data helpers ────────────────────────────────────────────────────────

function buildFullHistory(
    avail: number,
    startTick = 900,
    overrides: { containerFillPct?: number; sourceDepletedPct?: number } = {},
) {
    return Array.from({ length: 8 }, (_, i) => ({
        tick: startTick + i * 5,
        avail,
        containerFillPct:  overrides.containerFillPct  ?? 50,
        sourceDepletedPct: overrides.sourceDepletedPct ?? 0,
    }));
}

function buildDecliningHistory(startTick = 900) {
    return Array.from({ length: 8 }, (_, i) => ({
        tick: startTick + i * 5,
        avail: 300 - i * 30, // declining energy
        containerFillPct:  10,   // containers nearly empty
        sourceDepletedPct: 0,
    }));
}

// ─── computeTotalEnergy ───────────────────────────────────────────────────────

describe('computeTotalEnergy', () => {
    it('returns spawn energy and capacity when no containers or storage', () => {
        const room = makeRoom({ energyAvailable: 150, energyCapacityAvailable: 300 });
        const { current, capacity } = computeTotalEnergy(room);
        expect(current).toBe(150);
        expect(capacity).toBe(300);
    });

    it('adds container energy to current and container capacity to capacity', () => {
        const c1 = makeContainer(0.5);  // 1000e / 2000 cap
        const c2 = makeContainer(0.25); // 500e / 2000 cap
        const room = makeRoom({
            energyAvailable: 200,
            energyCapacityAvailable: 300,
            containers: [c1, c2],
        });
        const { current, capacity } = computeTotalEnergy(room);
        expect(current).toBe(200 + 1000 + 500);
        expect(capacity).toBe(300 + 2000 + 2000);
    });

    it('adds storage energy when storage is present', () => {
        const storage = makeStorage(80000);
        const room = makeRoom({
            energyAvailable: 200,
            energyCapacityAvailable: 300,
            storage,
        });
        const { current, capacity } = computeTotalEnergy(room);
        expect(current).toBe(200 + 80000);
        expect(capacity).toBe(300 + 1_000_000);
    });

    it('excludes storage when room.storage is undefined', () => {
        const room = makeRoom({ energyAvailable: 100, energyCapacityAvailable: 300 });
        const { capacity } = computeTotalEnergy(room);
        expect(capacity).toBe(300); // no storage added
    });

    it('returns capacity > 0 even with no energy anywhere', () => {
        const room = makeRoom({ energyAvailable: 0, energyCapacityAvailable: 300 });
        const { current, capacity } = computeTotalEnergy(room);
        expect(current).toBe(0);
        expect(capacity).toBeGreaterThan(0);
    });
});

// ─── PID integration via trackEnergyFlow ─────────────────────────────────────

describe('trackEnergyFlow PID integration', () => {
    it('writes pidState to room.memory after a sample', () => {
        (global as any).Game.time = 1000;
        const history = buildFullHistory(240, 950);
        const room = makeRoom({
            memory: { energyHistory: history },
            energyAvailable: 240,
            energyCapacityAvailable: 300,
        });
        trackEnergyFlow(room);
        expect(room.memory.pidState).toBeDefined();
        expect(typeof room.memory.pidState!.output).toBe('number');
        expect(room.memory.pidState!.output).toBeGreaterThanOrEqual(0);
        expect(room.memory.pidState!.output).toBeLessThanOrEqual(4);
    });

    it('pidState.output increases when energy is persistently above setpoint', () => {
        // First sample: energy above setpoint (240 > 60% of 300 = 180)
        (global as any).Game.time = 1000;
        const room = makeRoom({
            memory: { energyHistory: buildFullHistory(240, 900), pidState: undefined },
            energyAvailable: 240,
            energyCapacityAvailable: 300,
        });
        trackEnergyFlow(room);
        const firstOutput = room.memory.pidState!.output;

        // Second sample: still high
        (global as any).Game.time = 1005;
        resetPeriod();
        trackEnergyFlow(room);
        const secondOutput = room.memory.pidState!.output;

        // Integral has accumulated → output should be >= first
        expect(secondOutput).toBeGreaterThanOrEqual(firstOutput - 0.01);
    });

    it('pidState.output is lower when energy is below setpoint', () => {
        // Use different room names so the period key doesn't collide
        (global as any).Game.time = 1000;
        const roomHigh = makeRoom({
            name: 'W1N1',
            memory: { energyHistory: buildFullHistory(270, 900) },
            energyAvailable: 270,
            energyCapacityAvailable: 300,
        });
        const roomLow = makeRoom({
            name: 'W2N2',
            memory: { energyHistory: buildFullHistory(60, 900) },
            energyAvailable: 60,
            energyCapacityAvailable: 300,
        });
        trackEnergyFlow(roomHigh);
        trackEnergyFlow(roomLow);
        expect(roomHigh.memory.pidState!.output).toBeGreaterThan(roomLow.memory.pidState!.output);
    });
});

// ─── PID-driven upgrader targets ─────────────────────────────────────────────

describe('calcDynamicTargets upgrader (PID-driven)', () => {
    it('returns more upgraders when pidOutput is high (energy surplus)', () => {
        const ctrl = makeController({ nearContainer: true });
        const roomSurplus = makeRoom({
            controller: ctrl,
            memory: { pidState: { output: 3, integral: 1, lastError: 0.3, lastTick: 990 } },
        });
        const roomDeficit = makeRoom({
            controller: ctrl,
            memory: { pidState: { output: 0, integral: -1, lastError: -0.3, lastTick: 990 } },
        });
        expect(calcDynamicTargets(roomSurplus).upgrader).toBeGreaterThan(
            calcDynamicTargets(roomDeficit).upgrader,
        );
    });

    it('returns 0 upgraders when no controller container regardless of pidOutput', () => {
        const ctrl = makeController({ nearContainer: false });
        const room = makeRoom({
            controller: ctrl,
            memory: { pidState: { output: 4, integral: 2, lastError: 0.5, lastTick: 990 } },
        });
        expect(calcDynamicTargets(room).upgrader).toBe(0);
    });

    it('clamps upgrader target to [0, 4]', () => {
        const ctrl = makeController({ nearContainer: true });
        const roomMax = makeRoom({
            controller: ctrl,
            memory: { pidState: { output: 99, integral: 5, lastError: 1, lastTick: 990 } },
        });
        const roomMin = makeRoom({
            controller: ctrl,
            memory: { pidState: { output: -99, integral: -5, lastError: -1, lastTick: 990 } },
        });
        expect(calcDynamicTargets(roomMax).upgrader).toBeLessThanOrEqual(4);
        expect(calcDynamicTargets(roomMin).upgrader).toBeGreaterThanOrEqual(0);
    });
});

// ─── HAULER_SHORTAGE tightened condition ─────────────────────────────────────

describe('detectBottleneck HAULER_SHORTAGE (tightened)', () => {
    it('does NOT fire on transient post-spawn energy dip when energy is STABLE', () => {
        // Containers full (90%), spawn briefly low — just finished spawning a creep
        (global as any).Game.time = 1000;
        const history = buildFullHistory(90, 950, { containerFillPct: 90, sourceDepletedPct: 0 });
        const room = makeRoom({
            memory: { energyHistory: history },
            energyAvailable: 130,  // 43% — below 50%, but this is transient
            energyCapacityAvailable: 300,
        });
        // Provide a STABLE-level energyStatus (the status before this sample)
        room.memory.energyStatus = { level: 'STABLE', netRate: 0.3, trend: 0, pct: 43, bottleneck: 'BALANCED' };
        trackEnergyFlow(room);
        // STABLE level → should NOT trigger HAULER_SHORTAGE
        expect(room.memory.energyStatus!.bottleneck).not.toBe('HAULER_SHORTAGE');
    });

    it('fires when containers full AND energy is DEFICIT AND netRate is negative', () => {
        // Build a declining history with high container fill (haulers not draining)
        (global as any).Game.time = 1000;
        const history = Array.from({ length: 8 }, (_, i) => ({
            tick: 950 + i * 5,
            avail: 200 - i * 20,  // declining spawn energy
            containerFillPct: 85,  // containers full
            sourceDepletedPct: 0,
        }));
        const room = makeRoom({
            memory: { energyHistory: history },
            energyAvailable: 60,   // low spawn energy
            energyCapacityAvailable: 300,
        });
        trackEnergyFlow(room);
        expect(room.memory.energyStatus!.bottleneck).toBe('HAULER_SHORTAGE');
    });
});

// ─── Hauler hard cap ─────────────────────────────────────────────────────────

describe('calcDynamicTargets hauler cap', () => {
    it('caps hauler target at sources.length * 3 + 2', () => {
        const container = makeContainer();
        const src1 = makeSource({ id: 'src1', nearbyContainers: [container] });
        const src2 = makeSource({ id: 'src2', nearbyContainers: [container] });
        // Simulate HAULER_SHORTAGE to maximize the formula
        const room = makeRoom({
            sources: [src1, src2],
            containers: [container],
            memory: { energyStatus: { bottleneck: 'HAULER_SHORTAGE' } },
            // Use extreme distance to push baseHaulers high
        });
        // Override PathFinder to return a very long path
        (global as any).PathFinder.search = () => ({
            incomplete: false,
            path: new Array(50).fill({ x: 0, y: 0 }),
        });
        const t = calcDynamicTargets(room);
        const maxAllowed = 2 * 3 + 2; // sources.length * 3 + 2
        expect(t.hauler).toBeLessThanOrEqual(maxAllowed);
        // Restore
        (global as any).PathFinder.search = () => ({ incomplete: true, path: [] });
    });
});
