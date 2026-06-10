const fs = require("fs/promises");
const path = require("path");

const PLAYERS_PATH = path.join(__dirname, "data", "players_accolades.json");
const BREF_POSITIONS_PATH = path.join(__dirname, "data", "bref_positions.json");
const POSITION_KEYS = ["PG", "SG", "SF", "PF", "C"];
const VALID_POSITIONS = new Set(POSITION_KEYS);
const DEFAULT_PLAYER_ARRAY_KEYS = ["players", "data", "records"];
const DEFAULT_SLOT_KEYS = [
  "active_roster_slot",
  "activeRosterSlot",
  "roster_slot",
  "rosterSlot",
  "lineup_slot",
  "lineupSlot",
  "assigned_position",
  "assignedPosition",
  "assigned_slot",
  "assignedSlot",
  "layout_position",
  "layoutPosition",
  "team_layout_position",
  "teamLayoutPosition",
  "slot_position",
  "slotPosition",
  "game_position",
  "gamePosition",
  "selected_position",
  "selectedPosition",
  "active_slot",
  "activeSlot",
];
const DEFAULT_GOAT_SCORE_KEYS = [
  "goat_score",
  "goatScore",
  "media_score",
  "mediaScore",
];

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

function splitCsv(value) {
  if (!value || value === true) {
    return [];
  }

  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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

function normalizePosition(value) {
  const position = String(value || "").match(/\b(PG|SG|SF|PF|C)\b/i)?.[1]?.toUpperCase();
  return VALID_POSITIONS.has(position) ? position : null;
}

function positionFromBrefRecord(rawRecord) {
  if (Array.isArray(rawRecord)) {
    for (const value of rawRecord) {
      const position = positionFromBrefRecord(value);

      if (position) {
        return position;
      }
    }

    return null;
  }

  if (rawRecord && typeof rawRecord === "object") {
    return (
      normalizePosition(rawRecord.primary_position) ||
      normalizePosition(rawRecord.primaryPosition) ||
      normalizePosition(rawRecord.position) ||
      positionFromBrefRecord(rawRecord.positions)
    );
  }

  return normalizePosition(rawRecord);
}

function setIfMissing(map, key, value) {
  if (key && !map.has(key)) {
    map.set(key, value);
  }
}

function addIdKeys(lookup, value, position, prefix = null) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  const raw = String(value);
  setIfMissing(lookup.byId, raw, position);

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    setIfMissing(lookup.byId, String(numeric), position);

    if (prefix) {
      setIfMissing(lookup.byId, `${prefix}:${numeric}`, position);
      setIfMissing(lookup.byId, `${prefix}-${numeric}`, position);
    }
  }
}

function nameFromBrefRecord(rawRecord) {
  if (!rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) {
    return null;
  }

  return (
    rawRecord.name ||
    rawRecord.player ||
    rawRecord.player_name ||
    rawRecord.playerName ||
    rawRecord.full_name ||
    rawRecord.fullName ||
    rawRecord.display_name ||
    rawRecord.displayName ||
    null
  );
}

function addBrefLookupEntry(lookup, name, rawRecord) {
  const position = positionFromBrefRecord(rawRecord);

  if (!position) {
    return;
  }

  if (name) {
    setIfMissing(lookup.exact, String(name), position);
    setIfMissing(lookup.normalized, normalizeName(name), position);
  }

  if (!rawRecord || typeof rawRecord !== "object" || Array.isArray(rawRecord)) {
    return;
  }

  addIdKeys(lookup, rawRecord.id, position);
  addIdKeys(lookup, rawRecord.nba_stats_id || rawRecord.nbaStatsId, position, "nba");
  addIdKeys(lookup, rawRecord.person_id || rawRecord.personId || rawRecord.player_id || rawRecord.playerId, position, "nba");
  addIdKeys(lookup, rawRecord.balldontlie_id || rawRecord.balldontlieId, position, "bdl");

  const recordName = nameFromBrefRecord(rawRecord);
  if (recordName && recordName !== name) {
    setIfMissing(lookup.exact, String(recordName), position);
    setIfMissing(lookup.normalized, normalizeName(recordName), position);
  }
}

