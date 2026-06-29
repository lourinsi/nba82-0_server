const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");
const readline = require("readline/promises");
const {
  buildAdvancedLookup,
  parseAdvancedRows,
  updatePlayerAdvancedStats,
} = require("./seed-advanced-stats");
const { applyLegacyScoringPipeline } = require("./seed-legacy-points");
const { eraSortValue, seasonEndYear, seasonEra } = require("./seasonEras");
const {
  isAbaSeason,
  normalizeSourceLeague,
  normalizeTeamCodeForSeason,
  normalizedRawTeamCode,
  summarizeAbaTranslationsFromPlayers,
  teamTranslationFields,
  translateTeamForSeason,
} = require("./teamFranchises");
require("dotenv").config();

const FALLBACK_PLAYERS_PATH = path.join(__dirname, "data", "players_accolades.json");
const OUTPUT_PATH = path.join(__dirname, "data", "players_accolades_bref.json");
const BREF_POSITIONS_PATH = path.join(__dirname, "data", "bref_positions.json");
const BREF_PER_GAME_CACHE_PATH = path.join(__dirname, "data", "bref_per_game_stats_cache.json");
const BREF_PER_100_CACHE_PATH = path.join(__dirname, "data", "bref_per_100_stats_cache.json");
const BREF_ADVANCED_CACHE_PATH = path.join(__dirname, "data", "bref_advanced_stats_cache.json");
const BREF_TEAM_ADVANCED_CACHE_PATH = path.join(__dirname, "data", "bref_team_advanced_cache.json");
const STAT_TITLE_CACHE_PATH = path.join(__dirname, "data", "stat_title_winners.json");
const THREE_POINT_CONTEST_CACHE_PATH = path.join(__dirname, "data", "three_point_contest_winners.json");

const BREF_PER_GAME_URL_TEMPLATE = "https://www.basketball-reference.com/leagues/{league}_{year}_per_game.html";
const BREF_PER_100_URL_TEMPLATE = "https://www.basketball-reference.com/leagues/{league}_{year}_per_poss.html";
const BREF_ADVANCED_URL_TEMPLATE = "https://www.basketball-reference.com/leagues/{league}_{year}_advanced.html";
const BREF_TEAM_ADVANCED_URL_TEMPLATE = "https://www.basketball-reference.com/leagues/{league}_{year}.html";
const WRITE_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000];
const POSITION_ORDER = ["PG", "SG", "SF", "PF", "C"];
const VALID_POSITIONS = new Set(POSITION_ORDER);

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

function positiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function roundedNumber(value) {
  const numeric = numberOrNull(value);
  return numeric === null ? null : Number(numeric.toFixed(3));
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

function safeErrorMessage(error) {
  if (!error?.isAxiosError) {
    return error?.stack || error?.message || String(error);
  }

  const parts = ["Axios request failed"];

  if (error.response?.status) {
    parts.push(String(error.response.status));
  }
  if (error.response?.statusText) {
    parts.push(error.response.statusText);
  }
  if (error.code) {
    parts.push(`code=${error.code}`);
  }
  if (error.config?.url) {
    parts.push(`url=${error.config.url}`);
  }

  return parts.join(" | ");
}

function httpStatus(error) {
  return error?.response?.status || null;
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
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");

  for (let attempt = 0; attempt <= WRITE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await fs.rename(tempPath, filePath);
      return;
    } catch (error) {
      const retryable = ["EACCES", "EBUSY", "EPERM"].includes(error.code);

      if (!retryable || attempt >= WRITE_RETRY_DELAYS_MS.length) {
        try {
          await fs.unlink(tempPath);
        } catch {
          // Best effort cleanup; keep the original write error visible.
        }
        throw error;
      }

      const delayMs = WRITE_RETRY_DELAYS_MS[attempt];
      console.warn(`Write target locked (${error.code}); retrying ${filePath} in ${delayMs}ms.`);
      await sleep(delayMs);
    }
  }
}

function resolvePath(value, fallbackPath) {
  if (!value || value === true) {
    return fallbackPath;
  }

  return path.resolve(process.cwd(), String(value));
}

function brefLeagueCodesForSeason(season) {
  const endYear = seasonEndYear(season);

  if (endYear && endYear < 1950) {
    return ["BAA"];
  }

  return isAbaSeason(season) ? ["NBA", "ABA"] : ["NBA"];
}

function brefLeagueUrl(urlTemplate, league, season) {
  return urlTemplate
    .replace("{league}", league)
    .replace("{year}", String(seasonEndYear(season)));
}

function fixPossiblyMojibake(value) {
  const text = String(value || "");

  if (!/[\u00c2\u00c3\u00c4\u00c5]/.test(text)) {
    return text;
  }

  const fixed = Buffer.from(text, "latin1").toString("utf8");
  return fixed.includes("\uFFFD") ? text : fixed;
}

