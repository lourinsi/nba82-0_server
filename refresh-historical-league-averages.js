const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");
const { seasonEndYear } = require("./seasonEras");
const { writeJsonAtomically } = require("./eraRelativeClassicPoints");
require("dotenv").config();

const PLAYERS_PATH = path.join(__dirname, "data", "players_accolades.json");
const OUTPUT_PATH = path.join(__dirname, "data", "historical_league_averages.json");
const NBA_STATS_TEAM_STATS_URL = "https://stats.nba.com/stats/leaguedashteamstats";
const NBA_STATS_GAME_LOG_URL = "https://stats.nba.com/stats/leaguegamelog";
const BREF_SEASON_URL = (endYear) =>
  `https://www.basketball-reference.com/leagues/${endYear < 1950 ? "BAA" : "NBA"}_${endYear}.html`;
const DEFENSIVE_STATS_START_END_YEAR = 1974;
const NBA_GAME_LOG_RELIABLE_START_END_YEAR = 1999;

const NBA_STATS_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.nba.com",
  Referer: "https://www.nba.com/",
  Connection: "keep-alive",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

const BREF_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const NBA_STATS_TEAM_PARAMS = {
  Conference: "",
  DateFrom: "",
  DateTo: "",
  Division: "",
  GameScope: "",
  GameSegment: "",
  LastNGames: 0,
  LeagueID: "00",
  Location: "",
  MeasureType: "Base",
  Month: 0,
  OpponentTeamID: 0,
  Outcome: "",
  PORound: 0,
  PaceAdjust: "N",
  PerMode: "PerGame",
  Period: 0,
  PlayerExperience: "",
  PlayerPosition: "",
  PlusMinus: "N",
  Rank: "N",
  SeasonSegment: "",
  SeasonType: "Regular Season",
  ShotClockRange: "",
  StarterBench: "",
  TeamID: 0,
  TwoWay: 0,
  VsConference: "",
  VsDivision: "",
};

const NBA_STATS_GAME_LOG_PARAMS = {
  Counter: 0,
  Direction: "ASC",
  LeagueID: "00",
  PlayerOrTeam: "T",
  SeasonType: "Regular Season",
  Sorter: "DATE",
};

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

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function roundStat(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(3)) : null;
}

function seasonKeyFromEndYear(endYear) {
  return `${endYear - 1}-${String(endYear).slice(-2)}`;
}

function seasonKeysFromRange(startEndYear, endEndYear) {
  const seasons = [];

  for (let endYear = startEndYear; endYear <= endEndYear; endYear += 1) {
    seasons.push(seasonKeyFromEndYear(endYear));
  }

  return seasons;
}

function seasonKeysFromPlayers(players) {
  return Array.from(
    new Set(
      players
        .flatMap((player) => player.career_seasons || [])
        .map((season) => season?.season)
        .filter(Boolean),
    ),
  ).sort((a, b) => seasonEndYear(a) - seasonEndYear(b));
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function resultSetFromResponse(data) {
  return data.resultSets?.[0] || data.resultSet || { headers: [], rowSet: [] };
}

function rowObjectsFromResultSet(resultSet) {
  const headers = resultSet.headers || [];

  return (resultSet.rowSet || []).map((row) =>
    headers.reduce((record, header, index) => {
      record[header] = row[index];
      return record;
    }, {}),
  );
}

function averageRows(rows, key, options = {}) {
  const values = rows
    .map((row) => Number(row[key]))
    .filter((value) => Number.isFinite(value) && (options.allowZero ? value >= 0 : value > 0));

  if (!values.length) {
    return null;
  }

  return roundStat(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function sumRows(rows, key, options = {}) {
  const values = rows
    .map((row) => Number(row[key]))
    .filter((value) => Number.isFinite(value) && (options.allowZero ? value >= 0 : value > 0));

  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0);
}

function weightedSumRows(rows, valueKey, weightKey) {
  let total = 0;
  let used = 0;

  for (const row of rows) {
    const value = Number(row[valueKey]);
    const weight = Number(row[weightKey]);

    if (!Number.isFinite(value) || value < 0 || !Number.isFinite(weight) || weight <= 0) {
      continue;
    }

    total += value * weight;
    used += 1;
  }

  return used ? total : null;
}

function trueShootingPct(points, fieldGoalAttempts, freeThrowAttempts) {
  const pts = Number(points);
  const fga = Number(fieldGoalAttempts);
  const fta = Number(freeThrowAttempts);
  const denominator = 2 * (fga + 0.44 * fta);

  if (!Number.isFinite(pts) || !Number.isFinite(fga) || !Number.isFinite(fta) || denominator <= 0) {
    return null;
  }

  return roundStat(pts / denominator);
}

function trueShootingFromTeamRows(rows) {
  const points = weightedSumRows(rows, "PTS", "GP") ?? sumRows(rows, "PTS");
  const fieldGoalAttempts = weightedSumRows(rows, "FGA", "GP") ?? sumRows(rows, "FGA");
  const freeThrowAttempts = weightedSumRows(rows, "FTA", "GP") ?? sumRows(rows, "FTA", { allowZero: true });

  return trueShootingPct(points, fieldGoalAttempts, freeThrowAttempts);
}

function trueShootingFromGameRows(rows) {
  return trueShootingPct(
    sumRows(rows, "PTS"),
    sumRows(rows, "FGA"),
    sumRows(rows, "FTA", { allowZero: true }),
  );
}

function compactAverage(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null && value !== undefined));
}

