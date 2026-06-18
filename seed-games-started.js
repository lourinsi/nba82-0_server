const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");
const { writeJsonAtomically } = require("./eraRelativeClassicPoints");
const { calculateLegacyPoints } = require("./legacyPoints");
const { seasonEndYear, seasonEra } = require("./seasonEras");
const { normalizeTeamCode } = require("./teamFranchises");
require("dotenv").config();

const PLAYERS_PATH = path.join(__dirname, "data", "players_accolades.json");
const CAREER_CACHE_PATH = path.join(__dirname, "data", "nba_stats_career_stats_cache.json");
const NBA_STATS_CAREER_URL = "https://stats.nba.com/stats/playercareerstats";
const GAMES_STARTED_TRACKED_START_END_YEAR = 1971;
const DEFENSIVE_STATS_START_END_YEAR = 1974;
const VALID_MODES = new Set(["missing", "active", "all"]);

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

function positiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function nonNegativeNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRateLimit(lastFetchAt, delayMs) {
  if (!lastFetchAt || !delayMs) {
    return;
  }

  const elapsedMs = Date.now() - lastFetchAt;
  const waitMs = delayMs - elapsedMs;

  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

function retryAfterMs(headers, fallbackMs) {
  const retryAfter = headers?.["retry-after"];

  if (!retryAfter) {
    return fallbackMs;
  }

  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds)) {
    return seconds * 1000 + 1000;
  }

  const retryDate = Date.parse(retryAfter);
  return Number.isNaN(retryDate) ? fallbackMs : Math.max(retryDate - Date.now() + 1000, fallbackMs);
}

function safeErrorMessage(error) {
  if (!error?.isAxiosError) {
    return error?.stack || error?.message || String(error);
  }

  const parts = ["Axios request failed"];

  if (error.response?.status) {
    parts.push(String(error.response.status));
  }
  if (error.code) {
    parts.push(`code=${error.code}`);
  }
  if (error.config?.url) {
    parts.push(`url=${error.config.url}`);
  }

  return parts.join(" | ");
}

async function getWithRetry({ label, request, retries, delayMs, retryStatuses }) {
  let attempt = 0;

  while (attempt <= retries) {
    try {
      return await request();
    } catch (error) {
      attempt += 1;
      const status = error.response?.status;
      const retryable = !status || retryStatuses.includes(status) || status >= 500;

      if (!retryable || attempt > retries) {
        throw error;
      }

      const waitMs = status === 429 ? retryAfterMs(error.response?.headers, delayMs * attempt) : delayMs * attempt;
      console.warn(`${label} failed with ${status || error.code || "network error"}; retrying in ${Math.ceil(waitMs / 1000)}s.`);
      await sleep(waitMs);
    }
  }

  throw new Error(`${label} retry loop exhausted.`);
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
  return (
    data.resultSets?.find((resultSet) => resultSet.name === "SeasonTotalsRegularSeason") ||
    data.resultSets?.[0] ||
    data.resultSet ||
    { headers: [], rowSet: [] }
  );
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

function normalizedTeamKey(team) {
  return normalizeTeamCode(team) || String(team || "").trim().toUpperCase() || null;
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function perGame(row, totalKey, gamesPlayed) {
  if (!Object.prototype.hasOwnProperty.call(row, totalKey)) {
    return null;
  }

  const total = numberOrNull(row[totalKey]);

  if (total === null || !gamesPlayed) {
    return null;
  }

  return Number((total / gamesPlayed).toFixed(6));
}

function compactRecord(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null && value !== undefined));
}

function gamesStartedFromCareerRow(row, gamesPlayed, season) {
  if (Object.prototype.hasOwnProperty.call(row, "GS")) {
    const gamesStarted = positiveInteger(row.GS, 0);

    if (gamesStarted > 0) {
      return gamesStarted;
    }

    if (row.GS === 0 || row.GS === "0") {
      const endYear = seasonEndYear(season);
      return endYear && endYear >= GAMES_STARTED_TRACKED_START_END_YEAR ? 0 : gamesPlayed;
    }
  }

  return gamesPlayed;
}

