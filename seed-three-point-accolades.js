const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");
const { STAT_TITLE_DESCRIPTIONS, THREE_POINT_CONTEST_DESCRIPTION } = require("./classicPoints");
const { applyLegacyScoringPipeline } = require("./seed-legacy-points");

require("dotenv").config({ quiet: true });

const DEFAULT_PLAYERS_PATH = path.join(__dirname, "data", "players_accolades.json");
const STAT_TITLE_CACHE_PATH = path.join(__dirname, "data", "stat_title_winners.json");
const THREE_POINT_CONTEST_CACHE_PATH = path.join(__dirname, "data", "three_point_contest_winners.json");
const NBA_STATS_LEAGUE_LEADERS_URL = "https://stats.nba.com/stats/leagueleaders";
const BREF_CONTEST_URL = "https://www.basketball-reference.com/allstar/contest.html";

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
  Connection: "keep-alive",
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

async function writeJsonAtomically(filePath, data) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

function resultSetFromResponse(data, preferredName) {
  return (
    data.resultSets?.find((resultSet) => resultSet.name === preferredName) ||
    data.resultSets?.[0] ||
    data.resultSet ||
    { headers: [], rowSet: [] }
  );
}

function buildHeaderMapper(headers) {
  return (row) =>
    headers.reduce((record, header, index) => {
      record[header] = row[index];
      return record;
    }, {});
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

      const waitMs = delayMs * attempt;
      console.warn(`${label} failed with ${status || error.code || "network error"}; retrying in ${Math.ceil(waitMs / 1000)}s.`);
      await sleep(waitMs);
    }
  }

  throw new Error(`${label} retry loop exhausted.`);
}

function seasonsFromPlayers(players) {
  return Array.from(
    new Set(
      players.flatMap((player) =>
        (player.career_seasons || [])
          .map((season) => String(season?.season || ""))
          .filter(Boolean),
      ),
    ),
  ).sort();
}

async function fetchThreePointTitleWinners(season, options) {
  const response = await getWithRetry({
    label: `NBA Stats FG3M leaders ${season}`,
    retries: options.retries,
    delayMs: options.delayMs,
    retryStatuses: [403, 429],
    request: () =>
      axios.get(NBA_STATS_LEAGUE_LEADERS_URL, {
        headers: NBA_STATS_HEADERS,
        params: {
          LeagueID: "00",
          PerMode: "Totals",
          Scope: "S",
          Season: season,
          SeasonType: "Regular Season",
          StatCategory: "FG3M",
        },
        timeout: options.timeoutMs,
      }),
  });
  const resultSet = resultSetFromResponse(response.data, "LeagueLeaders");
  const mapRow = buildHeaderMapper(resultSet.headers || []);

  return (resultSet.rowSet || [])
    .map(mapRow)
    .filter((row) => Number(row.RANK) === 1 && Number(row.FG3M) > 0)
    .map((row) => ({
      player_id: Number(row.PLAYER_ID),
      player: row.PLAYER,
      team: row.TEAM,
      rank: Number(row.RANK),
      value: Number(row.FG3M),
    }));
}

async function ensureThreePointTitleCache(statTitleCache, seasons, options) {
  statTitleCache.winners ||= {};
  let fetched = 0;
  let cached = 0;

  for (const season of seasons) {
    statTitleCache.winners[season] ||= {};

    if (statTitleCache.winners[season].FG3M && !options.refresh) {
      cached += 1;
      continue;
    }

    statTitleCache.winners[season].FG3M = await fetchThreePointTitleWinners(season, options);
    fetched += 1;
    await sleep(options.delayMs);
  }

  return { fetched, cached };
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, "")).trim();
}

function cellHtml(rowHtml, dataStat) {
  const pattern = new RegExp(`<(?:td|th)[^>]*data-stat="${dataStat}"[^>]*>([\\s\\S]*?)<\\/(?:td|th)>`, "i");
  return pattern.exec(rowHtml)?.[1] || "";
}

function seasonFromAllStarYear(year) {
  const endYear = Number(year);

  if (!Number.isInteger(endYear) || endYear <= 0) {
    return null;
  }

  return `${endYear - 1}-${String(endYear % 100).padStart(2, "0")}`;
}

function parseThreePointContestWinners(html) {
  const winners = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(html))) {
    const rowHtml = rowMatch[1];
    const contest = stripTags(cellHtml(rowHtml, "contest"));

    if (contest !== "Three-Point Shootout") {
      continue;
    }

    const year = Number(stripTags(cellHtml(rowHtml, "year_id")));
    const winnerCell = cellHtml(rowHtml, "contest_winner");
    const brefId = /\/players\/[a-z]\/([^/.]+)\.html/i.exec(winnerCell)?.[1] || null;
    const player = stripTags(winnerCell);
    const season = seasonFromAllStarYear(year);

    if (!year || !season || !player) {
      continue;
    }

    winners.push({
      year,
      season,
      player,
      bref_id: brefId,
      description: THREE_POINT_CONTEST_DESCRIPTION,
    });
  }

  return winners.sort((a, b) => a.year - b.year || a.player.localeCompare(b.player));
}