function hasRequiredAverageFields(average) {
  return Boolean(average?.PPG && average?.RPG && average?.APG && average?.TS_PCT);
}

function hasCoreAverageFields(average) {
  return Boolean(average?.PPG && average?.RPG && average?.APG);
}

function hasAnyAverageFields(average) {
  return hasCoreAverageFields(average) || Boolean(Number(average?.TS_PCT) > 0);
}

async function fetchNbaStatsLeagueAverage(season, timeoutMs) {
  const endYear = seasonEndYear(season);

  if (endYear >= NBA_GAME_LOG_RELIABLE_START_END_YEAR) {
    return fetchNbaStatsGameLogAverage(season, timeoutMs);
  }

  const response = await axios.get(NBA_STATS_TEAM_STATS_URL, {
    headers: NBA_STATS_HEADERS,
    params: { ...NBA_STATS_TEAM_PARAMS, Season: season },
    timeout: timeoutMs,
  });
  const rows = rowObjectsFromResultSet(resultSetFromResponse(response.data));

  if (!rows.length) {
    return null;
  }

  return compactAverage({
    PPG: averageRows(rows, "PTS"),
    RPG: averageRows(rows, "REB"),
    APG: averageRows(rows, "AST"),
    SPG: endYear >= DEFENSIVE_STATS_START_END_YEAR ? averageRows(rows, "STL") : null,
    BPG: endYear >= DEFENSIVE_STATS_START_END_YEAR ? averageRows(rows, "BLK") : null,
    TS_PCT: trueShootingFromTeamRows(rows),
  });
}

async function fetchNbaStatsGameLogAverage(season, timeoutMs) {
  const response = await axios.get(NBA_STATS_GAME_LOG_URL, {
    headers: NBA_STATS_HEADERS,
    params: { ...NBA_STATS_GAME_LOG_PARAMS, Season: season },
    timeout: timeoutMs,
  });
  const rows = rowObjectsFromResultSet(resultSetFromResponse(response.data));

  if (!rows.length) {
    return null;
  }

  return compactAverage({
    PPG: averageRows(rows, "PTS"),
    RPG: averageRows(rows, "REB"),
    APG: averageRows(rows, "AST"),
    SPG: averageRows(rows, "STL", { allowZero: true }),
    BPG: averageRows(rows, "BLK", { allowZero: true }),
    TS_PCT: trueShootingFromGameRows(rows),
  });
}