function parseCareerRows(resultSet) {
  return rowObjectsFromResultSet(resultSet)
    .map((row) => {
      const season = row.SEASON_ID ? String(row.SEASON_ID) : null;
      const team = normalizedTeamKey(row.TEAM_ABBREVIATION);
      const gamesPlayed = positiveInteger(row.GP, 0);
      const endYear = seasonEndYear(season);

      if (!season || !team || team === "TOT" || !gamesPlayed) {
        return null;
      }

      const record = {
        season,
        team,
        era: seasonEra(season),
        games_played: gamesPlayed,
        games_started: gamesStartedFromCareerRow(row, gamesPlayed, season),
        ppg: perGame(row, "PTS", gamesPlayed),
        rpg: perGame(row, "REB", gamesPlayed),
        apg: perGame(row, "AST", gamesPlayed),
      };

      if (endYear >= DEFENSIVE_STATS_START_END_YEAR) {
        record.spg = perGame(row, "STL", gamesPlayed);
        record.bpg = perGame(row, "BLK", gamesPlayed);
      }

      return compactRecord(record);
    })
    .filter(Boolean);
}

async function fetchNbaCareerRows(nbaStatsId, options) {
  const response = await getWithRetry({
    label: `NBA Stats career PlayerID=${nbaStatsId}`,
    retries: options.retries,
    delayMs: options.delayMs,
    retryStatuses: [403, 429],
    request: () =>
      axios.get(NBA_STATS_CAREER_URL, {
        headers: NBA_STATS_HEADERS,
        params: {
          LeagueID: "00",
          PerMode: "Totals",
          PlayerID: nbaStatsId,
        },
        timeout: options.timeoutMs,
      }),
  });

  return parseCareerRows(resultSetFromResponse(response.data));
}

function cacheEntryLooksValid(entry) {
  return Array.isArray(entry?.seasons);
}

function cacheEntryHasGamesStarted(entry) {
  return cacheEntryLooksValid(entry) && entry.seasons.every((season) => Object.prototype.hasOwnProperty.call(season, "games_started"));
}

function cacheEntryAgeMs(entry, now = Date.now()) {
  const fetchedAt = Date.parse(entry?.fetched_at || "");
  return Number.isNaN(fetchedAt) ? Infinity : now - fetchedAt;
}

function cacheEntryIsStale(entry, maxCacheAgeMs, now = Date.now()) {
  return maxCacheAgeMs !== null && cacheEntryAgeMs(entry, now) > maxCacheAgeMs;
}

function fetchReasonForCacheEntry(entry, options, now = Date.now()) {
  if (options.refreshCache) {
    return "refresh";
  }
  if (!cacheEntryLooksValid(entry)) {
    return "missing-cache";
  }
  if (!cacheEntryHasGamesStarted(entry)) {
    return "missing-games-started";
  }
  if (cacheEntryIsStale(entry, options.maxCacheAgeMs, now)) {
    return "stale-cache";
  }

  return null;
}

function careerRowsBySeasonTeam(rows) {
  return new Map(rows.map((row) => [`${row.season}:${normalizedTeamKey(row.team)}`, row]));
}

function gamesStartedFromCareerRows(rows = []) {
  return rows.reduce((sum, row) => sum + positiveInteger(row?.games_started, 0), 0);
}

function playerCareerRowsHaveGamesStarted(player) {
  return (
    Array.isArray(player.career_seasons) &&
    player.career_seasons.length > 0 &&
    player.career_seasons.every((season) => Object.prototype.hasOwnProperty.call(season, "games_started"))
  );
}

function playerNeedsGamesStarted(player) {
  if (!Number(player.nba_stats_id)) {
    return false;
  }

  const storedGamesStarted = nonNegativeNumber(player.accolades?.games_started, null);
  return storedGamesStarted === null || !playerCareerRowsHaveGamesStarted(player);
}

function playerLooksActive(player) {
  return Boolean(player.active || player.current_team);
}

