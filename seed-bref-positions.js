const fs = require("fs/promises");
const path = require("path");
const { applyBrefPositionOverrides, summarizeBrefPositionMatches } = require("./brefPositions");

const PLAYERS_PATH = path.join(__dirname, "data", "players_accolades.json");
const BREF_POSITIONS_PATH = path.join(__dirname, "data", "bref_positions.json");

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
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);

  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

function positionsMatch(left = [], right = []) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((position, index) => position === right[index])
  );
}

function positionChanged(before, after) {
  return before.primary_position !== after.primary_position || !positionsMatch(before.positions, after.positions);
}

function summarizeChanges(beforePlayers, afterPlayers) {
  let changed = 0;

  for (let index = 0; index < beforePlayers.length; index += 1) {
    if (positionChanged(beforePlayers[index], afterPlayers[index])) {
      changed += 1;
    }
  }

  return { changed, unchanged: beforePlayers.length - changed };
}

async function main() {
  const args = parseArgs(process.argv);
  const playersPath = resolvePath(args.players || args.input, PLAYERS_PATH);
  const positionsPath = resolvePath(args.positions || args.brefPositions, BREF_POSITIONS_PATH);
  const outputPath = resolvePath(args.output, playersPath);
  const dryRun = flagEnabled(args.dryRun);

  console.time("bref-positions: total");
  console.time("bref-positions: read");
  const [players, brefPositions] = await Promise.all([
    readJson(playersPath, "Player storage"),
    readJson(positionsPath, "B-Ref positions"),
  ]);
  console.timeEnd("bref-positions: read");

  if (!Array.isArray(players)) {
    throw new Error("Player storage must be a JSON array.");
  }

  console.time("bref-positions: apply");
  const outputPlayers = applyBrefPositionOverrides(players, brefPositions);
  console.timeEnd("bref-positions: apply");

  const summary = summarizeChanges(players, outputPlayers);
  const matchSummary = summarizeBrefPositionMatches(players, brefPositions);

  if (dryRun) {
    console.log("Dry run enabled; no files were written.");
  } else {
    console.time("bref-positions: write");
    await writeJsonAtomically(outputPath, outputPlayers);
    console.timeEnd("bref-positions: write");
  }

  console.log(`Processed ${outputPlayers.length} players.`);
  console.log(`Matched ${matchSummary.matched} players to B-Ref positions.`);
  console.log(`Players missing from B-Ref lookup: ${matchSummary.missing}.`);
  console.log(`Overwrote positions from B-Ref for ${summary.changed} players.`);
  console.log(`Players already matching or not matched: ${summary.unchanged}.`);

  if (!dryRun) {
    console.log(`Updated player storage at ${outputPath}`);
  }
  console.timeEnd("bref-positions: total");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  summarizeChanges,
};
