"use strict";

const {
  STINT_SCALING_FACTOR,
  leagueAverageForSeason,
  playerMetricValue,
  scoreSeasonAgainstLeague,
} = require("./eraRelativeClassicPoints");

const STAT_MODES = Object.freeze({
  LEAGUE_ADJUSTED: "leagueAdjusted",
  PER_100: "per100",
  RAW: "raw",
});

const STAT_MODE_LABELS = Object.freeze({
  [STAT_MODES.LEAGUE_ADJUSTED]: "League adjusted stats",
  [STAT_MODES.PER_100]: "Per 100",
  [STAT_MODES.RAW]: "No adjustment",
});

const SCORE_WEIGHTS = Object.freeze({
  assist: 0.6,
  points: 1,
  rebound: 0.5,
  tsPlusDivisor: 200,
  winShareScale: 200,
});

const ACCOLADE_SCORE_MULTIPLIER = 0.5;
const ACCOLADE_WEIGHTS = Object.freeze({
  finals_mvp_count: 7.5,
  estimated_finals_mvp_count: 7.5,
  mvp_count: 5,
  aba_mvp_count: 7,
  aba_playoffs_mvp_count: 5,
  all_nba_1st: 7,
  all_nba_2nd: 5.5,
  all_nba_3rd: 4,
  aba_all_league_1st: 6,
  aba_all_league_2nd: 4,
  dpoy_count: 2.5,
  all_def_1st: 2,
  all_def_2nd: 1.5,
  aba_all_def_1st: 1.75,
  aba_all_def_2nd: 1.25,
  scoring_titles: 3,
  assist_titles: 3,
  rebound_titles: 2,
  aba_scoring_titles: 2.5,
  aba_assist_titles: 2.5,
  aba_rebound_titles: 1.75,
  three_point_titles: 2.5,
  steal_titles: 1.5,
  block_titles: 1.5,
  all_star_mvp_count: 1.1,
  aba_all_star_mvp_count: 1,
  three_point_contest_wins: 1,
  all_star_selections: 1,
  aba_all_star_selections: 0.8,
  championship_rings: 1,
  aba_championship_rings: 2,
  "6moy": 1,
  most_improved: 1,
  roy_won: 1.1,
  aba_rookie_of_year_count: 1,
  all_rookie_1st: 1,
  all_rookie_2nd: 0.75,
  seasons_played: 0.25,
});

const MERGED_ACCOLADE_KEYS = Object.freeze([
  "mvp_count",
  "finals_mvp_count",
  "estimated_finals_mvp_count",
  "aba_mvp_count",
  "aba_playoffs_mvp_count",
  "dpoy_count",
  "championship_rings",
  "aba_championship_rings",
  "most_improved",
  "top_3_mvp",
  "top_10_mvp",
  "top_3_dpoy",
  "all_nba_1st",
  "all_nba_2nd",
  "all_nba_3rd",
  "aba_all_league_1st",
  "aba_all_league_2nd",
  "all_def_1st",
  "all_def_2nd",
  "aba_all_def_1st",
  "aba_all_def_2nd",
  "all_rookie_1st",
  "all_rookie_2nd",
  "all_star_selections",
  "all_star_mvp_count",
  "aba_all_star_selections",
  "aba_all_star_mvp_count",
  "aba_rookie_of_year_count",
  "seasons_played",
  "scoring_titles",
  "assist_titles",
  "rebound_titles",
  "aba_scoring_titles",
  "aba_assist_titles",
  "aba_rebound_titles",
  "three_point_titles",
  "steal_titles",
  "block_titles",
  "three_point_contest_wins",
  "games_started",
  "6moy",
]);

