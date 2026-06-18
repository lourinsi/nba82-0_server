const ACCOLADE_WEIGHTS = {
  mvp_count: 8,
  finals_mvp_count: 7,
  all_nba_1st: 7,
  all_nba_2nd: 5.5,
  all_nba_3rd: 4,
  championship_rings: 2.5,
  dpoy_count: 2.5,
  all_def_1st: 2,
  all_def_2nd: 1.5,
  scoring_titles: 3,
  assist_titles: 3,
  rebound_titles: 2,
  steal_titles: 1.5,
  block_titles: 1.5,
  // no more olympics point value
  all_star_mvp_count: 1,
  all_star_selections: 1,
  "6moy": 1,
  most_improved: 1,
  roy_won: 1,
  all_rookie_1st: 1,
  all_rookie_2nd: 0.75,
  seasons_played: 0.25,
  games_started: 0.01,
};
const ACCOLADE_WEIGHT_ENTRIES = Object.entries(ACCOLADE_WEIGHTS);

function numericAccoladeValue(value) {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function calculateLegacyPoints(accolades = {}) {
  let basePoints = 0;

  for (const [key, weight] of ACCOLADE_WEIGHT_ENTRIES) {
    basePoints += numericAccoladeValue(accolades[key]) * weight;
  }

  const seasons = Math.max(numericAccoladeValue(accolades.seasons_played), 1);
  const uShapeModifier = (3.2 / Math.pow(seasons, 1.35)) + (0.0027 * seasons);
  const densityBonus = basePoints * uShapeModifier * 4.0;

  return Number((basePoints + densityBonus).toFixed(2));
}

function applyLegacyPoints(players) {
  return players.map((player) => ({
    ...player,
    legacy_points: calculateLegacyPoints(player.accolades),
  }));
}

module.exports = {
  ACCOLADE_WEIGHTS,
  applyLegacyPoints,
  calculateLegacyPoints,
};
