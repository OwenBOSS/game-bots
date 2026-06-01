// Scans the current room for Score objects and updates the shared memory map.
// This lets collectors in adjacent rooms know where scores have been seen recently.

export function trackScores(room: Room): void {
    if (!Memory.scoreMap) Memory.scoreMap = {};
    if (!Memory.knownRooms) Memory.knownRooms = [];

    if (!Memory.knownRooms.includes(room.name)) {
        Memory.knownRooms.push(room.name);
    }

    const scores = (room.find as Function)(FIND_SCORES) as ScoreObject[];
    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);

    if (totalScore > 0) {
        Memory.scoreMap[room.name] = { score: totalScore, tick: Game.time };
    } else if (Memory.scoreMap[room.name]) {
        // Clear stale entry once the room is empty
        delete Memory.scoreMap[room.name];
    }
}
