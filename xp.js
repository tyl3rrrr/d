// xp.js
// Pure XP/level calculation functions (no Discord/storage dependency).
//
// XP curve: linear increase, level 1 starts at 15 XP as requested.
//   Level 0 -> 1: 15 XP
//   Level 1 -> 2: 30 XP
//   Level 2 -> 3: 45 XP  etc. (each level needs 15 XP more than the previous)
// This makes the curve predictable and guarantees consistent, non-
// contradictory XP/level values (every total-XP value maps to exactly one level).

const XP_STEP = 15;

// XP needed for JUST this level (going from level-1 to level).
function xpForSingleLevel(level) {
  return XP_STEP * level;
}

// Total XP that must be accumulated to REACH level `level`.
function totalXpForLevel(level) {
  return (XP_STEP * level * (level + 1)) / 2;
}

// Computes the level from total XP (closed-form solution of the quadratic equation).
function levelFromTotalXp(totalXp) {
  const xp = Math.max(0, totalXp);
  const level = Math.floor((-1 + Math.sqrt(1 + (8 * xp) / XP_STEP)) / 2);
  return Math.max(0, level);
}

function progress(totalXp) {
  const level = levelFromTotalXp(totalXp);
  const currentLevelXp = totalXpForLevel(level);
  const nextLevelXp = totalXpForLevel(level + 1);
  const into = totalXp - currentLevelXp;
  const needed = nextLevelXp - currentLevelXp;
  return {
    level,
    totalXp,
    currentLevelXp,
    nextLevelXp,
    xpIntoLevel: into,
    xpNeededForNext: needed,
    xpToNext: Math.max(0, nextLevelXp - totalXp),
    percent: needed > 0 ? Math.min(100, Math.round((into / needed) * 100)) : 100,
  };
}

// Level-role milestones (per the brief: 1, 10, 20, ..., 100, then every 10 after that).
const LEVEL_ROLE_MILESTONES = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];

function isMilestoneLevel(level) {
  return level >= 100 ? level % 10 === 0 : LEVEL_ROLE_MILESTONES.includes(level);
}

module.exports = { XP_STEP, xpForSingleLevel, totalXpForLevel, levelFromTotalXp, progress, isMilestoneLevel, LEVEL_ROLE_MILESTONES };