function buildBrefLookup(brefPositions) {
  const lookup = {
    byId: new Map(),
    exact: new Map(),
    normalized: new Map(),
  };

  if (Array.isArray(brefPositions)) {
    for (const rawRecord of brefPositions) {
      addBrefLookupEntry(lookup, nameFromBrefRecord(rawRecord), rawRecord);
    }

    return lookup;
  }

  for (const [name, rawRecord] of Object.entries(brefPositions || {})) {
    addBrefLookupEntry(lookup, name, rawRecord);
  }

  return lookup;
}

function isBrefLookup(value) {
  return value?.byId instanceof Map && value?.exact instanceof Map && value?.normalized instanceof Map;
}

function lookupPositionById(player, brefLookup) {
  const candidates = [
    player?.id,
    player?.nba_stats_id ? `nba:${Number(player.nba_stats_id)}` : null,
    player?.nba_stats_id ? `nba-${Number(player.nba_stats_id)}` : null,
    player?.nba_stats_id ? Number(player.nba_stats_id) : null,
    player?.balldontlie_id ? `bdl:${Number(player.balldontlie_id)}` : null,
    player?.balldontlie_id ? `bdl-${Number(player.balldontlie_id)}` : null,
    player?.balldontlie_id ? Number(player.balldontlie_id) : null,
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") {
      continue;
    }

    const key = String(candidate);
    if (brefLookup.byId.has(key)) {
      return brefLookup.byId.get(key);
    }
  }

  return null;
}

function lookupPositionByName(player, brefLookup) {
  const name = player?.name;
  const fullName = `${player?.first_name || ""} ${player?.last_name || ""}`.trim();

  if (name && brefLookup.exact.has(name)) {
    return brefLookup.exact.get(name);
  }
  if (fullName && fullName !== name && brefLookup.exact.has(fullName)) {
    return brefLookup.exact.get(fullName);
  }

  const normalizedName = normalizeName(name);
  if (normalizedName && brefLookup.normalized.has(normalizedName)) {
    return brefLookup.normalized.get(normalizedName);
  }

  const normalizedFullName = normalizeName(fullName);
  if (normalizedFullName && normalizedFullName !== normalizedName && brefLookup.normalized.has(normalizedFullName)) {
    return brefLookup.normalized.get(normalizedFullName);
  }

  return null;
}

function resolveTruePosition(player, brefLookup) {
  const lookup = isBrefLookup(brefLookup) ? brefLookup : buildBrefLookup(brefLookup);
  const brefPosition = lookupPositionById(player, lookup) || lookupPositionByName(player, lookup);

  if (brefPosition) {
    return {
      position: brefPosition,
      source: "bref_positions.json",
    };
  }

  const fallbackPosition =
    normalizePosition(player.primary_position) ||
    normalizePosition(player.primaryPosition) ||
    normalizePosition(player.position);

  return {
    position: fallbackPosition,
    source: fallbackPosition ? "player.primary_position" : "missing",
  };
}

function valueAtPath(source, keyPath) {
  if (!keyPath || !source || typeof source !== "object") {
    return undefined;
  }

  return String(keyPath)
    .split(".")
    .reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), source);
}

function positionFromSlotValue(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const position = positionFromSlotValue(entry);

      if (position) {
        return position;
      }
    }

    return null;
  }

  if (value && typeof value === "object") {
    return (
      normalizePosition(value.position) ||
      normalizePosition(value.slot) ||
      normalizePosition(value.name) ||
      normalizePosition(value.label) ||
      normalizePosition(value.key) ||
      normalizePosition(value.id)
    );
  }

  return normalizePosition(value);
}