async function fetchThreePointContestCache(options) {
  const response = await getWithRetry({
    label: "Basketball Reference All-Star contest winners",
    retries: options.retries,
    delayMs: options.delayMs,
    retryStatuses: [429],
    request: () =>
      axios.get(BREF_CONTEST_URL, {
        headers: BREF_HEADERS,
        timeout: options.timeoutMs,
      }),
  });
  const winners = parseThreePointContestWinners(response.data);

  if (!winners.length) {
    throw new Error("No Three-Point Shootout winners parsed from Basketball Reference.");
  }

  return {
    fetched_at: new Date().toISOString(),
    source: BREF_CONTEST_URL,
    winners,
  };
}

async function main() {
  console.time("three-point-accolades: total");
  const args = parseArgs(process.argv);
  const playersPath = path.resolve(__dirname, args.players || args.file || args.input || DEFAULT_PLAYERS_PATH);
  const outputPath = path.resolve(__dirname, args.output || playersPath);
  const statTitleCachePath = path.resolve(__dirname, args.statTitleCache || STAT_TITLE_CACHE_PATH);
  const contestCachePath = path.resolve(__dirname, args.threePointContestCache || args.contestCache || THREE_POINT_CONTEST_CACHE_PATH);
  const dryRun = flagEnabled(args.dryRun);
  const refreshTitles = flagEnabled(args.refreshTitles);
  const refreshContest = flagEnabled(args.refreshContest);
  const skipFetch = flagEnabled(args.skipFetch);
  const delayMs = positiveInteger(args.delayMs || process.env.NBA_STATS_DELAY_MS, 1500);
  const retries = positiveInteger(args.retries || process.env.NBA_STATS_MAX_RETRIES, 5);
  const timeoutMs = positiveInteger(args.timeoutMs || process.env.NBA_STATS_TIMEOUT_MS, 30000);

  const [players, rawStatTitleCache, rawContestCache] = await Promise.all([
    fs.readFile(playersPath, "utf8").then(JSON.parse),
    readJsonIfExists(statTitleCachePath),
    readJsonIfExists(contestCachePath),
  ]);

  if (!Array.isArray(players)) {
    throw new Error(`${playersPath} must contain a player array.`);
  }

  const statTitleCache = rawStatTitleCache?.winners ? rawStatTitleCache : { fetched_at: null, winners: {} };
  const seasons = seasonsFromPlayers(players);

  if (!skipFetch) {
    const titleStats = await ensureThreePointTitleCache(statTitleCache, seasons, {
      delayMs,
      refresh: refreshTitles,
      retries,
      timeoutMs,
    });
    console.log(`FG3M title cache: fetched ${titleStats.fetched}, cache hits ${titleStats.cached}.`);
  }

  const threePointContestCache =
    !skipFetch && (refreshContest || !rawContestCache?.winners?.length)
      ? await fetchThreePointContestCache({ delayMs, retries, timeoutMs })
      : rawContestCache;

  if (!threePointContestCache?.winners?.length) {
    throw new Error(
      `Missing 3-Point Contest winners cache at ${contestCachePath}. Run without --skipFetch or provide --contestCache.`,
    );
  }

  const outputPlayers = applyLegacyScoringPipeline(players, {
    statTitleCache,
    threePointContestCache,
  });
  const titleCount = outputPlayers.reduce((sum, player) => sum + Number(player.accolades?.three_point_titles || 0), 0);
  const contestCount = outputPlayers.reduce((sum, player) => sum + Number(player.accolades?.three_point_contest_wins || 0), 0);

  if (dryRun) {
    console.log(`Dry run enabled; would write ${outputPlayers.length} players to ${outputPath}.`);
  } else {
    await writeJsonAtomically(statTitleCachePath, {
      ...statTitleCache,
      fetched_at: new Date().toISOString(),
    });
    await writeJsonAtomically(contestCachePath, threePointContestCache);
    await writeJsonAtomically(outputPath, outputPlayers);
    console.log(`Updated ${outputPlayers.length} players at ${outputPath}.`);
  }

  console.log(`${STAT_TITLE_DESCRIPTIONS.three_point_titles}: ${titleCount}`);
  console.log(`${THREE_POINT_CONTEST_DESCRIPTION}: ${contestCount}`);
  console.timeEnd("three-point-accolades: total");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  ensureThreePointTitleCache,
  parseThreePointContestWinners,
};
