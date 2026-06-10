const fs = require("fs/promises");
const path = require("path");
const {
  GOAT_RANKINGS_PATH,
  applyGoatRankingsToPlayers: applyMediaGoatRankingsToPlayers,
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

function flagEnabled(value) {
  return value === true || ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

async function refreshMediaGoatRankings(args) {
  const useCached = flagEnabled(args.cached);
  const rankings = useCached ? await loadCachedGoatRankings() : await fetchBleacherReportGoatRankings();

  if (!rankings.length) {
    throw new Error(`No cached GOAT rankings found at ${GOAT_RANKINGS_PATH}.`);
  }

  if (!useCached) {
    await saveCachedGoatRankings(rankings);
    console.log(`Cached ${rankings.length} GOAT rankings at ${GOAT_RANKINGS_PATH}`);
  }

  const players = JSON.parse(await fs.readFile(OUTPUT_PATH, "utf8"));
  const rankedPlayers = applyMediaGoatRankingsToPlayers(players, rankings);
  const matchedPlayerRecords = countMatchedGoatRankings(rankedPlayers);
  const matchedUniqueRanks = new Set(
    rankedPlayers.flatMap((player) => (player.goat_rank ? [player.goat_rank] : [])),
  ).size;
  const totalGoatScore = rankedPlayers.reduce(
    (sum, player) => sum + Number(player.goat_score || 0),
    0,
  );

  console.log(
    `Matched media GOAT rankings to ${matchedPlayerRecords} player records (${matchedUniqueRanks}/${rankings.length} unique rankings) in the current dataset.`,
  );
  console.log(`Current dataset media GOAT score total: ${totalGoatScore}`);
  console.log("players_accolades.json was not modified. Media GOAT is applied as an API/frontend overlay.");
}

async function main() {
  const args = parseArgs(process.argv);

  await refreshMediaGoatRankings(args);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  refreshMediaGoatRankings,
};
