const fs = require("fs/promises");
const path = require("path");
const { applyLegacyScoringPipeline } = require("./seed-legacy-points");
const {
  CANONICAL_ABA_GENERATED_ACCOLADE_KEYS,
  EXPECTED_ABA_TOTALS,
  validateAbaAccoladeSource,
} = require("./abaAccolades");
const { summarizeAbaTranslationsFromPlayers } = require("./teamFranchises");

const DEFAULT_PLAYERS_PATH = path.join(__dirname, "data", "players_accolades_bref.json");
const BREF_POSITIONS_PATH = path.join(__dirname, "data", "bref_positions.json");
const BREF_PER_GAME_CACHE_PATH = path.join(__dirname, "data", "bref_per_game_stats_cache.json");
const STAT_TITLE_CACHE_PATH = path.join(__dirname, "data", "stat_title_winners.json");
const THREE_POINT_CONTEST_CACHE_PATH = path.join(__dirname, "data", "three_point_contest_winners.json");

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

function canonicalAbaCountTotal(player) {
  return CANONICAL_ABA_GENERATED_ACCOLADE_KEYS.reduce(
    (sum, key) => sum + Number(player?.accolades?.[key] || 0),
    0,
  );
}

function updatedCanonicalAbaPlayers(beforePlayers, afterPlayers) {
  const beforeById = new Map(beforePlayers.map((player) => [player.id, player]));
  const updated = [];

  for (const afterPlayer of afterPlayers) {
    const beforePlayer = beforeById.get(afterPlayer.id);

    if (canonicalAbaCountTotal(beforePlayer) !== canonicalAbaCountTotal(afterPlayer)) {
      updated.push(afterPlayer.name);
    }
  }

  return updated.sort((a, b) => a.localeCompare(b));
}

function expectedAbaPlayers() {
  return Array.from(
    new Set(
      Object.values(EXPECTED_ABA_TOTALS)
        .flatMap((totals) => Object.keys(totals)),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function skippedExpectedPlayers(players) {
  const playerNames = new Set(players.map((player) => player.name));

  return expectedAbaPlayers().filter((name) => !playerNames.has(name));
}

function totalByAccolade(players, key) {
  return players.reduce((sum, player) => sum + Number(player?.accolades?.[key] || 0), 0);
}

async function main() {
  console.time("aba-accolades: total");
  const args = parseArgs(process.argv);
  const playersPath = path.resolve(__dirname, args.players || args.file || args.input || DEFAULT_PLAYERS_PATH);
  const outputPath = path.resolve(__dirname, args.output || playersPath);
  const dryRun = flagEnabled(args.dryRun || args["dry-run"]);
  const sourceSummary = validateAbaAccoladeSource();

  console.log(`ABA source validation passed: ${sourceSummary.awardCount} MVP/Playoffs MVP rows.`);

  const [players, brefPositions, brefPerGameCache, statTitleCache, threePointContestCache] = await Promise.all([
    fs.readFile(playersPath, "utf8").then(JSON.parse),
    readJsonIfExists(BREF_POSITIONS_PATH),
    readJsonIfExists(BREF_PER_GAME_CACHE_PATH),
    readJsonIfExists(STAT_TITLE_CACHE_PATH),
    readJsonIfExists(THREE_POINT_CONTEST_CACHE_PATH),
  ]);

  if (!Array.isArray(players)) {
    throw new Error(`${playersPath} must contain a player array.`);
  }

  const outputPlayers = applyLegacyScoringPipeline(players, {
    brefPositions,
    brefPerGameCache,
    statTitleCache,
    threePointContestCache,
  });
  const skipped = skippedExpectedPlayers(outputPlayers);
  const updated = updatedCanonicalAbaPlayers(players, outputPlayers);
  const abaSummary = summarizeAbaTranslationsFromPlayers(outputPlayers);

  for (const name of updated) {
    console.log(`${dryRun ? "Would update" : "Updated"} ${name}.`);
  }

  for (const name of skipped) {
    console.warn(`Skipped ${name}: expected ABA award winner was not found in ${playersPath}.`);
  }

  if (sourceSummary.unknownTeamCodes.length || abaSummary.unknownAbaTeamCodes.length) {
    const unknownCodes = Array.from(
      new Set([...sourceSummary.unknownTeamCodes, ...abaSummary.unknownAbaTeamCodes]),
    ).sort();
    console.warn(`Unknown ABA team codes: ${unknownCodes.join(", ")}`);
  }

  if (dryRun) {
    console.log(`Dry run enabled; would write ${outputPlayers.length} players to ${outputPath}.`);
  } else {
    await writeJsonAtomically(outputPath, outputPlayers);
    console.log(`Wrote ${outputPlayers.length} players to ${outputPath}.`);
  }

  console.log(`ABA MVP total: ${totalByAccolade(outputPlayers, "aba_mvp_count")}`);
  console.log(`ABA Playoffs MVP total: ${totalByAccolade(outputPlayers, "aba_playoffs_mvp_count")}`);
  console.log(`ABA scoring title total: ${totalByAccolade(outputPlayers, "aba_scoring_titles")}`);
  console.log(`ABA assist title total: ${totalByAccolade(outputPlayers, "aba_assist_titles")}`);
  console.log(`ABA rebound title total: ${totalByAccolade(outputPlayers, "aba_rebound_titles")}`);
  console.log(`Skipped expected ABA award players: ${skipped.length}`);
  console.timeEnd("aba-accolades: total");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  skippedExpectedPlayers,
  updatedCanonicalAbaPlayers,
};