function resolveAssignedSlotPosition(player, slotKeys) {
  for (const key of slotKeys) {
    const value = valueAtPath(player, key);

    if (value === undefined || value === null || value === "") {
      continue;
    }

    const position = positionFromSlotValue(value);

    if (position) {
      return position;
    }
  }

  return null;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function resolveGoatScore(player, goatScoreKeys) {
  for (const key of goatScoreKeys) {
    const value = valueAtPath(player, key);
    const score = Number(value);

    if (Number.isFinite(score)) {
      return score;
    }
  }

  return 0;
}

function multiplierForLegacyPoints(legacyPoints) {
  return legacyPoints < 100 ? 1.15 : 1.1;
}

function calculatePositionMultiplier(legacyPoints, truePosition, assignedPosition) {
  if (!truePosition || !assignedPosition || truePosition !== assignedPosition) {
    return 1;
  }

  return multiplierForLegacyPoints(legacyPoints);
}

function calculateProjectedScore(legacyPoints, goatScore, truePosition, assignedPosition) {
  const baseScore = legacyPoints + goatScore;
  const multiplier = calculatePositionMultiplier(legacyPoints, truePosition, assignedPosition);

  return Number((baseScore * multiplier).toFixed(2));
}

function calculatePositionBonus(legacyPoints, goatScore, truePosition, assignedPosition) {
  const baseScore = legacyPoints + goatScore;

  return Number((calculateProjectedScore(legacyPoints, goatScore, truePosition, assignedPosition) - baseScore).toFixed(2));
}

function stripPersistedScoreFields(player) {
  const {
    final_legacy_points,
    final_score,
    goat_ranking,
    goat_ranking_score,
    position_bonus,
    ...cleanPlayer
  } = player;

  return cleanPlayer;
}

function applyPositionBonusToPlayer(player, brefLookup, options = {}) {
  const slotKeys = options.slotKeys || DEFAULT_SLOT_KEYS;
  const goatScoreKeys = options.goatScoreKeys || DEFAULT_GOAT_SCORE_KEYS;
  const legacyPoints = numberValue(player.legacy_points);
  const goatScore = resolveGoatScore(player, goatScoreKeys);
  const { position: truePosition, source: positionSource } = resolveTruePosition(player, brefLookup);
  const assignedPosition = resolveAssignedSlotPosition(player, slotKeys);
  const baseScore = legacyPoints + goatScore;
  const positionMultiplier = calculatePositionMultiplier(legacyPoints, truePosition, assignedPosition);
  const projectedScore = calculateProjectedScore(legacyPoints, goatScore, truePosition, assignedPosition);

  return {
    player: stripPersistedScoreFields(player),
    meta: {
      assignedPosition,
      baseScore,
      goatScore,
      legacyPoints,
      positionBonus: Number((projectedScore - baseScore).toFixed(2)),
      positionMultiplier,
      positionSource,
      projectedScore,
      truePosition,
    },
  };
}

function applyPositionBonusResults(players, brefPositions, options = {}) {
  const brefLookup = isBrefLookup(brefPositions) ? brefPositions : buildBrefLookup(brefPositions);
  const slotKeys = options.slotKeys || DEFAULT_SLOT_KEYS;
  const goatScoreKeys = options.goatScoreKeys || DEFAULT_GOAT_SCORE_KEYS;

  return players.map((player) =>
    applyPositionBonusToPlayer(player, brefLookup, {
      ...options,
      goatScoreKeys,
      slotKeys,
    }),
  );
}

function applyPositionBonusToPlayers(players, brefPositions, options = {}) {
  return applyPositionBonusResults(players, brefPositions, options).map((result) => result.player);
}

function selectPlayerArray(root, preferredKey) {
  if (Array.isArray(root)) {
    return {
      players: root,
      replace(nextPlayers) {
        return nextPlayers;
      },
    };
  }

  if (!root || typeof root !== "object") {
    throw new Error("Primary player storage must be a JSON array or an object containing a player array.");
  }

  const keys = [...(preferredKey ? [preferredKey] : []), ...DEFAULT_PLAYER_ARRAY_KEYS];
  const key = keys.find((candidate) => Array.isArray(root[candidate]));

  if (!key) {
    throw new Error(
      `Could not find a player array in storage. Tried: ${keys.join(", ")}. Use --playersKey=<key> if needed.`,
    );
  }

  return {
    players: root[key],
    replace(nextPlayers) {
      return {
        ...root,
        [key]: nextPlayers,
      };
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
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  const payload = `${JSON.stringify(data, null, 2)}\n`;

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempPath, payload, "utf8");
  await fs.rename(tempPath, filePath);
}

function summarizeResults(results) {
  return results.reduce(
    (summary, result) => {
      if (result.meta.positionMultiplier > 1) {
        summary.matchedSlots += 1;
        summary.totalPositionBonus += result.meta.positionBonus;
      }

      if (!result.meta.assignedPosition) {
        summary.missingAssignedSlots += 1;
      }

      if (result.meta.positionSource !== "bref_positions.json") {
        summary.fallbackPositions += 1;
      }

      summary.totalProjectedScore += result.meta.projectedScore;

      return summary;
    },
    {
      fallbackPositions: 0,
      matchedSlots: 0,
      missingAssignedSlots: 0,
      totalProjectedScore: 0,
      totalPositionBonus: 0,
    },
  );
}

async function main() {
  const args = parseArgs(process.argv);
  const playersPath = resolvePath(args.players || args.input, PLAYERS_PATH);
  const positionsPath = resolvePath(args.positions || args.brefPositions, BREF_POSITIONS_PATH);
  const outputPath = resolvePath(args.output, playersPath);
  const slotKeys = [...splitCsv(args.slotKeys || args.slotKey), ...DEFAULT_SLOT_KEYS];
  const goatScoreKeys = [...splitCsv(args.goatScoreKeys || args.goatScoreKey), ...DEFAULT_GOAT_SCORE_KEYS];
  const dryRun = flagEnabled(args.dryRun);

  console.time("position-bonus: total");
  console.log(`Loading players from ${playersPath}`);
  console.log(`Loading B-Ref positions from ${positionsPath}`);

  console.time("position-bonus: read");
  const [playerStorage, brefPositions] = await Promise.all([
    readJson(playersPath, "Player storage"),
    readJson(positionsPath, "B-Ref positions"),
  ]);
  console.timeEnd("position-bonus: read");

  const storage = selectPlayerArray(playerStorage, args.playersKey);

  console.time("position-bonus: lookup");
  const brefLookup = buildBrefLookup(brefPositions);
  console.timeEnd("position-bonus: lookup");

  console.time("position-bonus: map");
  const results = applyPositionBonusResults(storage.players, brefLookup, { goatScoreKeys, slotKeys });
  console.timeEnd("position-bonus: map");

  const outputStorage = storage.replace(results.map((result) => result.player));
  const summary = summarizeResults(results);

  if (dryRun) {
    console.log("Dry run enabled; no files were written.");
  } else {
    console.time("position-bonus: write");
    await writeJsonAtomically(outputPath, outputStorage);
    console.timeEnd("position-bonus: write");
  }

  console.log(`Processed ${results.length} players.`);
  console.log(`Position multipliers matched ${summary.matchedSlots} players.`);
  console.log(`Players without an assigned active slot: ${summary.missingAssignedSlots}.`);
  console.log(`Players using primary_position fallback: ${summary.fallbackPositions}.`);
  console.log(`Total projected position lift: ${summary.totalPositionBonus}`);
  console.log(`Total projected score: ${summary.totalProjectedScore}`);

  if (!dryRun) {
    console.log(`Updated player storage at ${outputPath}`);
  }
  console.timeEnd("position-bonus: total");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  applyPositionBonusResults,
  applyPositionBonusToPlayer,
  applyPositionBonusToPlayers,
  buildBrefLookup,
  calculatePositionBonus,
  calculatePositionMultiplier,
  calculateProjectedScore,
  multiplierForLegacyPoints,
  normalizePosition,
  resolveAssignedSlotPosition,
  resolveTruePosition,
};
