const fs = require("fs/promises");
const path = require("path");
const { seasonEndYear, seasonEra } = require("./seasonEras");
const { normalizeTeamCodeForEra, normalizeTeamCodeForSeason } = require("./teamFranchises");

const PLAYERS_PATH = path.join(__dirname, "data", "players_accolades_bref.json");
const LEAGUE_AVERAGES_PATH = path.join(__dirname, "data", "historical_league_averages.json");

// Tune these values to rebalance the box-score signal across eras. The scorer
// compares each stat to that exact season's league climate before scaling.
const WEIGHTS = { ppg: 0.8, rpg: 0.55, apg: 0.55, spg: 0.25, bpg: 0.25, ts_impact: 1.0, ws_impact: 1.5 };
const STINT_SCALING_FACTOR = 250;
const ALL_TIME_TS_BASELINE = 0.54;
const TS_BLEND_WEIGHTS = { era: 0.25, absolute: 0.5 };

const BASE_METRICS = ["ppg", "rpg", "apg"];
const DEFENSIVE_METRICS = ["spg", "bpg"];
const VOLUME_METRICS = [...BASE_METRICS, ...DEFENSIVE_METRICS];
const EFFICIENCY_METRICS = ["ts_pct", "ws_48"];
const ALL_METRICS = [...VOLUME_METRICS, ...EFFICIENCY_METRICS];
const LEAGUE_AVERAGE_KEYS = {
  ppg: ["PPG", "ppg"],
  rpg: ["RPG", "rpg"],
  apg: ["APG", "apg"],
  spg: ["SPG", "spg"],
  bpg: ["BPG", "bpg"],
  ts_pct: ["TS_PCT", "ts_pct", "TS%", "true_shooting_pct", "trueShootingPct"],
};
const PLAYER_DIRECT_STAT_KEYS = {
  ppg: ["ppg", "PPG", "points_per_game", "pointsPerGame", "pts_per_game", "ptsPerGame"],
  rpg: ["rpg", "RPG", "rebounds_per_game", "reboundsPerGame", "reb_per_game", "rebPerGame", "trb_per_game"],
  apg: ["apg", "APG", "assists_per_game", "assistsPerGame", "ast_per_game", "astPerGame"],
  spg: ["spg", "SPG", "steals_per_game", "stealsPerGame", "stl_per_game", "stlPerGame"],
  bpg: ["bpg", "BPG", "blocks_per_game", "blocksPerGame", "blk_per_game", "blkPerGame"],
  ts_pct: ["ts_pct", "TS_PCT", "tsPct", "true_shooting_pct", "trueShootingPct", "true_shooting_percentage"],
  ws_48: ["ws_48", "WS_48", "ws_per_48", "WS_PER_48", "wsPer48", "win_shares_per_48", "winSharesPer48"],
};
const PLAYER_TOTAL_STAT_KEYS = {
  ppg: ["pts", "PTS", "points", "total_points"],
  rpg: ["reb", "REB", "trb", "TRB", "rebounds", "total_rebounds"],
  apg: ["ast", "AST", "assists", "total_assists"],
  spg: ["stl", "STL", "steals", "total_steals"],
  bpg: ["blk", "BLK", "blocks", "total_blocks"],
};
const GAMES_KEYS = ["games_played", "gamesPlayed", "gp", "GP"];

function parseArgs(argv) {
  const args = {};

  for (const arg of argv.slice(2)) {
    const [rawKey, ...rawValueParts] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    const value = rawValueParts.length ? rawValueParts.join("=").trim() : true;

    if (key) {
      args[key] = value;
    }
  }

  return args;
}

