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

function compactAverage(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null && value !== undefined));
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
  });
}

function tableHtmlById(html, tableId) {
  const pattern = new RegExp(`<table[^>]+id=["']${tableId}["'][\\s\\S]*?</table>`, "i");
  return html.match(pattern)?.[0] || null;
}

function leagueAverageRowHtml(tableHtml) {
  return tableHtml?.match(/<tfoot>[\s\S]*?<tr[\s\S]*?League Average[\s\S]*?<\/tr>[\s\S]*?<\/tfoot>/i)?.[0] || null;
}

function dataStatValue(rowHtml, statKey) {
  const pattern = new RegExp(`data-stat=["']${statKey}["'][^>]*>([\\s\\S]*?)<\\/t[dh]>`, "i");
  const rawValue = rowHtml?.match(pattern)?.[1];

  if (!rawValue) {
    return null;
  }

  const text = rawValue.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim();
  const numeric = Number(text);

  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
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
  const rowHtml = leagueAverageRowHtml(tableHtmlById(response.data, "per_game-team"));

  if (!rowHtml) {
    return null;
  }

  return compactAverage({
    PPG: roundStat(dataStatValue(rowHtml, "pts")),
    RPG: roundStat(dataStatValue(rowHtml, "trb")),
    APG: roundStat(dataStatValue(rowHtml, "ast")),
    SPG: endYear >= DEFENSIVE_STATS_START_END_YEAR ? roundStat(dataStatValue(rowHtml, "stl")) : null,
    BPG: endYear >= DEFENSIVE_STATS_START_END_YEAR ? roundStat(dataStatValue(rowHtml, "blk")) : null,
  });
}

async function fetchLeagueAverage(season, options) {
  const errors = [];

  if (options.source !== "bref") {
    try {
      const average = await fetchNbaStatsLeagueAverage(season, options.timeoutMs);

      if (average?.PPG && average?.RPG && average?.APG) {
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

    if (average?.PPG && average?.RPG && average?.APG) {
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
    if (!refresh && output[season]) {
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

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