const RAW_POINTS_KEYS = ["ppg", "PPG", "points_per_game", "pointsPerGame", "pts_per_game", "ptsPerGame"];
const RAW_REBOUNDS_KEYS = [
  "rpg",
  "RPG",
  "rebounds_per_game",
  "reboundsPerGame",
  "reb_per_game",
  "rebPerGame",
  "trb_per_game",
];
const RAW_ASSISTS_KEYS = ["apg", "APG", "assists_per_game", "assistsPerGame", "ast_per_game", "astPerGame"];
const PER100_POINTS_KEYS = ["per100PTS", "per_100_pts", "per100_pts", "per100_ppg", "pts_per_100", "ptsPer100", "pts_per_poss"];
const PER100_REBOUNDS_KEYS = [
  "per100REB",
  "per_100_reb",
  "per100_reb",
  "per100_rpg",
  "trb_per_100",
  "rebPer100",
  "trb_per_poss",
];
const PER100_ASSISTS_KEYS = ["per100AST", "per_100_ast", "per100_ast", "per100_apg", "ast_per_100", "astPer100", "ast_per_poss"];
const MPG_KEYS = ["mpg", "MPG", "mp_per_g", "minutes_per_game", "minutesPerGame"];
const MINUTES_KEYS = ["minutes", "mp", "MP", "total_minutes", "minutes_played", "minutesPlayed"];
const GAMES_KEYS = ["games_played", "gamesPlayed", "g", "G", "gp", "GP"];
const TS_KEYS = ["ts_pct", "TS_PCT", "TS%", "tsPct", "true_shooting_pct", "trueShootingPct"];
const TS_PLUS_KEYS = ["ts_plus", "TS_PLUS", "tsPlus", "ts_pct_plus", "tsPctPlus", "TS+"];
const WS48_KEYS = ["ws_per_48", "ws_48", "WS/48", "ws48", "WS_48", "win_shares_per_48"];

function rounded(value, digits = 2) {
  return Number(Number(value || 0).toFixed(digits));
}

function normalizeStatMode(value) {
  return Object.values(STAT_MODES).includes(value) ? value : STAT_MODES.PER_100;
}

function numericValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(String(value).replace(/,/g, ""));

  return Number.isFinite(numeric) ? numeric : null;
}

function firstNumericValue(source, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source || {}, key)) {
      const numeric = numericValue(source[key]);

      if (numeric !== null) {
        return numeric;
      }
    }
  }

  return null;
}

function normalizeTsPct(value) {
  const numeric = numericValue(value);

  if (numeric === null) {
    return null;
  }

  return numeric > 1 ? numeric / 100 : numeric;
}

function rawMpgForSeason(source) {
  const direct = firstNumericValue(source, MPG_KEYS);

  if (direct !== null && direct > 0) {
    return direct;
  }

  const minutes = firstNumericValue(source, MINUTES_KEYS);
  const games = firstNumericValue(source, GAMES_KEYS);

  return minutes !== null && games !== null && games > 0 ? minutes / games : null;
}

function minutesMultiplier(mpg) {
  if (mpg === null || !Number.isFinite(mpg) || mpg <= 0) {
    return 0.1;
  }

  if (mpg < 32) {
    return Math.max(0.35, mpg / 32);
  }

  return Math.min(1.3, 1 + ((mpg - 32) / 18) * 0.3);
}

function leagueTsPct(leagueAverage) {
  return normalizeTsPct(
    firstNumericValue(leagueAverage || {}, ["league_ts_pct", "leagueTsPct", "TS_PCT", "ts_pct", "TS%", "true_shooting_pct"]),
  );
}

function tsPlusForSeason(tsPct, source, leagueAverage) {
  const direct = firstNumericValue(source, TS_PLUS_KEYS);

  if (direct !== null && direct > 0) {
    return direct;
  }

  const leagueTs = leagueTsPct(leagueAverage);

  if (tsPct !== null && leagueTs !== null && leagueTs > 0) {
    return (tsPct / leagueTs) * 100;
  }

  return tsPct !== null ? 100 : null;
}

function tsHybridPercentValue(tsPct, tsPlus) {
  if (tsPct === null || tsPct <= 0) {
    return null;
  }

  const leagueTs = tsPlus && tsPlus > 0 ? tsPct / (tsPlus / 100) : null;
  const tsHybrid =
    leagueTs && Number.isFinite(leagueTs) && leagueTs > 0
      ? tsPct * 0.5 + (tsPct + (tsPct - leagueTs)) * 0.5
      : tsPct;

  return tsHybrid * 100;
}

