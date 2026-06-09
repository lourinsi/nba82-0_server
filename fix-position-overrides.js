const fs = require("fs/promises");
const path = require("path");

const OUTPUT_PATH = path.join(__dirname, "data", "players_accolades.json");

const POSITION_OVERRIDES = [
  {
    matches: ({ name, nba_stats_id, balldontlie_id }) =>
      name === "Dennis Rodman" || Number(nba_stats_id) === 23 || Number(balldontlie_id) === 552,
    positions: ["PF", "C"],
  },
];

async function main() {
  const players = JSON.parse(await fs.readFile(OUTPUT_PATH, "utf8"));
  let changed = 0;

  for (const player of players) {
    const override = POSITION_OVERRIDES.find(({ matches }) => matches(player));

    if (!override) {
      continue;
    }

    const nextPositions = [...override.positions];
    const samePositions =
      Array.isArray(player.positions) &&
      player.positions.length === nextPositions.length &&
      player.positions.every((position, index) => position === nextPositions[index]);

    if (samePositions && player.primary_position === nextPositions[0]) {
      continue;
    }

    player.positions = nextPositions;
    player.primary_position = nextPositions[0];
    changed += 1;
  }

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(players, null, 2)}\n`);
  console.log(`Applied position overrides to ${changed} player${changed === 1 ? "" : "s"}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
