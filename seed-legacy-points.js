const fs = require("fs/promises");
const path = require("path");
const brefPositions = require("./data/bref_positions.json");
const { applyBrefPrimaryPositions } = require("./brefPositions");
const { applyClassicPointsToPlayers } = require("./classicPoints");
const { applyLegacyPoints } = require("./legacyPoints");
const { normalizePlayerAccoladeRecords } = require("./playerAccoladeRecords");
const { normalizePlayerTeams } = require("./teamFranchises");

const OUTPUT_PATH = path.join(__dirname, "data", "players_accolades.json");
const STAT_TITLE_CACHE_PATH = path.join(__dirname, "data", "stat_title_winners.json");

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

async function main() {
  console.log(`Recalculating legacy points for players in ${OUTPUT_PATH}...`);
  const players = JSON.parse(await fs.readFile(OUTPUT_PATH, "utf8"));
  const statTitleCache = await readJsonIfExists(STAT_TITLE_CACHE_PATH);
  const normalizedPlayers = applyBrefPrimaryPositions(
    normalizePlayerAccoladeRecords(players, { statTitleCache }).map(normalizePlayerTeams),
    brefPositions,
  );
  const outputPlayers = applyClassicPointsToPlayers(applyLegacyPoints(normalizedPlayers));
  const totalLegacyPoints = outputPlayers.reduce((sum, player) => sum + Number(player.legacy_points || 0), 0);

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(outputPlayers, null, 2)}\n`);

  console.log(`Updated legacy_points for ${outputPlayers.length} players at ${OUTPUT_PATH}`);
  console.log(`Current dataset total legacy_points: ${Number(totalLegacyPoints.toFixed(2))}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