function scoreBoxLine({ assists, mpg, points, rebounds, tsPct, tsPlus, ws48 }, mode) {
  const missingStats = [];

  if (points === null) missingStats.push(mode === STAT_MODES.RAW ? "ppg" : "per100_pts");
  if (rebounds === null) missingStats.push(mode === STAT_MODES.RAW ? "rpg" : "per100_reb");
  if (assists === null) missingStats.push(mode === STAT_MODES.RAW ? "apg" : "per100_ast");
  if (mpg === null) missingStats.push("mpg");

  const displayStats = {
    assists: assists === null ? null : rounded(assists, 1),
    mpg: mpg === null ? null : rounded(mpg, 1),
    points: points === null ? null : rounded(points, 1),
    rebounds: rebounds === null ? null : rounded(rebounds, 1),
    tsHybrid: tsHybridPercentValue(tsPct, tsPlus),
    ws48: ws48 === null ? null : rounded(ws48, 3),
  };

  if (missingStats.length) {
    return {
      displayStats,
      missingStats,
      mode,
      score: null,
      scoreBreakdown: {
        assistsScore: 0,
        efficiencyScore: 0,
        impactScore: 0,
        pointsScore: 0,
        reboundsScore: 0,
        totalScore: 0,
      },
      totalScore: 0,
      warnings: [],
    };
  }

  const safeTsPct = tsPct ?? 0.54;
  const safeTsPlus = tsPlus ?? 100;
  const pointsScore = (points ?? 0) * (safeTsPct + safeTsPlus / SCORE_WEIGHTS.tsPlusDivisor) * SCORE_WEIGHTS.points;
  const reboundsScore = (rebounds ?? 0) * SCORE_WEIGHTS.rebound;
  const assistsScore = (assists ?? 0) * SCORE_WEIGHTS.assist;
  const weightedPRA = pointsScore + reboundsScore + assistsScore;
  const volumeScore = weightedPRA * minutesMultiplier(mpg);
  const impactScore = (ws48 ?? 0) * SCORE_WEIGHTS.winShareScale;
  const totalScore = rounded(volumeScore + impactScore, 2);

  return {
    displayStats,
    missingStats,
    mode,
    score: totalScore,
    scoreBreakdown: {
      assistsScore: rounded(assistsScore, 4),
      efficiencyScore: rounded(volumeScore - weightedPRA, 4),
      impactScore: rounded(impactScore, 4),
      pointsScore: rounded(pointsScore, 4),
      reboundsScore: rounded(reboundsScore, 4),
      totalScore,
    },
    totalScore,
    warnings: [],
  };
}

function calculateRawScore(playerSeason, leagueAverage) {
  const source = playerSeason || {};
  const tsPct = normalizeTsPct(firstNumericValue(source, TS_KEYS));
  const tsPlus = tsPlusForSeason(tsPct, source, leagueAverage);

  return scoreBoxLine(
    {
      assists: firstNumericValue(source, RAW_ASSISTS_KEYS),
      mpg: rawMpgForSeason(source),
      points: firstNumericValue(source, RAW_POINTS_KEYS),
      rebounds: firstNumericValue(source, RAW_REBOUNDS_KEYS),
      tsPct,
      tsPlus,
      ws48: firstNumericValue(source, WS48_KEYS),
    },
    STAT_MODES.RAW,
  );
}

function calculatePer100Score(playerSeason, leagueAverage) {
  const source = playerSeason || {};
  const tsPct = normalizeTsPct(firstNumericValue(source, TS_KEYS));
  const tsPlus = tsPlusForSeason(tsPct, source, leagueAverage);

  return scoreBoxLine(
    {
      assists: firstNumericValue(source, PER100_ASSISTS_KEYS) ?? firstNumericValue(source, RAW_ASSISTS_KEYS),
      mpg: rawMpgForSeason(source),
      points: firstNumericValue(source, PER100_POINTS_KEYS) ?? firstNumericValue(source, RAW_POINTS_KEYS),
      rebounds: firstNumericValue(source, PER100_REBOUNDS_KEYS) ?? firstNumericValue(source, RAW_REBOUNDS_KEYS),
      tsPct,
      tsPlus,
      ws48: firstNumericValue(source, WS48_KEYS),
    },
    STAT_MODES.PER_100,
  );
}