function playerMatchesMode(player, mode) {
  if (!Number(player.nba_stats_id)) {
    return false;
  }

  if (mode === "active") {
    return playerLooksActive(player);
  }

  if (mode === "all") {
    return true;
  }

  return playerNeedsGamesStarted(player);
}

function sliceWindow(values, offset, limit) {
  const start = Math.max(0, offset || 0);
  const end = limit ? start + limit : undefined;
  return values.slice(start, end);
}

function updatePlayerGamesStarted(player, careerRows) {
  const careerByKey = careerRowsBySeasonTeam(careerRows);
  let updatedSeasonRows = 0;

  const careerSeasons = (player.career_seasons || []).map((season) => {
    const key = `${season?.season}:${normalizedTeamKey(season?.team)}`;
    const stats = careerByKey.get(key);

    if (!stats || !Object.prototype.hasOwnProperty.call(stats, "games_started")) {
      return season;
    }

    const gamesStarted = positiveInteger(stats.games_started, 0);
    if (season.games_started === gamesStarted) {
      return season;
    }

    updatedSeasonRows += 1;
    return {
      ...season,
      games_started: gamesStarted,
    };
  });

  const fetchedGamesStarted = gamesStartedFromCareerRows(careerRows);
  const careerGamesStarted = gamesStartedFromCareerRows(careerSeasons);
  const existingGamesStarted = positiveInteger(player.accolades?.games_started, 0);
  const gamesStarted = careerRows.length
    ? fetchedGamesStarted
    : Math.max(careerGamesStarted, existingGamesStarted);
  const accolades = {
    ...(player.accolades || {}),
    games_started: gamesStarted,
  };
  const legacyPoints = calculateLegacyPoints(accolades);
  const changed =
    updatedSeasonRows > 0 ||
    player.accolades?.games_started !== gamesStarted ||
    player.legacy_points !== legacyPoints;

  return {
    changed,
    player: changed
      ? {
          ...player,
          career_seasons: careerSeasons,
          accolades,
          legacy_points: legacyPoints,
        }
      : player,
    updatedSeasonRows,
  };
}

function mergeUpdatedPlayers(players, updatedById) {
  if (!updatedById.size) {
    return players;
  }

  return players.map((player) => updatedById.get(player.id) || player);
}

