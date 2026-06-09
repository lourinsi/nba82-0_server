const ACCOLADE_WEIGHTS = {
  mvp_count: 10,
  finals_mvp_count: 5,
  dpoy_count: 5,
  roy_won: 5,
  championship_rings: 5,
  olympic_gold_medals: 3,
  olympic_silver_medals: 1,
  olympic_bronze_medals: 0.5,
  all_nba_1st: 5,
  all_nba_2nd: 3,
  all_nba_3rd: 2,
  all_def_1st: 3,
  all_def_2nd: 2,
  all_rookie_1st: 3,
  all_rookie_2nd: 2,
  all_star_selections: 2,
  all_star_mvp_count: 3,
  seasons_played: 0.5,
  scoring_titles: 3,
  assist_titles: 3,
  rebound_titles: 3,
  steal_titles: 3,
  block_titles: 3,
};

function numericAccoladeValue(value) {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function calculateLegacyPoints(accolades = {}) {
  const total = Object.entries(ACCOLADE_WEIGHTS).reduce(
    (sum, [key, weight]) => sum + numericAccoladeValue(accolades[key]) * weight,
    0,
  );

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
