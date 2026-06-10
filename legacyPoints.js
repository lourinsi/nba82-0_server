const ACCOLADE_WEIGHTS = {
  mvp_count: 10,
  finals_mvp_count: 6,
  championship_rings: 2,
  all_nba_1st: 6,
  all_nba_2nd: 4.5,
  all_nba_3rd: 3,
  dpoy_count: 2,
  all_def_1st: 1,
  all_def_2nd: 0.75,
  scoring_titles: 2,
  assist_titles: 2,
  rebound_titles: 1.5,
  steal_titles: 1,
  block_titles: 1,
  // no more olympics point value
  roy_won: 1.5,
  all_rookie_1st: 0.75,
  all_rookie_2nd: 0.5,
  all_star_selections: 1,
  all_star_mvp_count: 1.5,
  "6moy": 1,
  most_improved: 1,
  seasons_played: 0.25,
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
  let total = 0;

  for (const [key, weight] of ACCOLADE_WEIGHT_ENTRIES) {
    total += numericAccoladeValue(accolades[key]) * weight;
  }

  return Number(total.toFixed(2));
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
