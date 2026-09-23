// xp.js
// Reine XP-/Level-Rechenfunktionen (keine Discord-/Storage-Abhängigkeit).
//
// XP-Kurve: linear ansteigend, wie gefordert startet Level 1 bei 15 XP.
//   Level 0 -> 1 : 15 XP
//   Level 1 -> 2 : 30 XP
//   Level 2 -> 3 : 45 XP  usw. (jede Stufe braucht 15 XP mehr als die vorherige)
// Damit ist die Kurve nachvollziehbar und garantiert eindeutige, widerspruchsfreie
// XP-/Level-Werte (zu jedem Gesamt-XP-Wert gehört genau ein Level).

const XP_STEP = 15;

// XP, die NUR für die Stufe `level` (von level-1 auf level) benötigt werden.
function xpForSingleLevel(level) {
  return XP_STEP * level;
}

// Gesamt-XP, die man gesammelt haben muss, um Level `level` zu ERREICHEN.
function totalXpForLevel(level) {
  return (XP_STEP * level * (level + 1)) / 2;
}

// Level aus der Gesamt-XP berechnen (geschlossene Lösung der quadratischen Gleichung).
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

// Level-Rollen-Meilensteine (siehe Aufgabenstellung: 1,10,20,...,100 und danach weiter in 10er-Schritten).
const LEVEL_ROLE_MILESTONES = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200];

function isMilestoneLevel(level) {
  return level >= 100 ? level % 10 === 0 : LEVEL_ROLE_MILESTONES.includes(level);
}

module.exports = { XP_STEP, xpForSingleLevel, totalXpForLevel, levelFromTotalXp, progress, isMilestoneLevel, LEVEL_ROLE_MILESTONES };
