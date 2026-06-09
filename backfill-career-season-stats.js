const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");
const { seasonEndYear, seasonEra } = require("./seasonEras");
const { normalizeTeamCode } = require("./teamFranchises");
const { writeJsonAtomically } = require("./eraRelativeClassicPoints");
require("dotenv").config();

const PLAYERS_PATH = path.join(__dirname, "data", "players_accolades.json");
const CAREER_CACHE_PATH = path.join(__dirname, "data", "nba_stats_career_stats_cache.json");
const NBA_STATS_CAREER_URL = "https://stats.nba.com/stats/playercareerstats";
const DEFENSIVE_STATS_START_END_YEAR = 1974;
const BASE_STAT_KEYS = ["ppg", "rpg", "apg"];
const DEFENSIVE_STAT_KEYS = ["spg", "bpg"];

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        ppg: perGame(row, "PTS", gamesPlayed),
        rpg: perGame(row, "REB", gamesPlayed),
        apg: perGame(row, "AST", gamesPlayed),
      };

      if (endYear >= DEFENSIVE_STATS_START_END_YEAR) {
        record.spg = perGame(row, "STL", gamesPlayed);
        record.bpg = perGame(row, "BLK", gamesPlayed);
      }

      return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== null && value !== undefined));
    })
    .filter(Boolean);
}

function careerRowsBySeasonTeam(rows) {
  return new Map(rows.map((row) => [`${row.season}:${row.team}`, row]));
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

function statKeysForSeason(season) {
  const endYear = seasonEndYear(season);
  return endYear >= DEFENSIVE_STATS_START_END_YEAR ? [...BASE_STAT_KEYS, ...DEFENSIVE_STAT_KEYS] : BASE_STAT_KEYS;
}

function seasonNeedsStats(season) {
  return statKeysForSeason(season?.season).some((key) => numberOrNull(season?.[key]) === null);
}

function updateSeasonWithStats(season, stats, force) {
  if (!stats) {
    return { changed: false, season };
  }

  let changed = false;
  const nextSeason = { ...season };
  const keys = ["games_played", ...statKeysForSeason(season?.season)];

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(stats, key)) {
      continue;
    }

    if (force || numberOrNull(nextSeason[key]) === null) {
      if (nextSeason[key] !== stats[key]) {
        nextSeason[key] = stats[key];
        changed = true;
      }
    }
  }

  return { changed, season: changed ? nextSeason : season };
}

function updatePlayerCareerSeasons(player, careerRows, force) {
  const careerByKey = careerRowsBySeasonTeam(careerRows);
  const issues = [];
  let updatedSeasons = 0;

  const careerSeasons = (player.career_seasons || []).map((season) => {
    if (!force && !seasonNeedsStats(season)) {
      return season;
    }

    const team = normalizedTeamKey(season?.team);
    const stats = careerByKey.get(`${season?.season}:${team}`);
    const result = updateSeasonWithStats(season, stats, force);

    if (!stats) {
      issues.push({
        player: player.name || player.id || "Unknown player",
        season: season?.season || null,
        team: season?.team || null,
        message: "No matching NBA Stats career row found.",
      });
    }

    if (result.changed) {
      updatedSeasons += 1;
    }

    return result.season;
  });

  return {
    issues,
    player: updatedSeasons ? { ...player, career_seasons: careerSeasons } : player,
    updatedSeasons,
  };
}

function sliceWindow(values, offset, limit) {
  const start = Math.max(0, offset || 0);
  const end = limit ? start + limit : undefined;
  return values.slice(start, end);
}

function cacheEntryLooksValid(entry) {
  return Array.isArray(entry?.seasons);
}

