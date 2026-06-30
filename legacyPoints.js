const { ABA_ACCOLADE_WEIGHTS } = require("./abaAccolades");

const ACCOLADE_WEIGHTS = {
  finals_mvp_count: 7.5,
  estimated_finals_mvp_count: 7.5,
  mvp_count: 5,
  all_nba_1st: 7,
  all_nba_2nd: 5.5,
  all_nba_3rd: 4,
  dpoy_count: 2.5,
  all_def_1st: 2,
  all_def_2nd: 1.5,
  scoring_titles: 3,
  assist_titles: 3,
  rebound_titles: 2,
  three_point_titles: 2.5,
  steal_titles: 1.5,
  block_titles: 1.5,
  // no more olympics point value
  all_star_mvp_count: 1.1,
  three_point_contest_wins: 1,
  all_star_selections: 1,
  championship_rings: 1,
  "6moy": 1,
  most_improved: 1,
  roy_won: 1.1,
  all_rookie_1st: 1,
  all_rookie_2nd: 0.75,
  seasons_played: 0.25,
  games_started: 0.01,
  ...ABA_ACCOLADE_WEIGHTS,
};
const ACCOLADE_WEIGHT_ENTRIES = Object.entries(ACCOLADE_WEIGHTS);
const LEGACY_ENGINE_FACTORS = {
  // Raised from 0.2 to 0.6 to make the drop-off over time aggressive
  descentExponent: 0.6, 
  // Raised to keep the base bonus significant at low seasons
  descentNumerator: 5.5, 
  // Lowered so longevity doesn't kick back in too early
  ascentMultiplier: 0.001, 
  densityBonusMultiplier: 0.1,
};

function numericAccoladeValue(value) {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function calculateLegacyScoreBreakdown(accolades = {}, engineFactors = LEGACY_ENGINE_FACTORS) {
  let basePoints = 0;

  for (const [key, weight] of ACCOLADE_WEIGHT_ENTRIES) {
    basePoints += numericAccoladeValue(accolades[key]) * weight;
  }

  const {
    descentNumerator,
    descentExponent,
    ascentMultiplier,
    densityBonusMultiplier,
  } = engineFactors;
  const seasons = Math.max(numericAccoladeValue(accolades.seasons_played), 1);
  const descent = descentNumerator / Math.pow(seasons, descentExponent);
  const ascent = ascentMultiplier * seasons;
  const uShapeModifier = descent + ascent;
  const densityBonus = basePoints * uShapeModifier * densityBonusMultiplier;
  const totalLegacyScore = basePoints + densityBonus;

  return {
    basePoints,
    seasons,
    descent,
    ascent,
    uShapeModifier,
    densityBonus,
    totalLegacyScore,
  };
}

function calculateLegacyPoints(accolades = {}) {
  const { totalLegacyScore } = calculateLegacyScoreBreakdown(accolades);

  return Number(totalLegacyScore.toFixed(2));
}

function applyLegacyPoints(players) {
  return players.map((player) => ({
    ...player,
    legacy_points: calculateLegacyPoints(player.accolades),
  }));
}

module.exports = {
  ACCOLADE_WEIGHTS,
  LEGACY_ENGINE_FACTORS,
  applyLegacyPoints,
  calculateLegacyScoreBreakdown,
  calculateLegacyPoints,
};
