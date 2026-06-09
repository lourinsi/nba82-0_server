const fs = require("fs/promises");
const path = require("path");
const { applyLegacyPoints } = require("./legacyPoints");

const OUTPUT_PATH = path.join(__dirname, "data", "players_accolades.json");

async function main() {
  const players = JSON.parse(await fs.readFile(OUTPUT_PATH, "utf8"));
  const outputPlayers = applyLegacyPoints(players);
  const totalLegacyPoints = outputPlayers.reduce((sum, player) => sum + Number(player.legacy_points || 0), 0);

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(outputPlayers, null, 2)}\n`);

  console.log(`Updated legacy_points for ${outputPlayers.length} players at ${OUTPUT_PATH}`);
  console.log(`Current dataset total legacy_points: ${Number(totalLegacyPoints.toFixed(2))}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
