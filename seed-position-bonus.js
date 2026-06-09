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
  "goat_ranking",
  "goatRanking",
  "goat_ranking_score",
  "goatRankingScore",
  "goat_score",
  "goatScore",
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
    return rawRecord.map(normalizePosition).find(Boolean) || null;
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

function buildBrefLookup(brefPositions) {
  const exact = new Map();
  const normalized = new Map();

  for (const [name, rawRecord] of Object.entries(brefPositions || {})) {
    const position = positionFromBrefRecord(rawRecord);

    if (!position) {
      continue;
    }

    exact.set(name, position);

    const normalizedName = normalizeName(name);
    if (normalizedName && !normalized.has(normalizedName)) {
      normalized.set(normalizedName, position);
    }
  }

  return { exact, normalized };
}

function playerNameCandidates(player) {
  return Array.from(
    new Set([
      player?.name,
      `${player?.first_name || ""} ${player?.last_name || ""}`.trim(),
    ].filter(Boolean)),
  );
}

function resolveTruePosition(player, brefLookup) {
  for (const name of playerNameCandidates(player)) {
    if (brefLookup.exact.has(name)) {
      return {
        position: brefLookup.exact.get(name),
        source: "bref_positions.json",
      };
    }
  }

  for (const name of playerNameCandidates(player)) {
    const normalizedName = normalizeName(name);

    if (brefLookup.normalized.has(normalizedName)) {
      return {
        position: brefLookup.normalized.get(normalizedName),
        source: "bref_positions.json",
      };
    }
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

function candidateSlotValues(player, slotKeys) {
  const values = [];

  for (const key of slotKeys) {
    const value = valueAtPath(player, key);

    if (value !== undefined && value !== null && value !== "") {
      values.push(value);
    }
  }

  return values;
}

function positionFromSlotValue(value) {
  if (Array.isArray(value)) {
    return value.map(positionFromSlotValue).find(Boolean) || null;
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
  for (const value of candidateSlotValues(player, slotKeys)) {
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
  return legacyPoints < 100 ? 0.15 : 0.1;
}

function calculatePositionBonus(legacyPoints, truePosition, assignedPosition) {
  if (!truePosition || !assignedPosition || truePosition !== assignedPosition) {
    return 0;
  }

  return legacyPoints * multiplierForLegacyPoints(legacyPoints);
}

function applyPositionBonusToPlayer(player, brefLookup, options = {}) {
  const slotKeys = options.slotKeys || DEFAULT_SLOT_KEYS;
  const goatScoreKeys = options.goatScoreKeys || DEFAULT_GOAT_SCORE_KEYS;
  const legacyPoints = numberValue(player.legacy_points);
  const goatRanking = resolveGoatScore(player, goatScoreKeys);
  const { position: truePosition, source: positionSource } = resolveTruePosition(player, brefLookup);
  const assignedPosition = resolveAssignedSlotPosition(player, slotKeys);
  const positionBonus = calculatePositionBonus(legacyPoints, truePosition, assignedPosition);

  return {
    player: {
      ...player,
      position_bonus: positionBonus,
      final_score: legacyPoints + goatRanking + positionBonus,
    },
    meta: {
      assignedPosition,
      goatRanking,
      legacyPoints,
      positionBonus,
      positionSource,
      truePosition,
    },
  };
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
      if (result.meta.positionBonus > 0) {
        summary.matchedSlots += 1;
        summary.totalPositionBonus += result.meta.positionBonus;
      }

      if (!result.meta.assignedPosition) {
        summary.missingAssignedSlots += 1;
      }

      if (result.meta.positionSource !== "bref_positions.json") {
        summary.fallbackPositions += 1;
      }

      summary.totalFinalScore += result.player.final_score;

      return summary;
    },
    {
      fallbackPositions: 0,
      matchedSlots: 0,
      missingAssignedSlots: 0,
      totalFinalScore: 0,
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
  const dryRun = args.dryRun === true || args.dryRun === "true";

  console.log(`Loading players from ${playersPath}`);
  console.log(`Loading B-Ref positions from ${positionsPath}`);

  const [playerStorage, brefPositions] = await Promise.all([
    readJson(playersPath, "Player storage"),
    readJson(positionsPath, "B-Ref positions"),
  ]);
  const storage = selectPlayerArray(playerStorage, args.playersKey);
  const brefLookup = buildBrefLookup(brefPositions);
  const results = storage.players.map((player) =>
    applyPositionBonusToPlayer(player, brefLookup, { goatScoreKeys, slotKeys }),
  );
  const outputStorage = storage.replace(results.map((result) => result.player));
  const summary = summarizeResults(results);

  if (dryRun) {
    console.log("Dry run enabled; no files were written.");
  } else {
    await writeJsonAtomically(outputPath, outputStorage);
  }

  console.log(`Processed ${results.length} players.`);
  console.log(`Position bonuses applied to ${summary.matchedSlots} players.`);
  console.log(`Players without an assigned active slot: ${summary.missingAssignedSlots}.`);
  console.log(`Players using primary_position fallback: ${summary.fallbackPositions}.`);
  console.log(`Total position_bonus: ${summary.totalPositionBonus}`);
  console.log(`Total final_score: ${summary.totalFinalScore}`);

  if (!dryRun) {
    console.log(`Updated player storage at ${outputPath}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  applyPositionBonusToPlayer,
  buildBrefLookup,
  calculatePositionBonus,
  multiplierForLegacyPoints,
  normalizePosition,
  resolveAssignedSlotPosition,
  resolveTruePosition,
};
