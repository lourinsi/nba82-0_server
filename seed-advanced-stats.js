const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");
const { seasonEndYear } = require("./seasonEras");
const { normalizeTeamCodeForSeason } = require("./teamFranchises");
require("dotenv").config();

const PLAYERS_PATH = path.join(__dirname, "data", "players_accolades.json");
const ADVANCED_CACHE_PATH = path.join(__dirname, "data", "bref_advanced_stats_cache.json");
const BREF_ADVANCED_URL_TEMPLATE = "https://www.basketball-reference.com/leagues/NBA_{year}_advanced.html";
const ADVANCED_STAT_KEYS = ["ts_pct", "ws_per_48"];
const VALID_MODES = new Set(["missing", "active", "all"]);

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
  await fs.rename(tempPath, filePath);
}

function resolvePath(value, fallbackPath) {
  if (!value || value === true) {
    return fallbackPath;
  }

  return path.resolve(process.cwd(), String(value));
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&[a-z]+;|&#\d+;|&#x[\da-f]+;/gi, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
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

function seasonLabelFromEndYear(endYear) {
  return `${endYear - 1}-${String(endYear).slice(-2)}`;
}

function parseAdvancedRows(html, season) {
  const table = extractTableHtml(html, "advanced");

  if (!table) {
    return [];
  }

  const rows = [];

  for (const cells of parseTableRows(table)) {
    const playerCell = cells.player || cells.name_display;
    const rawTeam = cells.team_id?.text || cells.team_name_abbr?.text;
    const team = normalizeTeamCodeForSeason(rawTeam, season);

    if (!playerCell?.text || !team || isAggregateTeam(rawTeam)) {
      continue;
    }

    const tsPct = numberOrNull(cells.ts_pct?.text);
    const wsPer48 = numberOrNull(cells.ws_per_48?.text);

    if (tsPct === null && wsPer48 === null) {
      continue;
    }

    rows.push({
      season,
      team,
      player: playerCell.text.replace(/\*/g, "").trim(),
      bref_id: brefPlayerIdFromHtml(playerCell.html),
      games_played: positiveInteger(cells.g?.text || cells.games?.text, 0),
      ts_pct: tsPct,
      ws_per_48: wsPer48,
    });
  }

  return rows.sort(
    (a, b) =>
      a.season.localeCompare(b.season) ||
      a.team.localeCompare(b.team) ||
      normalizeName(a.player).localeCompare(normalizeName(b.player)),
  );
}

async function fetchAdvancedRowsForSeason(season, options) {
  const endYear = seasonEndYear(season);

  if (!endYear) {
    return [];
  }

  const url = BREF_ADVANCED_URL_TEMPLATE.replace("{year}", String(endYear));
  const response = await getWithRetry({
    label: `Basketball Reference advanced ${season}`,
    retries: options.retries,
    delayMs: options.delayMs,
    retryStatuses: [403, 429, 500, 502, 503, 504],
    request: () =>
      axios.get(url, {
        headers: BREF_HEADERS,
        timeout: options.timeoutMs,
      }),
  });

  return parseAdvancedRows(response.data, season);
}

function careerSeasonKey(season, team, playerName) {
  const normalizedTeam = normalizeTeamCodeForSeason(team, season);
  const normalizedPlayer = normalizeName(playerName);

  return season && normalizedTeam && normalizedPlayer ? `${season}:${normalizedTeam}:${normalizedPlayer}` : null;
}

function buildAdvancedLookup(rows) {
  const lookup = new Map();

  for (const row of rows || []) {
    const key = careerSeasonKey(row.season, row.team, row.player);

    if (!key) {
      continue;
    }

    if (!lookup.has(key)) {
      lookup.set(key, []);
    }

    lookup.get(key).push(row);
  }

  return lookup;
}

function chooseAdvancedRow(candidates = [], season) {
  if (candidates.length <= 1) {
    return candidates[0] || null;
  }

  const gamesPlayed = positiveInteger(season?.games_played, 0);

  if (!gamesPlayed) {
    return candidates[0];
  }

  return [...candidates].sort(
    (a, b) => Math.abs((a.games_played || gamesPlayed) - gamesPlayed) - Math.abs((b.games_played || gamesPlayed) - gamesPlayed),
  )[0];
}

function seasonNeedsAdvancedStats(season) {
  return ADVANCED_STAT_KEYS.some((key) => numberOrNull(season?.[key]) === null);
}

function playerMatchesMode(player, mode) {
  if (!Array.isArray(player.career_seasons) || player.career_seasons.length === 0) {
    return false;
  }

  if (mode === "active") {
    return Boolean(player.active || player.current_team);
  }

  if (mode === "all") {
    return true;
  }

  return player.career_seasons.some(seasonNeedsAdvancedStats);
}

function selectedSeasonLabels(players, force) {
  const seasons = new Set();

  for (const player of players) {
    for (const season of player.career_seasons || []) {
      if (!season?.season) {
        continue;
      }

      if (force || seasonNeedsAdvancedStats(season)) {
        seasons.add(String(season.season));
      }
    }
  }

  return Array.from(seasons).sort((a, b) => (seasonEndYear(a) || 0) - (seasonEndYear(b) || 0));
}

function updatePlayerAdvancedStats(player, advancedLookup, options = {}) {
  const force = Boolean(options.force);
  const unavailableSeasons = options.unavailableSeasons || new Set();
  const issues = [];
  let updatedSeasons = 0;

  const careerSeasons = (player.career_seasons || []).map((season) => {
    if (!force && !seasonNeedsAdvancedStats(season)) {
      return season;
    }

    const key = careerSeasonKey(season?.season, season?.team, player.name || `${player.first_name || ""} ${player.last_name || ""}`);
    const advancedRow = chooseAdvancedRow(key ? advancedLookup.get(key) : [], season);

    if (!advancedRow) {
      if (unavailableSeasons.has(String(season?.season || ""))) {
        return season;
      }

      issues.push({
        player: player.name || player.id || "Unknown player",
        season: season?.season || null,
        team: season?.team || null,
        message: "No matching Basketball Reference advanced row found.",
      });
      return season;
    }

    let changed = false;
    const nextSeason = { ...season };

    for (const keyName of ADVANCED_STAT_KEYS) {
      const value = numberOrNull(advancedRow[keyName]);

      if (value === null) {
        continue;
      }

      if (force || numberOrNull(nextSeason[keyName]) === null) {
        if (nextSeason[keyName] !== value) {
          nextSeason[keyName] = value;
          changed = true;
        }
      }
    }

    if (changed) {
      updatedSeasons += 1;
    }

    return changed ? nextSeason : season;
  });

  return {
    issues,
    changed: updatedSeasons > 0,
    player: updatedSeasons > 0 ? { ...player, career_seasons: careerSeasons } : player,
    updatedSeasons,
  };
}

function sliceWindow(values, offset, limit) {
  const start = Math.max(0, offset || 0);
  const end = limit ? start + limit : undefined;
  return values.slice(start, end);
}

function mergeUpdatedPlayers(players, updatedById) {
  if (!updatedById.size) {
    return players;
  }

  return players.map((player) => updatedById.get(player.id) || player);
}

async function main() {
  console.time("advanced-stats: total");
  const args = parseArgs(process.argv);
  const playersPath = resolvePath(args.players || args.input, PLAYERS_PATH);
  const outputPath = resolvePath(args.output, playersPath);
  const cachePath = resolvePath(args.cache, ADVANCED_CACHE_PATH);
  const dryRun = flagEnabled(args.dryRun);
  const force = flagEnabled(args.force);
  const refreshCache = flagEnabled(args.refreshCache);
  const mode = String(args.mode || "missing").toLowerCase();
  const delayMs = Math.max(4000, positiveInteger(args.delayMs || process.env.BREF_ADVANCED_DELAY_MS, 4000));
  const retries = positiveInteger(args.retries || process.env.BREF_ADVANCED_RETRIES, 3);
  const timeoutMs = positiveInteger(args.timeoutMs || process.env.BREF_ADVANCED_TIMEOUT_MS, 30000);
  const saveEvery = positiveInteger(args.saveEvery || process.env.ADVANCED_STATS_SAVE_EVERY, 0);
  const offset = positiveInteger(args.offset, 0);
  const limit = args.limit ? positiveInteger(args.limit) : null;

  if (!VALID_MODES.has(mode)) {
    throw new Error(`Unsupported advanced stat mode "${mode}". Use missing, active, or all.`);
  }

  console.time("advanced-stats: read");
  const [players, rawCache] = await Promise.all([
    readJsonIfExists(playersPath),
    readJsonIfExists(cachePath),
  ]);
  console.timeEnd("advanced-stats: read");

  if (!Array.isArray(players)) {
    throw new Error("Player storage must be a JSON array.");
  }

  const cache = rawCache?.seasons ? rawCache : { fetched_at: null, seasons: {} };
  cache.seasons ||= {};

  console.time("advanced-stats: select");
  const candidates = players.filter((player) => playerMatchesMode(player, mode));
  const selected = sliceWindow(candidates, offset, limit);
  const seasons = selectedSeasonLabels(selected, force);
  console.timeEnd("advanced-stats: select");

  console.log(
    `Selected ${selected.length}/${candidates.length} players and ${seasons.length} seasons for B-Ref advanced stat seed (mode=${mode}, saveEvery=${saveEvery || "final-only"}).`,
  );

  let fetchedSeasons = 0;
  let cacheHits = 0;
  let unavailableSeasonCount = 0;
  let lastFetchAt = 0;
  const unavailableSeasons = new Set();

  console.time("advanced-stats: fetch seasons");
  for (const [index, season] of seasons.entries()) {
    const cachedSeason = cache.seasons[season];

    if (!refreshCache && Array.isArray(cachedSeason?.rows)) {
      cacheHits += 1;
      if (cachedSeason.unavailable) {
        unavailableSeasons.add(season);
        unavailableSeasonCount += 1;
      }
      continue;
    }

    await waitForRateLimit(lastFetchAt, delayMs);
    try {
      const rows = await fetchAdvancedRowsForSeason(season, { delayMs, retries, timeoutMs });
      lastFetchAt = Date.now();
      cache.seasons[season] = {
        fetched_at: new Date().toISOString(),
        source: BREF_ADVANCED_URL_TEMPLATE.replace("{year}", String(seasonEndYear(season))),
        rows,
      };
      fetchedSeasons += 1;
      console.log(`[${index + 1}/${seasons.length}] ${season}: fetched ${rows.length} advanced rows.`);
    } catch (error) {
      lastFetchAt = Date.now();

      if (httpStatus(error) !== 404) {
        throw error;
      }

      cache.seasons[season] = {
        fetched_at: new Date().toISOString(),
        source: BREF_ADVANCED_URL_TEMPLATE.replace("{year}", String(seasonEndYear(season))),
        unavailable: true,
        reason: "not-found",
        rows: [],
      };
      unavailableSeasons.add(season);
      unavailableSeasonCount += 1;
      console.warn(`[${index + 1}/${seasons.length}] ${season}: B-Ref advanced page not found; skipping.`);
    }
  }
  console.timeEnd("advanced-stats: fetch seasons");

  const advancedRows = seasons.flatMap((season) => cache.seasons[season]?.rows || []);
  const advancedLookup = buildAdvancedLookup(advancedRows);
  const updatedById = new Map();
  const issues = [];
  let changedPlayers = 0;
  let updatedSeasons = 0;

  console.time("advanced-stats: apply");
  for (const [index, player] of selected.entries()) {
    const result = updatePlayerAdvancedStats(player, advancedLookup, { force, unavailableSeasons });

    issues.push(...result.issues);

    if (result.changed) {
      changedPlayers += 1;
      updatedSeasons += result.updatedSeasons;
      updatedById.set(player.id, result.player);
    }

    console.log(`[${index + 1}/${selected.length}] ${player.name}: ${result.updatedSeasons} seasons updated.`);

    if (!dryRun && saveEvery && (index + 1) % saveEvery === 0) {
      await writeJsonAtomically(cachePath, { ...cache, fetched_at: new Date().toISOString() });
      await writeJsonAtomically(outputPath, mergeUpdatedPlayers(players, updatedById));
      console.log(`Checkpoint saved after ${index + 1} players.`);
    }
  }
  console.timeEnd("advanced-stats: apply");

  if (dryRun) {
    console.log("Dry run enabled; no files were written.");
  } else {
    console.time("advanced-stats: write");
    await writeJsonAtomically(cachePath, { ...cache, fetched_at: new Date().toISOString() });
    await writeJsonAtomically(outputPath, mergeUpdatedPlayers(players, updatedById));
    console.timeEnd("advanced-stats: write");
  }

  console.log(`Fetched ${fetchedSeasons} B-Ref season pages; used ${cacheHits} cached seasons; skipped ${unavailableSeasonCount} unavailable seasons.`);
  console.log(`Updated ${updatedSeasons} career season rows across ${changedPlayers} players.`);
  if (issues.length) {
    console.warn(`Encountered ${issues.length} missing advanced stat matches.`);
    for (const issue of issues.slice(0, 20)) {
      console.warn(`${issue.player} ${issue.season || "no-season"} ${issue.team || "no-team"}: ${issue.message}`);
    }
    if (issues.length > 20) {
      console.warn(`...and ${issues.length - 20} more issues.`);
    }
  }
  if (!dryRun) {
    console.log(`Updated player storage at ${outputPath}`);
    console.log(`Updated B-Ref advanced cache at ${cachePath}`);
  }
  console.timeEnd("advanced-stats: total");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  buildAdvancedLookup,
  parseAdvancedRows,
  updatePlayerAdvancedStats,
};
