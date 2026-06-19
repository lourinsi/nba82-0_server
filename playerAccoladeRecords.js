const {
  STAT_TITLE_DESCRIPTIONS,
  applyAwardToAccolades,
  createEmptyClassicAccolades,
} = require("./classicPoints");

const STAT_TITLE_CATEGORY_TO_ACCOLADE = {
  PTS: "scoring_titles",
  AST: "assist_titles",
  REB: "rebound_titles",
  STL: "steal_titles",
  BLK: "block_titles",
};

function normalizedNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeAwardRow(row) {
  return {
    season: row?.season === undefined ? null : row.season,
    team: row?.team === undefined ? null : row.team,
    description: row?.description === undefined ? null : row.description,
    all_nba_team_number: row?.all_nba_team_number === undefined ? null : row.all_nba_team_number,
  };
}

function awardRowKey(row) {
  return [
    row.season || "",
    row.team || "",
    row.description || "",
    row.all_nba_team_number || "",
  ].join("|");
}

function uniqueAwardRows(rows) {
  const seen = new Set();
  const unique = [];

  for (const row of rows.map(normalizeAwardRow)) {
    const key = awardRowKey(row);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(row);
  }

  return unique;
}

function hasAwardRow(rows, candidate) {
  const key = awardRowKey(normalizeAwardRow(candidate));
  return rows.some((row) => awardRowKey(row) === key);
}

function buildStatTitleWinnerLookup(statTitleCache = null) {
  const rowsByPlayerId = new Map();

  if (!statTitleCache?.winners) {
    return rowsByPlayerId;
  }

  for (const [season, categories] of Object.entries(statTitleCache.winners)) {
    for (const [category, winners] of Object.entries(categories || {})) {
      const accoladeKey = STAT_TITLE_CATEGORY_TO_ACCOLADE[category];
      const description = accoladeKey ? STAT_TITLE_DESCRIPTIONS[accoladeKey] : null;

      if (!description || !Array.isArray(winners)) {
        continue;
      }

      for (const winner of winners) {
        const playerId = Number(winner.player_id || 0);

        if (!playerId) {
          continue;
        }

        if (!rowsByPlayerId.has(playerId)) {
          rowsByPlayerId.set(playerId, []);
        }

        rowsByPlayerId.get(playerId).push({
          season,
          team: winner.team || null,
          description,
          all_nba_team_number: null,
        });
      }
    }
  }

  return rowsByPlayerId;
}

function derivedStatTitleRows(player, statTitleCache = null, statTitleRowsByPlayerId = null) {
  const nbaStatsId = Number(player.nba_stats_id || 0);

  if (!nbaStatsId) {
    return [];
  }

  if (statTitleRowsByPlayerId) {
    return statTitleRowsByPlayerId.get(nbaStatsId) || [];
  }

  if (!statTitleCache?.winners) {
    return [];
  }

  const rows = [];

  for (const [season, categories] of Object.entries(statTitleCache.winners)) {
    for (const [category, winners] of Object.entries(categories || {})) {
      const accoladeKey = STAT_TITLE_CATEGORY_TO_ACCOLADE[category];
      const description = accoladeKey ? STAT_TITLE_DESCRIPTIONS[accoladeKey] : null;

      if (!description || !Array.isArray(winners)) {
        continue;
      }

      const winner = winners.find((candidate) => Number(candidate.player_id) === nbaStatsId);

      if (!winner) {
        continue;
      }

      rows.push({
        season,
        team: winner.team || null,
        description,
        all_nba_team_number: null,
      });
    }
  }

  return rows;
}

function seasonsPlayedFromCareer(player) {
  const seasons = new Set(
    (player.career_seasons || [])
      .map((season) => season?.season)
      .filter(Boolean),
  );

  return seasons.size;
}

function gamesStartedFromCareer(player) {
  return (player.career_seasons || []).reduce(
    (sum, season) => sum + normalizedNumber(season?.games_started),
    0,
  );
}

function gamesWonFromCareer(player) {
  return (player.career_seasons || []).reduce(
    (sum, season) => sum + normalizedNumber(season?.games_won),
    0,
  );
}

function recalculateAccolades(player, awardRows) {
  const existing = player.accolades || {};
  const accolades = createEmptyClassicAccolades();

  for (const row of awardRows) {
    applyAwardToAccolades(accolades, row);
  }

  const careerSeasonCount = seasonsPlayedFromCareer(player);
  accolades.seasons_played = careerSeasonCount || normalizedNumber(existing.seasons_played);
  accolades.games_started = Math.max(gamesStartedFromCareer(player), normalizedNumber(existing.games_started));
  accolades.games_won = Math.max(gamesWonFromCareer(player), normalizedNumber(existing.games_won));

  if (existing.most_improved_won) {
    accolades.most_improved = Math.max(accolades.most_improved, 1);
  }

  if (existing.sixth_man_won) {
    accolades["6moy"] = Math.max(accolades["6moy"], 1);
  }

  for (const key of Object.keys(accolades)) {
    if (key === "award_counts" || key === "roy_won") {
      continue;
    }
    if (key === "finals_mvp_count" && awardRows.length) {
      continue;
    }

    accolades[key] = Math.max(accolades[key], normalizedNumber(existing[key]));
  }

  accolades.roy_won = Boolean(accolades.roy_won || existing.roy_won);

  return accolades;
}

function normalizePlayerAccoladeRecord(player, options = {}) {
  const baseAwardRows = uniqueAwardRows(player.awards_raw || []);
  const statTitleRows = derivedStatTitleRows(
    player,
    options.statTitleCache,
    options.statTitleRowsByPlayerId,
  ).filter(
    (row) => !hasAwardRow(baseAwardRows, row),
  );
  const awardsRaw = uniqueAwardRows([...baseAwardRows, ...statTitleRows]);
  const normalized = {
    ...player,
    accolades: recalculateAccolades(player, awardsRaw),
    awards_raw: awardsRaw,
  };

  delete normalized.goat_rank;
  delete normalized.goat_score;
  delete normalized.goat_ranking;
  delete normalized.goat_ranking_score;
  delete normalized.media_score;
  delete normalized.final_legacy_points;
  delete normalized.position_bonus;
  delete normalized.final_score;

  return normalized;
}

function normalizePlayerAccoladeRecords(players, options = {}) {
  const statTitleRowsByPlayerId =
    options.statTitleRowsByPlayerId || buildStatTitleWinnerLookup(options.statTitleCache);

  return players.map((player) =>
    normalizePlayerAccoladeRecord(player, {
      ...options,
      statTitleRowsByPlayerId,
    }),
  );
}

module.exports = {
  buildStatTitleWinnerLookup,
  derivedStatTitleRows,
  gamesStartedFromCareer,
  gamesWonFromCareer,
  normalizePlayerAccoladeRecord,
  normalizePlayerAccoladeRecords,
};
