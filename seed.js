const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");
const readline = require("readline/promises");
const {
  isNbaFinalsMvpDescription,
  isOfficialMvpVotingDescription,
  STAT_TITLE_DESCRIPTIONS,
} = require("./classicPoints");
const { decadeLabelFromYear, eraSortValue, seasonEra } = require("./seasonEras");
const { applyLegacyScoringPipeline } = require("./seed-legacy-points");
const { normalizeTeamCodeForSeason, normalizeTeamName } = require("./teamFranchises");
require("dotenv").config();

const NBA_STATS_AWARDS_URL = "https://stats.nba.com/stats/playerawards";
const NBA_STATS_CAREER_URL = "https://stats.nba.com/stats/playercareerstats";
const NBA_STATS_GAME_FINDER_URL = "https://stats.nba.com/stats/leaguegamefinder";
const NBA_STATS_PLAYER_DIRECTORY_URL = "https://stats.nba.com/stats/commonallplayers";
const NBA_STATS_PLAYER_INFO_URL = "https://stats.nba.com/stats/commonplayerinfo";
const NBA_STATS_LEAGUE_LEADERS_URL = "https://stats.nba.com/stats/leagueleaders";
const GAMES_STARTED_TRACKED_START_END_YEAR = 1971;
const OUTPUT_PATH = path.join(__dirname, "data", "players_accolades.json");
const BREF_POSITIONS_PATH = path.join(__dirname, "data", "bref_positions.json");
const CAREER_STATS_CACHE_PATH = path.join(__dirname, "data", "nba_stats_career_stats_cache.json");
const GAME_WINS_CACHE_PATH = path.join(__dirname, "data", "nba_stats_game_wins_cache.json");
const MANUAL_ID_MAP_PATH = path.join(__dirname, "data", "nba_stats_id_map.json");
const NBA_PLAYER_DIRECTORY_CACHE_PATH = path.join(__dirname, "data", "nba_stats_player_directory.json");
const STAT_TITLE_CACHE_PATH = path.join(__dirname, "data", "stat_title_winners.json");
const THREE_POINT_CONTEST_CACHE_PATH = path.join(__dirname, "data", "three_point_contest_winners.json");

const STAT_TITLE_CONFIGS = [
  { accoladeKey: "scoring_titles", category: "PTS" },
  { accoladeKey: "assist_titles", category: "AST" },
  { accoladeKey: "rebound_titles", category: "REB" },
  { accoladeKey: "three_point_titles", category: "FG3M", perMode: "Totals" },
  { accoladeKey: "steal_titles", category: "STL" },
  { accoladeKey: "block_titles", category: "BLK" },
];
const PRESERVED_CAREER_SEASON_FIELDS = ["games_won", "ts_pct", "ws_per_48"];

const POSITION_ORDER = ["PG", "SG", "SF", "PF", "C"];
const UNKNOWN_POSITION_FALLBACK = ["SF", "PF"];
const POSITION_OVERRIDES = {
  "nba:23": ["PF", "C"],
  "bdl:552": ["PF", "C"],
  "name:dennis rodman": ["PF", "C"],
  "nba:202710": ["SF", "SG"], // Jimmy Butler
};

const TEAM_NAME_TO_ABBREVIATION = {
  "Atlanta Hawks": "ATL",
  "Boston Celtics": "BOS",
  "Brooklyn Nets": "BKN",
  "New Jersey Nets": "NJN",
  "Charlotte Bobcats": "CHA",
  "Charlotte Hornets": "CHA",
  "Chicago Bulls": "CHI",
  "Cleveland Cavaliers": "CLE",
  "Dallas Mavericks": "DAL",
  "Denver Nuggets": "DEN",
  "Detroit Pistons": "DET",
  "Golden State Warriors": "GSW",
  "Houston Rockets": "HOU",
  "Indiana Pacers": "IND",
  "LA Clippers": "LAC",
  "Los Angeles Clippers": "LAC",
  "Los Angeles Lakers": "LAL",
  "Memphis Grizzlies": "MEM",
  "Vancouver Grizzlies": "VAN",
  "Miami Heat": "MIA",
  "Milwaukee Bucks": "MIL",
  "Minnesota Timberwolves": "MIN",
  "New Orleans Hornets": "NOH",
  "New Orleans Pelicans": "NOP",
  "New Orleans/Oklahoma City Hornets": "NOK",
  "New York Knicks": "NYK",
  "Oklahoma City Thunder": "OKC",
  "Orlando Magic": "ORL",
  "Philadelphia 76ers": "PHI",
  "Phoenix Suns": "PHX",
  "Portland Trail Blazers": "POR",
  "Sacramento Kings": "SAC",
  "San Antonio Spurs": "SAS",
  "Seattle SuperSonics": "SEA",
  "Toronto Raptors": "TOR",
  "Utah Jazz": "UTA",
  "Washington Bullets": "WAS",
  "Washington Wizards": "WAS",
};

const NAME_TO_NBA_ID = {
  "jimmy butler": 202710,
  "lebron james": 2544,
  "kevin durant": 201142,
  "stephen curry": 201939,
  "luka doncic": 1629029,
  "giannis antetokounmpo": 203507,
  "shai gilgeous alexander": 1628983,
};

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
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value === undefined ? true : value;
  }

  return args;
}

