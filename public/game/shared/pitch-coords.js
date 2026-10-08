// Normalized Tactical Pitch Coordinates (651:1024 Vertical Pitch)
// Shared by REVEAL UI v1 (22-player full pitch & 11-player single-team modes)
// and designed as the normalized coordinate foundation for future 2D match simulation.

import { getSlotRole } from './constants.js';

export const PITCH_ASPECT_RATIO = Object.freeze({
    width: 651,
    height: 1024,
    cssValue: '651 / 1024',
});

export const TEAM_PITCH_META = Object.freeze({
    0: Object.freeze({
        teamIndex: 0,
        sideKey: 'teamA',
        attackDir: 'up',
        half: 'bottom',
        tokenVariant: 'home',
    }),
    1: Object.freeze({
        teamIndex: 1,
        sideKey: 'teamB',
        attackDir: 'down',
        half: 'top',
        tokenVariant: 'away',
    }),
});

// Single-team 11-player 4-3-3 normalized coordinates on a full vertical pitch (attacking upward)
export const SINGLE_TEAM_433_COORDS = Object.freeze({
    FW1: Object.freeze({ x: 0.22, y: 0.185, role: 'FW' }),
    FW2: Object.freeze({ x: 0.50, y: 0.145, role: 'FW' }),
    FW3: Object.freeze({ x: 0.78, y: 0.185, role: 'FW' }),
    MF1: Object.freeze({ x: 0.24, y: 0.415, role: 'MF' }),
    MF2: Object.freeze({ x: 0.50, y: 0.455, role: 'MF' }),
    MF3: Object.freeze({ x: 0.76, y: 0.415, role: 'MF' }),
    DF1: Object.freeze({ x: 0.15, y: 0.660, role: 'DF' }),
    DF2: Object.freeze({ x: 0.38, y: 0.690, role: 'DF' }),
    DF3: Object.freeze({ x: 0.62, y: 0.690, role: 'DF' }),
    DF4: Object.freeze({ x: 0.85, y: 0.660, role: 'DF' }),
    GK1: Object.freeze({ x: 0.50, y: 0.880, role: 'GK' }),
});

// Full 22-player 4-3-3 tactical matchup coordinates on a single vertical pitch:
// - Team B (index 1) occupies the top half (y: 0.085 .. 0.445), attacking downward
// - Team A (index 0) occupies the bottom half (y: 0.555 .. 0.915), attacking upward
export const FULL_PITCH_22_COORDS = Object.freeze({
    0: Object.freeze({
        FW1: Object.freeze({ x: 0.21, y: 0.580, role: 'FW', attackDir: 'up' }),
        FW2: Object.freeze({ x: 0.50, y: 0.555, role: 'FW', attackDir: 'up' }),
        FW3: Object.freeze({ x: 0.79, y: 0.580, role: 'FW', attackDir: 'up' }),
        MF1: Object.freeze({ x: 0.24, y: 0.680, role: 'MF', attackDir: 'up' }),
        MF2: Object.freeze({ x: 0.50, y: 0.705, role: 'MF', attackDir: 'up' }),
        MF3: Object.freeze({ x: 0.76, y: 0.680, role: 'MF', attackDir: 'up' }),
        DF1: Object.freeze({ x: 0.16, y: 0.805, role: 'DF', attackDir: 'up' }),
        DF2: Object.freeze({ x: 0.38, y: 0.785, role: 'DF', attackDir: 'up' }),
        DF3: Object.freeze({ x: 0.62, y: 0.785, role: 'DF', attackDir: 'up' }),
        DF4: Object.freeze({ x: 0.84, y: 0.805, role: 'DF', attackDir: 'up' }),
        GK1: Object.freeze({ x: 0.50, y: 0.915, role: 'GK', attackDir: 'up' }),
    }),
    1: Object.freeze({
        GK1: Object.freeze({ x: 0.50, y: 0.085, role: 'GK', attackDir: 'down' }),
        DF1: Object.freeze({ x: 0.16, y: 0.195, role: 'DF', attackDir: 'down' }),
        DF2: Object.freeze({ x: 0.38, y: 0.215, role: 'DF', attackDir: 'down' }),
        DF3: Object.freeze({ x: 0.62, y: 0.215, role: 'DF', attackDir: 'down' }),
        DF4: Object.freeze({ x: 0.84, y: 0.195, role: 'DF', attackDir: 'down' }),
        MF1: Object.freeze({ x: 0.24, y: 0.320, role: 'MF', attackDir: 'down' }),
        MF2: Object.freeze({ x: 0.50, y: 0.295, role: 'MF', attackDir: 'down' }),
        MF3: Object.freeze({ x: 0.76, y: 0.320, role: 'MF', attackDir: 'down' }),
        FW1: Object.freeze({ x: 0.21, y: 0.420, role: 'FW', attackDir: 'down' }),
        FW2: Object.freeze({ x: 0.50, y: 0.445, role: 'FW', attackDir: 'down' }),
        FW3: Object.freeze({ x: 0.79, y: 0.420, role: 'FW', attackDir: 'down' }),
    }),
});

export function getPitchSlotCoord(mode, teamIndex, slot) {
    const fallbackRole = getSlotRole(slot) || 'MF';
    if (mode === 'full') {
        const teamMap = FULL_PITCH_22_COORDS[teamIndex] || FULL_PITCH_22_COORDS[0];
        const pt = teamMap[slot] || { x: 0.5, y: teamIndex === 1 ? 0.25 : 0.75, role: fallbackRole };
        return {
            x: pt.x,
            y: pt.y,
            xPct: `${(pt.x * 100).toFixed(1)}%`,
            yPct: `${(pt.y * 100).toFixed(1)}%`,
            role: pt.role || fallbackRole,
            attackDir: pt.attackDir || (teamIndex === 1 ? 'down' : 'up'),
        };
    }

    const singlePt = SINGLE_TEAM_433_COORDS[slot] || { x: 0.5, y: 0.5, role: fallbackRole };
    return {
        x: singlePt.x,
        y: singlePt.y,
        xPct: `${(singlePt.x * 100).toFixed(1)}%`,
        yPct: `${(singlePt.y * 100).toFixed(1)}%`,
        role: singlePt.role || fallbackRole,
        attackDir: 'up',
    };
}