function flagEnabled(value) {
  return value === true || ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function resolvePath(value, fallbackPath) {
  if (!value || value === true) {
    return fallbackPath;
  }

  return path.resolve(process.cwd(), String(value));
}

function numericValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function positiveNumericValue(value) {
  const numeric = numericValue(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function firstNumericValue(source, keys = []) {
  if (!source || typeof source !== "object") {
    return null;
  }

  for (const key of keys || []) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const numeric = numericValue(source[key]);

      if (numeric !== null) {
        return numeric;
      }
    }
  }

  return null;
}

function firstPositiveNumericValue(source, keys) {
  const numeric = firstNumericValue(source, keys);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function playerMetricValue(season, metric) {
  const direct = firstNumericValue(season, PLAYER_DIRECT_STAT_KEYS[metric]);

  if (direct !== null) {
    return direct;
  }

  const totalKeys = PLAYER_TOTAL_STAT_KEYS[metric] || [];

  if (!totalKeys.length) {
    return null;
  }

  const total = firstNumericValue(season, totalKeys);
  const gamesPlayed = firstPositiveNumericValue(season, GAMES_KEYS);

  if (total === null || !gamesPlayed) {
    return null;
  }

  return total / gamesPlayed;
}

function leagueMetricValue(leagueAverage, metric) {
  return firstPositiveNumericValue(leagueAverage, LEAGUE_AVERAGE_KEYS[metric]);
}

function seasonKeyCandidates(season) {
  const rawSeason = String(season || "").trim();

  if (!rawSeason) {
    return [];
  }

  const candidates = [rawSeason];
  const fullYearRange = rawSeason.match(/^(\d{4})\D+(\d{4})/);

  if (fullYearRange) {
    const startYear = Number(fullYearRange[1]);
    const endYear = Number(fullYearRange[2]);
    candidates.push(`${startYear}-${String(endYear).slice(-2)}`);
    candidates.push(`${startYear}-${endYear}`);
  }

  const shortYearRange = rawSeason.match(/^(\d{4})\D+(\d{2})/);
  if (shortYearRange) {
    const startYear = Number(shortYearRange[1]);
    const endYearSuffix = Number(shortYearRange[2]);
    const startCentury = Math.floor(startYear / 100) * 100;
    const endYear = startCentury + endYearSuffix;
    const normalizedEndYear = endYear > startYear ? endYear : endYear + 100;
    candidates.push(`${startYear}-${normalizedEndYear}`);
    candidates.push(`${startYear}-${String(normalizedEndYear).slice(-2)}`);
  }

  return Array.from(new Set(candidates));
}

function leagueAverageForSeason(leagueAverages, season) {
  for (const key of seasonKeyCandidates(season)) {
    if (leagueAverages?.[key]) {
      return { key, average: leagueAverages[key] };
    }
  }

  const requestedEndYear = seasonEndYear(season);
  const earliestKey = Object.keys(leagueAverages || {})
    .filter((key) => seasonEndYear(key))
    .sort((a, b) => seasonEndYear(a) - seasonEndYear(b))[0];
  const earliestEndYear = seasonEndYear(earliestKey);

  if (requestedEndYear && earliestKey && earliestEndYear && requestedEndYear < earliestEndYear) {
    return { key: earliestKey, average: leagueAverages[earliestKey], fallback: "earliest_available" };
  }

  return { key: null, average: null };
}

function hasDefensiveLeagueAverages(leagueAverage) {
  return DEFENSIVE_METRICS.every((metric) => leagueMetricValue(leagueAverage, metric) !== null);
}

function metricWeightsForSeason(leagueAverage, weights = WEIGHTS) {
  if (!hasDefensiveLeagueAverages(leagueAverage)) {
    const totalWeight = VOLUME_METRICS.reduce((sum, metric) => sum + Number(weights[metric] || 0), 0);
    const balancedWeight = totalWeight / BASE_METRICS.length;

    // Pre-1974 league baselines omit steals/blocks. Keep era comparisons fair by
    // redistributing the total stat weight evenly across points, boards, assists.
    return Object.fromEntries(BASE_METRICS.map((metric) => [metric, balancedWeight]));
  }

  return Object.fromEntries(VOLUME_METRICS.map((metric) => [metric, Number(weights[metric] || 0)]));
}

function roundedStat(value, metric) {
  if (value === null) {
    return null;
  }

  const decimals = EFFICIENCY_METRICS.includes(metric) ? 3 : 1;
  return Number(value.toFixed(decimals));
}

function buildStintStatLine(seasons) {
  const totals = Object.fromEntries(ALL_METRICS.map((metric) => [metric, { value: 0, games: 0, samples: 0 }]));

  for (const season of seasons) {
    const gamesPlayed = firstPositiveNumericValue(season, GAMES_KEYS);

    for (const metric of ALL_METRICS) {
      const value = playerMetricValue(season, metric);

      if (value === null) {
        continue;
      }

      if (gamesPlayed) {
        totals[metric].value += value * gamesPlayed;
        totals[metric].games += gamesPlayed;
      } else {
        totals[metric].value += value;
        totals[metric].samples += 1;
      }
    }
  }

  return Object.fromEntries(
    ALL_METRICS.map((metric) => {
      const total = totals[metric];
      const value =
        total.games > 0
          ? total.value / total.games
          : total.samples > 0
            ? total.value / total.samples
            : null;

      return [metric, roundedStat(value, metric)];
    }),
  );
}

function seasonMatchesBlock(season, block) {
  const seasonTeam = normalizeTeamCodeForSeason(season?.team, season?.season);
  const blockTeam = normalizeTeamCodeForEra(block?.team, block?.era);
  const seasonBlockEra = season?.era || seasonEra(season?.season);

  return Boolean(seasonTeam && blockTeam && seasonTeam === blockTeam && seasonBlockEra === block?.era);
}

function scoreSeasonAgainstLeague(season, leagueAverages, options = {}) {
  const configuredWeights = options.weights || WEIGHTS;
  const weights = metricWeightsForSeason(leagueAverages, configuredWeights);
  let baseVolumeIndex = 0;

  for (const metric of VOLUME_METRICS) {
    if (!Object.prototype.hasOwnProperty.call(weights, metric)) {
      continue;
    }

    const weight = weights[metric];
    const playerValue = playerMetricValue(season, metric);
    const leagueValue = leagueMetricValue(leagueAverages, metric);

    if (playerValue === null || leagueValue === null) {
      return {
        ok: false,
        reason: `missing ${metric.toUpperCase()} ${playerValue === null ? "player stat" : "league average"}`,
      };
    }

    baseVolumeIndex += (playerValue / leagueValue) * weight;
  }

  let efficiencyModifier = 1;
  const playerTs = playerMetricValue(season, "ts_pct");
  const leagueTs = leagueMetricValue(leagueAverages, "ts_pct");

  if (playerTs !== null && leagueTs !== null) {
    const eraRelativeTs = playerTs / leagueTs;
    const absoluteRelativeTs = playerTs / ALL_TIME_TS_BASELINE;
    const blendedTsRatio =
      eraRelativeTs * TS_BLEND_WEIGHTS.era + absoluteRelativeTs * TS_BLEND_WEIGHTS.absolute;

    if (Number.isFinite(blendedTsRatio)) {
      efficiencyModifier += (blendedTsRatio - 1) * Number(configuredWeights.ts_impact ?? WEIGHTS.ts_impact);
    }
  }

  const playerWs48 = playerMetricValue(season, "ws_48");

  if (playerWs48 !== null) {
    const wsBonus = playerWs48 - 0.1;

    if (Number.isFinite(wsBonus)) {
      efficiencyModifier += wsBonus * Number(configuredWeights.ws_impact ?? WEIGHTS.ws_impact);
    }
  }

  return { ok: true, index: baseVolumeIndex * efficiencyModifier };
}

function calculateClassicPointsForBlock(player, block, leagueAverages, options = {}) {
  const matchingSeasons = (player.career_seasons || []).filter((season) => seasonMatchesBlock(season, block));
  const issues = [];
  let indexTotal = 0;
  let scoredSeasons = 0;

  for (const season of matchingSeasons) {
    const lookup = leagueAverageForSeason(leagueAverages, season?.season);

    if (!lookup.average) {
      issues.push({
        kind: "missing_league_average",
        player: player.name || player.id || "Unknown player",
        season: season?.season || null,
        team: season?.team || null,
        era: season?.era || null,
        message: "No historical league average found for season key.",
      });
      continue;
    }

    const result = scoreSeasonAgainstLeague(season, lookup.average, options);

    if (!result.ok) {
      issues.push({
        kind: "missing_player_stat",
        player: player.name || player.id || "Unknown player",
        season: season?.season || null,
        team: season?.team || null,
        era: season?.era || null,
        message: result.reason,
      });
      continue;
    }

    indexTotal += result.index;
    scoredSeasons += 1;
  }

  if (!matchingSeasons.length) {
    issues.push({
      kind: "missing_stint",
      player: player.name || player.id || "Unknown player",
      season: null,
      team: block?.team || null,
      era: block?.era || null,
      message: "No career_seasons rows matched this classic team-era block.",
    });
  }

  const averageIndex = scoredSeasons > 0 ? indexTotal / scoredSeasons : 0;
  const points = averageIndex * Number(options.scalingFactor || STINT_SCALING_FACTOR);
  return {
    issues,
    averageIndex,
    matchingSeasons: matchingSeasons.length,
    points,
    scoredSeasons,
    stats: buildStintStatLine(matchingSeasons),
  };
}

function updatePlayerClassicPoints(player, leagueAverages, options = {}) {
  if (!Array.isArray(player.classic_points_by_team_era)) {
    return {
      changed: false,
      issues: [],
      player,
      updatedBlocks: 0,
    };
  }

  const issues = [];
  let changed = false;
  let updatedBlocks = 0;

  const classicPointsByTeamEra = player.classic_points_by_team_era.map((block) => {
    const result = calculateClassicPointsForBlock(player, block, leagueAverages, options);
    issues.push(...result.issues);

    if (result.scoredSeasons === 0) {
      return block;
    }

    updatedBlocks += 1;
    changed =
      changed ||
      block.points !== result.points ||
      block.engine_adjusted_points !== undefined ||
      JSON.stringify(block.stats || {}) !== JSON.stringify(result.stats || {});

    const { engine_adjusted_points: _engineAdjustedPoints, ...blockWithoutEngineAdjustedPoints } = block;

    return {
      ...blockWithoutEngineAdjustedPoints,
      points: result.points,
      stats: result.stats,
    };
  });

  return {
    changed,
    issues,
    player: changed ? { ...player, classic_points_by_team_era: classicPointsByTeamEra } : player,
    updatedBlocks,
  };
}

function updatePlayersClassicPoints(players, leagueAverages, options = {}) {
  const issues = [];
  let changedPlayers = 0;
  let updatedBlocks = 0;

  const updatedPlayers = players.map((player) => {
    const result = updatePlayerClassicPoints(player, leagueAverages, options);

    issues.push(...result.issues);
    updatedBlocks += result.updatedBlocks;

    if (result.changed) {
      changedPlayers += 1;
    }

    return result.player;
  });

  return {
    issues,
    players: updatedPlayers,
    summary: {
      changedPlayers,
      totalPlayers: players.length,
      updatedBlocks,
    },
  };
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${label} file not found at ${filePath}`);
    }

    if (error instanceof SyntaxError) {
      throw new Error(`${label} file at ${filePath} is not valid JSON: ${error.message}`);
    }

    throw error;
  }
}

async function writeJsonAtomically(filePath, data) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  const payload = `${JSON.stringify(data, null, 2)}\n`;

  await fs.mkdir(directory, { recursive: true });

  try {
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function issueSummary(issues) {
  return issues.reduce((summary, issue) => {
    summary[issue.kind] = (summary[issue.kind] || 0) + 1;
    return summary;
  }, {});
}

async function main() {
  const args = parseArgs(process.argv);
  const playersPath = resolvePath(args.players || args.input, PLAYERS_PATH);
  const averagesPath = resolvePath(args.averages || args.leagueAverages, LEAGUE_AVERAGES_PATH);
  const outputPath = resolvePath(args.output, playersPath);
  const dryRun = flagEnabled(args.dryRun);
  const strict = flagEnabled(args.strict);

  console.log(`Loading players from ${playersPath}`);
  console.log(`Loading league averages from ${averagesPath}`);

  const [players, leagueAverages] = await Promise.all([
    readJson(playersPath, "Player storage"),
    readJson(averagesPath, "Historical league averages"),
  ]);

  if (!Array.isArray(players)) {
    throw new Error("Player storage must be the master players JSON array.");
  }

  const result = updatePlayersClassicPoints(players, leagueAverages);
  const summary = issueSummary(result.issues);

  if (strict && result.issues.length) {
    throw new Error(`Era-relative scoring found ${result.issues.length} data issues in strict mode.`);
  }

  if (!dryRun) {
    await writeJsonAtomically(outputPath, result.players);
  }

  console.log(`Processed ${result.summary.totalPlayers} players.`);
  console.log(`Updated ${result.summary.updatedBlocks} classic team-era point blocks.`);
  console.log(`Players with changed points: ${result.summary.changedPlayers}.`);

  if (result.issues.length) {
    console.warn(`Skipped ${result.issues.length} season/block inputs: ${JSON.stringify(summary)}`);
    for (const issue of result.issues.slice(0, 20)) {
      console.warn(
        `${issue.player} ${issue.season || "no-season"} ${issue.team || "no-team"} ${issue.era || "no-era"}: ${issue.message}`,
      );
    }
    if (result.issues.length > 20) {
      console.warn(`...and ${result.issues.length - 20} more issues.`);
    }
  }

  if (dryRun) {
    console.log("Dry run enabled; no files were written.");
  } else {
    console.log(`Updated player storage at ${outputPath}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  ALL_METRICS,
  ALL_TIME_TS_BASELINE,
  EFFICIENCY_METRICS,
  LEAGUE_AVERAGES_PATH,
  PLAYERS_PATH,
  STINT_SCALING_FACTOR,
  TS_BLEND_WEIGHTS,
  WEIGHTS,
  calculateClassicPointsForBlock,
  leagueAverageForSeason,
  metricWeightsForSeason,
  playerMetricValue,
  scoreSeasonAgainstLeague,
  updatePlayerClassicPoints,
  updatePlayersClassicPoints,
  writeJsonAtomically,
};