function flagEnabled(value) {
  return value === true || ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function secondsLabel(ms) {
  return `${Math.ceil(ms / 1000)}s`;
}

function positiveInteger(value, fallback = 0) {
  const numeric = Number(value);

  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

async function confirmOutputReplacement({ args, existingCount, outputCount, seedMode }) {
  if (!existingCount) {
    return true;
  }

  if (flagEnabled(args.yes) || flagEnabled(args.confirmReplace) || flagEnabled(process.env.SEED_CONFIRM_REPLACE)) {
    return true;
  }

  const warning =
    `This ${seedMode} seed will replace ${existingCount} existing player records with ${outputCount} refreshed records. ` +
    "Any players not included in this run will be removed from players_accolades.json.";

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `${warning} Drop --replace to preserve existing records, or use --replace --yes to confirm replacement.`,
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(`${warning}\nType yes to continue: `);
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
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
  if (!Number.isNaN(retryDate)) {
    return Math.max(retryDate - Date.now() + 1000, fallbackMs);
  }

  return fallbackMs;
}

function safeErrorMessage(error) {
  if (!error?.isAxiosError) {
    return error?.stack || error?.message || String(error);
  }

  const status = error.response?.status;
  const statusText = error.response?.statusText;
  const code = error.code;
  const url = error.config?.url;
  const retryAfter = error.response?.headers?.["retry-after"];
  const parts = ["Axios request failed"];

  if (status) {
    parts.push(`${status}${statusText ? ` ${statusText}` : ""}`);
  }
  if (code) {
    parts.push(`code=${code}`);
  }
  if (url) {
    parts.push(`url=${url}`);
  }
  if (retryAfter) {
    parts.push(`retry-after=${retryAfter}`);
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
      console.warn(
        `${label} failed with ${status || error.code || "network error"}; retrying in ${secondsLabel(waitMs)} (${attempt}/${retries}).`,
      );
      await sleep(waitMs);
    }
  }

  throw new Error(`${label} retry loop exhausted.`);
}

function createEmptyAccolades() {
  return {
    mvp_count: 0,
    finals_mvp_count: 0,
    estimated_finals_mvp_count: 0,
    dpoy_count: 0,
    roy_won: false,
    championship_rings: 0,
    most_improved: 0,
    "6moy": 0,
    olympic_gold_medals: 0,
    olympic_silver_medals: 0,
    olympic_bronze_medals: 0,
    top_3_mvp: 0,
    top_10_mvp: 0,
    top_3_dpoy: 0,
    all_nba_1st: 0,
    all_nba_2nd: 0,
    all_nba_3rd: 0,
    all_def_1st: 0,
    all_def_2nd: 0,
    all_rookie_1st: 0,
    all_rookie_2nd: 0,
    all_star_selections: 0,
    all_star_mvp_count: 0,
    seasons_played: 0,
    scoring_titles: 0,
    assist_titles: 0,
    rebound_titles: 0,
    three_point_titles: 0,
    steal_titles: 0,
    block_titles: 0,
    three_point_contest_wins: 0,
    games_started: 0,
    games_won: 0,
    award_counts: {},
  };
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
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

function normalizeTeamNumber(value) {
  const normalized = String(value || "").trim();
  return normalized ? Number(normalized) : null;
}

function isOfficialMvpDescription(description) {
  const normalized = normalizeText(description);

  return (
    normalized.includes("nba most valuable player") &&
    !normalized.includes("finals") &&
    !normalized.includes("all-star") &&
    !normalized.includes("cup") &&
    !normalized.includes("in-season tournament") &&
    !normalized.includes("sporting news") &&
    !normalized.includes("voting") &&
    !normalized.includes("ladder")
  );
}

function buildHeaderMapper(headers) {
  return (row) =>
    headers.reduce((record, header, index) => {
      record[header] = row[index];
      return record;
    }, {});
}

function uniqueObjects(values, keyForValue) {
  const seen = new Set();
  const unique = [];

  for (const value of values) {
    const key = keyForValue(value);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(value);
  }

  return unique;
}

function parsePositionGroup(position) {
  const normalized = normalizeText(position);
  const positions = [];
  const addPosition = (candidate) => {
    if (!positions.includes(candidate)) {
      positions.push(candidate);
    }
  };
  const tokenPattern =
    /point guard|shooting guard|small forward|power forward|center|\bpg\b|\bsg\b|\bsf\b|\bpf\b|\bc\b|\bguard\b|\bg\b|\bforward\b|\bf\b/g;
  const matches = normalized.matchAll(tokenPattern);

  for (const match of matches) {
    const token = match[0];

    if (token === "point guard" || token === "pg") addPosition("PG");
    if (token === "shooting guard" || token === "sg") addPosition("SG");
    if (token === "small forward" || token === "sf") addPosition("SF");
    if (token === "power forward" || token === "pf") addPosition("PF");
    if (token === "center" || token === "c") addPosition("C");
    if (token === "guard" || token === "g") {
      addPosition("PG");
      addPosition("SG");
    }
    if (token === "forward" || token === "f") {
      addPosition("SF");
      addPosition("PF");
    }
  }

  return positions.length ? positions : UNKNOWN_POSITION_FALLBACK;
}

function nameKey(player) {
  return normalizeName(`${player.first_name} ${player.last_name}`);
}

function positionsLookLikeLegacyUnknownFallback(positions) {
  return (
    Array.isArray(positions) &&
    positions.length === POSITION_ORDER.length &&
    POSITION_ORDER.every((position, index) => positions[index] === position)
  );
}

function trustedExistingPositionString(record) {
  if (!record?.positions?.length || positionsLookLikeLegacyUnknownFallback(record.positions)) {
    return "";
  }

  return record.positions.join("/");
}

function positionOverrideForPlayer(player, nbaStatsId) {
  const fullName = player.name || `${player.first_name || ""} ${player.last_name || ""}`;
  const keys = [
    nbaStatsId ? `nba:${Number(nbaStatsId)}` : null,
    player.nba_stats_id ? `nba:${Number(player.nba_stats_id)}` : null,
    player.balldontlie_id ? `bdl:${Number(player.balldontlie_id)}` : null,
    typeof player.id === "number" ? `bdl:${player.id}` : null,
    typeof player.id === "string" && player.id.startsWith("bdl-")
      ? `bdl:${player.id.replace("bdl-", "")}`
      : null,
    `name:${normalizeName(fullName)}`,
  ].filter(Boolean);

  for (const key of keys) {
    if (POSITION_OVERRIDES[key]) {
      return POSITION_OVERRIDES[key];
    }
  }

  return null;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
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

async function loadSeedInputs(idMapPath) {
  const resolvedIdMapPath = path.resolve(__dirname, idMapPath || MANUAL_ID_MAP_PATH);
  const [
    rawExistingPlayers,
    brefPositions,
    careerStatsCache,
    gameWinsCache,
    idMap,
    statTitleCache,
    threePointContestCache,
    playerDirectoryCache,
  ] = await Promise.all([
    readJsonIfExists(OUTPUT_PATH),
    readJsonIfExists(BREF_POSITIONS_PATH),
    readJsonIfExists(CAREER_STATS_CACHE_PATH),
    readJsonIfExists(GAME_WINS_CACHE_PATH),
    readJsonIfExists(resolvedIdMapPath),
    readJsonIfExists(STAT_TITLE_CACHE_PATH),
    readJsonIfExists(THREE_POINT_CONTEST_CACHE_PATH),
    readJsonIfExists(NBA_PLAYER_DIRECTORY_CACHE_PATH),
  ]);

  return {
    brefPositions: brefPositions || {},
    careerStatsCache: careerStatsCache?.players ? careerStatsCache : { fetched_at: null, players: {} },
    gameWinsCache: gameWinsCache?.players ? gameWinsCache : { fetched_at: null, players: {} },
    idMap: idMap || {},
    playerDirectoryCache,
    rawExistingPlayers: Array.isArray(rawExistingPlayers) ? rawExistingPlayers : [],
    statTitleCache: statTitleCache?.winners ? statTitleCache : { fetched_at: null, winners: {} },
    threePointContestCache,
  };
}

function sliceWindow(values, offset, limit) {
  const start = Math.max(0, offset || 0);
  const end = limit ? start + limit : undefined;

  return values.slice(start, end);
}

function resultSetFromResponse(data, preferredName) {
  const resultSets = data.resultSets || [];

  return (
    resultSets.find((resultSet) => resultSet.name === preferredName) ||
    resultSets[0] ||
    data.resultSet ||
    { headers: [], rowSet: [] }
  );
}

function parseNbaPlayerDirectory(resultSet) {
  const headers = resultSet.headers || [];
  const rows = resultSet.rowSet || [];
  const mapRow = buildHeaderMapper(headers);
  const players = [];
  const byName = new Map();
  const byNbaStatsId = new Map();

  for (const rawRow of rows) {
    const row = mapRow(rawRow);
    const personId = Number(row.PERSON_ID);
    const displayName = row.DISPLAY_FIRST_LAST || row.DISPLAY_FIRST_LAST_NAME || row.PLAYER_NAME;

    if (!personId || !displayName) {
      continue;
    }

    const entry = {
      person_id: personId,
      display_name: displayName,
      from_year: Number(row.FROM_YEAR || row.FROM_SEASON || 0) || null,
      to_year: Number(row.TO_YEAR || row.TO_SEASON || 0) || null,
      team_abbreviation: row.TEAM_ABBREVIATION || null,
      roster_status: row.ROSTERSTATUS ?? null,
    };
    const key = normalizeName(displayName);

    players.push(entry);
    byNbaStatsId.set(personId, entry);
    if (!byName.has(key)) {
      byName.set(key, []);
    }
    byName.get(key).push(entry);
  }

  return { players, byName, byNbaStatsId };
}

function parseNbaPlayerInfo(resultSet) {
  const headers = resultSet.headers || [];
  const rows = resultSet.rowSet || [];

  if (!rows.length) {
    return null;
  }

  const row = buildHeaderMapper(headers)(rows[0]);

  return {
    person_id: Number(row.PERSON_ID),
    first_name: row.FIRST_NAME || "",
    last_name: row.LAST_NAME || "",
    display_name: row.DISPLAY_FIRST_LAST || `${row.FIRST_NAME || ""} ${row.LAST_NAME || ""}`.trim(),
    position: row.POSITION || "",
    roster_status: row.ROSTERSTATUS ?? null,
    team_abbreviation: row.TEAM_ABBREVIATION || null,
    from_year: Number(row.FROM_YEAR || 0) || null,
    to_year: Number(row.TO_YEAR || 0) || null,
    draft_year: Number(row.DRAFT_YEAR || 0) || null,
  };
}

async function fetchNbaPlayerDirectory({ season, retries, delayMs, timeoutMs, refresh, cachedDirectory }) {
  if (!refresh && cachedDirectory?.players?.length) {
    console.log(`Loaded ${cachedDirectory.players.length} NBA Stats player directory rows from cache.`);
    return parseNbaPlayerDirectory({
      headers: ["PERSON_ID", "DISPLAY_FIRST_LAST", "FROM_YEAR", "TO_YEAR", "TEAM_ABBREVIATION", "ROSTERSTATUS"],
      rowSet: cachedDirectory.players.map((player) => [
        player.person_id,
        player.display_name,
        player.from_year,
        player.to_year,
        player.team_abbreviation,
        player.roster_status,
      ]),
    });
  }

  const response = await getWithRetry({
    label: "NBA Stats player directory",
    retries,
    delayMs,
    retryStatuses: [403, 429],
    request: () =>
      axios.get(NBA_STATS_PLAYER_DIRECTORY_URL, {
        headers: NBA_STATS_HEADERS,
        params: {
          IsOnlyCurrentSeason: "0",
          LeagueID: "00",
          Season: season,
        },
        timeout: timeoutMs,
      }),
  });
  const parsed = parseNbaPlayerDirectory(resultSetFromResponse(response.data, "CommonAllPlayers"));

  await writeJsonAtomically(NBA_PLAYER_DIRECTORY_CACHE_PATH, {
    fetched_at: new Date().toISOString(),
    season,
    players: parsed.players,
  });
  console.log(`Fetched ${parsed.players.length} NBA Stats player directory rows.`);

  return parsed;
}

function resolveNbaStatsId(player, manualIdMap, playerDirectory) {
  if (player.nba_stats_id) {
    return { id: Number(player.nba_stats_id), source: "existing" };
  }

  const lookupKey = nameKey(player);
  const manual = manualIdMap[player.id] || manualIdMap[lookupKey] || manualIdMap[normalizeText(lookupKey)];

  // Check the hardcoded star map first to prevent missing awards for high-profile players
  if (NAME_TO_NBA_ID[lookupKey]) {
    return { id: NAME_TO_NBA_ID[lookupKey], source: "hardcoded" };
  }

  if (manual) {
    return { id: Number(manual), source: "manual" };
  }

  const candidates = playerDirectory.byName.get(lookupKey) || [];

  if (candidates.length === 0) {
    return { id: null, source: "missing" };
  }

  if (candidates.length === 1) {
    return { id: candidates[0].person_id, source: "directory" };
  }

  const draftYear = Number(player.draft_year || 0);
  const currentTeam = player.team?.abbreviation || null;
  let narrowed = candidates;

  if (draftYear) {
    narrowed = candidates.filter((candidate) => {
      if (!candidate.from_year || !candidate.to_year) {
        return false;
      }

      return draftYear >= candidate.from_year - 4 && draftYear <= candidate.to_year;
    });
  }

  if (narrowed.length > 1 && currentTeam) {
    const teamMatches = narrowed.filter((candidate) => candidate.team_abbreviation === currentTeam);
    if (teamMatches.length === 1) {
      narrowed = teamMatches;
    }
  }

  if (narrowed.length === 1) {
    return { id: narrowed[0].person_id, source: "directory" };
  }

  if (draftYear && narrowed.length > 1) {
    const sortedByDraftDistance = [...narrowed].sort(
      (a, b) => Math.abs((a.from_year || draftYear) - draftYear) - Math.abs((b.from_year || draftYear) - draftYear),
    );
    const best = sortedByDraftDistance[0];
    const second = sortedByDraftDistance[1];

    if (
      best &&
      second &&
      Math.abs((best.from_year || draftYear) - draftYear) < Math.abs((second.from_year || draftYear) - draftYear)
    ) {
      return { id: best.person_id, source: "directory" };
    }
  }

  return {
    id: null,
    source: `ambiguous (${candidates.map((candidate) => `${candidate.display_name}:${candidate.person_id}`).join(", ")})`,
  };
}

function directoryEntryToPlayer(entry) {
  const { firstName, lastName } = splitName(entry.display_name);
  return {
    id: `nba-${entry.person_id}`,
    nba_stats_id: entry.person_id,
    first_name: firstName,
    last_name: lastName,
    active: rosterStatusIsActive(entry.roster_status),
    team: entry.team_abbreviation ? { abbreviation: entry.team_abbreviation, id: entry.team_abbreviation } : null,
  };
}

async function fetchNbaAwards(playerId, { retries, delayMs, timeoutMs }) {
  const response = await getWithRetry({
    label: `NBA Stats awards PlayerID=${playerId}`,
    retries,
    delayMs,
    retryStatuses: [403, 429],
    request: () =>
      axios.get(NBA_STATS_AWARDS_URL, {
        headers: NBA_STATS_HEADERS,
        params: { PlayerID: playerId },
        timeout: timeoutMs,
      }),
  });

  return response.data.resultSets?.[0] || { headers: [], rowSet: [] };
}

async function fetchNbaCareerStats(playerId, { retries, delayMs, timeoutMs }) {
  const response = await getWithRetry({
    label: `NBA Stats career stats PlayerID=${playerId}`,
    retries,
    delayMs,
    retryStatuses: [403, 429],
    request: () =>
      axios.get(NBA_STATS_CAREER_URL, {
        headers: NBA_STATS_HEADERS,
        params: {
          LeagueID: "00",
          PerMode: "Totals",
          PlayerID: playerId,
        },
        timeout: timeoutMs,
      }),
  });

  return (
    response.data.resultSets?.find((resultSet) => resultSet.name === "SeasonTotalsRegularSeason") ||
    response.data.resultSets?.[0] ||
    { headers: [], rowSet: [] }
  );
}

async function fetchNbaRegularSeasonGameWins(playerId, { retries, delayMs, timeoutMs }) {
  const response = await getWithRetry({
    label: `NBA Stats game wins PlayerID=${playerId}`,
    retries,
    delayMs,
    retryStatuses: [403, 429],
    request: () =>
      axios.get(NBA_STATS_GAME_FINDER_URL, {
        headers: NBA_STATS_HEADERS,
        params: {
          LeagueID: "00",
          PlayerID: playerId,
          SeasonType: "Regular Season",
        },
        timeout: timeoutMs,
      }),
  });

  return parseRegularSeasonGameWins(resultSetFromResponse(response.data, "LeagueGameFinderResults"));
}

async function fetchNbaPlayerInfo(playerId, { retries, delayMs, timeoutMs }) {
  const response = await getWithRetry({
    label: `NBA Stats player info PlayerID=${playerId}`,
    retries,
    delayMs,
    retryStatuses: [403, 429],
    request: () =>
      axios.get(NBA_STATS_PLAYER_INFO_URL, {
        headers: NBA_STATS_HEADERS,
        params: { PlayerID: playerId },
        timeout: timeoutMs,
      }),
  });

  return parseNbaPlayerInfo(resultSetFromResponse(response.data, "CommonPlayerInfo"));
}

async function saveStatTitleCache(cache) {
  await writeJsonAtomically(STAT_TITLE_CACHE_PATH, {
    ...cache,
    fetched_at: new Date().toISOString(),
  });
}

async function fetchStatTitleWinners(season, category, { retries, delayMs, timeoutMs, perMode = "PerGame" }) {
  const response = await getWithRetry({
    label: `NBA Stats league leaders ${season} ${category}`,
    retries,
    delayMs,
    retryStatuses: [403, 429],
    request: () =>
      axios.get(NBA_STATS_LEAGUE_LEADERS_URL, {
        headers: NBA_STATS_HEADERS,
        params: {
          LeagueID: "00",
          PerMode: perMode,
          Scope: "S",
          Season: season,
          SeasonType: "Regular Season",
          StatCategory: category,
        },
        timeout: timeoutMs,
      }),
  });
  const resultSet = resultSetFromResponse(response.data, "LeagueLeaders");
  const headers = resultSet.headers || [];
  const rows = resultSet.rowSet || [];
  const mapRow = buildHeaderMapper(headers);

  return rows
    .map(mapRow)
    .filter((row) => Number(row.RANK) === 1)
    .filter((row) => Number(row[category]) > 0)
    .map((row) => ({
      player_id: Number(row.PLAYER_ID),
      player: row.PLAYER,
      team: row.TEAM,
      rank: Number(row.RANK),
      value: Number(row[category]),
    }));
}

async function getStatTitleWinners(season, config, cache, fetchOptions) {
  const { category, perMode } = config;

  cache.winners[season] ||= {};

  if (!cache.winners[season][category]) {
    cache.winners[season][category] = await fetchStatTitleWinners(season, category, {
      ...fetchOptions,
      perMode,
    });
    await sleep(fetchOptions.delayMs);
  }

  return cache.winners[season][category];
}

async function applyStatTitles(accolades, career, nbaStatsId, statTitleCache, fetchOptions, awardRows = []) {
  if (!nbaStatsId || career.careerSeasons.length === 0) {
    return;
  }

  const seasons = Array.from(new Set(career.careerSeasons.map((season) => season.season)));

  for (const season of seasons) {
    for (const config of STAT_TITLE_CONFIGS) {
      const winners = await getStatTitleWinners(season, config, statTitleCache, fetchOptions);

      if (winners.some((winner) => winner.player_id === Number(nbaStatsId))) {
        accolades[config.accoladeKey] += 1;
        const winner = winners.find((candidate) => candidate.player_id === Number(nbaStatsId));
        const description = STAT_TITLE_DESCRIPTIONS[config.accoladeKey];
        const alreadyRecorded = awardRows.some(
          (award) => award.season === season && normalizeText(award.description) === normalizeText(description),
        );

        if (description && !alreadyRecorded) {
          awardRows.push({
            season,
            team: winner?.team || null,
            description,
            all_nba_team_number: null,
          });
        }
      }
    }
  }
}

function countStatTitle(accolades, description) {
  if (/(scoring title|scoring leader|points leader|points champion)/.test(description)) {
    accolades.scoring_titles += 1;
  }
  if (/(assist title|assist leader|assists leader|assists champion)/.test(description)) {
    accolades.assist_titles += 1;
  }
  if (/(rebound title|rebounding title|rebound leader|rebounds leader|rebounds champion)/.test(description)) {
    accolades.rebound_titles += 1;
  }
  if (
    /(three-point title|three point title|3-point title|3 point title|three-point leader|three point leader|3-point leader|3 point leader|three-point champion|three point champion|3-point champion|3 point champion|three-pointers made leader|3-pointers made leader|3pm leader|fg3m leader)/.test(description)
  ) {
    accolades.three_point_titles += 1;
  }
  if (/(steal title|steals leader|steals champion)/.test(description)) {
    accolades.steal_titles += 1;
  }
  if (/(block title|blocks leader|blocks champion)/.test(description)) {
    accolades.block_titles += 1;
  }
}

function countVotingPlacement({ accolades, description, teamNumber, season }) {
  const placement = teamNumber;
  if (!placement || placement < 1) {
    return;
  }

  if (isOfficialMvpVotingDescription(description)) {
    if (placement <= 3) accolades.top_3_mvp += 1;
    if (placement <= 10) accolades.top_10_mvp += 1;
  }

  if (description.includes("defensive player of the year") && description.includes("voting") && placement <= 3) {
    accolades.top_3_dpoy += 1;
  }
}

function parseAwards(resultSet) {
  const accolades = createEmptyAccolades();
  const seasons = new Set();
  const teams = new Set();
  const teamEras = [];
  const awardRows = [];

  const headers = resultSet.headers || [];
  const rows = resultSet.rowSet || [];
  const mapRow = buildHeaderMapper(headers);

  for (const rawRow of rows) {
    const row = mapRow(rawRow);
    const description = normalizeText(row.DESCRIPTION);
    const rawDescription = row.DESCRIPTION || null;
    const teamNumber = normalizeTeamNumber(row.ALL_NBA_TEAM_NUMBER);
    const season = row.SEASON ? String(row.SEASON) : null;
    const team = normalizeTeamName(row.TEAM, season);

    if (rawDescription) {
      accolades.award_counts[rawDescription] = (accolades.award_counts[rawDescription] || 0) + 1;
    }

    if (season) {
      seasons.add(season);
    }
    if (team) {
      teams.add(team);
    }

    const era = seasonEra(season);
    if (team && era) {
      teamEras.push({ team, era });
    }

    awardRows.push({
      season,
      team: row.TEAM || null,
      description: rawDescription,
      all_nba_team_number: row.ALL_NBA_TEAM_NUMBER || null,
    });

    if (description.includes("most valuable player") && !description.includes("voting") && !description.includes("ladder")) {
      if (isNbaFinalsMvpDescription(description)) {
        accolades.finals_mvp_count += 1;
      } else if (description.includes("all-star")) {
        accolades.all_star_mvp_count += 1;
      } else if (isOfficialMvpDescription(description)) {
        accolades.mvp_count += 1;
        accolades.top_3_mvp += 1;
        accolades.top_10_mvp += 1;
      }
    } else if (description.includes("defensive player of the year") && !description.includes("voting")) {
      accolades.dpoy_count += 1;
      accolades.top_3_dpoy += 1;
    } else if (description.includes("most improved player")) {
      accolades.most_improved += 1;
    } else if (description.includes("sixth man of the year")) {
      accolades["6moy"] += 1;
    } else if (description.includes("rookie of the year")) {
      accolades.roy_won = true;
    } else if (description.includes("nba champion")) {
      accolades.championship_rings += 1;
    } else if (description.includes("olympic gold medal")) {
      accolades.olympic_gold_medals += 1;
    } else if (description.includes("olympic silver medal")) {
      accolades.olympic_silver_medals += 1;
    } else if (description.includes("olympic bronze medal")) {
      accolades.olympic_bronze_medals += 1;
    } else if (/(three-point|3-point|three point|3pt).*(contest|shootout).*(winner|champion)/.test(description)) {
      accolades.three_point_contest_wins += 1;
    } else if (description.includes("nba all-star")) {
      accolades.all_star_selections += 1;
    } else if (description.includes("all-nba")) {
      if (teamNumber === 1) accolades.all_nba_1st += 1;
      if (teamNumber === 2) accolades.all_nba_2nd += 1;
      if (teamNumber === 3) accolades.all_nba_3rd += 1;
    } else if (description.includes("all-defensive team")) {
      if (teamNumber === 1) accolades.all_def_1st += 1;
      if (teamNumber === 2) accolades.all_def_2nd += 1;
    } else if (description.includes("all-rookie team")) {
      if (teamNumber === 1) accolades.all_rookie_1st += 1;
      if (teamNumber === 2) accolades.all_rookie_2nd += 1;
    }

    countVotingPlacement({ accolades, description, teamNumber, season });
    countStatTitle(accolades, description);
  }

  accolades.seasons_played = seasons.size;

  const eras = Array.from(seasons)
    .map(seasonEra)
    .filter(Boolean);

  return {
    accolades,
    teams: Array.from(teams),
    teamEras: uniqueObjects(teamEras, (teamEra) => `${teamEra.team}:${teamEra.era}`).sort((a, b) =>
      `${a.team}:${a.era}`.localeCompare(`${b.team}:${b.era}`),
    ),
    eras: Array.from(new Set(eras)).sort(),
    awardRows,
  };
}

function perGameFromTotals(row, totalKey, gamesPlayed) {
  const total = Number(row[totalKey] || 0);

  if (!Number.isFinite(total) || !gamesPlayed) {
    return 0;
  }

  return total / gamesPlayed;
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

function seasonLabelFromGameFinderSeasonId(value) {
  const raw = String(value || "").trim();
  const startYear = Number(raw.slice(-4));

  if (!Number.isInteger(startYear) || startYear <= 0) {
    return null;
  }

  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function seasonTeamKey(season, team) {
  const seasonLabel = season ? String(season) : null;
  const normalizedTeam = normalizeTeamCodeForSeason(team, seasonLabel);

  return seasonLabel && normalizedTeam ? `${seasonLabel}:${normalizedTeam}` : null;
}

function normalizeGameWinRows(rows = []) {
  const normalizedRows = [];
  const seen = new Set();

  for (const row of rows || []) {
    const season = row?.season ? String(row.season) : null;
    const team = normalizeTeamCodeForSeason(row?.team, season);
    const key = seasonTeamKey(season, team);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalizedRows.push({
      season,
      team,
      games_won: positiveInteger(row?.games_won, 0),
    });
  }

  return normalizedRows;
}

function parseRegularSeasonGameWins(resultSet) {
  const headers = resultSet.headers || [];
  const rows = resultSet.rowSet || [];
  const mapRow = buildHeaderMapper(headers);
  const winsBySeasonTeam = new Map();

  for (const rawRow of rows) {
    const row = mapRow(rawRow);
    const season = seasonLabelFromGameFinderSeasonId(row.SEASON_ID);
    const team = normalizeTeamCodeForSeason(row.TEAM_ABBREVIATION, season);
    const key = seasonTeamKey(season, team);

    if (!key) {
      continue;
    }

    if (!winsBySeasonTeam.has(key)) {
      winsBySeasonTeam.set(key, {
        season,
        team,
        games_won: 0,
      });
    }

    if (String(row.WL || "").trim().toUpperCase() === "W") {
      winsBySeasonTeam.get(key).games_won += 1;
    }
  }

  return Array.from(winsBySeasonTeam.values()).sort(
    (a, b) => a.season.localeCompare(b.season) || a.team.localeCompare(b.team),
  );
}

function parseCareerStats(resultSet) {
  const headers = resultSet.headers || [];
  const rows = resultSet.rowSet || [];
  const mapRow = buildHeaderMapper(headers);
  const seasons = new Set();
  const teams = new Set();
  const careerSeasons = [];
  const teamEras = [];

  for (const rawRow of rows) {
    const row = mapRow(rawRow);
    const season = row.SEASON_ID ? String(row.SEASON_ID) : null;
    const team = normalizeTeamCodeForSeason(row.TEAM_ABBREVIATION, season);
    const gamesPlayed = Number(row.GP || 0);
    const era = seasonEra(season);

    if (!season || !team || team === "TOT" || !era) {
      continue;
    }

    seasons.add(season);
    teams.add(team);
    careerSeasons.push({
      season,
      team,
      era,
      games_played: gamesPlayed,
      games_started: gamesStartedFromCareerRow(row, gamesPlayed, season),
      ppg: perGameFromTotals(row, "PTS", gamesPlayed),
      rpg: perGameFromTotals(row, "REB", gamesPlayed),
      apg: perGameFromTotals(row, "AST", gamesPlayed),
      spg: perGameFromTotals(row, "STL", gamesPlayed),
      bpg: perGameFromTotals(row, "BLK", gamesPlayed),
    });
    teamEras.push({ team, era });
  }

  return {
    seasonsPlayed: seasons.size,
    teams: Array.from(teams).sort(),
    eras: uniqueSortedBy(Array.from(new Set(careerSeasons.map((season) => season.era))), eraSortValue),
    careerSeasons: uniqueObjects(careerSeasons, (season) => `${season.season}:${season.team}`),
    teamEras: uniqueObjects(teamEras, (teamEra) => `${teamEra.team}:${teamEra.era}`).sort((a, b) =>
      `${a.team}:${a.era}`.localeCompare(`${b.team}:${b.era}`),
    ),
  };
}

function careerStatsFromCachedSeasons(cachedSeasons = []) {
  const seasons = new Set();
  const teams = new Set();
  const careerSeasons = [];
  const teamEras = [];

  for (const seasonRow of cachedSeasons) {
    const season = seasonRow?.season ? String(seasonRow.season) : null;
    const team = normalizeTeamCodeForSeason(seasonRow?.team, season);
    const era = seasonRow?.era || seasonEra(season);

    if (!season || !team || team === "TOT" || !era) {
      continue;
    }

    seasons.add(season);
    teams.add(team);
    careerSeasons.push({
      ...seasonRow,
      season,
      team,
      era,
    });
    teamEras.push({ team, era });
  }

  return {
    seasonsPlayed: seasons.size,
    teams: Array.from(teams).sort(),
    eras: uniqueSortedBy(Array.from(new Set(careerSeasons.map((season) => season.era))), eraSortValue),
    careerSeasons: uniqueObjects(careerSeasons, (season) => `${season.season}:${season.team}`),
    teamEras: uniqueObjects(teamEras, (teamEra) => `${teamEra.team}:${teamEra.era}`).sort((a, b) =>
      `${a.team}:${a.era}`.localeCompare(`${b.team}:${b.era}`),
    ),
  };
}

function applyGameWinsToCareer(career, gameWinRows = []) {
  const winsByKey = new Map(
    normalizeGameWinRows(gameWinRows).map((row) => [seasonTeamKey(row.season, row.team), row.games_won]),
  );

  if (!winsByKey.size) {
    return career;
  }

  let changed = false;
  const careerSeasons = career.careerSeasons.map((season) => {
    const key = seasonTeamKey(season?.season, season?.team);

    if (!key || !winsByKey.has(key)) {
      return season;
    }

    const gamesWon = winsByKey.get(key);
    if (season.games_won === gamesWon) {
      return season;
    }

    changed = true;
    return {
      ...season,
      games_won: gamesWon,
    };
  });

  return changed ? { ...career, careerSeasons } : career;
}

function fillMissingCareerSeasonFields(career, storedSeasons = [], fieldKeys = PRESERVED_CAREER_SEASON_FIELDS) {
  const storedByKey = new Map();

  for (const storedSeason of storedSeasons || []) {
    const key = seasonTeamKey(storedSeason?.season, storedSeason?.team);

    if (key && !storedByKey.has(key)) {
      storedByKey.set(key, storedSeason);
    }
  }

  if (!storedByKey.size) {
    return career;
  }

  let changed = false;
  const careerSeasons = career.careerSeasons.map((season) => {
    const key = seasonTeamKey(season?.season, season?.team);
    const storedSeason = key ? storedByKey.get(key) : null;

    if (!storedSeason) {
      return season;
    }

    let seasonChanged = false;
    const nextSeason = { ...season };

    for (const fieldKey of fieldKeys) {
      if (
        (Object.prototype.hasOwnProperty.call(nextSeason, fieldKey) &&
          nextSeason[fieldKey] !== null &&
          nextSeason[fieldKey] !== undefined) ||
        !Object.prototype.hasOwnProperty.call(storedSeason, fieldKey)
      ) {
        continue;
      }

      nextSeason[fieldKey] = storedSeason[fieldKey];
      seasonChanged = true;
    }

    changed ||= seasonChanged;
    return seasonChanged ? nextSeason : season;
  });

  return changed ? { ...career, careerSeasons } : career;
}

function gamesStartedFromCareerSeasons(careerSeasons = []) {
  return careerSeasons.reduce((sum, season) => sum + positiveInteger(season?.games_started, 0), 0);
}

function gamesWonFromCareerSeasons(careerSeasons = []) {
  return careerSeasons.reduce((sum, season) => sum + positiveInteger(season?.games_won, 0), 0);
}

function cachedCareerEntryLooksValid(entry) {
  return (
    Array.isArray(entry?.seasons) &&
    entry.seasons.every((season) => Object.prototype.hasOwnProperty.call(season, "games_started"))
  );
}

function cachedGameWinsEntryLooksValid(entry) {
  return (
    Array.isArray(entry?.seasons) &&
    entry.seasons.every((season) => Object.prototype.hasOwnProperty.call(season, "games_won"))
  );
}

function uniqueSortedBy(values, sortValue) {
  return values.sort((a, b) => sortValue(a) - sortValue(b));
}

function aggregatePlayer(player, awards, career, nbaStatsId) {
  const currentTeam = normalizeTeamCodeForSeason(player.team?.abbreviation, null);
  const allTeams = new Set(career.teams.length ? career.teams : awards.teams);
  const allEras = career.eras.length ? career.eras : awards.eras;
  const teamEras = career.teamEras.length ? career.teamEras : awards.teamEras;

  if (currentTeam) {
    allTeams.add(currentTeam);
  }

  if (!allEras.length && player.draft_year) {
    const era = decadeLabelFromYear(Number(player.draft_year));
    if (era) {
      allEras.push(era);
    }
  }

  if (career.seasonsPlayed > 0) {
    awards.accolades.seasons_played = career.seasonsPlayed;
  }
  awards.accolades.games_started = gamesStartedFromCareerSeasons(career.careerSeasons);
  awards.accolades.games_won = gamesWonFromCareerSeasons(career.careerSeasons);

  const positions = positionOverrideForPlayer(player, nbaStatsId) || parsePositionGroup(player.position);
  const recordId = `nba-${nbaStatsId || player.nba_stats_id || String(player.id).replace("nba-", "")}`;

  return {
    id: recordId,
    nba_stats_id: nbaStatsId,
    first_name: player.first_name,
    last_name: player.last_name,
    name: `${player.first_name} ${player.last_name}`.trim(),
    positions,
    primary_position: positions[0],
    current_team: currentTeam,
    teams: Array.from(allTeams).sort(),
    eras: uniqueSortedBy(Array.from(new Set(allEras)), eraSortValue),
    team_eras: teamEras,
    career_seasons: career.careerSeasons,
    draft_year: player.draft_year || null,
    active: player.active ?? Boolean(player.team?.id),
    accolades: awards.accolades,
    awards_raw: awards.awardRows,
    source: {
      nba_stats_awards: nbaStatsId ? `${NBA_STATS_AWARDS_URL}?PlayerID=${nbaStatsId}` : null,
      nba_stats_career: nbaStatsId ? `${NBA_STATS_CAREER_URL}?LeagueID=00&PerMode=Totals&PlayerID=${nbaStatsId}` : null,
      nba_stats_game_finder: nbaStatsId
        ? `${NBA_STATS_GAME_FINDER_URL}?LeagueID=00&PlayerID=${nbaStatsId}&SeasonType=Regular%20Season`
        : null,
    },
  };
}

function recordIdentityKey(player) {
  if (player.nba_stats_id) {
    return `nba:${Number(player.nba_stats_id)}`;
  }
  return `name:${normalizeName(player.name || `${player.first_name || ""} ${player.last_name || ""}`)}`;
}

function seedPlayerIdentityKey(player) {
  if (player.nba_stats_id) {
    return `nba:${Number(player.nba_stats_id)}`;
  }
  if (typeof player.id === "string" && player.id.startsWith("nba-")) {
    return player.id.replace("nba-", "nba:");
  }

  return `name:${normalizeName(player.name || `${player.first_name || ""} ${player.last_name || ""}`)}`;
}

function recordIdentityKeys(player) {
  const keys = new Set();

  if (player.nba_stats_id) {
    keys.add(`nba:${Number(player.nba_stats_id)}`);
  }
  if (typeof player.id === "string" && player.id.startsWith("nba-")) {
    keys.add(player.id.replace("nba-", "nba:"));
  }

  const name = player.name || `${player.first_name || ""} ${player.last_name || ""}`;
  if (name.trim()) {
    keys.add(`name:${normalizeName(name)}`);
  }

  return keys;
}

function buildExistingRecordLookup(players) {
  const lookup = new Map();

  for (const player of players) {
    for (const key of recordIdentityKeys(player)) {
      if (!lookup.has(key)) {
        lookup.set(key, player);
      }
    }
  }

  return lookup;
}

function existingRecordForSeedPlayer(player, existingRecordLookup) {
  for (const key of recordIdentityKeys(player)) {
    const existingRecord = existingRecordLookup.get(key);

    if (existingRecord) {
      return existingRecord;
    }
  }

  return existingRecordLookup.get(seedPlayerIdentityKey(player)) || null;
}

function filterResumePlayers(players, existingPlayers) {
  const existingKeys = new Set(existingPlayers.flatMap((player) => Array.from(recordIdentityKeys(player))));
  const pending = [];
  const skipped = [];

  for (const player of players) {
    if (existingKeys.has(seedPlayerIdentityKey(player))) {
      skipped.push(player);
    } else {
      pending.push(player);
    }
  }

  return { pending, skipped };
}

function timedStep(label, callback) {
  console.time(label);

  try {
    return callback();
  } finally {
    console.timeEnd(label);
  }
}

function buildPlayersOutput(players, { brefPositions, statTitleCache, threePointContestCache }, labelPrefix = "seed: pipeline") {
  return timedStep(`${labelPrefix}: legacy/classic`, () =>
    applyLegacyScoringPipeline(players, {
      brefPositions,
      statTitleCache,
      threePointContestCache,
    }),
  );
}

async function writePlayersOutput(players) {
  await writeJsonAtomically(OUTPUT_PATH, players);

  return players;
}

function mergeUpdatedPlayers(existingPlayers, updatedPlayers) {
  const updates = new Map(updatedPlayers.map((player) => [player.id, player]));
  const used = new Set();
  const merged = existingPlayers.map((player) => {
    const update = updates.get(player.id);

    if (!update) {
      return player;
    }

    used.add(player.id);
    return update;
  });

  for (const updatedPlayer of updatedPlayers) {
    if (!used.has(updatedPlayer.id)) {
      merged.push(updatedPlayer);
    }
  }

  return merged;
}

function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/);

  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

function existingRecordToSeedPlayer(record) {
  const fallbackName = splitName(record.name);

  return {
    id: record.id,
    nba_stats_id: record.nba_stats_id || null,
    first_name: record.first_name || fallbackName.firstName,
    last_name: record.last_name || fallbackName.lastName,
    position: trustedExistingPositionString(record),
    draft_year: record.draft_year || null,
    active: record.active,
    team: record.current_team
      ? {
          abbreviation: record.current_team,
          id: record.current_team,
        }
      : null,
  };
}

function playerInfoToSeedPlayer(info, existingRecord) {
  const fallbackName = splitName(info.display_name);
  const active = rosterStatusIsActive(info.roster_status);
  const existingPosition = trustedExistingPositionString(existingRecord);

  return {
    id: existingRecord?.id || `nba-${info.person_id}`,
    nba_stats_id: info.person_id,
    first_name: info.first_name || existingRecord?.first_name || fallbackName.firstName,
    last_name: info.last_name || existingRecord?.last_name || fallbackName.lastName,
    position: info.position || existingPosition,
    draft_year: info.draft_year || existingRecord?.draft_year || null,
    active,
    team:
      active && info.team_abbreviation
        ? {
            abbreviation: info.team_abbreviation,
            id: info.team_abbreviation,
          }
        : null,
  };
}

function rosterStatusIsActive(status) {
  const normalized = normalizeText(status);

  return status === 1 || status === "1" || normalized === "active" || normalized === "true";
}

function directoryEntryForRecord(record, playerDirectory) {
  if (!record.nba_stats_id) {
    return null;
  }

  return directoryEntryForNbaStatsId(record.nba_stats_id, playerDirectory);
}

function directoryEntryForNbaStatsId(nbaStatsId, playerDirectory) {
  if (!nbaStatsId) {
    return null;
  }

  return playerDirectory.byNbaStatsId?.get(Number(nbaStatsId)) || null;
}

function recordLooksActive(record, playerDirectory) {
  const directoryEntry = directoryEntryForRecord(record, playerDirectory);

  if (directoryEntry?.roster_status !== null && directoryEntry?.roster_status !== undefined) {
    return rosterStatusIsActive(directoryEntry.roster_status);
  }

  return Boolean(record.active || record.current_team);
}

function normalizeExistingRosterStatus(existingPlayers, playerDirectory) {
  if (!playerDirectory.players.length) {
    return existingPlayers;
  }

  return existingPlayers.map((record) => {
    const directoryEntry = directoryEntryForRecord(record, playerDirectory);

    if (directoryEntry?.roster_status === null || directoryEntry?.roster_status === undefined) {
      return record;
    }

    const active = rosterStatusIsActive(directoryEntry.roster_status);

    return {
      ...record,
      active,
      current_team: active ? directoryEntry.team_abbreviation || record.current_team || null : null,
    };
  });
}

async function buildActiveSeedPlayers({
  existingPlayers,
  playerDirectory,
  limit,
  offset,
  resume,
  nbaRetries,
  nbaDelayMs,
  nbaTimeoutMs,
}) {
  if (!playerDirectory.players.length) {
    const activeRecords = existingPlayers.filter((record) => recordLooksActive(record, playerDirectory));
    const limitedRecords = sliceWindow(activeRecords, offset, limit);
    const records = resume ? [] : limitedRecords;

    console.warn("NBA player directory unavailable; active seed is falling back to existing active records.");
    return records.map(existingRecordToSeedPlayer);
  }

  const existingByNbaId = new Map(
    existingPlayers
      .filter((record) => record.nba_stats_id)
      .map((record) => [Number(record.nba_stats_id), record]),
  );
  const activeEntries = playerDirectory.players.filter((entry) => rosterStatusIsActive(entry.roster_status));
  const windowedEntries = sliceWindow(activeEntries, offset, limit);
  const limitedEntries = resume
    ? windowedEntries.filter((entry) => !existingByNbaId.has(Number(entry.person_id)))
    : windowedEntries;
  const seedPlayers = [];

  console.log(
    `Active directory has ${activeEntries.length} current players; processing ${limitedEntries.length}${resume ? ` after skipping ${windowedEntries.length - limitedEntries.length} existing records` : ""}${offset ? ` from offset ${offset}` : ""}.`,
  );

  for (const [index, entry] of limitedEntries.entries()) {
    try {
      console.log(`[${index + 1}/${limitedEntries.length}] ${entry.display_name}: fetching player info...`);
      const info = await fetchNbaPlayerInfo(entry.person_id, {
        retries: nbaRetries,
        delayMs: nbaDelayMs,
        timeoutMs: nbaTimeoutMs,
      });

      if (!info) {
        console.warn(`[${index + 1}/${limitedEntries.length}] ${entry.display_name}: player info missing.`);
        continue;
      }

      seedPlayers.push(playerInfoToSeedPlayer(info, existingByNbaId.get(entry.person_id)));
    } catch (error) {
      const existingRecord = existingByNbaId.get(entry.person_id);

      console.warn(
        `[${index + 1}/${limitedEntries.length}] ${entry.display_name}: player info fetch failed (${safeErrorMessage(error)})`,
      );

      if (existingRecord) {
        seedPlayers.push(existingRecordToSeedPlayer(existingRecord));
      }
    }

    if (index < limitedEntries.length - 1) {
      await sleep(nbaDelayMs);
    }
  }

  return seedPlayers;
}

function applyDirectoryRosterStatus(player, nbaStatsId, playerDirectory) {
  const directoryEntry = directoryEntryForNbaStatsId(nbaStatsId, playerDirectory);

  if (!directoryEntry) {
    return player;
  }

  const active = rosterStatusIsActive(directoryEntry.roster_status);

  return {
    ...player,
    active,
    team:
      active && directoryEntry.team_abbreviation
        ? {
            abbreviation: directoryEntry.team_abbreviation,
            id: directoryEntry.team_abbreviation,
          }
        : null,
  };
}

async function refreshSeedPlayer({
  player,
  index,
  total,
  idMap,
  playerDirectory,
  statTitleCache,
  careerStatsCache,
  gameWinsCache,
  existingRecord,
  seedGameWins,
  refreshGameWins,
  hydratePlayerInfo,
  nbaRetries,
  nbaDelayMs,
  nbaTimeoutMs,
}) {
  const resolution = resolveNbaStatsId(player, idMap, playerDirectory);
  const nbaStatsId = resolution.id;
  const label = `${player.first_name} ${player.last_name}`.trim();
  let awards = parseAwards({ headers: [], rowSet: [] });
  let career = parseCareerStats({ headers: [], rowSet: [] });
  let playerInfo = null;
  let awardRowCount = 0;
  let careerSource = "empty";
  let gameWinsSource = null;

  if (!nbaStatsId) {
    console.warn(`[${index + 1}/${total}] ${label}: NBA Stats ID not found; skipping awards/career (${resolution.source}).`);
  } else {
    if (hydratePlayerInfo) {
      try {
        playerInfo = await fetchNbaPlayerInfo(nbaStatsId, {
          retries: nbaRetries,
          delayMs: nbaDelayMs,
          timeoutMs: nbaTimeoutMs,
        });
        await sleep(nbaDelayMs);
      } catch (error) {
        console.warn(`[${index + 1}/${total}] ${label}: player info fetch failed (${safeErrorMessage(error)})`);
      }
    }

    try {
      const resultSet = await fetchNbaAwards(nbaStatsId, {
        retries: nbaRetries,
        delayMs: nbaDelayMs,
        timeoutMs: nbaTimeoutMs,
      });
      awards = parseAwards(resultSet);
      awardRowCount = resultSet.rowSet?.length || 0;
    } catch (error) {
      console.warn(`[${index + 1}/${total}] ${label}: awards fetch failed (${safeErrorMessage(error)})`);
    }

    if (playerInfo) {
      const infoActive = rosterStatusIsActive(playerInfo.roster_status);
      player = {
        ...player,
        first_name: playerInfo.first_name || player.first_name,
        last_name: playerInfo.last_name || player.last_name,
        position: playerInfo.position || player.position,
        draft_year: playerInfo.draft_year || player.draft_year,
        active: infoActive,
        team:
          infoActive && playerInfo.team_abbreviation
            ? {
                abbreviation: playerInfo.team_abbreviation,
                id: playerInfo.team_abbreviation,
              }
            : player.team,
      };
    }

    const careerCacheKey = String(nbaStatsId);
    const cachedCareerEntry = careerStatsCache?.players?.[careerCacheKey];

    if (cachedCareerEntryLooksValid(cachedCareerEntry)) {
      career = careerStatsFromCachedSeasons(cachedCareerEntry.seasons);
      careerSource = "cache";
    } else {
      try {
        await sleep(nbaDelayMs);
        const careerSet = await fetchNbaCareerStats(nbaStatsId, {
          retries: nbaRetries,
          delayMs: nbaDelayMs,
          timeoutMs: nbaTimeoutMs,
        });
        career = parseCareerStats(careerSet);
        careerSource = "fetched";

        if (careerStatsCache?.players) {
          careerStatsCache.players[careerCacheKey] = {
            fetched_at: new Date().toISOString(),
            seasons: career.careerSeasons,
          };
        }
      } catch (error) {
        console.warn(`[${index + 1}/${total}] ${label}: career fetch failed (${safeErrorMessage(error)})`);
      }
    }

    if (seedGameWins) {
      const cachedGameWinsEntry = gameWinsCache?.players?.[careerCacheKey];
      let gameWinRows = [];

      if (!refreshGameWins && cachedGameWinsEntryLooksValid(cachedGameWinsEntry)) {
        gameWinRows = normalizeGameWinRows(cachedGameWinsEntry.seasons);
        gameWinsSource = "cache";
      } else {
        try {
          await sleep(nbaDelayMs);
          gameWinRows = await fetchNbaRegularSeasonGameWins(nbaStatsId, {
            retries: nbaRetries,
            delayMs: nbaDelayMs,
            timeoutMs: nbaTimeoutMs,
          });
          gameWinsSource = "fetched";

          if (gameWinsCache?.players) {
            gameWinsCache.players[careerCacheKey] = {
              fetched_at: new Date().toISOString(),
              seasons: gameWinRows,
            };
          }
        } catch (error) {
          console.warn(`[${index + 1}/${total}] ${label}: game wins fetch failed (${safeErrorMessage(error)})`);
        }
      }

      career = applyGameWinsToCareer(career, gameWinRows);

      if (gameWinsSource && careerStatsCache?.players?.[careerCacheKey]) {
        careerStatsCache.players[careerCacheKey] = {
          ...careerStatsCache.players[careerCacheKey],
          seasons: career.careerSeasons,
        };
      }
    }

    career = fillMissingCareerSeasonFields(career, existingRecord?.career_seasons || []);

    try {
      await applyStatTitles(awards.accolades, career, nbaStatsId, statTitleCache, {
        retries: nbaRetries,
        delayMs: nbaDelayMs,
        timeoutMs: nbaTimeoutMs,
      }, awards.awardRows);
    } catch (error) {
      console.warn(`[${index + 1}/${total}] ${label}: stat title fetch failed (${safeErrorMessage(error)})`);
    }
  }

  const hydratedPlayer = playerInfo ? player : applyDirectoryRosterStatus(player, nbaStatsId, playerDirectory);
  const aggregated = aggregatePlayer(hydratedPlayer, awards, career, nbaStatsId);
  console.log(
    `[${index + 1}/${total}] ${label}: ${awardRowCount} award rows, ${career.careerSeasons.length} team seasons${careerSource !== "empty" ? ` (${careerSource})` : ""}${gameWinsSource ? `, game wins ${gameWinsSource}` : ""}${nbaStatsId ? `, NBA ID ${nbaStatsId} (${resolution.source})` : ""}`,
  );

  return { aggregated, nbaStatsId };
}

async function main() {
  console.time("seed: total");
  const args = parseArgs(process.argv);
  const limit = args.limit ? Number(args.limit) : undefined;
  const offset = positiveInteger(args.offset || process.env.SEED_OFFSET, 0);
  const resume = flagEnabled(args.resume) || flagEnabled(process.env.SEED_RESUME);
  const replace = flagEnabled(args.replace);
  const saveEvery = positiveInteger(args.saveEvery || process.env.SEED_SAVE_EVERY, 0);
  const requestedMode = String(args.mode || process.env.SEED_MODE || "smart").toLowerCase();

  if (["bref", "basketball-reference", "basketball_reference"].includes(requestedMode)) {
    const { main: runBrefSeed } = require("./seed-bref");
    await runBrefSeed(process.argv);
    console.timeEnd("seed: total");
    return;
  }

  const nbaDelayMs = Number(args.delayMs || process.env.NBA_STATS_DELAY_MS || 2000);
  const nbaRetries = Number(args.retries || process.env.NBA_STATS_MAX_RETRIES || 5);
  const nbaTimeoutMs = Number(args.timeoutMs || process.env.NBA_STATS_TIMEOUT_MS || 30000);
  const nbaDirectorySeason = args.directorySeason || process.env.NBA_STATS_DIRECTORY_SEASON || "2025-26";
  const refreshNbaDirectory =
    flagEnabled(args.refreshNbaDirectory) || flagEnabled(process.env.NBA_STATS_REFRESH_PLAYER_DIRECTORY);
  const seedGameWins =
    flagEnabled(args.gameWins) ||
    flagEnabled(args.gamesWon) ||
    flagEnabled(args.seedGameWins) ||
    flagEnabled(process.env.SEED_GAME_WINS);
  const refreshGameWins =
    flagEnabled(args.refreshGameWins) ||
    flagEnabled(args.refreshGameWinsCache) ||
    flagEnabled(process.env.SEED_REFRESH_GAME_WINS);
  const idMapPath = process.env.NBA_STATS_ID_MAP_PATH || "./data/nba_stats_id_map.json";

  console.time("seed: load inputs");
  const {
    brefPositions,
    careerStatsCache,
    gameWinsCache,
    idMap,
    playerDirectoryCache,
    rawExistingPlayers,
    statTitleCache,
    threePointContestCache,
  } = await loadSeedInputs(idMapPath);
  console.timeEnd("seed: load inputs");

  const seedMode = requestedMode === "smart" ? (rawExistingPlayers.length ? "active" : "full") : requestedMode;
  const hydratePlayerInfo =
    args.hydratePlayerInfo === undefined && process.env.SEED_HYDRATE_PLAYER_INFO === undefined
      ? false
      : flagEnabled(args.hydratePlayerInfo || process.env.SEED_HYDRATE_PLAYER_INFO);

  if (!["active", "full"].includes(seedMode)) {
    throw new Error(`Unsupported SEED_MODE "${seedMode}". Use smart, active, or full.`);
  }

  const mergeOutput = !replace;

  console.time("seed: player directory");
  const playerDirectory = await fetchNbaPlayerDirectory({
    season: nbaDirectorySeason,
    retries: nbaRetries,
    delayMs: nbaDelayMs,
    timeoutMs: nbaTimeoutMs,
    refresh: refreshNbaDirectory,
    cachedDirectory: playerDirectoryCache,
  }).catch((error) => {
    console.warn(`NBA Stats player directory unavailable (${safeErrorMessage(error)}). Manual ID map only.`);
    return { players: [], byName: new Map(), byNbaStatsId: new Map() };
  });
  console.timeEnd("seed: player directory");

  console.time("seed: normalize existing roster");
  const existingPlayers = normalizeExistingRosterStatus(rawExistingPlayers, playerDirectory);
  const existingRecordLookup = buildExistingRecordLookup(existingPlayers);
  console.timeEnd("seed: normalize existing roster");

  let players;

  console.time("seed: build seed players");
  if (seedMode === "full") {
    players = sliceWindow(playerDirectory.players, offset, limit).map(directoryEntryToPlayer);
    console.log(
      `Seed mode: full. Selected ${players.length} players from NBA directory${offset ? ` from offset ${offset}` : ""}.`,
    );
  } else {
    players = await buildActiveSeedPlayers({
      existingPlayers,
      playerDirectory,
      limit,
      offset,
      resume,
      nbaRetries,
      nbaDelayMs,
      nbaTimeoutMs,
    });
    console.log(
      `Seed mode: active. Fetched ${players.length} active players${existingPlayers.length ? ` with ${existingPlayers.length} existing records available for metadata fallback` : ""}.`,
    );
  }
  console.timeEnd("seed: build seed players");

  if (resume) {
    const resumeFilter = filterResumePlayers(players, existingPlayers);
    players = resumeFilter.pending;
    console.log(`Resume mode: skipped ${resumeFilter.skipped.length} already-seeded players; ${players.length} left to process.`);
  }

  if (limit || offset || resume || mergeOutput || seedGameWins) {
    console.log(
      `Batch settings: limit=${limit || "none"}, offset=${offset}, resume=${resume ? "on" : "off"}, output=${mergeOutput ? "merge" : "replace"}, saveEvery=${saveEvery || "final-only"}, hydratePlayerInfo=${hydratePlayerInfo ? "on" : "off"}, gameWins=${seedGameWins ? "on" : "off"}, refreshGameWins=${refreshGameWins ? "on" : "off"}.`,
    );
  }

  if (!mergeOutput) {
    const confirmed = await confirmOutputReplacement({
      args,
      existingCount: existingPlayers.length,
      outputCount: players.length,
      seedMode,
    });

    if (!confirmed) {
      console.log("Seed canceled. Drop --replace to preserve existing records.");
      process.exitCode = 1;
      return;
    }
  }

  const updatedPlayers = [];

  console.time("seed: refresh players");
  for (const [index, player] of players.entries()) {
    const { aggregated: playerRecord, nbaStatsId } = await refreshSeedPlayer({
      player,
      index,
      total: players.length,
      idMap,
      playerDirectory,
      statTitleCache,
      careerStatsCache,
      gameWinsCache,
      existingRecord: existingRecordForSeedPlayer(player, existingRecordLookup),
      seedGameWins,
      refreshGameWins,
      hydratePlayerInfo,
      nbaRetries,
      nbaDelayMs,
      nbaTimeoutMs,
    });

    updatedPlayers.push(playerRecord);

    if (saveEvery && (index + 1) % saveEvery === 0) {
      const checkpointBasePlayers = mergeOutput
        ? mergeUpdatedPlayers(existingPlayers, updatedPlayers)
        : updatedPlayers;
      const checkpointPlayers = buildPlayersOutput(
        checkpointBasePlayers,
        { brefPositions, statTitleCache, threePointContestCache },
        `seed: checkpoint ${index + 1}`,
      );

      console.time(`seed: checkpoint ${index + 1}: write`);
      await writePlayersOutput(checkpointPlayers);
      await writeJsonAtomically(CAREER_STATS_CACHE_PATH, {
        ...careerStatsCache,
        fetched_at: new Date().toISOString(),
      });
      if (seedGameWins) {
        await writeJsonAtomically(GAME_WINS_CACHE_PATH, {
          ...gameWinsCache,
          fetched_at: new Date().toISOString(),
        });
      }
      console.timeEnd(`seed: checkpoint ${index + 1}: write`);
      console.log(`Checkpoint saved ${checkpointPlayers.length} players to ${OUTPUT_PATH}.`);
    }

    if (nbaStatsId && index < players.length - 1) {
      await sleep(nbaDelayMs);
    }
  }
  console.timeEnd("seed: refresh players");

  const baseOutputPlayers = mergeOutput
    ? mergeUpdatedPlayers(existingPlayers, updatedPlayers)
    : updatedPlayers;
  const outputPlayers = buildPlayersOutput(
    baseOutputPlayers,
    { brefPositions, statTitleCache, threePointContestCache },
    "seed: final pipeline",
  );

  console.time("seed: write output");
  await writePlayersOutput(outputPlayers);
  console.timeEnd("seed: write output");

  console.time("seed: save stat title cache");
  await saveStatTitleCache(statTitleCache);
  console.timeEnd("seed: save stat title cache");

  console.time("seed: save career cache");
  await writeJsonAtomically(CAREER_STATS_CACHE_PATH, {
    ...careerStatsCache,
    fetched_at: new Date().toISOString(),
  });
  console.timeEnd("seed: save career cache");

  if (seedGameWins) {
    console.time("seed: save game wins cache");
    await writeJsonAtomically(GAME_WINS_CACHE_PATH, {
      ...gameWinsCache,
      fetched_at: new Date().toISOString(),
    });
    console.timeEnd("seed: save game wins cache");
  }

  console.log(
    `Wrote ${outputPlayers.length} players to ${OUTPUT_PATH}`,
  );
  console.log(
    "Unmatched/ambiguous players can be fixed with NBA_STATS_ID_MAP_PATH manual overrides.",
  );
  console.timeEnd("seed: total");
}

main().catch((error) => {
  console.error(safeErrorMessage(error));
  process.exitCode = 1;
});
