const fs = require("fs/promises");
const path = require("path");
const { applyGoatRankingsToPlayers, loadCachedGoatRankings } = require("./mediaGoatRankings");
const { normalizePlayerAccoladeRecords } = require("./playerAccoladeRecords");
const { normalizePlayerTeams } = require("./teamFranchises");
const { getPrismaClient } = require("./db");

const DEFAULT_PLAYER_DATA_PATH = path.join(__dirname, "data", "players_accolades_bref.json");

let warnedAboutDatabaseRead = false;
let databasePlayersCache = null;
let databasePlayersCacheLoadedAt = 0;
let databasePlayersLoadPromise = null;

function databaseCacheTtlMs() {
  const configured = Number(process.env.PLAYER_DB_CACHE_MS);

  return Number.isFinite(configured) && configured >= 0 ? configured : 10 * 60 * 1000;
}

function cachedDatabasePlayers() {
  if (!databasePlayersCache) {
    return null;
  }

  if (databaseCacheTtlMs() === 0) {
    return null;
  }

  if (Date.now() - databasePlayersCacheLoadedAt > databaseCacheTtlMs()) {
    return null;
  }

  return databasePlayersCache;
}

function getPlayerDataPath() {
  return process.env.PLAYER_DATA_PATH
    ? path.resolve(__dirname, process.env.PLAYER_DATA_PATH)
    : DEFAULT_PLAYER_DATA_PATH;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function stringOrNull(value) {
  const text = value === null || value === undefined ? "" : String(value).trim();

  return text || null;
}

function stringOrEmpty(value) {
  return stringOrNull(value) || "";
}

function integerOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);

  return Number.isInteger(numeric) ? numeric : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function stringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => stringOrNull(item)).filter(Boolean);
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function jsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function playerToDatabaseRecord(player, sortOrder = 0) {
  const fallbackName = [player.first_name, player.last_name].map(stringOrNull).filter(Boolean).join(" ");
  const name = stringOrEmpty(player.name) || fallbackName;

  if (!player.id) {
    throw new Error(`Player record is missing an id: ${name || JSON.stringify(player).slice(0, 80)}`);
  }

  return {
    id: String(player.id),
    brefId: stringOrNull(player.bref_id),
    balldontlieId: integerOrNull(player.balldontlie_id),
    nbaStatsId: integerOrNull(player.nba_stats_id),
    firstName: stringOrEmpty(player.first_name),
    lastName: stringOrEmpty(player.last_name),
    name,
    positions: stringArray(player.positions),
    primaryPosition: stringOrNull(player.primary_position),
    currentTeam: stringOrNull(player.current_team),
    teams: stringArray(player.teams),
    eras: stringArray(player.eras),
    teamEras: jsonArray(player.team_eras),
    careerSeasons: jsonArray(player.career_seasons),
    accolades: jsonObject(player.accolades),
    awardsRaw: jsonArray(player.awards_raw),
    classicPointsByTeamEra: jsonArray(player.classic_points_by_team_era),
    legacyPoints: numberOrNull(player.legacy_points),
    draftYear: integerOrNull(player.draft_year),
    active: booleanOrNull(player.active),
    source: stringOrNull(player.source),
    sortOrder,
    payload: player,
  };
}

function databaseRowToPlayer(row) {
  const payload = jsonObject(row.payload);

  return {
    ...payload,
    id: row.id,
    bref_id: row.brefId,
    balldontlie_id: row.balldontlieId,
    nba_stats_id: row.nbaStatsId,
    first_name: row.firstName,
    last_name: row.lastName,
    name: row.name,
    positions: row.positions,
    primary_position: row.primaryPosition,
    current_team: row.currentTeam,
    teams: row.teams,
    eras: row.eras,
    team_eras: row.teamEras,
    career_seasons: row.careerSeasons,
    accolades: row.accolades,
    awards_raw: row.awardsRaw,
    classic_points_by_team_era: row.classicPointsByTeamEra,
    legacy_points: row.legacyPoints,
    draft_year: row.draftYear,
    active: row.active,
    source: row.source,
  };
}

async function normalizePlayersForApi(players) {
  const goatRankings = await loadCachedGoatRankings();
  const normalizedPlayers = normalizePlayerAccoladeRecords(players).map(normalizePlayerTeams);

  return applyGoatRankingsToPlayers(normalizedPlayers, goatRankings);
}

async function readPlayersFromJson(filePath = getPlayerDataPath()) {
  const players = await readJson(filePath);

  return normalizePlayersForApi(players);
}

async function readPlayersFromDatabase() {
  const cachedPlayers = cachedDatabasePlayers();

  if (cachedPlayers) {
    return cachedPlayers;
  }

  if (databasePlayersLoadPromise) {
    return databasePlayersLoadPromise;
  }

  const prisma = getPrismaClient();

  if (!prisma) {
    return null;
  }

  databasePlayersLoadPromise = (async () => {
    const rows = await prisma.player.findMany({
      select: { payload: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    const players = await normalizePlayersForApi(rows.map((row) => row.payload));
    databasePlayersCache = players;
    databasePlayersCacheLoadedAt = Date.now();

    return players;
  })();

  try {
    return await databasePlayersLoadPromise;
  } finally {
    databasePlayersLoadPromise = null;
  }
}

function playerCacheStatus() {
  return {
    cached: Boolean(databasePlayersCache),
    cachedAt: databasePlayersCacheLoadedAt ? new Date(databasePlayersCacheLoadedAt).toISOString() : null,
    loading: Boolean(databasePlayersLoadPromise),
    size: databasePlayersCache?.length || 0,
    ttlMs: databaseCacheTtlMs(),
  };
}

async function readPlayers() {
  const dataSource = String(process.env.PLAYER_DATA_SOURCE || "auto").toLowerCase();

  if (!["auto", "database", "json"].includes(dataSource)) {
    throw new Error(`Unsupported PLAYER_DATA_SOURCE "${dataSource}". Use auto, database, or json.`);
  }

  if (dataSource !== "json") {
    try {
      const databasePlayers = await readPlayersFromDatabase();

      if (databasePlayers && (databasePlayers.length || dataSource === "database")) {
        return databasePlayers;
      }

      if (databasePlayers && !databasePlayers.length && dataSource === "auto" && !warnedAboutDatabaseRead) {
        warnedAboutDatabaseRead = true;
        console.warn("Prisma database has no players yet; falling back to JSON player data.");
      }
    } catch (error) {
      if (dataSource === "database") {
        throw error;
      }

      if (!warnedAboutDatabaseRead) {
        warnedAboutDatabaseRead = true;
        console.warn(`Prisma player read failed; falling back to JSON player data. ${error.message}`);
      }
    }
  }

  return readPlayersFromJson();
}

module.exports = {
  databaseRowToPlayer,
  getPlayerDataPath,
  normalizePlayersForApi,
  playerToDatabaseRecord,
  readJson,
  readPlayers,
  readPlayersFromDatabase,
  readPlayersFromJson,
  playerCacheStatus,
};