function calculateLeagueAdjustedScore(playerSeason, leagueAverage) {
  if (!leagueAverage) {
    const fallback = calculateRawScore(playerSeason, null);

    return {
      ...fallback,
      missingStats: [...fallback.missingStats, "league_average"],
      mode: STAT_MODES.LEAGUE_ADJUSTED,
      warnings: ["League-adjusted baseline unavailable; raw scoring fallback used."],
    };
  }

  const result = scoreSeasonAgainstLeague(playerSeason, leagueAverage);
  const rawDisplay = calculateRawScore(playerSeason, leagueAverage);

  if (!result.ok) {
    return {
      ...rawDisplay,
      missingStats: [...rawDisplay.missingStats, result.reason || "league_adjusted_inputs"],
      mode: STAT_MODES.LEAGUE_ADJUSTED,
      warnings: [result.reason || "League-adjusted inputs unavailable; raw scoring fallback used."],
    };
  }

  const totalScore = rounded(result.index * STINT_SCALING_FACTOR, 2);
  const points = playerMetricValue(playerSeason, "ppg") ?? 0;
  const rebounds = playerMetricValue(playerSeason, "rpg") ?? 0;
  const assists = playerMetricValue(playerSeason, "apg") ?? 0;
  const pointsShare = points + rebounds + assists > 0 ? points / (points + rebounds + assists) : 0.5;
  const reboundsShare = points + rebounds + assists > 0 ? rebounds / (points + rebounds + assists) : 0.25;
  const assistsShare = points + rebounds + assists > 0 ? assists / (points + rebounds + assists) : 0.25;

  return {
    displayStats: rawDisplay.displayStats,
    missingStats: [],
    mode: STAT_MODES.LEAGUE_ADJUSTED,
    score: totalScore,
    scoreBreakdown: {
      assistsScore: rounded(totalScore * assistsShare, 4),
      efficiencyScore: 0,
      impactScore: 0,
      pointsScore: rounded(totalScore * pointsShare, 4),
      reboundsScore: rounded(totalScore * reboundsShare, 4),
      totalScore,
    },
    sourceScore: result,
    totalScore,
    warnings: [],
  };
}

function calculatePlayerSeasonScore({ playerSeason, statMode, statsEngineConfig } = {}) {
  const resolvedStatMode = normalizeStatMode(statMode);
  const leagueAverages = statsEngineConfig?.leagueAverages || {};
  const leagueLookup = leagueAverageForSeason(leagueAverages, playerSeason?.season);
  const leagueAverage = leagueLookup.average || null;

  if (resolvedStatMode === STAT_MODES.LEAGUE_ADJUSTED) {
    return calculateLeagueAdjustedScore(playerSeason, leagueAverage);
  }

  if (resolvedStatMode === STAT_MODES.RAW) {
    return calculateRawScore(playerSeason, leagueAverage);
  }

  return calculatePer100Score(playerSeason, leagueAverage);
}

function canonicalEra(era) {
  return era === "40's" || era === "50's" ? "60's" : era;
}

function numericAccoladeValue(value) {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  const numeric = Number(value ?? 0);

  return Number.isFinite(numeric) ? numeric : 0;
}

function classicBlocksForSelection(player, selection) {
  if (!player || !selection) {
    return [];
  }

  const selectedEra = canonicalEra(selection.era);

  return (player.classic_points_by_team_era || []).filter(
    (block) => block?.team === selection.team && canonicalEra(block?.era) === selectedEra,
  );
}

function mergeBlockAccolades(blocks) {
  const blocksWithAccolades = blocks.filter((block) => block?.accolades);

  if (!blocksWithAccolades.length) {
    return null;
  }

  const merged = { ...blocksWithAccolades[0].accolades };

  for (const key of MERGED_ACCOLADE_KEYS) {
    const total = blocksWithAccolades.reduce(
      (sum, block) => sum + numericAccoladeValue(block.accolades?.[key]),
      0,
    );

    if (total > 0 || key in merged) {
      merged[key] = total;
    }
  }

  merged.roy_won = blocksWithAccolades.some((block) => Boolean(block.accolades?.roy_won));

  return merged;
}

function accoladeScore(accolades) {
  if (!accolades) {
    return 0;
  }

  const score = Object.entries(ACCOLADE_WEIGHTS).reduce(
    (sum, [key, weight]) => sum + numericAccoladeValue(accolades[key]) * Number(weight || 0),
    0,
  );

  return rounded(score * ACCOLADE_SCORE_MULTIPLIER, 2);
}

function playerAccoladeScoreForSelection(player, selection) {
  const blockAccolades = mergeBlockAccolades(classicBlocksForSelection(player, selection));

  return accoladeScore(blockAccolades || player?.accolades);
}

module.exports = {
  STAT_MODE_LABELS,
  STAT_MODES,
  calculatePlayerSeasonScore,
  normalizeStatMode,
  playerAccoladeScoreForSelection,
  rounded,
};