async function main() {
  const args = parseArgs(process.argv);
  const playersPath = path.resolve(process.cwd(), args.players || args.input || PLAYERS_PATH);
  const outputPath = path.resolve(process.cwd(), args.output || playersPath);
  const cachePath = path.resolve(process.cwd(), args.cache || CAREER_CACHE_PATH);
  const dryRun = flagEnabled(args.dryRun);
  const force = flagEnabled(args.force);
  const refreshCache = flagEnabled(args.refreshCache);
  const delayMs = positiveInteger(args.delayMs || process.env.NBA_STATS_DELAY_MS, 1500);
  const retries = positiveInteger(args.retries || process.env.NBA_STATS_MAX_RETRIES, 5);
  const timeoutMs = positiveInteger(args.timeoutMs || process.env.NBA_STATS_TIMEOUT_MS, 30000);
  const saveEvery = positiveInteger(args.saveEvery, 25);
  const offset = positiveInteger(args.offset, 0);
  const limit = args.limit ? positiveInteger(args.limit) : null;
  const players = await readJsonIfExists(playersPath);
  const cache = (await readJsonIfExists(cachePath)) || { fetched_at: null, players: {} };

  if (!Array.isArray(players)) {
    throw new Error("Player storage must be a JSON array.");
  }

  const candidates = players.filter(
    (player) =>
      Number(player.nba_stats_id) &&
      Array.isArray(player.career_seasons) &&
      player.career_seasons.length > 0 &&
      (force || player.career_seasons.some(seasonNeedsStats)),
  );
  const selected = sliceWindow(candidates, offset, limit);
  const selectedIds = new Set(selected.map((player) => player.id));
  const updatedById = new Map();
  const issues = [];
  let fetched = 0;
  let cacheHits = 0;
  let changedPlayers = 0;
  let updatedSeasons = 0;

  console.log(`Selected ${selected.length}/${candidates.length} players needing career-season stat backfill.`);

  for (const [index, player] of selected.entries()) {
    const nbaStatsId = Number(player.nba_stats_id);
    let careerRows = cache.players[String(nbaStatsId)]?.seasons;

    if (!cacheEntryLooksValid(cache.players[String(nbaStatsId)]) || refreshCache) {
      try {
        careerRows = await fetchNbaCareerRows(nbaStatsId, { delayMs, retries, timeoutMs });
        cache.players[String(nbaStatsId)] = {
          fetched_at: new Date().toISOString(),
          seasons: careerRows,
        };
        fetched += 1;
      } catch (error) {
        issues.push({
          player: player.name || player.id || "Unknown player",
          season: null,
          team: null,
          message: safeErrorMessage(error),
        });
        console.warn(`[${index + 1}/${selected.length}] ${player.name}: fetch failed (${safeErrorMessage(error)})`);
        continue;
      }
    } else {
      cacheHits += 1;
    }

    const result = updatePlayerCareerSeasons(player, careerRows, force);
    issues.push(...result.issues);

    if (result.updatedSeasons) {
      changedPlayers += 1;
      updatedSeasons += result.updatedSeasons;
      updatedById.set(player.id, result.player);
    }

    console.log(
      `[${index + 1}/${selected.length}] ${player.name}: ${result.updatedSeasons} seasons updated (${cacheHits + fetched === index + 1 && cacheHits > 0 ? "cache/source mixed" : fetched > 0 && cacheHits === 0 ? "fetched" : "cache"})`,
    );

    if (!dryRun && saveEvery && (index + 1) % saveEvery === 0) {
      await writeJsonAtomically(cachePath, { ...cache, fetched_at: new Date().toISOString() });
      const checkpointPlayers = players.map((candidate) => updatedById.get(candidate.id) || candidate);
      await writeJsonAtomically(outputPath, checkpointPlayers);
      console.log(`Checkpoint saved after ${index + 1} players.`);
    }

    if (index < selected.length - 1 && fetched > 0) {
      await sleep(delayMs);
    }
  }

  const outputPlayers = players.map((player) => {
    if (!selectedIds.has(player.id)) {
      return player;
    }

    return updatedById.get(player.id) || player;
  });

  if (dryRun) {
    console.log("Dry run enabled; no files were written.");
  } else {
    await writeJsonAtomically(cachePath, { ...cache, fetched_at: new Date().toISOString() });
    await writeJsonAtomically(outputPath, outputPlayers);
  }

  console.log(`Fetched ${fetched} career stat payloads; used ${cacheHits} cache entries.`);
  console.log(`Updated ${updatedSeasons} career season rows across ${changedPlayers} players.`);
  if (issues.length) {
    console.warn(`Encountered ${issues.length} missing/failing season inputs.`);
    for (const issue of issues.slice(0, 20)) {
      console.warn(`${issue.player} ${issue.season || "no-season"} ${issue.team || "no-team"}: ${issue.message}`);
    }
    if (issues.length > 20) {
      console.warn(`...and ${issues.length - 20} more issues.`);
    }
  }
  if (!dryRun) {
    console.log(`Updated player storage at ${outputPath}`);
    console.log(`Updated career stat cache at ${cachePath}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