function tableHtmlById(html, tableId) {
  const pattern = new RegExp(`<table[^>]+id=["']${tableId}["'][\\s\\S]*?</table>`, "i");
  return html.match(pattern)?.[0] || null;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tableRowsHtml(tableHtml) {
  return Array.from(String(tableHtml || "").matchAll(/<tr\b[\s\S]*?<\/tr>/gi)).map((match) => match[0]);
}

function leagueAverageRowHtml(tableHtml) {
  const footerHtml = tableHtml?.match(/<tfoot>[\s\S]*?<\/tfoot>/i)?.[0] || "";
  const footerRow = tableRowsHtml(footerHtml).find((rowHtml) => /League Average/i.test(stripHtml(rowHtml)));

  if (footerRow) {
    return footerRow;
  }

  return tableRowsHtml(tableHtml).find((rowHtml) => /League Average/i.test(stripHtml(rowHtml))) || null;
}

function dataStatValue(rowHtml, statKey) {
  const pattern = new RegExp(`data-stat=["']${statKey}["'][^>]*>([\\s\\S]*?)<\\/t[dh]>`, "i");
  const rawValue = rowHtml?.match(pattern)?.[1];

  if (!rawValue) {
    return null;
  }

  const text = stripHtml(rawValue);
  const numeric = Number(text);

  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function brefTableRows(tableHtml) {
  return tableRowsHtml(tableHtml).filter(
    (rowHtml) => !/League Average/i.test(stripHtml(rowHtml)) && dataStatValue(rowHtml, "g"),
  );
}

function brefTeamRows(tableHtml) {
  return brefTableRows(tableHtml).map((rowHtml) => ({
    GP: dataStatValue(rowHtml, "g"),
    PTS: dataStatValue(rowHtml, "pts"),
    REB: dataStatValue(rowHtml, "trb"),
    AST: dataStatValue(rowHtml, "ast"),
    STL: dataStatValue(rowHtml, "stl"),
    BLK: dataStatValue(rowHtml, "blk"),
    FGA: dataStatValue(rowHtml, "fga"),
    FTA: dataStatValue(rowHtml, "fta"),
  }));
}

async function fetchBrefLeagueAverage(season, timeoutMs) {
  const endYear = seasonEndYear(season);

  if (!endYear) {
    return null;
  }

  const response = await axios.get(BREF_SEASON_URL(endYear), {
    headers: BREF_HEADERS,
    timeout: timeoutMs,
  });
  const perGameTableHtml = tableHtmlById(response.data, "per_game-team");
  const rowHtml = leagueAverageRowHtml(perGameTableHtml);
  const advancedRowHtml = leagueAverageRowHtml(tableHtmlById(response.data, "advanced-team"));
  const teamRows = rowHtml ? [] : brefTeamRows(perGameTableHtml);

  if (!rowHtml && !teamRows.length && !advancedRowHtml) {
    return null;
  }

  return compactAverage({
    PPG: rowHtml ? roundStat(dataStatValue(rowHtml, "pts")) : averageRows(teamRows, "PTS"),
    RPG: rowHtml ? roundStat(dataStatValue(rowHtml, "trb")) : averageRows(teamRows, "REB"),
    APG: rowHtml ? roundStat(dataStatValue(rowHtml, "ast")) : averageRows(teamRows, "AST"),
    SPG: endYear >= DEFENSIVE_STATS_START_END_YEAR
      ? rowHtml
        ? roundStat(dataStatValue(rowHtml, "stl"))
        : averageRows(teamRows, "STL", { allowZero: true })
      : null,
    BPG: endYear >= DEFENSIVE_STATS_START_END_YEAR
      ? rowHtml
        ? roundStat(dataStatValue(rowHtml, "blk"))
        : averageRows(teamRows, "BLK", { allowZero: true })
      : null,
    TS_PCT:
      roundStat(dataStatValue(advancedRowHtml, "ts_pct")) ||
      (rowHtml
        ? trueShootingPct(
            dataStatValue(rowHtml, "pts"),
            dataStatValue(rowHtml, "fga"),
            dataStatValue(rowHtml, "fta"),
          )
        : trueShootingFromTeamRows(teamRows)),
  });
}

async function fetchLeagueAverage(season, options) {
  const errors = [];

  if (options.source !== "bref") {
    try {
      const average = await fetchNbaStatsLeagueAverage(season, options.timeoutMs);

      if (hasAnyAverageFields(average)) {
        return { average, source: "nba_stats" };
      }
    } catch (error) {
      errors.push(`NBA Stats: ${error.response?.status || error.code || error.message}`);
    }
  }

  if (options.source === "nba") {
    return {
      average: null,
      error: errors.join("; ") || "No NBA Stats league-average row found.",
      source: null,
    };
  }

  try {
    const average = await fetchBrefLeagueAverage(season, options.timeoutMs);

    if (hasAnyAverageFields(average)) {
      return { average, source: "basketball_reference" };
    }
  } catch (error) {
    errors.push(`Basketball Reference: ${error.response?.status || error.code || error.message}`);
  }

  return {
    average: null,
    error: errors.join("; ") || "No league-average row found.",
    source: null,
  };
}

function sortedAverages(output) {
  return Object.fromEntries(
    Object.entries(output).sort((a, b) => seasonEndYear(a[0]) - seasonEndYear(b[0])),
  );
}

function fillEarlyMissingTrueShooting(output, seasonKeys = Object.keys(output)) {
  const entriesWithTs = Object.entries(output)
    .map(([season, average]) => ({
      season,
      endYear: seasonEndYear(season),
      tsPct: Number(average?.TS_PCT),
    }))
    .filter((entry) => entry.endYear && Number.isFinite(entry.tsPct) && entry.tsPct > 0)
    .sort((a, b) => a.endYear - b.endYear);

  if (!entriesWithTs.length) {
    return 0;
  }

  const earliest = entriesWithTs[0];
  let filled = 0;

  for (const season of seasonKeys) {
    const average = output[season] || {};
    const endYear = seasonEndYear(season);

    if (!endYear || endYear >= earliest.endYear || Number.isFinite(Number(average?.TS_PCT))) {
      continue;
    }

    output[season] = {
      ...average,
      TS_PCT: earliest.tsPct,
    };
    filled += 1;
  }

  return filled;
}

async function main() {
  const args = parseArgs(process.argv);
  const playersPath = path.resolve(process.cwd(), args.players || PLAYERS_PATH);
  const outputPath = path.resolve(process.cwd(), args.output || OUTPUT_PATH);
  const dryRun = flagEnabled(args.dryRun);
  const refresh = flagEnabled(args.refresh);
  const prefer = String(args.prefer || "nba").toLowerCase();
  const source = String(args.source || (prefer === "bref" ? "bref" : "hybrid")).toLowerCase();
  const delayMs = positiveInteger(args.delayMs || process.env.NBA_STATS_DELAY_MS, 1500);
  const timeoutMs = positiveInteger(args.timeoutMs || process.env.NBA_STATS_TIMEOUT_MS, 30000);
  const saveEvery = positiveInteger(args.saveEvery, 10);
  const existing = (await readJsonIfExists(outputPath)) || {};
  const players = (await readJsonIfExists(playersPath)) || [];
  const startEndYear = args.startEndYear ? positiveInteger(args.startEndYear) : null;
  const endEndYear = args.endEndYear ? positiveInteger(args.endEndYear) : null;
  const seasons =
    startEndYear && endEndYear
      ? seasonKeysFromRange(startEndYear, endEndYear)
      : seasonKeysFromPlayers(players);
  const output = { ...existing };
  const failures = [];
  let fetched = 0;
  let skipped = 0;

  if (!Array.isArray(players) && (!startEndYear || !endEndYear)) {
    throw new Error("Player storage must be a JSON array unless --startEndYear and --endEndYear are provided.");
  }

  console.log(`Preparing league averages for ${seasons.length} seasons.`);

  for (const [index, season] of seasons.entries()) {
    if (!refresh && hasRequiredAverageFields(output[season])) {
      skipped += 1;
      continue;
    }

    const result = await fetchLeagueAverage(season, { source, timeoutMs });

    if (result.average) {
      output[season] = result.average;
      fetched += 1;
      console.log(`[${index + 1}/${seasons.length}] ${season}: ${result.source} ${JSON.stringify(result.average)}`);

      if (!dryRun && saveEvery && fetched % saveEvery === 0) {
        await writeJsonAtomically(outputPath, sortedAverages(output));
        console.log(`Checkpoint saved ${Object.keys(output).length} seasons to ${outputPath}.`);
      }
    } else {
      failures.push({ season, error: result.error });
      console.warn(`[${index + 1}/${seasons.length}] ${season}: ${result.error}`);
    }

    if (index < seasons.length - 1) {
      await sleep(delayMs);
    }
  }

  const filledEarlyTs = fillEarlyMissingTrueShooting(output, seasons);

  if (filledEarlyTs) {
    console.log(`Filled TS_PCT for ${filledEarlyTs} early seasons using the earliest available league TS%.`);
  }

  if (dryRun) {
    console.log("Dry run enabled; no files were written.");
  } else {
    await writeJsonAtomically(outputPath, sortedAverages(output));
  }

  console.log(`Fetched/refreshed ${fetched} seasons; skipped ${skipped} existing seasons.`);
  if (failures.length) {
    console.warn(`Failed to fetch ${failures.length} seasons.`);
  }
  if (!dryRun) {
    console.log(`Updated league averages at ${outputPath}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  fetchBrefLeagueAverage,
  fetchLeagueAverage,
  fetchNbaStatsGameLogAverage,
  fetchNbaStatsLeagueAverage,
  fillEarlyMissingTrueShooting,
  hasAnyAverageFields,
  hasCoreAverageFields,
  hasRequiredAverageFields,
  trueShootingFromGameRows,
  trueShootingFromTeamRows,
  trueShootingPct,
};
