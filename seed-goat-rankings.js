const fs = require("fs/promises");
const path = require("path");
const {
  GOAT_RANKINGS_PATH,
  applyGoatRankingsToPlayers,
  countMatchedGoatRankings,
  fetchBleacherReportGoatRankings,
  loadCachedGoatRankings,
  saveCachedGoatRankings,
} = require("./mediaGoatRankings");

const OUTPUT_PATH = path.join(__dirname, "data", "players_accolades.json");

function parseArgs(argv) {
  const args = {};

  for (const arg of argv.slice(2)) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value === undefined ? true : value;
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const useCached = args.cached === true || args.cached === "true";
  const rankings = useCached ? await loadCachedGoatRankings() : await fetchBleacherReportGoatRankings();

  if (!rankings.length) {
    throw new Error(`No cached GOAT rankings found at ${GOAT_RANKINGS_PATH}.`);
  }

  if (!useCached) {
    await saveCachedGoatRankings(rankings);
    console.log(`Cached ${rankings.length} GOAT rankings at ${GOAT_RANKINGS_PATH}`);
  }

  const players = JSON.parse(await fs.readFile(OUTPUT_PATH, "utf8"));
  const rankedPlayers = applyGoatRankingsToPlayers(players, rankings);
  const matchedPlayerRecords = countMatchedGoatRankings(rankedPlayers);
  const matchedUniqueRanks = new Set(
    rankedPlayers.flatMap((player) => (player.goat_rank ? [player.goat_rank] : [])),
  ).size;
  const totalGoatScore = rankedPlayers.reduce(
    (sum, player) => sum + Number(player.goat_score || 0),
    0,
  );

  console.log(
    `Matched GOAT rankings to ${matchedPlayerRecords} player records (${matchedUniqueRanks}/${rankings.length} unique rankings) in the current dataset.`,
  );
  console.log(`Current dataset GOAT score total: ${totalGoatScore}`);
  console.log(`players_accolades.json was not modified. GOAT is applied as an API/frontend overlay.`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
