const assert = require("assert");
const {
  normalizePlayerAccoladeRecord,
  normalizePlayerAccoladeRecords,
} = require("../playerAccoladeRecords");

function scoringTitleSeasons(player) {
  return (player.awards_raw || [])
    .filter((award) => award.description === "NBA Scoring Title")
    .map((award) => award.season)
    .sort();
}

function verifyMikanBaaFallback() {
  const player = {
    name: "George Mikan",
    career_seasons: [
      { season: "1948-49", team: "LAL" },
      { season: "1949-50", team: "LAL" },
      { season: "1950-51", team: "LAL" },
    ],
    accolades: {},
    awards_raw: [],
  };
  const brefPerGameCache = {
    seasons: {
      "1948-49": {
        rows: [
          { season: "1948-49", player: "George Mikan", bref_id: "mikange01", team: "MNL", ppg: 28.3 },
          { season: "1948-49", player: "Joe Fulks", bref_id: "fulksjo01", team: "PHW", ppg: 26 },
        ],
      },
      "1949-50": {
        rows: [
          { season: "1949-50", player: "George Mikan", bref_id: "mikange01", team: "MNL", ppg: 27.4 },
          { season: "1949-50", player: "Dolph Schayes", bref_id: "schaydo01", team: "SYR", ppg: 16.8 },
        ],
      },
      "1950-51": {
        rows: [
          { season: "1950-51", player: "George Mikan", bref_id: "mikange01", team: "MNL", ppg: 28.4 },
          { season: "1950-51", player: "Ed Macauley", bref_id: "macaued01", team: "BOS", ppg: 20.4 },
        ],
      },
    },
  };

  const normalized = normalizePlayerAccoladeRecord(player, { brefPerGameCache });

  assert.strictEqual(normalized.accolades.scoring_titles, 3);
  assert.deepStrictEqual(scoringTitleSeasons(normalized), ["1948-49", "1949-50", "1950-51"]);
}

function verifyNbaStatsAndBrefDoNotDuplicateSameTitle() {
  const player = {
    name: "Paul Arizin",
    nba_stats_id: 76056,
    career_seasons: [{ season: "1951-52", team: "GSW" }],
    accolades: {},
    awards_raw: [],
  };
  const statTitleCache = {
    winners: {
      "1951-52": {
        PTS: [{ player_id: 76056, player: "Paul Arizin", team: "PHW", value: 25.4 }],
      },
    },
  };
  const brefPerGameCache = {
    seasons: {
      "1951-52": {
        rows: [
          { season: "1951-52", player: "Paul Arizin", bref_id: "arizipa01", team: "GSW", ppg: 25.4 },
          { season: "1951-52", player: "George Mikan", bref_id: "mikange01", team: "LAL", ppg: 23.8 },
        ],
      },
    },
  };

  const [normalized] = normalizePlayerAccoladeRecords([player], {
    brefPerGameCache,
    statTitleCache,
  });

  assert.strictEqual(normalized.accolades.scoring_titles, 1);
  assert.deepStrictEqual(scoringTitleSeasons(normalized), ["1951-52"]);
}

function verifyMikanHistoricalMbwaMvps() {
  const player = {
    name: "George Mikan",
    career_seasons: [
      { season: "1949-50", team: "LAL" },
      { season: "1950-51", team: "LAL" },
    ],
    accolades: {},
    awards_raw: [],
  };

  const normalized = normalizePlayerAccoladeRecord(player);
  const mbwaMvpSeasons = normalized.awards_raw
    .filter((award) => award.description === "MBWA NBA Most Valuable Player")
    .map((award) => award.season)
    .sort();

  assert.strictEqual(normalized.accolades.mvp_count, 2);
  assert.deepStrictEqual(mbwaMvpSeasons, ["1949-50", "1950-51"]);
}

function main() {
  verifyMikanBaaFallback();
  verifyNbaStatsAndBrefDoNotDuplicateSameTitle();
  verifyMikanHistoricalMbwaMvps();
  console.log("Stat-title fallback verification passed.");
}

if (require.main === module) {
  main();
}