function normalizeName(value) {
  return fixPossiblyMojibake(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&[a-z]+;|&#\d+;|&#x[\da-f]+;/gi, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function nameWithoutSuffix(normalizedName) {
  const alias = String(normalizedName || "").replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");
  return alias && alias !== normalizedName ? alias : "";
}

function nameWithoutMiddleInitials(normalizedName) {
  const parts = String(normalizedName || "").split(" ").filter(Boolean);

  if (parts.length < 3) {
    return "";
  }

  const alias = parts
    .filter((part, index) => index === 0 || index === parts.length - 1 || part.length !== 1)
    .join(" ");

  return alias && alias !== normalizedName ? alias : "";
}

function nameWithCompactedLeadingInitials(normalizedName) {
  const parts = String(normalizedName || "").split(" ").filter(Boolean);
  let index = 0;
  let compacted = "";

  while (index < parts.length - 1 && parts[index].length === 1) {
    compacted += parts[index];
    index += 1;
  }

  if (compacted.length < 2) {
    return "";
  }

  const alias = [compacted, ...parts.slice(index)].join(" ");
  return alias && alias !== normalizedName ? alias : "";
}

function nameAliases(value) {
  const normalized = normalizeName(value);

  return Array.from(
    new Set(
      [
        normalized,
        nameWithoutSuffix(normalized),
        nameWithoutMiddleInitials(normalized),
        nameWithCompactedLeadingInitials(normalized),
      ].filter(Boolean),
    ),
  );
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#x([\da-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripTags(html) {
  return decodeHtml(String(html || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function htmlAttribute(attrs, name) {
  const pattern = new RegExp(`\\b${name}=["']([^"']+)["']`, "i");
  return attrs.match(pattern)?.[1] || null;
}

function extractTableHtml(html, tableId) {
  const pattern = new RegExp(`<table\\b[^>]*\\bid=["']${tableId}["'][\\s\\S]*?<\\/table>`, "i");
  return html.match(pattern)?.[0] || null;
}

function brefPlayerIdFromHtml(html) {
  const match = String(html || "").match(/href=["']\/players\/[a-z]\/([^"'.]+)\.html["']/i);
  return match?.[1] || null;
}

function parseTableRows(tableHtml) {
  const rows = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;

  for (const rowMatch of tableHtml.matchAll(rowPattern)) {
    const cells = {};
    const cellPattern = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

    for (const cellMatch of rowMatch[1].matchAll(cellPattern)) {
      const dataStat = htmlAttribute(cellMatch[2], "data-stat");

      if (!dataStat) {
        continue;
      }

      cells[dataStat] = {
        html: cellMatch[3],
        text: stripTags(cellMatch[3]),
      };
    }

    if (Object.keys(cells).length) {
      rows.push(cells);
    }
  }

  return rows;
}

function isAggregateTeam(team) {
  const normalized = String(team || "").trim().toUpperCase();
  return normalized === "TOT" || /^\d+TM$/.test(normalized);
}

function sourceLeagueForRow(row, fallback = null) {
  return normalizeSourceLeague(row?.source_league || row?.sourceLeague || row?.league || fallback);
}

function translatedTeamForRow(rawTeam, season, sourceLeague) {
  const translation = translateTeamForSeason(rawTeam, season, { sourceLeague });

  if (!translation.team) {
    return null;
  }

  return {
    team: translation.team,
    fields: teamTranslationFields(translation),
  };
}

function normalizePosition(value) {
  const position = String(value || "").match(/\b(PG|SG|SF|PF|C)\b/i)?.[1]?.toUpperCase();
  return VALID_POSITIONS.has(position) ? position : null;
}

function positionsFromString(value) {
  return uniquePositions(String(value || "").match(/\b(PG|SG|SF|PF|C)\b/gi) || []);
}

function uniquePositions(values) {
  const positions = [];

  for (const value of values || []) {
    const position = normalizePosition(value);

    if (position && !positions.includes(position)) {
      positions.push(position);
    }
  }

  return positions;
}

function normalizeBrefSeason(rawSeason) {
  if (!rawSeason || typeof rawSeason !== "object") {
    return null;
  }

  const season = String(rawSeason.season || "").trim();
  const rawTeam = String(rawSeason.team || "").trim().toUpperCase();
  const sourceLeague = sourceLeagueForRow(rawSeason);
  const translated = translatedTeamForRow(rawTeam, season, sourceLeague);

  if (!season || !translated || isAggregateTeam(rawTeam)) {
    return null;
  }

  return {
    season,
    team: translated.team,
    ...translated.fields,
    games_played: positiveInteger(rawSeason.games_played ?? rawSeason.gamesPlayed ?? rawSeason.games, 0),
  };
}

function normalizeBrefSeasons(rawSeasons) {
  if (!Array.isArray(rawSeasons)) {
    return [];
  }

  const seen = new Set();
  const seasons = [];

  for (const rawSeason of rawSeasons) {
    const season = normalizeBrefSeason(rawSeason);

    if (!season) {
      continue;
    }

    const key = `${season.season}:${season.team}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    seasons.push(season);
  }

  return seasons.sort(
    (a, b) =>
      (seasonEndYear(a.season) || 0) - (seasonEndYear(b.season) || 0) ||
      a.team.localeCompare(b.team),
  );
}

function normalizeBrefRecord(rawRecord, fallbackBrefId = null) {
  if (!rawRecord || typeof rawRecord !== "object") {
    return null;
  }

  const primaryPosition = normalizePosition(rawRecord.primary_position || rawRecord.primaryPosition || rawRecord.position);
  const positions = uniquePositions([
    ...(primaryPosition ? [primaryPosition] : []),
    ...(Array.isArray(rawRecord.positions) ? rawRecord.positions : positionsFromString(rawRecord.positions)),
  ]);
  const name = fixPossiblyMojibake(rawRecord.name || rawRecord.player || rawRecord.display_name || "");
  const brefId = rawRecord.bref_id || rawRecord.brefId || rawRecord.player_id || rawRecord.playerId || fallbackBrefId;

  if (!name || !brefId) {
    return null;
  }

  return {
    name,
    bref_id: String(brefId),
    primary_position: primaryPosition || positions[0] || "SF",
    positions: positions.length ? positions : ["SF"],
    seasons: normalizeBrefSeasons(rawRecord.seasons || rawRecord.career_seasons),
  };
}

function brefRecordEntries(brefPositions) {
  if (Array.isArray(brefPositions)) {
    return brefPositions.map((rawRecord) => [rawRecord?.bref_id || rawRecord?.name || "", rawRecord]);
  }

  if (Array.isArray(brefPositions?.players)) {
    return brefPositions.players.map((rawRecord) => [rawRecord?.bref_id || rawRecord?.name || "", rawRecord]);
  }

  return Object.entries(brefPositions || {}).filter(([key]) => !String(key).startsWith("_"));
}

function normalizeBrefRecords(brefPositions) {
  const seen = new Set();
  const records = [];

  for (const [fallbackBrefId, rawRecord] of brefRecordEntries(brefPositions)) {
    const record = normalizeBrefRecord(rawRecord, fallbackBrefId);

    if (!record || seen.has(record.bref_id)) {
      continue;
    }

    seen.add(record.bref_id);
    records.push(record);
  }

  return records.sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name)));
}

function seasonLabelsFromBrefRecords(records) {
  const seasons = new Set();

  for (const record of records) {
    for (const season of record.seasons || []) {
      if (season?.season) {
        seasons.add(season.season);
      }
    }
  }

  return Array.from(seasons).sort((a, b) => (seasonEndYear(a) || 0) - (seasonEndYear(b) || 0));
}

function parsePerGameRows(html, season, sourceLeague = "NBA") {
  const table = extractTableHtml(html, "per_game_stats");

  if (!table) {
    return [];
  }

  const rows = [];

  for (const cells of parseTableRows(table)) {
    const playerCell = cells.player || cells.name_display;
    const rawTeam = cells.team_id?.text || cells.team_name_abbr?.text;
    const translated = translatedTeamForRow(rawTeam, season, sourceLeague);

    if (!playerCell?.text || !translated || isAggregateTeam(rawTeam)) {
      continue;
    }

    const gamesPlayed = positiveInteger(cells.g?.text || cells.games?.text, 0);
    const gamesStarted = numberOrNull(cells.gs?.text || cells.games_started?.text);
    const mpg = roundedNumber(cells.mp_per_g?.text);

    rows.push({
      season,
      team: translated.team,
      ...translated.fields,
      player: playerCell.text.replace(/\*/g, "").trim(),
      bref_id: brefPlayerIdFromHtml(playerCell.html),
      games_played: gamesPlayed,
      games_started: gamesStarted === null ? null : Math.max(0, Math.floor(gamesStarted)),
      mpg,
      minutes: mpg !== null && gamesPlayed > 0 ? Number((mpg * gamesPlayed).toFixed(1)) : null,
      ppg: roundedNumber(cells.pts_per_g?.text),
      rpg: roundedNumber(cells.trb_per_g?.text),
      apg: roundedNumber(cells.ast_per_g?.text),
      spg: roundedNumber(cells.stl_per_g?.text),
      bpg: roundedNumber(cells.blk_per_g?.text),
    });
  }

  return rows.sort(
    (a, b) =>
      a.season.localeCompare(b.season) ||
      a.team.localeCompare(b.team) ||
      normalizeName(a.player).localeCompare(normalizeName(b.player)),
  );
}

function parsePer100Rows(html, season, sourceLeague = "NBA") {
  const table = extractTableHtml(html, "per_poss") || extractTableHtml(html, "per_poss_stats");

  if (!table) {
    return [];
  }

  const rows = [];

  for (const cells of parseTableRows(table)) {
    const playerCell = cells.player || cells.name_display;
    const rawTeam = cells.team_id?.text || cells.team_name_abbr?.text;
    const translated = translatedTeamForRow(rawTeam, season, sourceLeague);

    if (!playerCell?.text || !translated || isAggregateTeam(rawTeam)) {
      continue;
    }

    const per100Pts = roundedNumber(cells.pts_per_poss?.text);
    const per100Reb = roundedNumber(cells.trb_per_poss?.text);
    const per100Ast = roundedNumber(cells.ast_per_poss?.text);

    if (per100Pts === null && per100Reb === null && per100Ast === null) {
      continue;
    }

    rows.push({
      season,
      team: translated.team,
      ...translated.fields,
      player: playerCell.text.replace(/\*/g, "").trim(),
      bref_id: brefPlayerIdFromHtml(playerCell.html),
      games_played: positiveInteger(cells.g?.text || cells.games?.text, 0),
      per100_pts: per100Pts,
      per100_reb: per100Reb,
      per100_ast: per100Ast,
    });
  }

  return rows.sort(
    (a, b) =>
      a.season.localeCompare(b.season) ||
      a.team.localeCompare(b.team) ||
      normalizeName(a.player).localeCompare(normalizeName(b.player)),
  );
}

function brefTeamIdFromHtml(html) {
  const match = String(html || "").match(/href=["']\/teams\/([^/"']+)\/\d+\.html["']/i);

  return match?.[1] || null;
}

function parseTeamAdvancedRows(html, season, sourceLeague = "NBA") {
  const table = extractTableHtml(html, "advanced-team");

  if (!table) {
    return [];
  }

  const rows = [];

  for (const cells of parseTableRows(table)) {
    const teamCell = cells.team || cells.team_name;
    const rawTeam = brefTeamIdFromHtml(teamCell?.html) || teamCell?.text;
    const translated = translatedTeamForRow(rawTeam, season, sourceLeague);
    const pace = roundedNumber(cells.pace?.text);

    if (!translated || !pace || /league average/i.test(teamCell?.text || "")) {
      continue;
    }

    rows.push({
      season,
      team: translated.team,
      ...translated.fields,
      pace,
    });
  }

  return rows.sort((a, b) => a.season.localeCompare(b.season) || a.team.localeCompare(b.team));
}

async function fetchRowsForSeason(season, options) {
  const endYear = seasonEndYear(season);

  if (!endYear) {
    return { rows: [], sources: [] };
  }

  const rows = [];
  const sources = [];
  const leagues = options.leagues || brefLeagueCodesForSeason(season);
  let lastNotFoundError = null;

  for (const [leagueIndex, league] of leagues.entries()) {
    const url = brefLeagueUrl(options.urlTemplate, league, season);

    try {
      const response = await getWithRetry({
        label: `${options.label} ${league} ${season}`,
        retries: options.retries,
        delayMs: options.delayMs,
        retryStatuses: [403, 429, 500, 502, 503, 504],
        request: () =>
          axios.get(url, {
            headers: BREF_HEADERS,
            timeout: options.timeoutMs,
          }),
      });

      rows.push(...options.parseRows(response.data, season, league));
      sources.push(url);
    } catch (error) {
      if (httpStatus(error) !== 404 || leagues.length === 1) {
        throw error;
      }

      lastNotFoundError = error;
    }

    if (leagueIndex < leagues.length - 1) {
      await sleep(options.delayMs);
    }
  }

  if (!sources.length && lastNotFoundError) {
    throw lastNotFoundError;
  }

  return { rows, sources };
}

async function populateSeasonCache(options) {
  const cache = options.cache?.seasons ? options.cache : { fetched_at: null, seasons: {} };
  cache.seasons ||= {};

  let cacheHits = 0;
  let fetchedSeasons = 0;
  let missingCache = 0;
  let unavailableSeasons = 0;
  let lastFetchAt = 0;

  for (const [index, season] of options.seasons.entries()) {
    const cachedSeason = cache.seasons[season];

    if (!options.refresh && Array.isArray(cachedSeason?.rows)) {
      cacheHits += 1;
      if (cachedSeason.unavailable) {
        unavailableSeasons += 1;
      }
      continue;
    }

    if (options.skipFetch) {
      missingCache += 1;
      continue;
    }

    await waitForRateLimit(lastFetchAt, options.delayMs);

    try {
      const result = await fetchRowsForSeason(season, options);
      lastFetchAt = Date.now();
      cache.seasons[season] = {
        fetched_at: new Date().toISOString(),
        source: result.sources.length === 1 ? result.sources[0] : result.sources,
        rows: result.rows,
      };
      fetchedSeasons += 1;
      console.log(`[${index + 1}/${options.seasons.length}] ${season}: fetched ${result.rows.length} ${options.cacheLabel} rows.`);
    } catch (error) {
      lastFetchAt = Date.now();

      if (httpStatus(error) !== 404) {
        throw error;
      }

      cache.seasons[season] = {
        fetched_at: new Date().toISOString(),
        source: brefLeagueCodesForSeason(season).map((league) => brefLeagueUrl(options.urlTemplate, league, season)),
        unavailable: true,
        reason: "not-found",
        rows: [],
      };
      unavailableSeasons += 1;
      console.warn(`[${index + 1}/${options.seasons.length}] ${season}: B-Ref ${options.cacheLabel} page not found; skipping.`);
    }

    if (!options.dryRun && options.saveEvery && fetchedSeasons > 0 && fetchedSeasons % options.saveEvery === 0) {
      await writeJsonAtomically(options.cachePath, { ...cache, fetched_at: new Date().toISOString() });
      console.log(`Saved ${options.cacheLabel} cache checkpoint after ${fetchedSeasons} fetched seasons.`);
    }
  }

  return {
    cache,
    stats: {
      cacheHits,
      fetchedSeasons,
      missingCache,
      unavailableSeasons,
    },
  };
}

function seasonRowsFromCache(cache, seasons) {
  const selectedSeasons = new Set(seasons || []);
  const rows = [];

  for (const [season, cachedSeason] of Object.entries(cache?.seasons || {})) {
    if (selectedSeasons.size && !selectedSeasons.has(season)) {
      continue;
    }

    rows.push(...(cachedSeason?.rows || []));
  }

  return rows;
}

function seasonPlayerTeamKey(season, team, playerName, options = {}) {
  const normalizedTeam = normalizeTeamCodeForSeason(team, season, { sourceLeague: options.sourceLeague });
  const normalizedName = normalizeName(playerName);

  return season && normalizedTeam && normalizedName ? `${season}:team:${normalizedTeam}:${normalizedName}` : null;
}

function seasonPlayerSourceTeamKey(season, originalTeam, sourceLeague, playerName) {
  const normalizedSourceLeague = normalizeSourceLeague(sourceLeague);
  const normalizedOriginalTeam = normalizedRawTeamCode(originalTeam);
  const normalizedName = normalizeName(playerName);

  return season && normalizedSourceLeague && normalizedOriginalTeam && normalizedName
    ? `${season}:source:${normalizedSourceLeague}:${normalizedOriginalTeam}:${normalizedName}`
    : null;
}

function seasonBrefTeamKey(season, team, brefId, options = {}) {
  const normalizedTeam = normalizeTeamCodeForSeason(team, season, { sourceLeague: options.sourceLeague });

  return season && normalizedTeam && brefId ? `${season}:team:${normalizedTeam}:${brefId}` : null;
}

function seasonBrefSourceTeamKey(season, originalTeam, sourceLeague, brefId) {
  const normalizedSourceLeague = normalizeSourceLeague(sourceLeague);
  const normalizedOriginalTeam = normalizedRawTeamCode(originalTeam);

  return season && normalizedSourceLeague && normalizedOriginalTeam && brefId
    ? `${season}:source:${normalizedSourceLeague}:${normalizedOriginalTeam}:${brefId}`
    : null;
}

function addLookupValue(lookup, key, value) {
  if (!key) {
    return;
  }

  if (!lookup.has(key)) {
    lookup.set(key, []);
  }

  lookup.get(key).push(value);
}

function addLookupValues(lookup, keys, value) {
  for (const key of keys) {
    addLookupValue(lookup, key, value);
  }
}

function sourceLookupOptions(row) {
  return {
    originalTeam: row?.original_team,
    sourceLeague: sourceLeagueForRow(row),
  };
}

function seasonBrefLookupKeys(row, brefId) {
  const options = sourceLookupOptions(row);

  return Array.from(
    new Set(
      [
        seasonBrefSourceTeamKey(row?.season, options.originalTeam, options.sourceLeague, brefId),
        seasonBrefTeamKey(row?.season, row?.team, brefId, options),
      ].filter(Boolean),
    ),
  );
}

function seasonPlayerLookupKeys(row, playerName) {
  const options = sourceLookupOptions(row);

  return Array.from(
    new Set(
      [
        seasonPlayerSourceTeamKey(row?.season, options.originalTeam, options.sourceLeague, playerName),
        seasonPlayerTeamKey(row?.season, row?.team, playerName, options),
      ].filter(Boolean),
    ),
  );
}

function buildPerGameLookup(rows) {
  const byBref = new Map();
  const byName = new Map();

  for (const row of rows || []) {
    addLookupValues(byBref, seasonBrefLookupKeys(row, row.bref_id), row);
    addLookupValues(byName, seasonPlayerLookupKeys(row, row.player), row);
  }

  return { byBref, byName };
}

function chooseClosestByGames(candidates = [], gamesPlayed = 0) {
  if (candidates.length <= 1) {
    return candidates[0] || null;
  }

  const games = positiveInteger(gamesPlayed, 0);

  if (!games) {
    return candidates[0];
  }

  return [...candidates].sort(
    (a, b) => Math.abs((a.games_played || games) - games) - Math.abs((b.games_played || games) - games),
  )[0];
}

function perGameRowForSeason(record, season, perGameLookup) {
  const byBrefKeys = seasonBrefLookupKeys(season, record.bref_id);
  const byNameKeys = seasonPlayerLookupKeys(season, record.name);
  const candidates = [
    ...byBrefKeys.flatMap((key) => perGameLookup.byBref.get(key) || []),
    ...byNameKeys.flatMap((key) => perGameLookup.byName.get(key) || []),
  ];

  return chooseClosestByGames(candidates, season.games_played);
}

function per100RowForSeason(record, season, per100Lookup) {
  return perGameRowForSeason(record, season, per100Lookup);
}

function buildTeamPaceLookup(rows) {
  const lookup = new Map();

  for (const row of rows || []) {
    const team = normalizeTeamCodeForSeason(row.team, row.season, { sourceLeague: row.source_league });

    if (!row.season || !team || numberOrNull(row.pace) === null) {
      continue;
    }

    const sourceLeague = sourceLeagueForRow(row);
    const originalTeam = normalizedRawTeamCode(row.original_team);

    if (sourceLeague && originalTeam) {
      lookup.set(`${row.season}:source:${sourceLeague}:${originalTeam}`, row.pace);
    }

    if (!lookup.has(`${row.season}:team:${team}`)) {
      lookup.set(`${row.season}:team:${team}`, row.pace);
    }
  }

  return lookup;
}

function teamPaceForSeason(season, teamPaceLookup) {
  const sourceLeague = sourceLeagueForRow(season);
  const originalTeam = normalizedRawTeamCode(season?.original_team);
  const sourceKey =
    season?.season && sourceLeague && originalTeam
      ? `${season.season}:source:${sourceLeague}:${originalTeam}`
      : null;
  const team = normalizeTeamCodeForSeason(season?.team, season?.season, { sourceLeague });

  if (sourceKey && teamPaceLookup.has(sourceKey)) {
    return teamPaceLookup.get(sourceKey);
  }

  return season?.season && team ? teamPaceLookup.get(`${season.season}:team:${team}`) ?? null : null;
}

function careerSeasonKeys(careerSeasons = []) {
  const keys = new Set();

  for (const season of careerSeasons) {
    const sourceLeague = sourceLeagueForRow(season);
    const team = normalizeTeamCodeForSeason(season?.team, season?.season, { sourceLeague });

    if (season?.season && team) {
      keys.add(`${season.season}:${team}`);
    }
  }

  return keys;
}

function careerOverlapScore(record, existing) {
  const brefKeys = careerSeasonKeys(record.seasons);
  const existingKeys = careerSeasonKeys(existing?.career_seasons || []);
  let exactOverlap = 0;
  let seasonOverlap = 0;
  const existingSeasons = new Set((existing?.career_seasons || []).map((season) => season?.season).filter(Boolean));

  for (const key of brefKeys) {
    if (existingKeys.has(key)) {
      exactOverlap += 1;
    }

    const [season] = key.split(":");
    if (existingSeasons.has(season)) {
      seasonOverlap += 1;
    }
  }

  const exactName = normalizeName(existing?.name || `${existing?.first_name || ""} ${existing?.last_name || ""}`) === normalizeName(record.name);
  return exactOverlap * 10 + seasonOverlap * 3 + (exactName ? 1 : 0);
}

function addExistingCandidate(lookup, key, player) {
  if (!key) {
    return;
  }

  if (!lookup.has(key)) {
    lookup.set(key, []);
  }

  lookup.get(key).push(player);
}

function buildExistingLookup(players = []) {
  const byBref = new Map();
  const byName = new Map();

  for (const player of players) {
    if (player.bref_id) {
      byBref.set(String(player.bref_id), player);
    }

    const playerName = player.name || `${player.first_name || ""} ${player.last_name || ""}`;

    for (const alias of nameAliases(playerName)) {
      addExistingCandidate(byName, alias, player);
    }
  }

  return { byBref, byName };
}

function existingRecordForBrefRecord(record, existingLookup) {
  const byBref = existingLookup.byBref.get(record.bref_id);

  if (byBref) {
    return byBref;
  }

  const candidates = [];
  const seen = new Set();

  for (const alias of nameAliases(record.name)) {
    for (const candidate of existingLookup.byName.get(alias) || []) {
      const key = candidate.id || candidate.nba_stats_id || candidate.name;

      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(candidate);
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: careerOverlapScore(record, candidate),
    }))
    .sort((a, b) => b.score - a.score);

  if (!scored[0]?.score || (scored[1] && scored[0].score === scored[1].score)) {
    return null;
  }

  return scored[0].candidate;
}

function existingSeasonFor(recordSeason, existing) {
  const seasons = existing?.career_seasons || [];

  if (!seasons.length) {
    return null;
  }

  const exact = seasons.filter(
    (season) =>
      season?.season === recordSeason.season &&
      normalizeTeamCodeForSeason(season.team, season.season, { sourceLeague: sourceLeagueForRow(season) }) === recordSeason.team,
  );

  if (exact.length) {
    return chooseClosestByGames(exact, recordSeason.games_played);
  }

  const sameSeason = seasons.filter((season) => season?.season === recordSeason.season);
  return chooseClosestByGames(sameSeason, recordSeason.games_played);
}

function fallbackSeasonsFromExisting(existing) {
  if (!Array.isArray(existing?.career_seasons)) {
    return [];
  }

  const seen = new Set();
  const seasons = [];

  for (const rawSeason of existing.career_seasons) {
    const season = String(rawSeason?.season || "").trim();
    const translation = translateTeamForSeason(rawSeason?.original_team || rawSeason?.team, season, {
      sourceLeague: rawSeason?.source_league,
    });
    const team = translation.team;

    if (!season || !team) {
      continue;
    }

    const key = `${season}:${rawSeason?.source_league || ""}:${rawSeason?.original_team || team}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    seasons.push({
      season,
      team,
      ...teamTranslationFields(translation, rawSeason),
      games_played: positiveInteger(rawSeason.games_played, 0),
    });
  }

  return seasons.sort(
    (a, b) =>
      (seasonEndYear(a.season) || 0) - (seasonEndYear(b.season) || 0) ||
      a.team.localeCompare(b.team),
  );
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function assignNumberField(target, key, primary, fallback) {
  const primaryValue = numberOrNull(primary);
  const fallbackValue = numberOrNull(fallback);

  if (primaryValue !== null) {
    target[key] = primaryValue;
  } else if (fallbackValue !== null) {
    target[key] = fallbackValue;
  }
}

function estimatedPer100FromPerGame(perGame, mpg, teamPace) {
  const perGameValue = numberOrNull(perGame);
  const mpgValue = numberOrNull(mpg);
  const paceValue = numberOrNull(teamPace);

  if (perGameValue === null || mpgValue === null || paceValue === null || mpgValue <= 0 || paceValue <= 0) {
    return null;
  }

  const possessionsPerGame = (mpgValue / 48) * paceValue;

  return possessionsPerGame > 0 ? Number(((perGameValue / possessionsPerGame) * 100).toFixed(3)) : null;
}

function buildCareerSeason(record, rawSeason, perGameRow, per100Row, teamPace, existingSeason) {
  const translation = translateTeamForSeason(rawSeason.original_team || rawSeason.team, rawSeason.season, {
    sourceLeague: rawSeason.source_league,
  });
  const gamesPlayed =
    positiveInteger(perGameRow?.games_played, 0) ||
    positiveInteger(per100Row?.games_played, 0) ||
    positiveInteger(rawSeason.games_played, 0) ||
    positiveInteger(existingSeason?.games_played, 0);
  const gamesStarted =
    numberOrNull(perGameRow?.games_started) ??
    numberOrNull(existingSeason?.games_started) ??
    gamesPlayed;
  const season = {
    season: rawSeason.season,
    team: translation.team || rawSeason.team,
    ...teamTranslationFields(translation, rawSeason),
    era: seasonEra(rawSeason.season),
    games_played: gamesPlayed,
    games_started: Math.max(0, Math.floor(gamesStarted)),
  };

  assignNumberField(season, "games_won", null, existingSeason?.games_won);
  assignNumberField(season, "minutes", perGameRow?.minutes, existingSeason?.minutes);
  assignNumberField(season, "mpg", perGameRow?.mpg, existingSeason?.mpg);
  assignNumberField(season, "ppg", perGameRow?.ppg, existingSeason?.ppg);
  assignNumberField(season, "rpg", perGameRow?.rpg, existingSeason?.rpg);
  assignNumberField(season, "apg", perGameRow?.apg, existingSeason?.apg);
  assignNumberField(season, "spg", perGameRow?.spg, existingSeason?.spg);
  assignNumberField(season, "bpg", perGameRow?.bpg, existingSeason?.bpg);
  assignNumberField(season, "per100_pts", per100Row?.per100_pts, existingSeason?.per100_pts);
  assignNumberField(season, "per100_reb", per100Row?.per100_reb, existingSeason?.per100_reb);
  assignNumberField(season, "per100_ast", per100Row?.per100_ast, existingSeason?.per100_ast);
  assignNumberField(season, "team_pace", teamPace, existingSeason?.team_pace);

  const mpg = numberOrNull(season.mpg);
  const pace = numberOrNull(season.team_pace);
  const estimatedPer100Pts = estimatedPer100FromPerGame(season.ppg, mpg, pace);
  const estimatedPer100Reb = estimatedPer100FromPerGame(season.rpg, mpg, pace);
  const estimatedPer100Ast = estimatedPer100FromPerGame(season.apg, mpg, pace);

  assignNumberField(season, "per100_pts", season.per100_pts, estimatedPer100Pts);
  assignNumberField(season, "per100_reb", season.per100_reb, estimatedPer100Reb);
  assignNumberField(season, "per100_ast", season.per100_ast, estimatedPer100Ast);
  assignNumberField(season, "per100_ppg", per100Row?.per100_pts, existingSeason?.per100_ppg ?? estimatedPer100Pts);
  assignNumberField(season, "per100_rpg", per100Row?.per100_reb, existingSeason?.per100_rpg ?? estimatedPer100Reb);
  assignNumberField(season, "per100_apg", per100Row?.per100_ast, existingSeason?.per100_apg ?? estimatedPer100Ast);

  assignNumberField(season, "ts_pct", null, existingSeason?.ts_pct);
  assignNumberField(season, "ts_plus", null, existingSeason?.ts_plus);
  assignNumberField(season, "ows", null, existingSeason?.ows);
  assignNumberField(season, "dws", null, existingSeason?.dws);
  assignNumberField(season, "ws_per_48", null, existingSeason?.ws_per_48);

  if (!season.era) {
    delete season.era;
  }

  return compactObject(season);
}

function uniqueSorted(values, sorter = null) {
  const unique = Array.from(new Set(values.filter(Boolean)));
  return sorter ? unique.sort(sorter) : unique.sort();
}

function buildTeamEras(careerSeasons = []) {
  const seen = new Set();
  const rows = [];

  for (const season of careerSeasons) {
    if (!season.team || !season.era) {
      continue;
    }

    const key = `${season.team}:${season.era}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    rows.push({ team: season.team, era: season.era });
  }

  return rows.sort((a, b) => a.team.localeCompare(b.team) || eraSortValue(a.era) - eraSortValue(b.era));
}

function splitNameParts(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { first_name: "", last_name: "" };
  }

  if (parts.length === 1) {
    return { first_name: parts[0], last_name: "" };
  }

  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(" "),
  };
}

function basketballReferencePlayerUrl(brefId) {
  if (!brefId) {
    return null;
  }

  return `https://www.basketball-reference.com/players/${String(brefId)[0]}/${brefId}.html`;
}

function buildBrefPlayer(record, options) {
  const existing = options.existingRecord;
  const recordSeasons = record.seasons.length ? record.seasons : fallbackSeasonsFromExisting(existing);
  const careerSeasons = recordSeasons.map((season) => {
    const perGameRow = perGameRowForSeason(record, season, options.perGameLookup);
    const per100Row = per100RowForSeason(record, season, options.per100Lookup);
    const teamPace = teamPaceForSeason(season, options.teamPaceLookup);
    const existingSeason = existingSeasonFor(season, existing);

    return buildCareerSeason(record, season, perGameRow, per100Row, teamPace, existingSeason);
  });
  const seasonEndYears = careerSeasons.map((season) => seasonEndYear(season.season)).filter(Boolean);
  const lastSeasonEndYear = Math.max(0, ...seasonEndYears);
  const lastCareerSeason = careerSeasons[careerSeasons.length - 1] || null;
  const isActive = Boolean(existing?.active) || Boolean(options.latestEndYear && lastSeasonEndYear === options.latestEndYear);
  const nameParts = splitNameParts(record.name);

  return {
    id: `bref:${record.bref_id}`,
    bref_id: record.bref_id,
    balldontlie_id: existing?.balldontlie_id ?? null,
    nba_stats_id: existing?.nba_stats_id ?? null,
    ...nameParts,
    name: record.name,
    positions: record.positions,
    primary_position: record.primary_position || record.positions[0],
    current_team: existing?.current_team || (isActive ? lastCareerSeason?.team || null : null),
    teams: uniqueSorted(careerSeasons.map((season) => season.team)),
    eras: uniqueSorted(careerSeasons.map((season) => season.era), (a, b) => eraSortValue(a) - eraSortValue(b)),
    team_eras: buildTeamEras(careerSeasons),
    career_seasons: careerSeasons,
    draft_year: existing?.draft_year ?? null,
    active: isActive,
    accolades: existing?.accolades || {},
    awards_raw: Array.isArray(existing?.awards_raw) ? existing.awards_raw : [],
    source: compactObject({
      basketball_reference_player: basketballReferencePlayerUrl(record.bref_id),
      basketball_reference_per_game: BREF_PER_GAME_URL_TEMPLATE,
      basketball_reference_per_100: BREF_PER_100_URL_TEMPLATE,
      basketball_reference_advanced: BREF_ADVANCED_URL_TEMPLATE,
      basketball_reference_team_advanced: BREF_TEAM_ADVANCED_URL_TEMPLATE,
      nba_stats_awards: existing?.source?.nba_stats_awards ?? null,
      nba_stats_career: existing?.source?.nba_stats_career ?? null,
      nba_stats_game_finder: existing?.source?.nba_stats_game_finder ?? null,
    }),
  };
}

function sliceWindow(values, offset, limit) {
  const start = Math.max(0, offset || 0);
  const end = limit ? start + limit : undefined;
  return values.slice(start, end);
}

async function confirmOutputReplacement({ args, existingCount, outputCount, outputPath }) {
  if (!existingCount || flagEnabled(args.yes) || flagEnabled(args.confirmReplace) || flagEnabled(process.env.SEED_CONFIRM_REPLACE)) {
    return true;
  }

  const warning =
    `This B-Ref seed will replace ${existingCount} existing B-Ref output records with ${outputCount} rebuilt records at ${outputPath}.`;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${warning} Pass --replace --yes to confirm.`);
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

function logCacheStats(label, stats) {
  console.log(
    `${label}: fetched ${stats.fetchedSeasons}, cache hits ${stats.cacheHits}, unavailable ${stats.unavailableSeasons}, missing cache ${stats.missingCache}.`,
  );
}

async function main(argv = process.argv) {
  console.time("seed:bref total");
  const args = parseArgs(argv);
  const outputPath = resolvePath(args.output, OUTPUT_PATH);
  const fallbackPlayersPath = resolvePath(
    args.fallbackPlayers || args.existingPlayers || args.input,
    FALLBACK_PLAYERS_PATH,
  );
  const brefPositionsPath = resolvePath(args.brefPositions, BREF_POSITIONS_PATH);
  const perGameCachePath = resolvePath(args.perGameCache, BREF_PER_GAME_CACHE_PATH);
  const per100CachePath = resolvePath(args.per100Cache, BREF_PER_100_CACHE_PATH);
  const advancedCachePath = resolvePath(args.advancedCache, BREF_ADVANCED_CACHE_PATH);
  const teamAdvancedCachePath = resolvePath(args.teamAdvancedCache, BREF_TEAM_ADVANCED_CACHE_PATH);
  const statTitleCachePath = resolvePath(args.statTitleCache, STAT_TITLE_CACHE_PATH);
  const threePointContestCachePath = resolvePath(args.threePointContestCache, THREE_POINT_CONTEST_CACHE_PATH);
  const replace = flagEnabled(args.replace) || flagEnabled(args.rebuild) || flagEnabled(args.deleteFirst);
  const dryRun = flagEnabled(args.dryRun);
  const refreshPerGame = flagEnabled(args.refreshPerGame) || flagEnabled(args.refreshPerGameCache);
  const refreshPer100 = flagEnabled(args.refreshPer100) || flagEnabled(args.refreshPer100Cache);
  const refreshAdvanced = flagEnabled(args.refreshAdvanced) || flagEnabled(args.refreshAdvancedCache);
  const refreshTeamAdvanced = flagEnabled(args.refreshTeamAdvanced) || flagEnabled(args.refreshTeamAdvancedCache);
  const skipFetch = flagEnabled(args.skipFetch) || flagEnabled(args.cacheOnly);
  const offset = positiveInteger(args.offset || process.env.SEED_OFFSET, 0);
  const limit = args.limit ? positiveInteger(args.limit) : null;
  const delayMs = Math.max(4000, positiveInteger(args.delayMs || process.env.BREF_SEED_DELAY_MS, 4000));
  const retries = positiveInteger(args.retries || process.env.BREF_SEED_RETRIES, 3);
  const timeoutMs = positiveInteger(args.timeoutMs || process.env.BREF_SEED_TIMEOUT_MS, 30000);
  const saveEvery = positiveInteger(args.saveEvery || process.env.BREF_SEED_SAVE_EVERY, 0);

  if (!replace && !dryRun) {
    throw new Error("B-Ref seed is a rebuild mode. Pass --replace --yes to rewrite players_accolades_bref.json.");
  }

  console.time("seed:bref read inputs");
  const [
    existingBrefOutput,
    fallbackPlayers,
    rawBrefPositions,
    rawPerGameCache,
    rawPer100Cache,
    rawAdvancedCache,
    rawTeamAdvancedCache,
    statTitleCache,
    threePointContestCache,
  ] = await Promise.all([
    readJsonIfExists(outputPath),
    readJsonIfExists(fallbackPlayersPath),
    readJsonIfExists(brefPositionsPath),
    readJsonIfExists(perGameCachePath),
    readJsonIfExists(per100CachePath),
    readJsonIfExists(advancedCachePath),
    readJsonIfExists(teamAdvancedCachePath),
    readJsonIfExists(statTitleCachePath),
    readJsonIfExists(threePointContestCachePath),
  ]);
  console.timeEnd("seed:bref read inputs");

  if (!rawBrefPositions) {
    throw new Error(`Missing B-Ref positions cache at ${brefPositionsPath}. Generate or restore data/bref_positions.json first.`);
  }

  const existingOutputRoster = Array.isArray(existingBrefOutput) ? existingBrefOutput : [];
  const existingRoster = Array.isArray(fallbackPlayers) ? fallbackPlayers : [];
  const allBrefRecords = normalizeBrefRecords(rawBrefPositions);
  const selectedRecords = sliceWindow(allBrefRecords, offset, limit);
  const seasons = seasonLabelsFromBrefRecords(selectedRecords);
  const latestEndYear = Math.max(0, ...seasonLabelsFromBrefRecords(allBrefRecords).map(seasonEndYear).filter(Boolean));
  const recordsWithoutCachedSeasons = selectedRecords.filter((record) => !record.seasons.length).length;

  console.log(
    `Selected ${selectedRecords.length}/${allBrefRecords.length} B-Ref players and ${seasons.length} seasons for rebuild${limit ? ` (offset=${offset}, limit=${limit})` : ""}.`,
  );
  console.log(
    `Writing B-Ref output to ${outputPath}; using ${existingRoster.length} players from ${fallbackPlayersPath} as award/accolade fallback.`,
  );
  if (recordsWithoutCachedSeasons) {
    console.log(
      `${recordsWithoutCachedSeasons} selected B-Ref players have no cached B-Ref seasons; existing matched career seasons will be used as fallback when available.`,
    );
  }
  console.log(
    `Mode: replace=${replace ? "on" : "off"}, dryRun=${dryRun ? "on" : "off"}, skipFetch=${skipFetch ? "on" : "off"}, saveEvery=${saveEvery || "final-only"}.`,
  );

  const confirmed = await confirmOutputReplacement({
    args,
    existingCount: existingOutputRoster.length,
    outputCount: selectedRecords.length,
    outputPath,
  });

  if (!confirmed) {
    console.log("B-Ref seed canceled.");
    process.exitCode = 1;
    return;
  }

  console.time("seed:bref fetch per-game");
  const perGameResult = await populateSeasonCache({
    cache: rawPerGameCache,
    cachePath: perGameCachePath,
    cacheLabel: "per-game",
    label: "Basketball Reference per-game",
    seasons,
    urlTemplate: BREF_PER_GAME_URL_TEMPLATE,
    parseRows: parsePerGameRows,
    refresh: refreshPerGame,
    skipFetch,
    dryRun,
    delayMs,
    retries,
    timeoutMs,
    saveEvery,
  });
  console.timeEnd("seed:bref fetch per-game");

  console.time("seed:bref fetch per-100");
  const per100Result = await populateSeasonCache({
    cache: rawPer100Cache,
    cachePath: per100CachePath,
    cacheLabel: "per-100",
    label: "Basketball Reference per-100",
    seasons,
    urlTemplate: BREF_PER_100_URL_TEMPLATE,
    parseRows: parsePer100Rows,
    refresh: refreshPer100,
    skipFetch,
    dryRun,
    delayMs,
    retries,
    timeoutMs,
    saveEvery,
  });
  console.timeEnd("seed:bref fetch per-100");

  console.time("seed:bref fetch advanced");
  const advancedResult = await populateSeasonCache({
    cache: rawAdvancedCache,
    cachePath: advancedCachePath,
    cacheLabel: "advanced",
    label: "Basketball Reference advanced",
    seasons,
    urlTemplate: BREF_ADVANCED_URL_TEMPLATE,
    parseRows: parseAdvancedRows,
    refresh: refreshAdvanced,
    skipFetch,
    dryRun,
    delayMs,
    retries,
    timeoutMs,
    saveEvery,
  });
  console.timeEnd("seed:bref fetch advanced");

  console.time("seed:bref fetch team advanced");
  const teamAdvancedResult = await populateSeasonCache({
    cache: rawTeamAdvancedCache,
    cachePath: teamAdvancedCachePath,
    cacheLabel: "team-advanced",
    label: "Basketball Reference team advanced",
    seasons,
    urlTemplate: BREF_TEAM_ADVANCED_URL_TEMPLATE,
    parseRows: parseTeamAdvancedRows,
    refresh: refreshTeamAdvanced,
    skipFetch,
    dryRun,
    delayMs,
    retries,
    timeoutMs,
    saveEvery,
  });
  console.timeEnd("seed:bref fetch team advanced");

  logCacheStats("Per-game cache", perGameResult.stats);
  logCacheStats("Per-100 cache", per100Result.stats);
  logCacheStats("Advanced cache", advancedResult.stats);
  logCacheStats("Team advanced cache", teamAdvancedResult.stats);

  const perGameRows = seasonRowsFromCache(perGameResult.cache, seasons);
  const per100Rows = seasonRowsFromCache(per100Result.cache, seasons);
  const advancedRows = seasonRowsFromCache(advancedResult.cache, seasons);
  const teamAdvancedRows = seasonRowsFromCache(teamAdvancedResult.cache, seasons);
  const perGameLookup = buildPerGameLookup(perGameRows);
  const per100Lookup = buildPerGameLookup(per100Rows);
  const advancedLookup = buildAdvancedLookup(advancedRows);
  const teamPaceLookup = buildTeamPaceLookup(teamAdvancedRows);
  const existingLookup = buildExistingLookup(existingRoster);

  let matchedExisting = 0;
  let unmatchedExisting = 0;
  let updatedAdvancedSeasons = 0;

  console.time("seed:bref build players");
  const rebuiltPlayers = selectedRecords.map((record) => {
    const existingRecord = existingRecordForBrefRecord(record, existingLookup);

    if (existingRecord) {
      matchedExisting += 1;
    } else {
      unmatchedExisting += 1;
    }

    const basePlayer = buildBrefPlayer(record, {
      existingRecord,
      perGameLookup,
      per100Lookup,
      teamPaceLookup,
      latestEndYear,
    });
    const advancedResultForPlayer = updatePlayerAdvancedStats(basePlayer, advancedLookup, { force: true });
    updatedAdvancedSeasons += advancedResultForPlayer.updatedSeasons;

    return advancedResultForPlayer.player;
  });
  console.timeEnd("seed:bref build players");

  console.log(
    `Matched ${matchedExisting} B-Ref players to existing rows for NBA award/accolade fallback; ${unmatchedExisting} had no existing fallback.`,
  );
  console.log(`Applied/finalized TS% and WS/48 on ${updatedAdvancedSeasons} season rows.`);

  console.time("seed:bref legacy/classic pipeline");
  const outputPlayers = applyLegacyScoringPipeline(rebuiltPlayers, {
    brefPositions: rawBrefPositions,
    brefPerGameCache: perGameResult.cache,
    statTitleCache,
    threePointContestCache,
  });
  console.timeEnd("seed:bref legacy/classic pipeline");

  const abaSummary = summarizeAbaTranslationsFromPlayers(outputPlayers);
  console.log(
    `ABA team translation: ${abaSummary.nbaFranchiseSeasons} seasons mapped to NBA-continuity franchises; ` +
      `${abaSummary.abaTeamSeasons} seasons grouped into ABA Team.`,
  );
  if (abaSummary.unknownAbaTeamCodes.length) {
    console.warn(`Unknown ABA-era team codes not mapped: ${abaSummary.unknownAbaTeamCodes.join(", ")}`);
  }

  if (dryRun) {
    console.log(`Dry run enabled; would write ${outputPlayers.length} players to ${outputPath}.`);
  } else {
    console.time("seed:bref write");
    await writeJsonAtomically(perGameCachePath, { ...perGameResult.cache, fetched_at: new Date().toISOString() });
    await writeJsonAtomically(per100CachePath, { ...per100Result.cache, fetched_at: new Date().toISOString() });
    await writeJsonAtomically(advancedCachePath, { ...advancedResult.cache, fetched_at: new Date().toISOString() });
    await writeJsonAtomically(teamAdvancedCachePath, { ...teamAdvancedResult.cache, fetched_at: new Date().toISOString() });
    await writeJsonAtomically(outputPath, outputPlayers);
    console.timeEnd("seed:bref write");
    console.log(`Rebuilt ${outputPlayers.length} B-Ref-primary players at ${outputPath}.`);
  }

  console.timeEnd("seed:bref total");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(safeErrorMessage(error));
    process.exitCode = 1;
  });
}

module.exports = {
  buildPerGameLookup,
  buildTeamPaceLookup,
  main,
  normalizeBrefRecords,
  parsePerGameRows,
  parsePer100Rows,
  parseTeamAdvancedRows,
};
