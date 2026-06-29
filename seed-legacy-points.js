const fs = require("fs/promises");
const path = require("path");
const { applyBrefPrimaryPositions } = require("./brefPositions");
const { applyClassicPointsToPlayers } = require("./classicPoints");
const { LEGACY_ENGINE_FACTORS, applyLegacyPoints } = require("./legacyPoints");
const {
  buildStatTitleWinnerLookup,
  normalizePlayerAccoladeRecords,
} = require("./playerAccoladeRecords");
const { normalizePlayerTeams } = require("./teamFranchises");

const OUTPUT_PATH = path.join(__dirname, "data", "players_accolades_bref.json");
const BREF_POSITIONS_PATH = path.join(__dirname, "data", "bref_positions.json");
const STAT_TITLE_CACHE_PATH = path.join(__dirname, "data", "stat_title_winners.json");
const THREE_POINT_CONTEST_CACHE_PATH = path.join(__dirname, "data", "three_point_contest_winners.json");

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

function applyLegacyScoringPipeline(players, options = {}) {
  const statTitleRowsByPlayerId =
    options.statTitleRowsByPlayerId || buildStatTitleWinnerLookup(options.statTitleCache);
  const normalizedPlayers = normalizePlayerAccoladeRecords(players, {
    statTitleCache: options.statTitleCache,
    statTitleRowsByPlayerId,
    threePointContestCache: options.threePointContestCache,
  });
  const positionedPlayers = options.brefPositions
    ? applyBrefPrimaryPositions(normalizedPlayers, options.brefPositions)
    : normalizedPlayers;
  const teamNormalizedPlayers = positionedPlayers.map(normalizePlayerTeams);
  const classicPlayers = applyClassicPointsToPlayers(teamNormalizedPlayers);

  return applyLegacyPoints(classicPlayers);
}

async function main() {
  console.time("legacy-points: total");
  console.log(`Recalculating legacy points for players in ${OUTPUT_PATH}...`);
  console.log(`Using legacy engine factors: ${JSON.stringify(LEGACY_ENGINE_FACTORS)}`);

  console.time("legacy-points: read");
  const [players, brefPositions, statTitleCache, threePointContestCache] = await Promise.all([
    JSON.parse(await fs.readFile(OUTPUT_PATH, "utf8")),
    readJsonIfExists(BREF_POSITIONS_PATH),
    readJsonIfExists(STAT_TITLE_CACHE_PATH),
    readJsonIfExists(THREE_POINT_CONTEST_CACHE_PATH),
  ]);
  console.timeEnd("legacy-points: read");

  console.time("legacy-points: in-memory pipeline");
  const outputPlayers = applyLegacyScoringPipeline(players, {
    brefPositions,
    statTitleCache,
    threePointContestCache,
  });
  console.timeEnd("legacy-points: in-memory pipeline");

  const totalLegacyPoints = outputPlayers.reduce((sum, player) => sum + Number(player.legacy_points || 0), 0);

  console.time("legacy-points: write");
  await writeJsonAtomically(OUTPUT_PATH, outputPlayers);
  console.timeEnd("legacy-points: write");

  console.log(`Updated legacy_points for ${outputPlayers.length} players at ${OUTPUT_PATH}`);
  console.log(`Current dataset total legacy_points: ${Number(totalLegacyPoints.toFixed(2))}`);
  console.timeEnd("legacy-points: total");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  applyLegacyScoringPipeline,
};