async function main() {
  console.time("games-started: total");
  const args = parseArgs(process.argv);
  const playersPath = path.resolve(process.cwd(), args.players || args.input || PLAYERS_PATH);
  const outputPath = path.resolve(process.cwd(), args.output || playersPath);
  const cachePath = path.resolve(process.cwd(), args.cache || CAREER_CACHE_PATH);
  const dryRun = flagEnabled(args.dryRun);
  const refreshCache = flagEnabled(args.refreshCache);
  const mode = String(args.mode || "missing").toLowerCase();
  const delayMs = positiveInteger(args.delayMs || process.env.NBA_STATS_DELAY_MS, 1500);
  const retries = positiveInteger(args.retries || process.env.NBA_STATS_MAX_RETRIES, 5);
  const timeoutMs = positiveInteger(args.timeoutMs || process.env.NBA_STATS_TIMEOUT_MS, 30000);
  const saveEvery = positiveInteger(args.saveEvery || process.env.GAMES_STARTED_SAVE_EVERY, 0);
  const maxCacheAgeDays = nonNegativeNumber(args.maxCacheAgeDays ?? process.env.GAMES_STARTED_MAX_CACHE_AGE_DAYS, null);
  const maxCacheAgeMs = maxCacheAgeDays === null ? null : maxCacheAgeDays * 24 * 60 * 60 * 1000;
  const offset = positiveInteger(args.offset, 0);
  const limit = args.limit ? positiveInteger(args.limit) : null;

  if (!VALID_MODES.has(mode)) {
    throw new Error(`Unsupported games-started mode "${mode}". Use missing, active, or all.`);
  }

  console.time("games-started: read");
  const [players, rawCache] = await Promise.all([
    readJsonIfExists(playersPath),
    readJsonIfExists(cachePath),
  ]);
  console.timeEnd("games-started: read");

  if (!Array.isArray(players)) {
    throw new Error("Player storage must be a JSON array.");
  }

  const cache = rawCache || { fetched_at: null, players: {} };
  cache.players ||= {};

  console.time("games-started: select");
  const candidates = players.filter((player) => playerMatchesMode(player, mode));
  const selected = sliceWindow(candidates, offset, limit);
  console.timeEnd("games-started: select");

  const updatedById = new Map();
  const issues = [];
  let fetched = 0;
  let cacheHits = 0;
  let changedPlayers = 0;
  let staleFetches = 0;
  let updatedSeasonRows = 0;
  let lastFetchAt = 0;

  console.log(
    `Selected ${selected.length}/${candidates.length} players for games-started seed (mode=${mode}, saveEvery=${saveEvery || "final-only"}, maxCacheAgeDays=${maxCacheAgeDays ?? "none"}).`,
  );

  console.time("games-started: process");
  for (const [index, player] of selected.entries()) {
    const nbaStatsId = Number(player.nba_stats_id);
    const cacheKey = String(nbaStatsId);
    const cacheEntry = cache.players[cacheKey];
    const fetchReason = fetchReasonForCacheEntry(cacheEntry, { maxCacheAgeMs, refreshCache });
    let careerRows = cacheEntry?.seasons;
    let source = "cache";

    if (fetchReason) {
      await waitForRateLimit(lastFetchAt, delayMs);
      try {
        careerRows = await fetchNbaCareerRows(nbaStatsId, { delayMs, retries, timeoutMs });
        lastFetchAt = Date.now();
        cache.players[cacheKey] = {
          fetched_at: new Date().toISOString(),
          seasons: careerRows,
        };
        fetched += 1;
        staleFetches += fetchReason === "stale-cache" ? 1 : 0;
        source = fetchReason;
      } catch (error) {
        lastFetchAt = Date.now();
        issues.push({
          player: player.name || player.id || "Unknown player",
          message: safeErrorMessage(error),
        });
        console.warn(`[${index + 1}/${selected.length}] ${player.name}: fetch failed (${safeErrorMessage(error)})`);
        continue;
      }
    } else {
      cacheHits += 1;
    }

    const result = updatePlayerGamesStarted(player, careerRows || []);

    if (result.changed) {
      changedPlayers += 1;
      updatedSeasonRows += result.updatedSeasonRows;
      updatedById.set(player.id, result.player);
    }

    console.log(
      `[${index + 1}/${selected.length}] ${player.name}: ${result.player.accolades?.games_started || 0} games started, ${result.updatedSeasonRows} season rows updated (${source})`,
    );

    if (!dryRun && saveEvery && (index + 1) % saveEvery === 0) {
      await writeJsonAtomically(cachePath, { ...cache, fetched_at: new Date().toISOString() });
      await writeJsonAtomically(outputPath, mergeUpdatedPlayers(players, updatedById));
      console.log(`Checkpoint saved after ${index + 1} players.`);
    }
  }
  console.timeEnd("games-started: process");

  if (dryRun) {
    console.log("Dry run enabled; no files were written.");
  } else {
    console.time("games-started: write");
    await writeJsonAtomically(cachePath, { ...cache, fetched_at: new Date().toISOString() });
    await writeJsonAtomically(outputPath, mergeUpdatedPlayers(players, updatedById));
    console.timeEnd("games-started: write");
  }

  console.log(`Fetched ${fetched} career stat payloads (${staleFetches} stale refreshes); used ${cacheHits} cache entries.`);
  console.log(`Updated ${updatedSeasonRows} career season rows across ${changedPlayers} players.`);
  if (issues.length) {
    console.warn(`Encountered ${issues.length} games-started fetch failures.`);
    for (const issue of issues.slice(0, 20)) {
      console.warn(`${issue.player}: ${issue.message}`);
    }
    if (issues.length > 20) {
      console.warn(`...and ${issues.length - 20} more issues.`);
    }
  }
  if (!dryRun) {
    console.log(`Updated player storage at ${outputPath}`);
    console.log(`Updated career stat cache at ${cachePath}`);
  }
  console.timeEnd("games-started: total");
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
