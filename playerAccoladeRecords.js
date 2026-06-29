const {
  STAT_TITLE_DESCRIPTIONS,
  THREE_POINT_CONTEST_DESCRIPTION,
  applyAwardToAccolades,
  createEmptyClassicAccolades,
} = require("./classicPoints");
const { seasonEndYear } = require("./seasonEras");
const { normalizeTeamCodeForSeason } = require("./teamFranchises");

const STAT_TITLE_CATEGORY_TO_ACCOLADE = {
  PTS: "scoring_titles",
  AST: "assist_titles",
  REB: "rebound_titles",
  FG3M: "three_point_titles",
  STL: "steal_titles",
  BLK: "block_titles",
};

function normalizedNumber(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
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

function hasAwardDescriptionForSeason(rows, candidate) {
  const normalizedCandidate = normalizeAwardRow(candidate);
  const candidateSeason = String(normalizedCandidate.season || "");
  const candidateDescription = normalizeName(normalizedCandidate.description);

  return rows.some((row) => {
    const normalizedRow = normalizeAwardRow(row);

    return (
      String(normalizedRow.season || "") === candidateSeason &&
      normalizeName(normalizedRow.description) === candidateDescription
    );
  });
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
        const value = Number(winner.value || 0);

        if (!playerId || value <= 0) {
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

      if (!winner || Number(winner.value || 0) <= 0) {
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

function contestWinnersFromCache(threePointContestCache = null) {
  if (Array.isArray(threePointContestCache?.winners)) {
    return threePointContestCache.winners;
  }

  if (threePointContestCache?.winners && typeof threePointContestCache.winners === "object") {
    return Object.values(threePointContestCache.winners).flat();
  }

  return [];
}

function playerBrefIds(player) {
  const ids = new Set();

  if (player.bref_id) {
    ids.add(String(player.bref_id));
  }

  if (typeof player.id === "string" && player.id.startsWith("bref:")) {
    ids.add(player.id.replace("bref:", ""));
  }

  const playerUrl = player.source?.basketball_reference_player;
  const urlMatch = typeof playerUrl === "string" ? /\/players\/[a-z]\/([^/.]+)\.html/i.exec(playerUrl) : null;

  if (urlMatch?.[1]) {
    ids.add(urlMatch[1]);
  }

  return ids;
}

function contestWinnerMatchesPlayer(player, winner) {
  const brefId = winner?.bref_id ? String(winner.bref_id) : "";
  const nbaStatsId = Number(winner?.nba_stats_id || 0);
  const season = winner?.season ? String(winner.season) : "";

  if (brefId && playerBrefIds(player).has(brefId)) {
    return true;
  }

  if (nbaStatsId && Number(player.nba_stats_id || 0) === nbaStatsId) {
    return true;
  }

  if (normalizeName(player.name || `${player.first_name || ""} ${player.last_name || ""}`) !== normalizeName(winner?.player)) {
    return false;
  }

  if ((player.career_seasons || []).some((row) => String(row?.season || "") === season)) {
    return true;
  }

  const winnerEndYear = seasonEndYear(season);
  const latestCareerEndYear = Math.max(
    0,
    ...(player.career_seasons || []).map((row) => seasonEndYear(row?.season)).filter(Boolean),
  );

  return Boolean(player.active && winnerEndYear && latestCareerEndYear && winnerEndYear - latestCareerEndYear === 1);
}

function awardTeamForSeason(player, season) {
  const allStarAward = (player.awards_raw || []).find((award) => {
    const description = normalizeName(award?.description);

    return (
      String(award?.season || "") === String(season || "") &&
      award?.team &&
      description.includes("all star")
    );
  });

  if (allStarAward?.team) {
    return allStarAward.team;
  }

  const seasonTeams = Array.from(
    new Set(
      (player.career_seasons || [])
        .filter((row) => String(row?.season || "") === String(season || ""))
        .map((row) => normalizeTeamCodeForSeason(row?.team, row?.season))
        .filter((team) => team && team !== "TOT"),
    ),
  );

  if (seasonTeams.length === 1) {
    return seasonTeams[0];
  }

  const awardEndYear = seasonEndYear(season);
  const latestCareerEndYear = Math.max(
    0,
    ...(player.career_seasons || []).map((row) => seasonEndYear(row?.season)).filter(Boolean),
  );

  if (player.active && player.current_team && awardEndYear && latestCareerEndYear && awardEndYear - latestCareerEndYear === 1) {
    return normalizeTeamCodeForSeason(player.current_team, season);
  }

  return null;
}

function derivedThreePointContestRows(player, threePointContestCache = null) {
  const rows = [];

  for (const winner of contestWinnersFromCache(threePointContestCache)) {
    if (!contestWinnerMatchesPlayer(player, winner)) {
      continue;
    }

    rows.push({
      season: winner.season || null,
      team: winner.team || awardTeamForSeason(player, winner.season),
      description: THREE_POINT_CONTEST_DESCRIPTION,
      all_nba_team_number: null,
    });
  }

  return rows;
}

function isThreePointContestAwardRow(row) {
  return normalizeName(row?.description) === normalizeName(THREE_POINT_CONTEST_DESCRIPTION);
}

function shouldKeepExistingAwardRow(player, row, threePointContestCache = null) {
  const contestWinners = contestWinnersFromCache(threePointContestCache);

  if (!isThreePointContestAwardRow(row) || !contestWinners.length) {
    return true;
  }

  return contestWinners.some(
    (winner) => String(winner?.season || "") === String(row?.season || "") && contestWinnerMatchesPlayer(player, winner),
  );
}

function fillDerivedAwardRowFields(player, row) {
  if (isThreePointContestAwardRow(row) && !row.team) {
    return {
      ...row,
      team: awardTeamForSeason(player, row.season),
    };
  }

  return row;
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

function statTitleCacheHasCategory(statTitleCache, category) {
  return Object.values(statTitleCache?.winners || {}).some((categories) =>
    Object.prototype.hasOwnProperty.call(categories || {}, category),
  );
}

function recalculateAccolades(player, awardRows, options = {}) {
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
    if (key === "three_point_titles" && options.rebuildThreePointTitles) {
      continue;
    }
    if (key === "three_point_contest_wins" && options.rebuildThreePointContestWins) {
      continue;
    }

    accolades[key] = Math.max(accolades[key], normalizedNumber(existing[key]));
  }

  accolades.roy_won = Boolean(accolades.roy_won || existing.roy_won);

  return accolades;
}

function normalizePlayerAccoladeRecord(player, options = {}) {
  const baseAwardRows = uniqueAwardRows(player.awards_raw || []).filter((row) =>
    shouldKeepExistingAwardRow(player, row, options.threePointContestCache),
  ).map((row) => fillDerivedAwardRowFields(player, row));
  const statTitleRows = derivedStatTitleRows(
    player,
    options.statTitleCache,
    options.statTitleRowsByPlayerId,
  ).filter(
    (row) => !hasAwardRow(baseAwardRows, row),
  );
  const threePointContestRows = derivedThreePointContestRows(
    player,
    options.threePointContestCache,
  ).filter(
    (row) => !hasAwardDescriptionForSeason(baseAwardRows, row),
  );
  const awardsRaw = uniqueAwardRows([...baseAwardRows, ...statTitleRows, ...threePointContestRows]);
  const normalized = {
    ...player,
    accolades: recalculateAccolades(player, awardsRaw, {
      rebuildThreePointContestWins: contestWinnersFromCache(options.threePointContestCache).length > 0,
      rebuildThreePointTitles: statTitleCacheHasCategory(options.statTitleCache, "FG3M"),
    }),
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
  derivedThreePointContestRows,
  gamesStartedFromCareer,
  gamesWonFromCareer,
  normalizePlayerAccoladeRecord,
  normalizePlayerAccoladeRecords,
};
